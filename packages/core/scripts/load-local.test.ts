import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertDockerMemory,
  assertLocalUrls,
  isLoadRefusal,
  isLoadStackDatabase,
  LOAD_STACK,
  loadUrls,
  REPO_ROOT,
} from './load-local.ts';

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

  it('refuses a remote API address', () => {
    expect(refusalOf(() => loadUrls({ LOAD_API_URL: 'https://brij-crm-phi.vercel.app' }))?.exitCode).toBe(3);
  });

  it('knows the load stack’s own database by its port', () => {
    expect(isLoadStackDatabase(LOAD_STACK.ownerUrl)).toBe(true);
    expect(isLoadStackDatabase('postgres://crm_owner:x@localhost:5433/load_smoke')).toBe(false);
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

  it('marks every secret local-only', () => {
    const secrets = [...file.matchAll(/(?:SECRET|KEY|ADMIN_PASSWORD)\w*: (\S+)/g)].map((match) => match[1]);
    expect(secrets.length).toBeGreaterThan(4);
    for (const secret of secrets) expect(secret).toContain('local-only');
  });
});
