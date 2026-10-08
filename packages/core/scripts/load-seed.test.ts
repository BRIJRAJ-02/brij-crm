// `pnpm load:seed` and `pnpm load:sessions` refuse before touching anything
// (spec 0011, AC-195, AC-210): a remote address and an unknown profile exit 3.
// The seeding itself is proved by seed-crm.test.ts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function run(script: string, args: readonly string[], env: Readonly<Record<string, string>>) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('pnpm load:seed', () => {
  it('refuses a database that isn’t on this machine, with exit 3', () => {
    const { status, output } = run('./load-seed.ts', [], {
      LOAD_DATABASE_URL_OWNER: 'postgres://crm_owner:x@ep-example.neon.tech/crm',
    });
    expect(status).toBe(3);
    expect(output).toContain('ep-example.neon.tech');
  });

  it('refuses an API that isn’t on this machine, with exit 3', () => {
    const { status } = run('./load-seed.ts', ['--profile', 'test'], {
      LOAD_API_URL: 'https://brij-crm-phi.vercel.app',
    });
    expect(status).toBe(3);
  });

  it('refuses to reset the dev Postgres’s logins, with exit 3, before connecting', () => {
    const { status, output } = run('./load-seed.ts', ['--profile', 'test'], {
      LOAD_DATABASE_URL_OWNER: 'postgres://crm_owner:crm_owner_local@localhost:5433/crm',
    });
    expect(status).toBe(3);
    expect(output).toContain('the dev Postgres');
  });

  it('refuses an unknown profile, with exit 3', () => {
    const { status, output } = run('./load-seed.ts', ['--profile', 'huge'], {});
    expect(status).toBe(3);
    expect(output).toContain('crm, smoke or test');
  });
});

describe('pnpm load:sessions', () => {
  it('refuses any secret but the load stack’s, with exit 3', () => {
    const { status, output } = run('./load-sessions.ts', [], {
      LOAD_BETTER_AUTH_SECRET: 'local-only-but-some-other-secret-entirely',
    });
    expect(status).toBe(3);
    expect(output).toContain('only the load stack');
  });

  it('refuses a remote database, with exit 3', () => {
    const { status } = run('./load-sessions.ts', [], { LOAD_DATABASE_URL_OWNER: 'postgres://u:p@10.1.2.3/crm' });
    expect(status).toBe(3);
  });
});
