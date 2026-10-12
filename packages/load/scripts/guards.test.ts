// The load commands' setup refusals (spec 0011, AC-203, AC-209, AC-210): with
// any address that isn't this machine, `load:run` and `load:reset` exit 3
// before they read or reach anything, and so does a scenario a later
// milestone builds, or none at all. Run as the real commands, in a child.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertSessionsApi, objectOf, plannedCreates, scenarioOf } from '../src/run.ts';
import { threadsFor } from '../src/scenarios.ts';

const RUN = fileURLToPath(new URL('./run.ts', import.meta.url));
const RESET = fileURLToPath(new URL('../../core/scripts/load-reset.ts', import.meta.url));

/** Runs a load command with only these variables (and PATH), answering its exit code and what it printed. */
function command(script: string, args: readonly string[], env: Readonly<Record<string, string>>) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('load:run', () => {
  it.each([
    ['LOAD_API_URL', 'http://api.example.com:3100'],
    ['LOAD_DATABASE_URL_OWNER', 'postgres://crm_owner:x@db.example.com:5434/crm'],
    ['LOAD_PGBOUNCER_URL', 'postgres://crm_app_user:x@10.0.0.7:6434/crm'],
    ['LOAD_CENTRIFUGO_URL', 'ws://centrifugo.example.com:8100/connection/websocket'],
  ])('refuses a remote %s with exit 3, before anything else', (name, url) => {
    const { status, output } = command(RUN, ['steady'], { [name]: url });
    expect(status).toBe(3);
    expect(output).toContain(`Refusing ${name}`);
  });

  it('refuses a scenario a later milestone builds, and a missing one', () => {
    const later = command(RUN, ['hub'], {});
    expect(later.status).toBe(3);
    expect(later.output).toContain('arrives with milestone 4');
    const none = command(RUN, [], {});
    expect(none.status).toBe(3);
    expect(none.output).toContain('Name a scenario');
  });
});

describe('load:reset', () => {
  it('refuses a remote owner database with exit 3', () => {
    const { status, output } = command(RESET, [], {
      LOAD_DATABASE_URL_OWNER: 'postgres://crm_owner:x@db.example.com:5434/crm',
    });
    expect(status).toBe(3);
    expect(output).toContain('Refusing LOAD_DATABASE_URL_OWNER');
  });
});

describe('the sessions file’s API (AC-210)', () => {
  it('must be this machine, and the API the run calls', () => {
    expect(() => assertSessionsApi('http://localhost:3100', 'http://localhost:3100/')).not.toThrow();
    expect(() => assertSessionsApi('https://crm.example.com', 'http://localhost:3100')).toThrow(/Refusing apiUrl/);
    expect(() => assertSessionsApi('http://localhost:3000', 'http://localhost:3100')).toThrow(/pnpm load:sessions/);
  });
});

describe('the run’s plan', () => {
  it('counts the creates a run plans, warm up included', () => {
    // 100 users × 660 seconds × 0.2 a second × 3%.
    expect(plannedCreates(100, 10)).toBeCloseTo(396);
  });

  it('spreads users over People, Deals and Companies at 50%, 30% and 20%', () => {
    const objects = Array.from({ length: 100 }, (_, index) => objectOf(index));
    const share = (key: string) => objects.filter((object) => object === key).length;
    expect(share('people')).toBeGreaterThanOrEqual(49);
    expect(share('people')).toBeLessThanOrEqual(51);
    expect(share('deals')).toBeGreaterThanOrEqual(29);
    expect(share('deals')).toBeLessThanOrEqual(31);
    expect(share('companies')).toBeGreaterThanOrEqual(19);
    expect(share('companies')).toBeLessThanOrEqual(21);
  });

  it('runs the gates and refuses the rest for now', () => {
    expect(scenarioOf('steady').gate).toBe(true);
    expect(scenarioOf('spread').behaviour.jumps).toBe('even');
    expect(() => scenarioOf('hub')).toThrow(/milestone 4/);
  });

  it('plays 1,000 users for 5 minutes in thousand, by validity only, 250 users to a thread', () => {
    expect(scenarioOf('thousand')).toMatchObject({ gate: false, users: 1_000, minutes: 5 });
    expect(threadsFor(1_000)).toBe(4);
    expect(threadsFor(100)).toBe(1);
    expect(threadsFor(251)).toBe(2);
  });
});
