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

  it('indexes every foreign key into records and entries, so a purge or an erasure never scans for them', async () => {
    // Deleting a record or an entry checks each referencing table for rows that still point at it.
    const keys = await owner.query<{ key: string; indexed: boolean }>(`
      select c.conname as key, exists (
        select 1 from pg_index x
        where x.indrelid = c.conrelid and x.indnatts >= 2
          and x.indkey[0] = any(c.conkey) and x.indkey[1] = any(c.conkey)
      ) as indexed
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' and c.contype = 'f'
        and c.confrelid in ('public.records'::regclass, 'public.list_entries'::regclass)
      order by 1
    `);
    expect(keys.rows.map((row) => row.key)).toContain('values_record');
    expect(keys.rows.filter((row) => !row.indexed).map((row) => row.key)).toEqual([]);
  });

  it("reads every view with the reader's own row level security", async () => {
    const views = await owner.query<{ view: string; invoker: boolean }>(`
      select c.relname as view, coalesce('security_invoker=true' = any(c.reloptions), false) as invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
    `);
    expect(views.rows.length).toBeGreaterThan(0);
    expect(views.rows.filter((row) => !row.invoker).map((row) => row.view)).toEqual([]);
  });
});

describe('the one hole in row level security (spec 0004, stored sort keys, AC-24)', () => {
  it('has exactly one security definer function, crm_search_text, owned by crm_search', async () => {
    const definers = await owner.query<{ name: string; owner: string }>(`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    `);
    expect(definers.rows).toEqual([{ name: 'crm_search_text', owner: 'crm_search' }]);
  });

  it('lets no role but crm_search and the owner bypass it, outside the superusers', async () => {
    const bypass = await owner.query<{ role: string }>(`
      select rolname as role from pg_roles
      where rolbypassrls and not rolsuper
        and rolname <> (select pg_get_userbyid(datdba) from pg_database where datname = current_database())
      order by rolname
    `);
    expect(bypass.rows.map((row) => row.role)).toEqual(['crm_search']);
  });

  it('keeps crm_search unable to log in, owning nothing else, and out of the app’s reach', async () => {
    const role = await owner.query<{ login: boolean; owned: number; members: number; app: boolean }>(`
      select r.rolcanlogin as login,
        (select count(*)::int from pg_class c where c.relowner = r.oid)
          + (select count(*)::int from pg_proc p where p.proowner = r.oid and p.proname <> 'crm_search_text')
          + (select count(*)::int from pg_namespace s where s.nspowner = r.oid)
          + (select count(*)::int from pg_type t where t.typowner = r.oid) as owned,
        (select count(*)::int from pg_auth_members m where m.roleid = r.oid
          and (m.set_option or m.inherit_option
            or m.member <> (select datdba from pg_database where datname = current_database()))) as members,
        pg_has_role('crm_app', r.oid, 'USAGE') or pg_has_role('crm_app', r.oid, 'SET') as app
      from pg_roles r where r.rolname = 'crm_search'
    `);
    expect(role.rows).toEqual([{ login: false, owned: 0, members: 0, app: false }]);
    // The app can call it, and nobody else by default.
    const grants = await owner.query<{ app: boolean; anyone: boolean }>(`
      select has_function_privilege('crm_app', 'crm_search_text(uuid, text, integer)', 'EXECUTE') as app,
        exists (select 1 from aclexplode((select proacl from pg_proc where proname = 'crm_search_text'))
          where grantee = 0) as anyone
    `);
    expect(grants.rows).toEqual([{ app: true, anyone: false }]);
    // And an app login can't become it.
    await expect(
      db.withWorkspace(randomUUID(), (tx) => tx.execute(sql`set local role crm_search`)),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    });
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
