// The guard tests the house rules require (spec 0004, AC-9): every tenant
// table forces row level security and has a policy, every index leads with the
// workspace, a read never crosses workspaces even with no filter, and a
// reference into another workspace is refused by the database itself.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl } = inject('testDatabase');

/** Tables that are not tenant data: drizzle's own bookkeeping lives in its own schema. */
const NOT_TENANT = new Set<string>();

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-guard-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A workspace with one member, made the way the app makes them: inside `withWorkspace`. */
async function workspaceWithMember(name: string) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, ${name}, ${`${name}-${workspaceId}`}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, name, email, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${name}, ${`${name}@example.com`}, 'system', 'system')`,
    );
  });
  return { workspaceId, memberId };
}

describe('every tenant table', () => {
  it('forces row level security and has a policy', async () => {
    const tables = await owner.query<{ table: string; enabled: boolean; forced: boolean; policies: number }>(`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    const tenant = tables.rows.filter((row) => !NOT_TENANT.has(row.table));
    expect(tenant.length).toBeGreaterThan(0);
    const unguarded = tenant.filter((row) => !row.enabled || !row.forced || row.policies === 0).map((row) => row.table);
    expect(unguarded).toEqual([]);
  });

  it('leads every index with the workspace', async () => {
    const indexes = await owner.query<{ index: string; table: string; first: string }>(`
      select i.relname as index, t.relname as table, a.attname as first
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
      where n.nspname = 'public'
    `);
    const stray = indexes.rows
      .filter(
        (row) =>
          !(
            row.first === 'workspace_id' ||
            (row.table === 'workspaces' && row.first === 'id') ||
            row.index === 'workspaces_slug'
          ),
      )
      .map((row) => row.index);
    expect(stray).toEqual([]);
  });
});

describe('isolation', () => {
  it('returns nothing from another workspace, even with no filter', async () => {
    const a = await workspaceWithMember('alpha');
    const b = await workspaceWithMember('beta');
    const seenFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from members`),
    );
    expect(seenFromA.rows.map((row) => row.id)).toEqual([a.memberId]);
    const workspacesFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from workspaces`),
    );
    expect(workspacesFromA.rows.map((row) => row.id)).toEqual([a.workspaceId]);
    expect(b.memberId).not.toBe(a.memberId);
  });

  it('returns nothing at all outside withWorkspace', async () => {
    await workspaceWithMember('gamma');
    const pool = new pg.Pool({ connectionString: appUrl });
    try {
      const members = await pool.query('select id from members');
      expect(members.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('refuses a row written into another workspace', async () => {
    const a = await workspaceWithMember('delta');
    const b = await workspaceWithMember('epsilon');
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into members (workspace_id, name, email, created_by_type, updated_by_type) values (${b.workspaceId}, 'x', 'x@example.com', 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('refuses a reference to another workspace through the composite keys', async () => {
    const a = await workspaceWithMember('zeta');
    const b = await workspaceWithMember('eta');
    // A record in workspace A created "by" workspace B's member: the foreign key has no such member in A.
    await expect(
      db.withWorkspace(a.workspaceId, async (tx) => {
        const object = await tx.execute<{ id: string }>(
          sql`insert into objects (workspace_id, api_slug, singular_name, plural_name, icon, hue, created_by_type, updated_by_type) values (${a.workspaceId}, 'things', 'Thing', 'Things', 'box', 'gray', 'system', 'system') returning id`,
        );
        const objectId = object.rows[0]?.id;
        await tx.execute(
          sql`insert into records (workspace_id, object_id, created_by_type, created_by_id, created_by_member_id, updated_by_type) values (${a.workspaceId}, ${objectId}, 'member', ${b.memberId}, ${b.memberId}, 'system')`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'records_created_by' } });
  });
});
