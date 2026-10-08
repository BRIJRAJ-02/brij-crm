import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertDockerMemory,
  assertLoginsApart,
  assertLocalUrls,
  isLoadRefusal,
  isLoadStackDatabase,
  LOAD_STACK,
  loadUrls,
  REPO_ROOT,
} from './load-local.ts';
import { hostsOf, NO_HOST } from './local-only.ts';

function refusalOf(work: () => unknown): { message: string; exitCode: number } | undefined {
  try {
    work();
  } catch (error) {
    if (isLoadRefusal(error)) return { message: error.message, exitCode: error.exitCode };
    throw error;
  }
  return undefined;
}

describe('the localhost guard', () => {
  it('lets every load stack default through', () => {
    const urls = loadUrls({});
    expect(urls.LOAD_DATABASE_URL_OWNER).toBe(LOAD_STACK.ownerUrl);
    expect(urls.LOAD_API_URL).toBe(LOAD_STACK.apiUrl);
  });

  it('accepts localhost, 127.0.0.1 and ::1', () => {
    expect(
      refusalOf(() =>
        assertLocalUrls({
          a: 'postgres://u:p@localhost:5433/load_x',
          b: 'http://127.0.0.1:3100',
          c: 'postgres://u:p@[::1]:5434/crm',
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses a remote host with exit 3, and names it', () => {
    const refused = refusalOf(() => loadUrls({ LOAD_DATABASE_URL_OWNER: 'postgres://u:p@ep-cool-1.neon.tech/crm' }));
    expect(refused?.exitCode).toBe(3);
    expect(refused?.message).toContain('ep-cool-1.neon.tech');
  });

  it('refuses a remote host hidden in the query string', () => {
    const refused = refusalOf(() => assertLocalUrls({ db: 'postgres://u:p@localhost/crm?host=db.example.com' }));
    expect(refused?.exitCode).toBe(3);
    expect(refused?.message).toContain('db.example.com');
  });

  it('refuses a database URL with no host, which node-postgres would send to PGHOST', () => {
    const before = process.env.PGHOST;
    process.env.PGHOST = 'ep-cool-1.neon.tech';
    try {
      for (const url of ['postgres:///crm', 'postgres://u:p@localhost/crm?host=']) {
        const refused = refusalOf(() => assertLocalUrls({ LOAD_DATABASE_URL_OWNER: url }));
        expect(refused?.exitCode, url).toBe(3);
        expect(refused?.message).toContain(NO_HOST);
      }
      expect(refusalOf(() => loadUrls({ LOAD_DATABASE_URL_OWNER: 'postgres:///crm' }))?.exitCode).toBe(3);
      // A URL that names localhost wins over PGHOST, so it stays allowed.
      expect(refusalOf(() => assertLocalUrls({ db: 'postgres://u:p@localhost:5434/crm' }))).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.PGHOST;
      else process.env.PGHOST = before;
    }
  });

  it('refuses a URL that does not parse', () => {
    expect(refusalOf(() => assertLocalUrls({ db: 'postgres://u:p@/crm' }))?.exitCode).toBe(3);
  });

  it('names an empty host for the older scale scripts’ guard too', () => {
    expect(hostsOf('postgres:///crm')).toEqual([NO_HOST]);
    expect(hostsOf('postgres://u:p@localhost/crm?host=db.example.com')).toEqual(['localhost', 'db.example.com']);
  });

  it('refuses a remote API address', () => {
    expect(refusalOf(() => loadUrls({ LOAD_API_URL: 'https://brij-crm-phi.vercel.app' }))?.exitCode).toBe(3);
  });

  it('knows the load stack’s own database by its port', () => {
    expect(isLoadStackDatabase(LOAD_STACK.ownerUrl)).toBe(true);
    expect(isLoadStackDatabase('postgres://crm_owner:x@localhost:5433/load_smoke')).toBe(false);
  });
});

describe('setting up logins off the load stack', () => {
  const dev = 'postgres://crm_owner:crm_owner_local@localhost:5433/load_proof';
  const apart = (env: Record<string, string>) => refusalOf(() => assertLoginsApart(env, loadUrls(env)));

  it('lets the load stack’s own logins through on the load stack', () => {
    expect(apart({})).toBeUndefined();
  });

  it('refuses the dev Postgres when the login URLs are left at their defaults', () => {
    const refused = apart({ LOAD_DATABASE_URL_OWNER: dev });
    expect(refused?.exitCode).toBe(3);
    expect(refused?.message).toContain('the dev Postgres');
  });

  it('refuses the dev Postgres when a login URL names the stack’s (and the dev stack’s) login', () => {
    const refused = apart({
      LOAD_DATABASE_URL_OWNER: dev,
      LOAD_PGBOUNCER_URL: 'postgres://crm_app_user:x@localhost:5433/load_proof',
      LOAD_IDENTITY_DATABASE_URL: 'postgres://load_identity:x@localhost:5433/load_proof',
    });
    expect(refused?.message).toContain('crm_app_user');
  });

  it('lets another local Postgres through when both logins are its own', () => {
    expect(
      apart({
        LOAD_DATABASE_URL_OWNER: dev,
        LOAD_PGBOUNCER_URL: 'postgres://load_app:x@localhost:5433/load_proof',
        LOAD_IDENTITY_DATABASE_URL: 'postgres://load_identity:x@localhost:5433/load_proof',
      }),
    ).toBeUndefined();
  });
});

describe('the Docker memory check', () => {
  it('refuses under 11 GB with exit 3, naming what Docker has', () => {
    const refused = refusalOf(() => assertDockerMemory(8_319_770_624));
    expect(refused?.exitCode).toBe(3);
    expect(refused?.message).toContain('7.75 GB');
  });

  it('lets 12 GB through', () => {
    expect(refusalOf(() => assertDockerMemory(12 * 1024 ** 3))).toBeUndefined();
  });
});

describe('docker-compose.load.yml', () => {
  const file = readFileSync(join(REPO_ROOT, LOAD_STACK.composeFile), 'utf8');

  it('is its own project with its own volume', () => {
    expect(file).toMatch(/^name: crm-load$/m);
    expect(file).toContain('name: crm-load-postgres');
  });

  it('holds the same secrets and logins as the load scripts', () => {
    expect(file).toContain(`BETTER_AUTH_SECRET: ${LOAD_STACK.betterAuthSecret}`);
    const app = new URL(LOAD_STACK.appUrl);
    expect(file).toContain(`DB_USER: ${app.username}`);
    expect(file).toContain(`DB_PASSWORD: ${app.password}`);
    const identity = new URL(LOAD_STACK.identityUrl);
    expect(file).toContain(`${identity.username}:${identity.password}@postgres:5432/crm`);
  });

  it('binds every port the scripts use to this machine only', () => {
    const { ports } = LOAD_STACK;
    for (const port of [ports.postgres, ports.pgbouncer, ports.api, ports.worker, ports.centrifugo, ports.mailpit]) {
      expect(file).toContain(`"127.0.0.1:${String(port)}:`);
    }
    expect(file).not.toMatch(/- "\d+:\d+"/);
  });

  it('caps Postgres at 2 vCPU and 8 GB with load.conf', () => {
    expect(file).toContain('config_file=/etc/postgresql/load.conf');
    expect(file).toMatch(/cpus: "2"\n\s+memory: 8g/);
  });

  it('marks every secret and password local-only, in variables and in connection URLs', () => {
    const secrets = [...file.matchAll(/(?:SECRET|KEY|PASSWORD)\w*: (\S+)/g)].map((match) => match[1]);
    const inUrls = [...file.matchAll(/postgres:\/\/[^:\s]+:([^@\s]+)@/g)].map((match) => match[1]);
    expect(secrets.length).toBeGreaterThan(6);
    expect(inUrls.length).toBeGreaterThan(3);
    for (const secret of [...secrets, ...inUrls]) expect(secret).toContain('local-only');
  });
});
