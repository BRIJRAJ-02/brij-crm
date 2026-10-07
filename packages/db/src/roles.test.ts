// The checks that keep the two logins plain (spec 0005, the sign in security
// review): the api refuses to start on an app or identity login that can reach
// more than its group gives it, and migration 0018 (0017's check, tightened)
// refuses to finish while any role can reach schema `auth` beyond crm_identity
// and crm_app's insert.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { assertAppConnection, createDatabase } from './client.ts';
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

/** The quoted role name in a login URL `login` made. */
function roleOf(url: string): string {
  return admin.escapeIdentifier(decodeURIComponent(new URL(url).username));
}

/** A nologin group role with `options` (like `createdb`), made as a superuser. */
async function group(options: string): Promise<string> {
  const role = `crm_test_group_${randomUUID().slice(0, 8)}`;
  made.push(role);
  await admin.query(`create role ${admin.escapeIdentifier(role)} nologin ${options}`);
  return role;
}

/**
 * The app login check, on the pool (the api) and on one direct client (the
 * worker's relay connection): both see the same role, so they must agree.
 */
async function appCheck(url: string): Promise<void> {
  const db = createDatabase({ url, applicationName: 'crm-roles-tests' });
  const direct = new pg.Client({ connectionString: url, application_name: 'crm-roles-tests' });
  await direct.connect();
  try {
    const [pooled, single] = await Promise.allSettled([
      db.assertAppRole(),
      assertAppConnection(direct, 'DATABASE_URL_DIRECT'),
    ]);
    expect(single.status).toBe(pooled.status);
    if (pooled.status === 'rejected') throw pooled.reason;
  } finally {
    await direct.end();
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
  it('names the variable to fix: DATABASE_URL for the pool, DATABASE_URL_DIRECT for the worker', async () => {
    const direct = new pg.Client({ connectionString: adminUrl, application_name: 'crm-roles-tests' });
    await direct.connect();
    try {
      await expect(assertAppConnection(direct, 'DATABASE_URL_DIRECT')).rejects.toThrow(
        /bypass row level security\. Point DATABASE_URL_DIRECT at the app login/,
      );
    } finally {
      await direct.end();
    }
    const db = createDatabase({ url: adminUrl, applicationName: 'crm-roles-tests' });
    try {
      await expect(db.assertAppRole()).rejects.toThrow(/Point DATABASE_URL at the app login/);
    } finally {
      await db.close();
    }
  });

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

  it(
    'refuses one holding pg_read_all_data, or a group that bypasses row level security, WITH ADMIN alone',
    apart(async () => {
      // No INHERIT and no SET, but ADMIN lets it grant either to itself whenever it likes.
      const reader = await login(['crm_app']);
      await admin.query(`grant pg_read_all_data to ${roleOf(reader)} with admin true, inherit false, set false`);
      await expect(appCheck(reader)).rejects.toThrow(/a member of pg_read_all_data/);

      const bypassing = await login(['crm_app']);
      const bypass = admin.escapeIdentifier(await group('bypassrls'));
      await admin.query(`grant ${bypass} to ${roleOf(bypassing)} with admin true, inherit false, set false`);
      await expect(appCheck(bypassing)).rejects.toThrow(/bypass row level security/);
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

  it(
    'refuses one holding pg_read_all_data, or crm_app, WITH ADMIN alone',
    apart(async () => {
      for (const held of ['pg_read_all_data', 'crm_app']) {
        const url = await login(['crm_identity']);
        await admin.query(`grant ${held} to ${roleOf(url)} with admin true, inherit false, set false`);
        await expect(identityCheck(url)).rejects.toThrow(new RegExp(`a member of ${held}`));
      }
    }),
  );
});

/** A migration's closing check: everything from its `do $$` block on. */
async function closingCheck(file: string): Promise<string> {
  const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  return sql.slice(sql.indexOf('do $$'));
}

describe("migration 0018's closing check", () => {
  let check: string;

  beforeAll(async () => {
    check = await closingCheck('0018_auth_privileges_by_membership.sql');
  });

  /** Runs `sql` (the check) after `setup`, in a transaction that is rolled back, so nothing outlives the test. */
  async function checkAfter(setup: readonly string[], sql = check): Promise<void> {
    await admin.query('begin');
    try {
      for (const statement of setup) await admin.query(statement);
      await admin.query(sql);
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
    [
      'a role holding pg_read_all_data WITH ADMIN alone (no INHERIT, no SET)',
      [
        'create role crm_test_probe',
        'grant pg_read_all_data to crm_test_probe with admin true, inherit false, set false',
      ],
      'SELECT',
    ],
    [
      'a role holding one with a grant WITH ADMIN alone',
      [
        'create role crm_test_reader',
        'grant select on auth.session to crm_test_reader',
        'create role crm_test_probe',
        'grant crm_test_reader to crm_test_probe with admin true, inherit false, set false',
      ],
      'SELECT',
    ],
    ['crm_app reading users', ['grant select on auth."user" to crm_app'], 'SELECT'],
    ['crm_identity truncating', ['grant truncate on auth.session to crm_identity'], 'TRUNCATE'],
  ])('refuses %s', async (_name, setup, privilege) => {
    await expect(checkAfter(setup)).rejects.toThrow(new RegExp(`has ${privilege} on auth\\.`));
  });

  it('refuses a stray grant to an app login the owner inherits, which 0017 let through', async () => {
    const owner = admin.escapeIdentifier((await ownerName()) ?? 'crm_owner');
    // The owner inherits the login (as with createrole_self_grant = 'inherit'), and the login was handed a role
    // that reads every session.
    const setup = [
      'create role crm_test_app_login login',
      'grant crm_app to crm_test_app_login',
      `grant crm_test_app_login to ${owner} with inherit true`,
      'create role crm_test_reader',
      'grant select on auth.session to crm_test_reader',
      'grant crm_test_reader to crm_test_app_login',
    ];
    await expect(checkAfter(setup)).rejects.toThrow(/crm_test_app_login has SELECT on auth\.session/);
    // 0017 skipped it, as a role the owner is in.
    await checkAfter(setup, await closingCheck('0017_auth_effective_privileges.sql'));
  });

  it('refuses the same for an identity login, through a role it holds WITH ADMIN alone', async () => {
    const owner = admin.escapeIdentifier((await ownerName()) ?? 'crm_owner');
    await expect(
      checkAfter([
        'create role crm_test_identity_login login',
        'grant crm_identity to crm_test_identity_login',
        `grant crm_test_identity_login to ${owner} with inherit true`,
        'create role crm_test_truncater',
        'grant truncate on auth.session to crm_test_truncater',
        'grant crm_test_truncater to crm_test_identity_login with admin true, inherit false, set false',
      ]),
    ).rejects.toThrow(/crm_test_identity_login has TRUNCATE on auth\.session/);
  });

  it("skips Neon's own platform roles by name, and still refuses a role made in the Neon console", async () => {
    // As on Neon: neon_superuser holds pg_read_all_data, the owner is in it, and neon_service and a console made
    // role are in it too.
    const owner = admin.escapeIdentifier((await ownerName()) ?? 'crm_owner');
    const neon = [
      'create role neon_superuser',
      'grant pg_read_all_data to neon_superuser',
      `grant neon_superuser to ${owner} with inherit true`,
      'create role neon_service login',
      'grant neon_superuser to neon_service',
    ];
    for (const file of ['0017_auth_effective_privileges.sql', '0018_auth_privileges_by_membership.sql']) {
      const sql = await closingCheck(file);
      await checkAfter(neon, sql);
      await expect(
        checkAfter([...neon, 'create role crm_test_console login', 'grant neon_superuser to crm_test_console'], sql),
      ).rejects.toThrow(/crm_test_console has SELECT on auth\./);
    }
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

describe("migration 0020's closing check: who can reach crm_relay", () => {
  let check: string;

  beforeAll(async () => {
    const sql = await readFile(new URL('../migrations/0020_outbox_relay.sql', import.meta.url), 'utf8');
    check = sql.slice(sql.lastIndexOf('do $$'));
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
    ['the app, even WITH ADMIN alone', ['grant crm_relay to crm_app with admin true, inherit false, set false']],
    [
      'an app login, through a group',
      [
        'create role crm_test_middle',
        'grant crm_relay to crm_test_middle',
        'create role crm_test_login login',
        'grant crm_test_middle to crm_test_login',
      ],
    ],
    ['a login of its own', ['create role crm_test_probe login', 'grant crm_relay to crm_test_probe']],
    ['crm_relay logging in', ['alter role crm_relay login']],
    ['crm_relay losing BYPASSRLS, which its function needs', ['alter role crm_relay nobypassrls']],
  ])('refuses %s', async (_name, setup) => {
    await expect(checkAfter(setup)).rejects.toThrow(/crm_relay must be a plain role/);
  });

  it.each([
    ['updating outbox rows', ['grant update on outbox to crm_relay']],
    ['updating one outbox column', ['grant update (published_at) on outbox to crm_relay']],
    ['reading another table', ['grant select on records to crm_relay']],
    ['reading every table, as a member of pg_read_all_data', ['grant pg_read_all_data to crm_relay']],
    ['writing another table through PUBLIC', ['grant insert on records to public']],
  ])('refuses crm_relay %s', async (_name, setup) => {
    await expect(checkAfter(setup)).rejects.toThrow(/crm_relay may only read and delete outbox rows/);
  });

  it("skips Neon's own platform roles by name", async () => {
    await checkAfter(['create role neon_service login', 'grant crm_relay to neon_service']);
  });
});
