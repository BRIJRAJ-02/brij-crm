// Every live workspace keeps an active owner (spec 0009, AC-132 and AC-137):
// migration 0022's backfill names one per workspace, and its deferred
// constraint trigger refuses, at commit, any transaction that leaves a live
// workspace without one, even a raw update that never went through a service.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl, application_name: 'crm-owner-tests' });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-owner-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

type Role = 'owner' | 'admin' | 'member';

/** A workspace with members of the given roles, made as the app makes them: inside `withWorkspace`. */
async function workspaceWith(roles: readonly Role[]) {
  const workspaceId = randomUUID();
  const memberIds = roles.map(() => randomUUID());
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, 'Owners', ${`owners-${workspaceId}`}, 'system', 'system')`,
    );
    for (const [index, role] of roles.entries()) {
      const id = memberIds[index] ?? '';
      await tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${id}, 'x', ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      );
    }
  });
  return { workspaceId, memberIds };
}

/** The SQLSTATE a failed call carries, on the error or the one it wraps. */
async function sqlState(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      if ('code' in current && typeof current.code === 'string') return current.code;
    }
    throw error;
  }
  return undefined;
}

describe('the last owner guard', () => {
  it('refuses demoting the only active owner at commit, with CRM01 and LAST_OWNER, and changes nothing', async () => {
    const { workspaceId, memberIds } = await workspaceWith(['owner', 'member']);
    const [first] = memberIds;
    let failure: unknown;
    try {
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(sql`update members set role = 'member' where id = ${first}`);
        // The statement itself passes: the guard is deferred to the commit.
        const after = await tx.execute<{ role: string }>(sql`select role from members where id = ${first}`);
        expect(after.rows).toEqual([{ role: 'member' }]);
      });
    } catch (error) {
      failure = error;
    }
    // Raised by the commit itself, which drizzle wraps: the Postgres error is its cause.
    expect(failure).toMatchObject({ cause: { code: 'CRM01', message: 'LAST_OWNER' } });
    const rows = await db.withWorkspace(workspaceId, (tx) =>
      tx.execute<{ role: string }>(sql`select role from members where id = ${first}`),
    );
    expect(rows.rows).toEqual([{ role: 'owner' }]);
  });

  it('refuses removing or deleting the only active owner', async () => {
    const { workspaceId, memberIds } = await workspaceWith(['owner']);
    const [only] = memberIds;
    expect(
      await sqlState(
        db.withWorkspace(workspaceId, (tx) =>
          tx.execute(sql`update members set status = 'removed' where id = ${only}`),
        ),
      ),
    ).toBe('CRM01');
    expect(
      await sqlState(db.withWorkspace(workspaceId, (tx) => tx.execute(sql`delete from members where id = ${only}`))),
    ).toBe('CRM01');
  });

  it('refuses it from a role that skips row level security too', async () => {
    const { workspaceId, memberIds } = await workspaceWith(['owner']);
    expect(await sqlState(owner.query(`update members set role = 'admin' where id = $1`, [memberIds[0]]))).toBe(
      'CRM01',
    );
    expect(workspaceId).toBeDefined();
  });

  it('allows demoting one of two owners, and an owner stepping down for another in the same transaction', async () => {
    const two = await workspaceWith(['owner', 'owner']);
    await db.withWorkspace(two.workspaceId, (tx) =>
      tx.execute(sql`update members set role = 'admin' where id = ${two.memberIds[0]}`),
    );
    const handover = await workspaceWith(['owner', 'member']);
    await db.withWorkspace(handover.workspaceId, async (tx) => {
      await tx.execute(sql`update members set role = 'member' where id = ${handover.memberIds[0]}`);
      await tx.execute(sql`update members set role = 'owner' where id = ${handover.memberIds[1]}`);
    });
    const roles = await db.withWorkspace(handover.workspaceId, (tx) =>
      tx.execute<{ id: string; role: string }>(sql`select id, role from members order by role`),
    );
    expect(roles.rows.map((row) => row.role).sort()).toEqual(['member', 'owner']);
  });

  it('leaves non owners and deleted workspaces alone', async () => {
    const { workspaceId, memberIds } = await workspaceWith(['owner', 'admin', 'member']);
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`update members set role = 'member' where id = ${memberIds[1]}`);
      await tx.execute(sql`update members set status = 'removed' where id = ${memberIds[2]}`);
    });
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`update workspaces set deleted_at = now() where id = ${workspaceId}`);
      await tx.execute(sql`update members set role = 'member' where id = ${memberIds[0]}`);
    });
  });

  it('counts only an active owner: a removed one is no owner', async () => {
    const { workspaceId, memberIds } = await workspaceWith(['owner', 'owner']);
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${memberIds[0]}`),
    );
    expect(
      await sqlState(
        db.withWorkspace(workspaceId, (tx) =>
          tx.execute(sql`update members set role = 'member' where id = ${memberIds[1]}`),
        ),
      ),
    ).toBe('CRM01');
  });
});

describe("migration 0022's backfill and closing check", () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(new URL('../migrations/0022_access_owner_guard.sql', import.meta.url), 'utf8');
  });

  /** The backfill statement, as the migration runs it. */
  const backfill = () =>
    migration.slice(
      migration.indexOf('update members m'),
      migration.indexOf(';', migration.indexOf('update members m')) + 1,
    );
  const closingCheck = () => migration.slice(migration.indexOf('do $$'));

  /** Runs `statements` as the owner in a transaction that is rolled back, so nothing outlives the test. */
  async function rolledBack<T>(work: () => Promise<T>): Promise<T> {
    await owner.query('begin');
    try {
      return await work();
    } finally {
      await owner.query('rollback');
    }
  }

  it('makes the earliest active member of each workspace its owner, by created_at and then id', async () => {
    const workspaceId = randomUUID();
    const ids = {
      removedFirst: '00000000-0000-7000-8000-000000000001',
      tiedLow: '00000000-0000-7000-8000-000000000002',
      tiedHigh: '00000000-0000-7000-8000-000000000003',
      later: '00000000-0000-7000-8000-000000000004',
    };
    const roles = await rolledBack(async () => {
      await owner.query(
        `insert into workspaces (id, name, slug, created_by_type, updated_by_type) values ($1, 'Backfill', $2, 'system', 'system')`,
        [workspaceId, `backfill-${workspaceId}`],
      );
      const add = (id: string, at: string, status: string) =>
        owner.query(
          `insert into members (workspace_id, id, name, email, status, created_at, created_by_type, updated_by_type)
           values ($1, $2, 'x', $3, $4, $5, 'system', 'system')`,
          [workspaceId, id, `${id}@example.com`, status, at],
        );
      await add(ids.later, '2026-03-01T00:00:00Z', 'active');
      await add(ids.tiedHigh, '2026-02-01T00:00:00Z', 'active');
      await add(ids.tiedLow, '2026-02-01T00:00:00Z', 'active');
      await add(ids.removedFirst, '2026-01-01T00:00:00Z', 'removed');
      await owner.query(backfill());
      const result = await owner.query<{ id: string; role: string }>(
        'select id, role from members where workspace_id = $1 order by id',
        [workspaceId],
      );
      return result.rows;
    });
    expect(roles).toEqual([
      { id: ids.removedFirst, role: 'member' },
      { id: ids.tiedLow, role: 'owner' },
      { id: ids.tiedHigh, role: 'member' },
      { id: ids.later, role: 'member' },
    ]);
  });

  it('passes the database as migrated', async () => {
    await rolledBack(() => owner.query(closingCheck()));
  });

  it('refuses a workspace with active members and no active owner', async () => {
    const workspaceId = randomUUID();
    await expect(
      rolledBack(async () => {
        await owner.query(
          `insert into workspaces (id, name, slug, created_by_type, updated_by_type) values ($1, 'Ownerless', $2, 'system', 'system')`,
          [workspaceId, `ownerless-${workspaceId}`],
        );
        await owner.query(
          `insert into members (workspace_id, name, email, created_by_type, updated_by_type) values ($1, 'x', 'x@example.com', 'system', 'system')`,
          [workspaceId],
        );
        await owner.query(closingCheck());
      }),
    ).rejects.toThrow(new RegExp(`these have none: .*${workspaceId}`));
  });

  it('refuses a guard that is disabled or missing', async () => {
    await expect(
      rolledBack(async () => {
        await owner.query('alter table members disable trigger members_keep_an_owner');
        await owner.query(closingCheck());
      }),
    ).rejects.toThrow(/deferrable initially deferred/);
    await expect(
      rolledBack(async () => {
        await owner.query('drop trigger members_keep_an_owner on members');
        await owner.query(closingCheck());
      }),
    ).rejects.toThrow(/deferrable initially deferred/);
  });
});
