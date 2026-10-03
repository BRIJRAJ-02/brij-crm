// The checks that keep the two logins plain (spec 0005, the sign in security
// review): the api refuses to start on an app or identity login that can reach
// more than its group gives it, and migration 0017 refuses to finish while any
// role can reach schema `auth` beyond crm_identity and crm_app's insert.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from './client.ts';
import { createIdentityStore } from './identity/store.ts';
import { withSetupLock } from './testing.ts';

const { appUrl, adminUrl } = inject('testDatabase');

let admin: pg.Client;
const made: string[] = [];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl, application_name: 'crm-roles-tests' });
  await admin.connect();
});

afterAll(async () => {
  await dropMade();
  await admin.end();
});

async function dropMade(): Promise<void> {
  for (const role of made.splice(0).reverse()) {
    await admin.query(`drop role if exists ${admin.escapeIdentifier(role)}`);
  }
}

/**
 * Runs `work`, which makes roles the migrations' closing checks would refuse
 * (roles belong to the whole server), while no suite is migrating, and drops
 * them before letting go.
 */
function apart(work: () => Promise<void>): () => Promise<void> {
  return () =>
    withSetupLock(async () => {
      try {
        await work();
      } finally {
        await dropMade();
      }
    });
}

const PASSWORD = 'crm_roles_test_local';

/** A new login role in `groups`, made as a superuser, with any other `options`; and its URL on the test database. */
async function login(groups: readonly string[], options = ''): Promise<string> {
  const role = `crm_test_roles_${randomUUID().slice(0, 8)}`;
  made.push(role);
  await admin.query(
    `create role ${admin.escapeIdentifier(role)} login password ${admin.escapeLiteral(PASSWORD)} ${options}`,
  );
  for (const group of groups) {
    await admin.query(`grant ${admin.escapeIdentifier(group)} to ${admin.escapeIdentifier(role)}`);
  }
  const url = new URL(appUrl);
  url.username = role;
  url.password = PASSWORD;
  return url.toString();
}

/** A nologin group role with `options` (like `createdb`), made as a superuser. */
async function group(options: string): Promise<string> {
  const role = `crm_test_group_${randomUUID().slice(0, 8)}`;
  made.push(role);
  await admin.query(`create role ${admin.escapeIdentifier(role)} nologin ${options}`);
  return role;
}

async function appCheck(url: string): Promise<void> {
  const db = createDatabase({ url, applicationName: 'crm-roles-tests' });
  try {
    await db.assertAppRole();
  } finally {
    await db.close();
  }
}

async function identityCheck(url: string): Promise<void> {
  const identity = createIdentityStore({ url, applicationName: 'crm-roles-tests' });
  try {
    await identity.assertIdentityRole();
  } finally {
    await identity.close();
  }
}

describe('the app login check', () => {
  it(
    'passes a plain member of crm_app',
    apart(async () => {
      await appCheck(await login(['crm_app']));
    }),
  );

  it.each(['pg_read_all_data', 'pg_write_all_data'])('refuses a member of %s, which skips every grant', (all) =>
    apart(async () => {
      const url = await login(['crm_app', all]);
      await expect(appCheck(url)).rejects.toThrow(new RegExp(`a member of ${all}`));
    })(),
  );

  it(
    'refuses one that reaches it through another group',
    apart(async () => {
      const middle = await group('');
      await admin.query(`grant pg_read_all_data to ${admin.escapeIdentifier(middle)}`);
      await expect(appCheck(await login(['crm_app', middle]))).rejects.toThrow(/pg_read_all_data/);
    }),
  );

  it(
    'refuses one in a group that bypasses row level security',
    apart(async () => {
      const bypass = await group('bypassrls');
      await expect(appCheck(await login(['crm_app', bypass]))).rejects.toThrow(/bypass row level security/);
    }),
  );
});

describe('the identity login check', () => {
  it(
    'passes a plain member of crm_identity',
    apart(async () => {
      await identityCheck(await login(['crm_identity']));
    }),
  );

  it.each(['pg_read_all_data', 'pg_write_all_data'])('refuses a member of %s', (all) =>
    apart(async () => {
      const url = await login(['crm_identity', all]);
      await expect(identityCheck(url)).rejects.toThrow(new RegExp(`a member of ${all}`));
    })(),
  );

  it.each(['superuser', 'bypassrls', 'createrole', 'createdb'])(
    'refuses a member of a group with %s, directly or through another group',
    (power) =>
      apart(async () => {
        const powerful = await group(power);
        await expect(identityCheck(await login(['crm_identity', powerful]))).rejects.toThrow(
          new RegExp(`a member of ${powerful}`),
        );
        const middle = await group('');
        await admin.query(`grant ${admin.escapeIdentifier(powerful)} to ${admin.escapeIdentifier(middle)}`);
        await expect(identityCheck(await login(['crm_identity', middle]))).rejects.toThrow(
          new RegExp(`a member of ${powerful}`),
        );
      })(),
  );

  it.each(['createrole', 'createdb', 'bypassrls'])('refuses a login that has %s itself', (power) =>
    apart(async () => {
      await expect(identityCheck(await login(['crm_identity'], power))).rejects.toThrow(/creates roles or databases/);
    })(),
  );

  it(
    'refuses a member of crm_app, and a role outside crm_identity',
    apart(async () => {
      await expect(identityCheck(await login(['crm_identity', 'crm_app']))).rejects.toThrow(/a member of crm_app/);
      await expect(identityCheck(await login([]))).rejects.toThrow(/not a member of crm_identity/);
    }),
  );
});

describe("migration 0017's closing check", () => {
  let check: string;

  beforeAll(async () => {
    const sql = await readFile(new URL('../migrations/0017_auth_effective_privileges.sql', import.meta.url), 'utf8');
    check = sql.slice(sql.indexOf('do $$'));
  });

  /** Runs the check after `setup`, in a transaction that is rolled back, so nothing outlives the test. */
  async function checkAfter(setup: readonly string[]): Promise<void> {
    await admin.query('begin');
    try {
      for (const statement of setup) await admin.query(statement);
      await admin.query(check);
    } finally {
      await admin.query('rollback');
    }
  }

  it('passes the database as migrated', async () => {
    await checkAfter([]);
  });

  it.each([
    [
      'a role in pg_read_all_data',
      ['create role crm_test_probe', 'grant pg_read_all_data to crm_test_probe'],
      'SELECT',
    ],
    [
      'a role in pg_write_all_data',
      ['create role crm_test_probe', 'grant pg_write_all_data to crm_test_probe'],
      'DELETE',
    ],
    [
      'a column grant',
      ['create role crm_test_probe', 'grant select (token) on auth.session to crm_test_probe'],
      'SELECT',
    ],
    [
      'a role that can SET ROLE to one with a grant',
      [
        'create role crm_test_reader',
        'grant select on auth.account to crm_test_reader',
        'create role crm_test_probe',
        'grant crm_test_reader to crm_test_probe with inherit false, set true',
      ],
      'SELECT',
    ],
    ['crm_app reading users', ['grant select on auth."user" to crm_app'], 'SELECT'],
    ['crm_identity truncating', ['grant truncate on auth.session to crm_identity'], 'TRUNCATE'],
  ])('refuses %s', async (_name, setup, privilege) => {
    await expect(checkAfter(setup)).rejects.toThrow(new RegExp(`has ${privilege} on auth\\.`));
  });

  it("tolerates the owner's own groups, as 0016 does", async () => {
    // A role the owner is in already holds what the owner holds.
    await checkAfter([
      'create role crm_test_owner_group',
      `grant crm_test_owner_group to ${admin.escapeIdentifier((await ownerName()) ?? 'crm_owner')}`,
      'grant select on auth.session to crm_test_owner_group',
    ]);
  });

  async function ownerName(): Promise<string | undefined> {
    const result = await admin.query<{ owner: string }>(
      `select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'auth'`,
    );
    return result.rows[0]?.owner;
  }
});
