// Making a login (spec 0005, the sign in security review): the password goes
// over as a SCRAM-SHA-256 verifier, never in plain text; an existing role loses
// any power it held; and a role in some other group is refused. Run as the
// test database's owner, which, like Neon's, is not a superuser.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { withSetupLock } from '../src/testing.ts';
import { ensureLogin, SCRAM_ITERATIONS, scramVerifier } from './login.ts';

const { ownerUrl, adminUrl } = inject('testDatabase');

let admin: pg.Client;
const made: string[] = [];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl, application_name: 'crm-login-tests' });
  await admin.connect();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const role of made.splice(0)) await admin.query(`drop role if exists ${admin.escapeIdentifier(role)}`);
});

afterAll(async () => {
  await admin.end();
  vi.restoreAllMocks();
});

function newLogin(password = `pw-${randomUUID()}`) {
  const role = `crm_test_login_${randomUUID().slice(0, 8)}`;
  made.push(role);
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = password;
  return { role, password, url: url.toString() };
}

const spec = (loginUrl: string) => ({
  ownerUrl,
  loginUrl,
  variable: 'DATABASE_URL',
  group: 'crm_app',
  apartFrom: 'crm_identity',
});

/** Connects as `url` and says who it is, or the error code Postgres answered with. */
async function connectAs(url: string): Promise<string> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query<{ user: string }>('select current_user as user');
    return result.rows[0]?.user ?? '';
  } catch (error) {
    return `refused ${(error as { code?: string }).code ?? ''}`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function stored(role: string) {
  const result = await admin.query<{
    password: string | null;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolsuper: boolean;
    in_group: boolean;
  }>(
    `select rolpassword as password, rolcreatedb, rolcreaterole, rolsuper,
       pg_has_role(rolname, 'crm_app', 'USAGE') as in_group
     from pg_authid where rolname = $1`,
    [role],
  );
  return result.rows[0];
}

describe('the SCRAM-SHA-256 verifier', () => {
  it('has the format Postgres stores, with a fresh 16 byte salt each time', () => {
    const verifier = scramVerifier('a password');
    expect(verifier).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/);
    expect(SCRAM_ITERATIONS).toBe(4096);
    expect(scramVerifier('a password')).not.toBe(verifier);
    expect(verifier).not.toContain('a password');
  });

  it('refuses a password outside printable ASCII', () => {
    expect(() => scramVerifier('pässword')).toThrow(/printable ASCII/);
  });
});

describe('ensureLogin', () => {
  it('creates a login that connects with its password, stored only as a SCRAM verifier', async () => {
    const login = newLogin();
    await ensureLogin(spec(login.url));
    expect(await connectAs(login.url)).toBe(login.role);
    const wrong = new URL(login.url);
    wrong.password = 'not-the-password';
    expect(await connectAs(wrong.toString())).toBe('refused 28P01');
    const row = await stored(login.role);
    expect(row?.password?.startsWith('SCRAM-SHA-256$4096:')).toBe(true);
    expect(row?.password).not.toContain(login.password);
    expect(row).toMatchObject({ rolcreatedb: false, rolcreaterole: false, rolsuper: false, in_group: true });
  });

  /** A login the owner made earlier (as ensureLogin does), given `powers` since by a superuser. */
  async function existingLogin(login: { role: string }, powers: string): Promise<void> {
    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      await owner.query(`create role ${login.role} login password 'old-password'`);
    } finally {
      await owner.end();
    }
    if (powers !== '') await admin.query(`alter role ${login.role} ${powers}`);
  }

  it('sets a new password on an existing login the same way, and clears powers it held', async () => {
    const login = newLogin();
    await existingLogin(login, 'createrole');
    await ensureLogin(spec(login.url));
    expect(await connectAs(login.url)).toBe(login.role);
    expect(await stored(login.role)).toMatchObject({ rolcreaterole: false, in_group: true });
    expect((await stored(login.role))?.password?.startsWith('SCRAM-SHA-256$')).toBe(true);
  });

  it("refuses an existing login with a power the owner can't clear, and leaves its password", async () => {
    // The test owner, unlike Neon's, has no CREATEDB, so it can't take it away.
    const login = newLogin();
    await existingLogin(login, 'createdb');
    const before = (await stored(login.role))?.password;
    await expect(ensureLogin(spec(login.url))).rejects.toThrow(/\(nocreatedb\), and the owner can't clear them/);
    expect(await stored(login.role)).toMatchObject({ password: before, rolcreatedb: true, in_group: false });
  });

  it('refuses an existing login in another group, before changing anything', async () => {
    const login = newLogin();
    await admin.query(`create role ${login.role} login password 'old-password' createdb`);
    await admin.query(`grant crm_search to ${login.role}`);
    await expect(ensureLogin(spec(login.url))).rejects.toThrow(/a member of crm_search/);
    expect(await stored(login.role)).toMatchObject({ rolcreatedb: true, in_group: false });
  });

  it('refuses one in pg_read_all_data the same way', () =>
    withSetupLock(async () => {
      const login = newLogin();
      try {
        await admin.query(`create role ${login.role} login password 'old-password'`);
        await admin.query(`grant pg_read_all_data to ${login.role}`);
        await expect(ensureLogin(spec(login.url))).rejects.toThrow(/a member of pg_read_all_data/);
      } finally {
        await admin.query(`drop role if exists ${login.role}`);
      }
    }));

  it('refuses one in the other group', async () => {
    const login = newLogin();
    await admin.query(`create role ${login.role} login password 'old-password'`);
    await admin.query(`grant crm_identity to ${login.role}`);
    await expect(ensureLogin(spec(login.url))).rejects.toThrow(/a member of crm_identity/);
  });
});
