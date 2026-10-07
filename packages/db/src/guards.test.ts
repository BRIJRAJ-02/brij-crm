// The guard tests the house rules require (spec 0004, AC-9): every tenant
// table forces row level security and has a policy, every index leads with the
// workspace, a read never crosses workspaces even with no filter, and a
// reference into another workspace is refused by the database itself.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import * as tenantSchema from './schema/index.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');

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

/** An object in the workspace, made as the app makes rows: for outbox rows to name. */
async function objectIn(workspaceId: string): Promise<string> {
  const objectId = randomUUID();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into objects (workspace_id, id, api_slug, singular_name, plural_name, icon, hue, created_by_type, updated_by_type) values (${workspaceId}, ${objectId}, ${`things-${objectId}`}, 'Thing', 'Things', 'box', 'gray', 'system', 'system')`,
    ),
  );
  return objectId;
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
            row.index === 'workspaces_slug' ||
            // Retention reads published rows oldest first across workspaces, through crm_outbox_prune only.
            row.index === 'outbox_published'
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

describe('the holes in row level security (crm_search_text, spec 0004 AC-24; the outbox relay, spec 0005)', () => {
  it('has exactly three security definer functions, each owned by its own narrow role', async () => {
    const definers = await owner.query<{ name: string; owner: string }>(`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by 1
    `);
    expect(definers.rows).toEqual([
      { name: 'crm_outbox_prune', owner: 'crm_relay' },
      { name: 'crm_outbox_workspaces', owner: 'crm_relay' },
      { name: 'crm_search_text', owner: 'crm_search' },
    ]);
  });

  it('lets no role but crm_relay, crm_search and the owner bypass it, outside the superusers', async () => {
    const bypass = await owner.query<{ role: string }>(`
      select rolname as role from pg_roles
      where rolbypassrls and not rolsuper
        and rolname <> (select pg_get_userbyid(datdba) from pg_database where datname = current_database())
      order by rolname
    `);
    expect(bypass.rows.map((row) => row.role)).toEqual(['crm_relay', 'crm_search']);
  });

  it.each([
    ['crm_search', ['crm_search_text'], ['crm_search_text(uuid, text, integer)']],
    [
      'crm_relay',
      ['crm_outbox_workspaces', 'crm_outbox_prune'],
      ['crm_outbox_workspaces(integer, uuid)', 'crm_outbox_prune(integer)'],
    ],
  ])('keeps %s unable to log in, owning only %s, and out of the app’s reach', async (name, fns, signatures) => {
    const role = await owner.query<{ login: boolean; owned: number; members: number; app: boolean }>(
      `
      select r.rolcanlogin as login,
        (select count(*)::int from pg_class c where c.relowner = r.oid)
          + (select count(*)::int from pg_proc p where p.proowner = r.oid and p.proname <> all($2))
          + (select count(*)::int from pg_namespace s where s.nspowner = r.oid)
          + (select count(*)::int from pg_type t where t.typowner = r.oid) as owned,
        (select count(*)::int from pg_auth_members m where m.roleid = r.oid
          and (m.set_option or m.inherit_option
            or m.member <> (select datdba from pg_database where datname = current_database()))) as members,
        pg_has_role('crm_app', r.oid, 'MEMBER') as app
      from pg_roles r where r.rolname = $1
    `,
      [name, fns],
    );
    expect(role.rows).toEqual([{ login: false, owned: 0, members: 0, app: false }]);
    // The app can call each, and nobody else by default.
    for (const [index, signature] of signatures.entries()) {
      const grants = await owner.query<{ app: boolean; anyone: boolean }>(
        `
        select has_function_privilege('crm_app', $1, 'EXECUTE') as app,
          exists (select 1 from aclexplode((select proacl from pg_proc where proname = $2)) where grantee = 0) as anyone
      `,
        [signature, fns[index]],
      );
      expect(grants.rows, signature).toEqual([{ app: true, anyone: false }]);
    }
    // And an app login can't become it.
    await expect(
      db.withWorkspace(randomUUID(), (tx) => tx.execute(sql.raw(`set local role ${name}`))),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('gives crm_relay select and delete on the outbox and nothing else', async () => {
    // From the catalog (information_schema hides grants the reader can't see), by every route.
    const tables = await owner.query<{ table: string; privileges: string }>(`
      select n.nspname || '.' || c.relname as table, string_agg(p.privilege, ',' order by p.privilege) as privileges
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%' and has_table_privilege('crm_relay', c.oid, p.privilege)
      group by 1 order by 1
    `);
    expect(tables.rows).toEqual([{ table: 'public.outbox', privileges: 'DELETE,SELECT' }]);
    const columns = await owner.query<{ column: string }>(`
      select att.attrelid::regclass || '.' || att.attname as column
      from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_relay'::regrole
    `);
    expect(columns.rows).toEqual([]);
    const memberOf = await owner.query(`select 1 from pg_auth_members where member = 'crm_relay'::regrole`);
    expect(memberOf.rowCount).toBe(0);
    const schemas = await owner.query<{ schema: string; privilege: string }>(`
      select n.nspname as schema, a.privilege_type as privilege
      from pg_namespace n cross join aclexplode(n.nspacl) a
      where a.grantee = 'crm_relay'::regrole order by 1, 2
    `);
    expect(schemas.rows).toEqual([{ schema: 'public', privilege: 'USAGE' }]);
  });

  it('lets the app insert and read outbox rows and stamp published_at, and nothing more', async () => {
    // From the catalog, as for crm_relay.
    const table = await owner.query<{ privileges: string }>(`
      select string_agg(p.privilege, ',' order by p.privilege) as privileges
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where has_table_privilege('crm_app', 'public.outbox', p.privilege)
    `);
    expect(table.rows).toEqual([{ privileges: 'INSERT,SELECT' }]);
    const updatable = await owner.query<{ column: string }>(`
      select att.attname as column from pg_attribute att
      where att.attrelid = 'public.outbox'::regclass and att.attnum > 0 and not att.attisdropped
        and has_column_privilege('crm_app', att.attrelid, att.attnum, 'UPDATE')
    `);
    expect(updatable.rows).toEqual([{ column: 'published_at' }]);
  });

  it('names the workspaces with unpublished rows, ids only, clamped to 1 to 500', async () => {
    const a = await workspaceWithMember('outbox-a');
    const b = await workspaceWithMember('outbox-b');
    const done = await workspaceWithMember('outbox-done');
    const event = async (workspaceId: string, seq: number, published: boolean) => {
      const objectId = await objectIn(workspaceId);
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute(
          sql`insert into outbox (workspace_id, seq, kind, object_id, published_at) values (${workspaceId}, ${seq}, 'records', ${objectId}, ${published ? sql`now()` : null})`,
        ),
      );
    };
    await event(a.workspaceId, 1, false);
    await event(a.workspaceId, 2, false);
    await event(b.workspaceId, 1, false);
    await event(done.workspaceId, 1, true);

    // The app, outside any workspace: the function sees past row level security, and hands back ids only.
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const all = await app.query<Record<string, unknown>>('select * from crm_outbox_workspaces(500, null)');
      expect(all.fields.map((field) => field.name)).toEqual(['crm_outbox_workspaces']);
      const ids = all.rows.map((row) => row.crm_outbox_workspaces);
      expect(ids).toEqual(expect.arrayContaining([a.workspaceId, b.workspaceId]));
      expect(ids).not.toContain(done.workspaceId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const max of [0, -5, 1]) {
        const one = await app.query('select * from crm_outbox_workspaces($1, null)', [max]);
        expect(one.rowCount, String(max)).toBe(1);
      }
      // The table itself still shows the app nothing outside withWorkspace.
      expect((await app.query('select * from outbox')).rowCount).toBe(0);
    } finally {
      await app.end();
    }
    const definition = await owner.query<{ body: string }>(
      `select pg_get_functiondef('crm_outbox_workspaces(integer, uuid)'::regprocedure) as body`,
    );
    expect(definition.rows[0]?.body).toMatch(/least\(greatest\(crm_outbox_workspaces\.max, 1\), 500\)/i);
  });

  it('starts after the id it is given and wraps round, so every waiting workspace gets its turn', async () => {
    const made = await Promise.all(['outbox-r1', 'outbox-r2', 'outbox-r3'].map((name) => workspaceWithMember(name)));
    const [a, b, c] = made.map((w) => w.workspaceId).sort();
    if (a === undefined || b === undefined || c === undefined) throw new Error('Three workspaces were made.');
    for (const workspaceId of [a, b, c]) {
      const objectId = await objectIn(workspaceId);
      await db.withWorkspace(workspaceId, (tx) =>
        tx.execute(
          sql`insert into outbox (workspace_id, seq, kind, object_id) values (${workspaceId}, 1, 'records', ${objectId}), (${workspaceId}, 2, 'records', ${objectId})`,
        ),
      );
    }
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      const ours = async (after: string | null) => {
        const result = await app.query<{ id: string }>('select id from crm_outbox_workspaces(500, $1) as w(id)', [
          after,
        ]);
        const ids = result.rows.map((row) => row.id);
        expect(new Set(ids).size, 'one id per workspace').toBe(ids.length);
        return ids.filter((id) => id === a || id === b || id === c);
      };
      expect(await ours(null)).toEqual([a, b, c]);
      expect(await ours(b)).toEqual([c, a, b]);
      expect(await ours(c)).toEqual([a, b, c]);
      // An id that waits for nothing still works as a starting point.
      expect(await ours(randomUUID())).toHaveLength(3);
      // At most `max`, from the starting point on.
      const two = await app.query<{ id: string }>('select id from crm_outbox_workspaces(2, $1) as w(id)', [a]);
      expect(two.rows).toHaveLength(2);
    } finally {
      await app.end();
    }
  });

  it('prunes only rows published more than a day ago, at most 1,000 at a time, and nothing unpublished', async () => {
    const w = await workspaceWithMember('outbox-prune');
    const objectId = await objectIn(w.workspaceId);
    const event = (seq: number, published: string | undefined) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(
          sql`insert into outbox (workspace_id, seq, kind, object_id, created_at, published_at) values (${w.workspaceId}, ${seq}, 'records', ${objectId}, now() - interval '30 days', ${published === undefined ? null : sql`now() - ${published}::interval`})`,
        ),
      );
    await event(1, '25 hours');
    await event(2, '24 hours 1 minute');
    await event(3, '23 hours 59 minutes');
    await event(4, undefined);
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      // The app, outside any workspace: the function reaches past row level security, oldest first.
      const prune = (max: number) =>
        app.query<{ pruned: number }>('select crm_outbox_prune($1) as pruned', [max]).then((r) => r.rows[0]?.pruned);
      const left = () =>
        owner
          .query<{ seq: number }>('select seq::int as seq from outbox where workspace_id = $1 order by seq', [
            w.workspaceId,
          ])
          .then((r) => r.rows.map((row) => row.seq));
      // Clamped to 1 to 1,000.
      expect(await prune(0)).toBeLessThanOrEqual(1);
      expect(await prune(1_000_000)).toBeLessThanOrEqual(1_000);
      expect(await left()).toEqual([3, 4]);
      expect(await prune(1_000)).toBe(0);
    } finally {
      await app.end();
    }
    const definition = await owner.query<{ body: string }>(
      `select pg_get_functiondef('crm_outbox_prune(integer)'::regprocedure) as body`,
    );
    expect(definition.rows[0]?.body).toMatch(/least\(greatest\(crm_outbox_prune\.max, 1\), 1000\)/i);
  });

  it('lets the app stamp published_at once, from null to now(), and never take it back, move it or date it', async () => {
    const w = await workspaceWithMember('outbox-once');
    const objectId = await objectIn(w.workspaceId);
    const run = (statement: ReturnType<typeof sql>) =>
      db.withWorkspace(w.workspaceId, (tx) => tx.execute<{ seq: number }>(statement));
    await run(
      sql`insert into outbox (workspace_id, seq, kind, object_id) values (${w.workspaceId}, 1, 'records', ${objectId}), (${w.workspaceId}, 2, 'records', ${objectId})`,
    );
    // Null to a time: once.
    const stamped = await run(sql`update outbox set published_at = now() where seq = 1 returning seq`);
    expect(stamped.rows).toHaveLength(1);
    // Back to null, or to another time: the published row is out of reach.
    expect((await run(sql`update outbox set published_at = null where seq = 1 returning seq`)).rows).toEqual([]);
    expect(
      (await run(sql`update outbox set published_at = now() + interval '1 day' where seq = 1 returning seq`)).rows,
    ).toEqual([]);
    // An unpublished row can be stamped only with the transaction's own time: not null, not backdated past the
    // prune's cutoff, not future dated.
    for (const stamp of [
      sql`null`,
      sql`now() - interval '25 hours'`,
      sql`now() + interval '1 minute'`,
      sql`clock_timestamp()`,
    ]) {
      await expect(run(sql`update outbox set published_at = ${stamp} where seq = 2`)).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    }
    const left = await run(sql`select seq::int as seq from outbox where published_at is not null order by seq`);
    expect(left.rows).toEqual([{ seq: 1 }]);
  });

  it('refuses an outbox row naming an object of another workspace, or none at all', async () => {
    const a = await workspaceWithMember('outbox-fk-a');
    const b = await workspaceWithMember('outbox-fk-b');
    const theirs = await objectIn(b.workspaceId);
    for (const objectId of [theirs, randomUUID()]) {
      await expect(
        db.withWorkspace(a.workspaceId, (tx) =>
          tx.execute(
            sql`insert into outbox (workspace_id, seq, kind, object_id) values (${a.workspaceId}, 1, 'records', ${objectId})`,
          ),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'outbox_object' } });
    }
  });

  it('answers nothing to a caller without execute', async () => {
    const identity = new pg.Client({ connectionString: identityUrl });
    await identity.connect();
    try {
      for (const call of [
        'select * from public.crm_outbox_workspaces(10, null)',
        'select public.crm_outbox_prune(10)',
      ]) {
        await expect(identity.query(call)).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await identity.end();
    }
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

  it("reads none of another workspace's outbox rows, even with no filter, nor stamps them", async () => {
    const a = await workspaceWithMember('outbox-iso-a');
    const b = await workspaceWithMember('outbox-iso-b');
    for (const w of [a, b]) {
      const objectId = await objectIn(w.workspaceId);
      await db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(
          sql`insert into outbox (workspace_id, seq, kind, object_id) values (${w.workspaceId}, 1, 'records', ${objectId}), (${w.workspaceId}, 2, 'records', ${objectId})`,
        ),
      );
    }
    const seenFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from outbox`),
    );
    expect(seenFromA.rows).toHaveLength(2);
    expect(seenFromA.rows.every((row) => row.workspace_id === a.workspaceId)).toBe(true);
    // An unfiltered stamp from A touches only A's rows; B's still wait.
    await db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`update outbox set published_at = now()`));
    const fromB = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute<{ seq: number }>(sql`select seq::int as seq from outbox where published_at is null order by seq`),
    );
    expect(fromB.rows).toEqual([{ seq: 1 }, { seq: 2 }]);
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

describe('the auth schema: global identity, outside row level security (spec 0005)', () => {
  const AUTH_TABLES = [
    'account',
    'rate_limit',
    'session',
    'user',
    'verification',
    'workspace_directory',
    'workspace_membership',
  ];

  it("holds Better Auth's tables and the directory, and only the directory carries a workspace id", async () => {
    const tables = await owner.query<{ table: string; workspace: boolean; enabled: boolean }>(`
      select c.relname as table, c.relrowsecurity as enabled,
        exists (
          select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
        ) as workspace
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by 1
    `);
    expect(tables.rows.map((row) => row.table)).toEqual(AUTH_TABLES);
    expect(tables.rows.filter((row) => row.workspace).map((row) => row.table)).toEqual([
      'workspace_directory',
      'workspace_membership',
    ]);
    // No row level security here: the grants below are the fence.
    expect(tables.rows.filter((row) => row.enabled).map((row) => row.table)).toEqual([]);
  });

  /** A role's privileges on each `auth` table, from the catalog. */
  async function authGrants(role: string) {
    const grants = await owner.query<{ table: string; privileges: string }>(
      `
      select table_name as table, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'auth' and grantee = $1
      group by table_name order by 1
    `,
      [role],
    );
    return grants.rows;
  }

  async function schemaPrivileges(role: string) {
    const schema = await owner.query<{ usage: boolean; create: boolean }>(
      `select has_schema_privilege($1, 'auth', 'USAGE') as usage, has_schema_privilege($1, 'auth', 'CREATE') as create`,
      [role],
    );
    return schema.rows;
  }

  it('lets only the identity login select, insert, update and delete there', async () => {
    expect(await authGrants('crm_identity')).toEqual(
      AUTH_TABLES.map((table) => ({ table, privileges: 'DELETE,INSERT,SELECT,UPDATE' })),
    );
    expect(await schemaPrivileges('crm_identity')).toEqual([{ usage: true, create: false }]);
  });

  it('leaves the app only insert on the two directory tables, written inside the workspace transaction', async () => {
    expect(await authGrants('crm_app')).toEqual([
      { table: 'workspace_directory', privileges: 'INSERT' },
      { table: 'workspace_membership', privileges: 'INSERT' },
    ]);
    expect(await schemaPrivileges('crm_app')).toEqual([{ usage: true, create: false }]);
  });

  it('gives a table added later to the identity login only', async () => {
    await owner.query('begin');
    try {
      await owner.query('create table auth.later_probe (id int)');
      const later = await owner.query<{ grantee: string; privileges: string }>(`
        select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
        from information_schema.role_table_grants
        where table_schema = 'auth' and table_name = 'later_probe'
          and grantee <> (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth')
        group by grantee order by 1
      `);
      expect(later.rows).toEqual([{ grantee: 'crm_identity', privileges: 'DELETE,INSERT,SELECT,UPDATE' }]);
    } finally {
      await owner.query('rollback');
    }
  });

  it('keeps the two logins apart: the app reads no identity, and the identity login no tenant data', async () => {
    const roles = await owner.query<{ app_in_identity: boolean; identity_in_app: boolean; powers: boolean }>(`
      select pg_has_role('crm_app', 'crm_identity', 'MEMBER') as app_in_identity,
        pg_has_role('crm_identity', 'crm_app', 'MEMBER') as identity_in_app,
        (select rolcanlogin or rolsuper or rolbypassrls from pg_roles where rolname = 'crm_identity') as powers
    `);
    expect(roles.rows).toEqual([{ app_in_identity: false, identity_in_app: false, powers: false }]);
    const tenant = await owner.query<{ table: string }>(`
      select distinct table_name as table from information_schema.role_table_grants
      where grantee = 'crm_identity' and table_schema <> 'auth'
    `);
    expect(tenant.rows).toEqual([]);

    // And for real, through each login.
    const app = new pg.Client({ connectionString: appUrl });
    const identity = new pg.Client({ connectionString: identityUrl });
    await app.connect();
    await identity.connect();
    try {
      for (const table of AUTH_TABLES) {
        await expect(app.query(`select 1 from auth."${table}" limit 1`)).rejects.toMatchObject({ code: '42501' });
      }
      for (const table of ['members', 'workspaces', 'records', 'values']) {
        await expect(identity.query(`select 1 from "${table}" limit 1`)).rejects.toMatchObject({ code: '42501' });
      }
      for (const table of AUTH_TABLES) await identity.query(`select 1 from auth."${table}" limit 1`);
    } finally {
      await app.end();
      await identity.end();
    }
  });

  it('stays out of the schema `@crm/db` exports, so only the identity store reaches it', () => {
    const exported: readonly unknown[] = Object.values(tenantSchema);
    const tables = exported.flatMap((value) => (value instanceof PgTable ? [getTableConfig(value)] : []));
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => table.schema !== undefined).map((table) => table.name)).toEqual([]);
  });

  it('is closed to every other role, crm_search included', async () => {
    const schema = await owner.query<{ grantee: string }>(`
      select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') as grantee
      from aclexplode((select nspacl from pg_namespace where nspname = 'auth')) a
      where a.grantee not in (
        'crm_app'::regrole, 'crm_identity'::regrole, (select nspowner from pg_namespace where nspname = 'auth')
      )
    `);
    expect(schema.rows).toEqual([]);
    const tables = await owner.query<{ grantee: string }>(`
      select distinct grantee from information_schema.role_table_grants
      where table_schema = 'auth'
        and grantee not in (
          'crm_app', 'crm_identity', (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth')
        )
    `);
    expect(tables.rows).toEqual([]);
    const search = await owner.query<{ usage: boolean }>(
      `select has_schema_privilege('crm_search', 'auth', 'USAGE') as usage`,
    );
    expect(search.rows).toEqual([{ usage: false }]);
  });

  it('keeps one active member per user in a workspace, and lets a removed one come back', async () => {
    const { workspaceId } = await workspaceWithMember('theta');
    const userId = randomUUID();
    const add = (id: string) =>
      db.withWorkspace(workspaceId, (tx) =>
        tx.execute(
          sql`insert into members (workspace_id, id, user_id, name, email, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${userId}, 'x', ${`${id}@example.com`}, 'system', 'system')`,
        ),
      );
    const first = randomUUID();
    await add(first);
    await expect(add(randomUUID())).rejects.toMatchObject({ cause: { code: '23505', constraint: 'members_user' } });
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${first}`),
    );
    await add(randomUUID());
  });
});
