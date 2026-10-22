// The load commands' setup refusals (spec 0011, AC-203, AC-209, AC-210): with
// any address that isn't this machine, `load:run` exits 3 before it reads or
// reaches anything, and so does an unknown scenario, or none at all. The
// checks run in process (`preflightRun`, which the command calls before it
// imports the harness); one smoke test runs the real command in a child to
// prove the refusal becomes exit 3. `load:reset`'s refusal is tested beside it
// in @crm/core (`load-reset.test.ts`).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isLoadRefusal } from '@crm/core/load-local';
import { describe, expect, it } from 'vitest';
import { preflightRun } from '../src/preflight.ts';
import { assertSessionsApi, objectOf, plannedCreates, scenarioOf } from '../src/run.ts';
import { threadsFor } from '../src/scenarios.ts';

const RUN = fileURLToPath(new URL('./run.ts', import.meta.url));

/** The refusal `work` throws (its message and exit code), or undefined when it passes. */
function refusalOf(work: () => unknown): { message: string; exitCode: number } | undefined {
  try {
    work();
  } catch (error) {
    if (isLoadRefusal(error)) return { message: error.message, exitCode: error.exitCode };
    throw error;
  }
  return undefined;
}

describe('load:run', () => {
  it.each([
    ['LOAD_API_URL', 'http://api.example.com:3100'],
    ['LOAD_DATABASE_URL_OWNER', 'postgres://crm_owner:x@db.example.com:5434/crm'],
    ['LOAD_PGBOUNCER_URL', 'postgres://crm_app_user:x@10.0.0.7:6434/crm'],
    ['LOAD_CENTRIFUGO_URL', 'ws://centrifugo.example.com:8100/connection/websocket'],
  ])('refuses a remote %s with exit 3, before anything else', (name, url) => {
    const refusal = refusalOf(() => preflightRun(['steady'], { [name]: url }));
    expect(refusal?.exitCode).toBe(3);
    expect(refusal?.message).toContain(`Refusing ${name}`);
  });

  it('refuses an unknown scenario, and a missing one', () => {
    for (const args of [['soak'], []]) {
      const refusal = refusalOf(() => preflightRun(args, {}));
      expect(refusal?.exitCode).toBe(3);
      expect(refusal?.message).toContain('Name a scenario');
    }
  });

  it('refuses a number that is not above 0', () => {
    expect(refusalOf(() => preflightRun(['steady', '--users', '0'], {}))?.message).toContain('--users');
    expect(refusalOf(() => preflightRun(['steady'], { LOAD_TEST_BLOCK_LOOP_MS: 'x' }))?.exitCode).toBe(3);
  });

  it('passes the load stack, answering the scenario, its options and the addresses', () => {
    const request = preflightRun(['hub', '--users', '20', '--seed', '7.9'], {});
    expect(request).toMatchObject({ scenario: 'hub', users: 20, seed: 7, minutes: undefined, threads: undefined });
    expect(request.urls.LOAD_API_URL).toBe('http://localhost:3100');
  });

  // The one child: the real command, so the refusal is shown to end the process with exit 3. It refuses before the
  // harness is imported, so it costs one Node start; the timeouts only bound a stuck child on a busy runner.
  it('ends the real command with exit 3 and the refusal', { timeout: 60_000 }, () => {
    const result = spawnSync(process.execPath, [RUN, 'steady'], {
      env: { PATH: process.env.PATH ?? '', LOAD_API_URL: 'http://api.example.com:3100' },
      encoding: 'utf8',
      timeout: 50_000,
    });
    expect(result.status).toBe(3);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing LOAD_API_URL');
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

  it('runs the gates, and the stress scenarios by validity only', () => {
    expect(scenarioOf('steady').gate).toBe(true);
    expect(scenarioOf('spread').behaviour.jumps).toBe('even');
    expect(scenarioOf('hub')).toMatchObject({ gate: false, users: 100, hub: { editEveryMs: 10_000 } });
    expect(scenarioOf('storm').gate).toBe(false);
  });

  it('plays 1,000 users for 5 minutes in thousand, by validity only, 250 users to a thread', () => {
    expect(scenarioOf('thousand')).toMatchObject({ gate: false, users: 1_000, minutes: 5 });
    expect(threadsFor(1_000)).toBe(4);
    expect(threadsFor(100)).toBe(1);
    expect(threadsFor(251)).toBe(2);
  });
});
