// The guard tests the house rules require (spec 0004, AC-9): every tenant
// table forces row level security and has a policy, every index leads with the
// workspace, a read never crosses workspaces even with no filter, and a
// reference into another workspace is refused by the database itself.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import * as tenantSchema from './schema/index.ts';

const { appUrl, identityUrl, ownerUrl, workerUrl } = inject('testDatabase');

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

/** A workspace with one member, its owner, made the way the app makes them: inside `withWorkspace`. */
async function workspaceWithMember(name: string) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, ${name}, ${`${name}-${workspaceId}`}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${name}, ${`${name}@example.com`}, 'owner', 'system', 'system')`,
    );
  });
  return { workspaceId, memberId };
}

/** An object in the workspace, made as the app makes rows: for outbox rows to name. */
async function objectIn(workspaceId: string): Promise<string> {
  const objectId = randomUUID();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into objects (workspace_id, id, api_slug, singular_name, plural_name, icon, hue, position, created_by_type, updated_by_type) values (${workspaceId}, ${objectId}, ${`things-${objectId}`}, ${`Thing ${objectId}`}, ${`Things ${objectId}`}, 'box', 'gray', 0, 'system', 'system')`,
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
            // A form's public key finds it before the workspace is known (spec 0023), so it is unique everywhere.
            row.index === 'forms_public_key' ||
            row.index === 'booking_pages_public_key' ||
            // `/<handle>/<slug>` and a profile's pages are found before the workspace is known (22 Oct 2026), read
            // only through crm_booking_lookup's crm_booking_page_by_address and crm_booking_profile_pages.
            row.index === 'booking_pages_owner_slug' ||
            row.index === 'booking_pages_profile' ||
            // An old slug's address (slug history, 0087) likewise, read only through crm_booking_page_by_address and
            // crm_booking_owner_slugs; unique per person across workspaces, so no other page of theirs takes it.
            row.index === 'booking_page_slugs_owner_slug' ||
            row.index === 'bookings_manage_token' ||
            // An invitation's token finds it before the workspace is known, and sign up asks about an address
            // across workspaces (spec 0031): both read only through crm_invitation_lookup's two functions.
            row.index === 'invitations_token' ||
            row.index === 'invitations_open_address' ||
            // /join finds a person's workspaces by their email's domain (spec 0031, AC-819), read only through
            // crm_domain_lookup's two functions.
            row.index === 'workspace_domains_domain_lookup' ||
            // Deleting an account closes and blanks the person's join requests (spec 0033), found only through
            // crm_domain_lookup's crm_join_requests_of.
            row.index === 'join_requests_by_user'
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

describe('the holes in row level security (crm_search_text, spec 0004 AC-24; the outbox relay, spec 0005; the daily cleanup, spec 0008)', () => {
  it('has exactly twenty three security definer functions, each owned by its own narrow role', async () => {
    const definers = await owner.query<{ name: string; owner: string }>(`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by 1
    `);
    expect(definers.rows).toEqual([
      { name: 'crm_booking_by_token', owner: 'crm_booking_lookup' },
      { name: 'crm_booking_owner_slugs', owner: 'crm_booking_lookup' },
      { name: 'crm_booking_page_by_address', owner: 'crm_booking_lookup' },
      { name: 'crm_booking_page_by_key', owner: 'crm_booking_lookup' },
      { name: 'crm_booking_profile_pages', owner: 'crm_booking_lookup' },
      { name: 'crm_claim_workspace_address', owner: 'crm_address' },
      { name: 'crm_enqueue_booking_mail', owner: 'crm_queue' },
      { name: 'crm_enqueue_calendar_sync', owner: 'crm_queue' },
      { name: 'crm_enqueue_email', owner: 'crm_queue' },
      { name: 'crm_enqueue_job', owner: 'crm_queue' },
      { name: 'crm_enqueue_notification_email', owner: 'crm_queue' },
      { name: 'crm_form_by_key', owner: 'crm_form_lookup' },
      { name: 'crm_handle_owner', owner: 'crm_handle' },
      { name: 'crm_invitation_by_token', owner: 'crm_invitation_lookup' },
      { name: 'crm_invitation_open_for', owner: 'crm_invitation_lookup' },
      { name: 'crm_join_requests_of', owner: 'crm_domain_lookup' },
      { name: 'crm_notification_digests_due', owner: 'crm_sweep' },
      { name: 'crm_outbox_prune', owner: 'crm_relay' },
      { name: 'crm_outbox_workspaces', owner: 'crm_relay' },
      { name: 'crm_pictures_hidden', owner: 'crm_handle' },
      { name: 'crm_public_profiles_of', owner: 'crm_handle' },
      { name: 'crm_purge_workspace_begin', owner: 'crm_purge' },
      { name: 'crm_purge_workspace_end', owner: 'crm_purge' },
      { name: 'crm_save_picture_hidden', owner: 'crm_handle' },
      { name: 'crm_save_public_profile', owner: 'crm_handle' },
      { name: 'crm_search_similar', owner: 'crm_search' },
      { name: 'crm_search_text', owner: 'crm_search' },
      { name: 'crm_workspace_has_domain', owner: 'crm_domain_lookup' },
      { name: 'crm_workspace_ids', owner: 'crm_sweep' },
      { name: 'crm_workspaces_by_domain', owner: 'crm_domain_lookup' },
      { name: 'crm_workspaces_to_purge', owner: 'crm_purge' },
    ]);
    // Each hardened: a fixed search path (the prune also waits at most a second for a lock), and a standard SQL body (begin atomic, bound when it was made), but
    // crm_enqueue_job's, which is quoted so a Graphile upgrade that recreates add_job never fails on it.
    const hardening = await owner.query<{ name: string; config: string[] | null; atomic: boolean }>(`
      select p.proname as name, p.proconfig as config, p.prosqlbody is not null as atomic
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'public'
      order by 1
    `);
    expect(hardening.rows).toEqual([
      { name: 'crm_booking_by_token', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_booking_owner_slugs', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_booking_page_by_address', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_booking_page_by_key', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_booking_profile_pages', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      // A plpgsql body: it raises the unique violation a taken address is refused with.
      { name: 'crm_claim_workspace_address', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_enqueue_booking_mail', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_enqueue_calendar_sync', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_enqueue_email', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_enqueue_job', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_enqueue_notification_email', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      { name: 'crm_form_by_key', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_handle_owner', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_invitation_by_token', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_invitation_open_for', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_join_requests_of', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_notification_digests_due', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_outbox_prune', config: ['search_path=pg_catalog, pg_temp', 'lock_timeout=1s'], atomic: true },
      { name: 'crm_outbox_workspaces', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_pictures_hidden', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_public_profiles_of', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_purge_workspace_begin', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_purge_workspace_end', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_save_picture_hidden', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      // A plpgsql body: it raises the unique violation a taken handle is refused with.
      { name: 'crm_save_public_profile', config: ['search_path=pg_catalog, pg_temp'], atomic: false },
      {
        name: 'crm_search_similar',
        config: ['search_path=pg_catalog, pg_temp', 'pg_trgm.word_similarity_threshold=0.5'],
        atomic: true,
      },
      { name: 'crm_search_text', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_workspace_has_domain', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_workspace_ids', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_workspaces_by_domain', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
      { name: 'crm_workspaces_to_purge', config: ['search_path=pg_catalog, pg_temp'], atomic: true },
    ]);
  });

  it('lets no role but crm_booking_lookup, crm_domain_lookup, crm_form_lookup, crm_invitation_lookup, crm_purge, crm_relay, crm_search, crm_sweep and the owner bypass it, outside the superusers', async () => {
    const bypass = await owner.query<{ role: string }>(`
      select rolname as role from pg_roles
      where rolbypassrls and not rolsuper
        and rolname <> (select pg_get_userbyid(datdba) from pg_database where datname = current_database())
      order by rolname
    `);
    expect(bypass.rows.map((row) => row.role)).toEqual([
      'crm_booking_lookup',
      'crm_domain_lookup',
      'crm_form_lookup',
      'crm_invitation_lookup',
      'crm_purge',
      'crm_relay',
      'crm_search',
      'crm_sweep',
    ]);
  });

  // Each owner role, its functions, their signatures, and who calls each: the app (and so the worker, which
  // inherits it), or the worker alone. Listing workspaces reaches across them, so it is the worker's (spec 0008);
  // the app keeps it too until milestone 3's contract migration, once every worker runs on crm_worker_user. The
  // prune is the worker's alone from the start (spec 0007, milestone 3), and so is the daily cleanup's workspace
  // listing (spec 0008, milestone 3).
  it.each([
    [
      'crm_search',
      ['crm_search_text', 'crm_search_similar'],
      ['crm_search_text(uuid, text, integer)', 'crm_search_similar(uuid[], text, integer)'],
      ['app', 'app'],
    ],
    [
      'crm_relay',
      ['crm_outbox_workspaces', 'crm_outbox_prune'],
      ['crm_outbox_workspaces(integer, uuid)', 'crm_outbox_prune(timestamp with time zone, integer)'],
      ['app', 'worker'],
    ],
    [
      'crm_queue',
      [
        'crm_enqueue_job',
        'crm_enqueue_calendar_sync',
        'crm_enqueue_booking_mail',
        'crm_enqueue_email',
        'crm_enqueue_notification_email',
      ],
      [
        'crm_enqueue_job(uuid, timestamp with time zone)',
        'crm_enqueue_calendar_sync(uuid, timestamp with time zone)',
        'crm_enqueue_booking_mail(uuid, text)',
        'crm_enqueue_email(uuid)',
        'crm_enqueue_notification_email(uuid)',
      ],
      ['app', 'app', 'app', 'app', 'app'],
    ],
    [
      'crm_sweep',
      ['crm_workspace_ids', 'crm_notification_digests_due'],
      ['crm_workspace_ids(uuid, integer)', 'crm_notification_digests_due(uuid, uuid, integer)'],
      ['worker', 'worker'],
    ],
    [
      'crm_purge',
      ['crm_workspaces_to_purge', 'crm_purge_workspace_begin', 'crm_purge_workspace_end'],
      ['crm_workspaces_to_purge(integer)', 'crm_purge_workspace_begin(uuid)', 'crm_purge_workspace_end(uuid)'],
      ['worker', 'worker', 'worker'],
    ],
    ['crm_form_lookup', ['crm_form_by_key'], ['crm_form_by_key(text)'], ['app']],
    [
      'crm_invitation_lookup',
      ['crm_invitation_by_token', 'crm_invitation_open_for'],
      ['crm_invitation_by_token(text)', 'crm_invitation_open_for(text)'],
      ['app', 'app'],
    ],
    [
      'crm_domain_lookup',
      ['crm_workspace_has_domain', 'crm_workspaces_by_domain', 'crm_join_requests_of'],
      ['crm_workspace_has_domain(uuid, text)', 'crm_workspaces_by_domain(text)', 'crm_join_requests_of(uuid)'],
      ['app', 'app', 'app'],
    ],
    [
      'crm_booking_lookup',
      [
        'crm_booking_page_by_key',
        'crm_booking_by_token',
        'crm_booking_page_by_address',
        'crm_booking_profile_pages',
        'crm_booking_owner_slugs',
      ],
      [
        'crm_booking_page_by_key(text)',
        'crm_booking_by_token(text)',
        'crm_booking_page_by_address(uuid, text)',
        'crm_booking_profile_pages(uuid, smallint, uuid, text, integer)',
        'crm_booking_owner_slugs(uuid, text)',
      ],
      ['app', 'app', 'app', 'app', 'app'],
    ],
    ['crm_address', ['crm_claim_workspace_address'], ['crm_claim_workspace_address(text)'], ['app']],
    [
      'crm_handle',
      [
        'crm_save_public_profile',
        'crm_public_profiles_of',
        'crm_handle_owner',
        'crm_save_picture_hidden',
        'crm_pictures_hidden',
      ],
      [
        'crm_save_public_profile(uuid, text, text)',
        'crm_public_profiles_of(uuid[])',
        'crm_handle_owner(text)',
        'crm_save_picture_hidden(uuid, boolean)',
        'crm_pictures_hidden(uuid[])',
      ],
      ['app', 'app', 'app', 'app', 'app'],
    ],
  ])(
    'keeps %s unable to log in, owning only %s, and out of the app’s reach',
    async (name, fns, signatures, callers) => {
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
      // The app (or the worker alone) can call each, and nobody else by default.
      for (const [index, signature] of signatures.entries()) {
        const grants = await owner.query<{ app: boolean; worker: boolean; anyone: boolean }>(
          `
        select has_function_privilege('crm_app', $1, 'EXECUTE') as app,
          has_function_privilege('crm_worker', $1, 'EXECUTE') as worker,
          exists (select 1 from aclexplode((select proacl from pg_proc where proname = $2)) where grantee = 0) as anyone
      `,
          [signature, fns[index]],
        );
        expect(grants.rows, signature).toEqual([{ app: callers[index] === 'app', worker: true, anyone: false }]);
      }
      // And an app login can't become it.
      await expect(
        db.withWorkspace(randomUUID(), (tx) => tx.execute(sql.raw(`set local role ${name}`))),
      ).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    },
  );

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

    // The worker (the relay's login from spec 0008 on), outside any workspace: the function sees past row level
    // security, and hands back ids only.
    const app = new pg.Client({ connectionString: workerUrl });
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
    const app = new pg.Client({ connectionString: workerUrl });
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

  describe('crm_outbox_prune (spec 0007, milestone 3, AC-89)', () => {
    type Row = { readonly age: string; readonly published: boolean };
    const old: Row = { age: '2 days', published: true };
    const recent: Row = { age: '1 hour', published: true };
    const waiting: Row = { age: '2 days', published: false };

    /** A workspace whose outbox holds `rows` as seq 1, 2 and on, each made `age` ago. */
    async function outboxOf(name: string, rows: readonly Row[]): Promise<string> {
      const { workspaceId } = await workspaceWithMember(name);
      const objectId = await objectIn(workspaceId);
      for (const [index, row] of rows.entries()) {
        await owner.query(
          `insert into outbox (workspace_id, seq, kind, object_id, created_at, published_at)
           values ($1, $2, 'records', $3, now() - $4::interval, case when $5::boolean then now() end)`,
          [workspaceId, index + 1, objectId, row.age, row.published],
        );
      }
      return workspaceId;
    }

    const left = async (workspaceId: string): Promise<readonly number[]> =>
      (
        await owner.query<{ seq: number }>('select seq::int as seq from outbox where workspace_id = $1 order by seq', [
          workspaceId,
        ])
      ).rows.map((row) => row.seq);

    /** Runs `work` on the worker's login, the only one that may call the prune. */
    async function asWorker<T>(work: (worker: pg.Client) => Promise<T>): Promise<T> {
      const worker = new pg.Client({ connectionString: workerUrl });
      await worker.connect();
      try {
        return await work(worker);
      } finally {
        await worker.end();
      }
    }

    /** One call with the cutoff `retention` ago (null for none). Other suites' rows may go in the same call. */
    const prune = async (worker: pg.Client, retention: string | null, max: number): Promise<number | undefined> =>
      (
        await worker.query<{ pruned: number }>('select crm_outbox_prune(now() - $1::interval, $2) as pruned', [
          retention,
          max,
        ])
      ).rows[0]?.pruned;

    it('deletes published rows made before the cutoff from the oldest seq up, stopping at the first it keeps', async () => {
      // An unpublished row: nothing after it goes, however old.
      const blocked = await outboxOf('prune-blocked', [old, old, waiting, old, recent]);
      // A newer row before older ones (a clock that stepped back): nothing after it goes either.
      const newer = await outboxOf('prune-newer', [old, recent, old]);
      // An unpublished oldest row: nothing goes.
      const first = await outboxOf('prune-first', [waiting, old]);
      const clean = await outboxOf('prune-clean', [old, old, old, recent]);
      await asWorker(async (worker) => {
        // The worker, outside any workspace: the function reaches past row level security and answers a count.
        const answered = await worker.query<Record<string, unknown>>(
          `select * from crm_outbox_prune(now() - interval '24 hours', 10000)`,
        );
        expect(answered.fields.map((field) => field.name)).toEqual(['crm_outbox_prune']);
        expect(answered.rows[0]?.crm_outbox_prune).toBeGreaterThanOrEqual(6);
        // The table itself still shows the worker nothing outside withWorkspace.
        expect((await worker.query('select * from outbox')).rowCount).toBe(0);
      });
      expect(await left(blocked)).toEqual([3, 4, 5]);
      expect(await left(newer)).toEqual([2, 3]);
      expect(await left(first)).toEqual([1, 2]);
      expect(await left(clean)).toEqual([4]);
    });

    it('keeps rows made after the cutoff it is given, deletes nothing for a null cutoff, and never the last hour', async () => {
      const workspaceId = await outboxOf('prune-cutoff', [
        { age: '24 hours 1 minute', published: true },
        { age: '23 hours 59 minutes', published: true },
        { age: '61 minutes', published: true },
        { age: '59 minutes', published: true },
      ]);
      await asWorker(async (worker) => {
        expect(await prune(worker, null, 10_000)).toBe(0);
        expect(await left(workspaceId)).toEqual([1, 2, 3, 4]);
        await prune(worker, '24 hours', 10_000);
        expect(await left(workspaceId)).toEqual([2, 3, 4]);
        // A cutoff of now, or in the future, still keeps the last hour: the function's floor.
        await prune(worker, '0 seconds', 10_000);
        await prune(worker, '-1 day', 10_000);
      });
      expect(await left(workspaceId)).toEqual([4]);
    });

    it('deletes at most max rows a call, clamped to 1 to 10,000', async () => {
      const workspaceId = await outboxOf('prune-clamp', []);
      await owner.query(
        `insert into outbox (workspace_id, seq, kind, created_at, published_at)
         select $1, n, 'members', now() - interval '2 days', now() from generate_series(1, 10010) n`,
        [workspaceId],
      );
      await asWorker(async (worker) => {
        expect(await prune(worker, '24 hours', 0)).toBe(1);
        expect(await prune(worker, '24 hours', -5)).toBe(1);
        expect(await prune(worker, '24 hours', 1_000_000)).toBe(10_000);
        // Whatever is left of this workspace's 8 (other suites' rows may share the call).
        expect(await prune(worker, '24 hours', 10_000)).toBeGreaterThanOrEqual(8);
      });
      expect(await left(workspaceId)).toEqual([]);
      const definition = await owner.query<{ body: string }>(
        `select pg_get_functiondef('crm_outbox_prune(timestamptz, integer)'::regprocedure) as body`,
      );
      expect(definition.rows[0]?.body).toMatch(/least\(greatest\(crm_outbox_prune\.max, 1\), 10000\)/i);
    });

    it('is refused to the app and the identity login, and is the only crm_outbox_prune', async () => {
      const workspaceId = await outboxOf('prune-refused', [old]);
      for (const url of [appUrl, identityUrl]) {
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
          await expect(
            client.query(`select public.crm_outbox_prune(now() - interval '24 hours', 10)`),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.end();
        }
      }
      // Nor can the app delete outbox rows itself, even its own workspace's.
      await expect(
        db.withWorkspace(workspaceId, (tx) => tx.execute(sql`delete from outbox where workspace_id = ${workspaceId}`)),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      expect(await left(workspaceId)).toEqual([1]);
      // 0020's crm_outbox_prune(integer), the app's, is gone.
      const overloads = await owner.query<{ signature: string }>(
        `select p.oid::regprocedure::text as signature from pg_proc p where p.proname = 'crm_outbox_prune'`,
      );
      expect(overloads.rows).toEqual([{ signature: 'crm_outbox_prune(timestamp with time zone,integer)' }]);
    });
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

  describe('crm_workspace_ids (spec 0008, milestone 3, AC-112, AC-115)', () => {
    it('gives crm_sweep select on workspaces.id and deleted_at, and the digest’s columns, and nothing else', async () => {
      // From the catalog, by every route, as for crm_relay: no table privilege, two column grants, no role.
      const tables = await owner.query<{ table: string }>(`
        select n.nspname || '.' || c.relname as table
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
        where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg\\_toast%' and has_table_privilege('crm_sweep', c.oid, p.privilege)
      `);
      expect(tables.rows).toEqual([]);
      const columns = await owner.query<{ column: string; privilege: string }>(`
        select att.attrelid::regclass || '.' || att.attname as column, a.privilege_type as privilege
        from pg_attribute att cross join lateral aclexplode(att.attacl) a
        where a.grantee = 'crm_sweep'::regrole order by 1
      `);
      expect(columns.rows).toEqual([
        { column: 'members.id', privilege: 'SELECT' },
        { column: 'members.status', privilege: 'SELECT' },
        { column: 'members.workspace_id', privilege: 'SELECT' },
        { column: 'notification_settings.digest', privilege: 'SELECT' },
        { column: 'notification_settings.digest_sent_on', privilege: 'SELECT' },
        { column: 'notification_settings.member_id', privilege: 'SELECT' },
        { column: 'notification_settings.time_zone', privilege: 'SELECT' },
        { column: 'notification_settings.workspace_id', privilege: 'SELECT' },
        { column: 'workspaces.deleted_at', privilege: 'SELECT' },
        { column: 'workspaces.id', privilege: 'SELECT' },
      ]);
      const memberOf = await owner.query(`select 1 from pg_auth_members where member = 'crm_sweep'::regrole`);
      expect(memberOf.rowCount).toBe(0);
      const schemas = await owner.query<{ schema: string; privilege: string }>(`
        select n.nspname as schema, a.privilege_type as privilege
        from pg_namespace n cross join aclexplode(n.nspacl) a
        where a.grantee = 'crm_sweep'::regrole order by 1, 2
      `);
      expect(schemas.rows).toEqual([{ schema: 'public', privilege: 'USAGE' }]);
    });

    it('names the workspaces not deleted, ids only, in id order after the one given, clamped to 1 to 500', async () => {
      const made = await Promise.all(['sweep-1', 'sweep-2', 'sweep-3'].map((name) => workspaceWithMember(name)));
      const [a, b, c] = made.map((w) => w.workspaceId).sort();
      if (a === undefined || b === undefined || c === undefined) throw new Error('Three workspaces were made.');
      await owner.query('update workspaces set deleted_at = now() where id = $1', [b]);
      // The worker, outside any workspace: the function sees past row level security, and hands back ids only.
      const worker = new pg.Client({ connectionString: workerUrl });
      await worker.connect();
      try {
        const page = await worker.query<Record<string, unknown>>('select * from crm_workspace_ids(null, 500)');
        expect(page.fields.map((field) => field.name)).toEqual(['crm_workspace_ids']);
        const ids = page.rows.map((row) => String(row.crm_workspace_ids));
        expect(ids).toEqual([...ids].sort());
        expect(ids).toEqual(expect.arrayContaining([a, c]));
        expect(ids).not.toContain(b);
        const ours = async (after: string | null, max = 500) => {
          const result = await worker.query<{ id: string }>('select id from crm_workspace_ids($1, $2) as w(id)', [
            after,
            max,
          ]);
          return result.rows.map((row) => row.id);
        };
        // After `a`, every id is greater, and `c` comes before any later page.
        const afterA = await ours(a);
        expect(afterA.every((id) => id > a)).toBe(true);
        expect(afterA).toContain(c);
        expect(await ours(c)).not.toContain(a);
        for (const max of [0, -5, 1]) expect(await ours(null, max), String(max)).toHaveLength(1);
        expect((await ours(null, 1_000_000)).length).toBeLessThanOrEqual(500);
        // The table itself still shows the worker nothing outside withWorkspace.
        expect((await worker.query('select id from workspaces')).rowCount).toBe(0);
      } finally {
        await worker.end();
      }
      const definition = await owner.query<{ body: string }>(
        `select pg_get_functiondef('crm_workspace_ids(uuid, integer)'::regprocedure) as body`,
      );
      expect(definition.rows[0]?.body).toMatch(/least\(greatest\(crm_workspace_ids\.max, 1\), 500\)/i);
    });

    it('is refused to the app and the identity login, and is the only crm_workspace_ids', async () => {
      for (const url of [appUrl, identityUrl]) {
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
          await expect(client.query('select * from public.crm_workspace_ids(null, 10)')).rejects.toMatchObject({
            code: '42501',
          });
        } finally {
          await client.end();
        }
      }
      // Nor can an app login become crm_sweep, or read the workspaces it lists outside its own.
      await expect(
        db.withWorkspace(randomUUID(), (tx) => tx.execute(sql.raw('set local role crm_sweep'))),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      const overloads = await owner.query<{ signature: string }>(
        `select p.oid::regprocedure::text as signature from pg_proc p where p.proname = 'crm_workspace_ids'`,
      );
      expect(overloads.rows).toEqual([{ signature: 'crm_workspace_ids(uuid,integer)' }]);
    });
  });

  it('answers nothing to a caller without execute', async () => {
    const identity = new pg.Client({ connectionString: identityUrl });
    await identity.connect();
    try {
      for (const call of [
        'select * from public.crm_outbox_workspaces(10, null)',
        'select public.crm_outbox_prune(now(), 10)',
        'select * from public.crm_workspace_ids(null, 10)',
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
          sql`insert into objects (workspace_id, api_slug, singular_name, plural_name, icon, hue, position, created_by_type, updated_by_type) values (${a.workspaceId}, 'things', 'Thing', 'Things', 'box', 'gray', 0, 'system', 'system') returning id`,
        );
        const objectId = object.rows[0]?.id;
        await tx.execute(
          sql`insert into records (workspace_id, object_id, created_by_type, created_by_id, created_by_member_id, updated_by_type) values (${a.workspaceId}, ${objectId}, 'member', ${b.memberId}, ${b.memberId}, 'system')`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'records_created_by' } });
  });

  it("reads none of another workspace's validation rules, and refuses a rule on its attribute (spec 0013)", async () => {
    /** An object with one text attribute and one rule on it, made inside the workspace. */
    const ruled = async (workspaceId: string) => {
      const objectId = await objectIn(workspaceId);
      const attributeId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into attributes (workspace_id, id, object_id, api_slug, title, type, position, created_by_type, updated_by_type) values (${workspaceId}, ${attributeId}, ${objectId}, 'code', 'Code', 'text', 0, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into validation_rules (workspace_id, id, object_id, attribute_id, kind, params, position, created_by_type, updated_by_type) values (${workspaceId}, ${randomUUID()}, ${objectId}, ${attributeId}, 'length', '{"max": 8}', 0, 'system', 'system')`,
        );
      });
      return { objectId, attributeId };
    };
    const a = await workspaceWithMember('rules-a');
    const b = await workspaceWithMember('rules-b');
    const inA = await ruled(a.workspaceId);
    const inB = await ruled(b.workspaceId);
    const seenFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ attribute_id: string }>(sql`select attribute_id from validation_rules`),
    );
    expect(seenFromA.rows).toEqual([{ attribute_id: inA.attributeId }]);
    // A rule in A naming B's attribute: the composite key finds no such attribute in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into validation_rules (workspace_id, id, object_id, attribute_id, kind, params, position, created_by_type, updated_by_type) values (${a.workspaceId}, ${randomUUID()}, ${inA.objectId}, ${inB.attributeId}, 'length', '{"max": 8}', 1, 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'validation_rules_attribute' } });
  });

  it("reads none of another workspace's views, and refuses a view on its object or a default naming its view (spec 0020)", async () => {
    /** An object with one shared view, made inside the workspace, set as its default. */
    const viewed = async (workspaceId: string) => {
      const objectId = await objectIn(workspaceId);
      const viewId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into views (workspace_id, id, object_id, name, visibility, position, config, created_by_type, updated_by_type) values (${workspaceId}, ${viewId}, ${objectId}, 'All things', 'workspace', 0, '{"columns":[],"showNewAttributes":true,"pinnedCount":1,"sorts":[]}', 'system', 'system')`,
        );
        await tx.execute(sql`update objects set default_view_id = ${viewId} where id = ${objectId}`);
      });
      return { objectId, viewId };
    };
    const a = await workspaceWithMember('views-a');
    const b = await workspaceWithMember('views-b');
    const inA = await viewed(a.workspaceId);
    const inB = await viewed(b.workspaceId);
    const seenFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from views`),
    );
    expect(seenFromA.rows).toEqual([{ id: inA.viewId }]);
    // A view in A on B's object: the composite key finds no such object in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into views (workspace_id, object_id, name, visibility, position, config, created_by_type, updated_by_type) values (${a.workspaceId}, ${inB.objectId}, 'Theirs', 'workspace', 1, '{}', 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'views_object' } });
    // A's object pointing at B's view as its default.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update objects set default_view_id = ${inB.viewId} where id = ${inA.objectId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'objects_default_view' } });
    // A private view needs its creator and can't be locked.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into views (workspace_id, object_id, name, visibility, position, config, created_by_type, updated_by_type) values (${a.workspaceId}, ${inA.objectId}, 'Mine', 'private', 0, '{}', 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'views_private' } });
    // The last opened view (milestone 2): each workspace reads only its own bookmarks, and one in A can't name B's view.
    const bookmark = (workspaceId: string, memberId: string, objectId: string, viewId: string) =>
      db.withWorkspace(workspaceId, (tx) =>
        tx.execute(
          sql`insert into member_view_state (workspace_id, member_id, parent_id, view_id) values (${workspaceId}, ${memberId}, ${objectId}, ${viewId})`,
        ),
      );
    await bookmark(a.workspaceId, a.memberId, inA.objectId, inA.viewId);
    await bookmark(b.workspaceId, b.memberId, inB.objectId, inB.viewId);
    const statesFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ view_id: string }>(sql`select view_id from member_view_state`),
    );
    expect(statesFromA.rows).toEqual([{ view_id: inA.viewId }]);
    await expect(bookmark(a.workspaceId, a.memberId, inB.objectId, inB.viewId)).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'member_view_state_view' },
    });
  });

  it("reads none of another workspace's recent items, and refuses one for its member (spec 0039, AC-1103)", async () => {
    const a = await workspaceWithMember('recents-a');
    const b = await workspaceWithMember('recents-b');
    const visit = (workspaceId: string, memberId: string) =>
      db.withWorkspace(workspaceId, (tx) =>
        tx.execute(
          sql`insert into member_recents (workspace_id, member_id, kind, target_id) values (${workspaceId}, ${memberId}, 'record', ${randomUUID()})`,
        ),
      );
    await visit(a.workspaceId, a.memberId);
    await visit(b.workspaceId, b.memberId);
    const fromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ member_id: string }>(sql`select member_id from member_recents`),
    );
    expect(fromA.rows).toEqual([{ member_id: a.memberId }]);
    // A row in A for B's member: the composite key finds no such member in A.
    await expect(visit(a.workspaceId, b.memberId)).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'member_recents_member' },
    });
    // Only records and views.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into member_recents (workspace_id, member_id, kind, target_id) values (${a.workspaceId}, ${a.memberId}, 'task', ${randomUUID()})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'member_recents_kind' } });
  });

  it('finds nothing through crm_search_similar with no workspace set (spec 0039)', async () => {
    const client = new pg.Client({ connectionString: appUrl });
    await client.connect();
    try {
      const found = await client.query('select * from crm_search_similar(array[gen_random_uuid()], $1, 10)', ['acme']);
      expect(found.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("reads none of another workspace's tasks or task links, and refuses a link to its record (spec 0019)", async () => {
    /** A task linking one record, made inside the workspace. */
    const tasked = async (workspaceId: string) => {
      const objectId = await objectIn(workspaceId);
      const recordId = randomUUID();
      const taskId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type) values (${workspaceId}, ${recordId}, ${objectId}, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into tasks (workspace_id, id, title, created_by_type, updated_by_type) values (${workspaceId}, ${taskId}, 'Call back', 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into task_records (workspace_id, task_id, record_id, position, created_by_type) values (${workspaceId}, ${taskId}, ${recordId}, 0, 'system')`,
        );
      });
      return { recordId, taskId };
    };
    const a = await workspaceWithMember('tasks-a');
    const b = await workspaceWithMember('tasks-b');
    const inA = await tasked(a.workspaceId);
    const inB = await tasked(b.workspaceId);
    const tasksFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from tasks`),
    );
    expect(tasksFromA.rows).toEqual([{ id: inA.taskId }]);
    const linksFromA = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ task_id: string }>(sql`select task_id from task_records`),
    );
    expect(linksFromA.rows).toEqual([{ task_id: inA.taskId }]);
    // A link in A to B's record: the composite key finds no such record in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into task_records (workspace_id, task_id, record_id, position, created_by_type) values (${a.workspaceId}, ${inA.taskId}, ${inB.recordId}, 1, 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'task_records_record' } });
    // A record removed for good while a task still links it fails: the key has no cascade (AC-446).
    await expect(
      db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`delete from records where id = ${inA.recordId}`)),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'task_records_record' } });
  });
  it("reads none of another workspace's notes, and refuses a note on its record (spec 0019)", async () => {
    /** A note on one record, made inside the workspace. */
    const noted = async (workspaceId: string) => {
      const objectId = await objectIn(workspaceId);
      const recordId = randomUUID();
      const noteId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type) values (${workspaceId}, ${recordId}, ${objectId}, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into notes (workspace_id, id, record_id, content, created_by_type, updated_by_type) values (${workspaceId}, ${noteId}, ${recordId}, '{"type":"doc"}', 'system', 'system')`,
        );
      });
      return { recordId, noteId };
    };
    const a = await workspaceWithMember('notes-a');
    const b = await workspaceWithMember('notes-b');
    const inA = await noted(a.workspaceId);
    const inB = await noted(b.workspaceId);
    const fromA = await db.withWorkspace(a.workspaceId, (tx) => tx.execute<{ id: string }>(sql`select id from notes`));
    expect(fromA.rows).toEqual([{ id: inA.noteId }]);
    // A note in A on B's record: the composite key finds no such record in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into notes (workspace_id, id, record_id, content, created_by_type, updated_by_type) values (${a.workspaceId}, ${randomUUID()}, ${inB.recordId}, '{"type":"doc"}', 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'notes_record' } });
    // A record removed for good while it still has a note fails: the key has no cascade (AC-446).
    await expect(
      db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`delete from records where id = ${inA.recordId}`)),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'notes_record' } });
  });

  it("reads none of another workspace's comments or notifications, and refuses either on its record (spec 0038, AC-1182)", async () => {
    /** A comment on one record, a reaction, an earlier version and a notification for the member, made inside the workspace. */
    const commented = async (workspaceId: string, memberId: string) => {
      const objectId = await objectIn(workspaceId);
      const recordId = randomUUID();
      const commentId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type) values (${workspaceId}, ${recordId}, ${objectId}, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into comments (workspace_id, id, record_id, thread_id, body, created_by_type, updated_by_type) values (${workspaceId}, ${commentId}, ${recordId}, ${commentId}, 'Hello', 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into comment_versions (workspace_id, comment_id, version, body, created_at, created_by_type) values (${workspaceId}, ${commentId}, 1, 'Hi', now(), 'system')`,
        );
        await tx.execute(
          sql`insert into comment_reactions (workspace_id, comment_id, member_id, emoji) values (${workspaceId}, ${commentId}, ${memberId}, '👍')`,
        );
        await tx.execute(
          sql`insert into notifications (workspace_id, member_id, kind, actor_type, record_id, thread_id, comment_id) values (${workspaceId}, ${memberId}, 'mention', 'system', ${recordId}, ${commentId}, ${commentId})`,
        );
        await tx.execute(
          sql`insert into notification_settings (workspace_id, member_id, email_replies) values (${workspaceId}, ${memberId}, true)`,
        );
      });
      return { recordId, commentId };
    };
    const a = await workspaceWithMember('comments-a');
    const b = await workspaceWithMember('comments-b');
    const inA = await commented(a.workspaceId, a.memberId);
    const inB = await commented(b.workspaceId, b.memberId);
    const fromA = await db.withWorkspace(a.workspaceId, async (tx) => ({
      comments: (await tx.execute<{ id: string }>(sql`select id from comments`)).rows,
      versions: (await tx.execute<{ id: string }>(sql`select comment_id as id from comment_versions`)).rows,
      reactions: (await tx.execute<{ id: string }>(sql`select comment_id as id from comment_reactions`)).rows,
      notifications: (await tx.execute<{ id: string }>(sql`select comment_id as id from notifications`)).rows,
      settings: (await tx.execute<{ id: string }>(sql`select member_id as id from notification_settings`)).rows,
    }));
    expect(fromA).toEqual({
      comments: [{ id: inA.commentId }],
      versions: [{ id: inA.commentId }],
      reactions: [{ id: inA.commentId }],
      notifications: [{ id: inA.commentId }],
      settings: [{ id: a.memberId }],
    });
    // A comment in A on B's record, or a notification in A for B's member: the composite keys find no such row in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into comments (workspace_id, id, record_id, thread_id, body, created_by_type, updated_by_type) values (${a.workspaceId}, ${inB.commentId}, ${inB.recordId}, ${inB.commentId}, 'Hello', 'system', 'system')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'comments_record' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into notifications (workspace_id, member_id, kind, actor_type, record_id, thread_id, comment_id) values (${a.workspaceId}, ${b.memberId}, 'mention', 'system', ${inA.recordId}, ${inA.commentId}, ${inA.commentId})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'notifications_member' } });
    // A record removed for good while it still has a comment fails: the key has no cascade (AC-1160).
    await expect(
      db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`delete from records where id = ${inA.recordId}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it("reads none of another workspace's calendar rows, and refuses a link to its record (spec 0024)", async () => {
    /** A connection holding one meeting that shows on one record, made inside the workspace. */
    const synced = async (workspaceId: string, memberId: string) => {
      const objectId = await objectIn(workspaceId);
      const recordId = randomUUID();
      const connectionId = randomUUID();
      const meetingId = randomUUID();
      await db.withWorkspace(workspaceId, async (tx) => {
        await tx.execute(
          sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type) values (${workspaceId}, ${recordId}, ${objectId}, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into calendar_connections (workspace_id, id, member_id, provider, account_email, tokens, created_by_type, created_by_id, created_by_member_id, updated_by_type)
            values (${workspaceId}, ${connectionId}, ${memberId}, 'google', 'ada@example.com', '\\x00'::bytea, 'member', ${memberId}, ${memberId}, 'calendar')`,
        );
        await tx.execute(
          sql`insert into meetings (workspace_id, id, ical_uid, title, starts_at, ends_at, created_by_type, updated_by_type)
            values (${workspaceId}, ${meetingId}, ${`uid-${meetingId}`}, 'Intro', now(), now(), 'calendar', 'calendar')`,
        );
        await tx.execute(
          sql`insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id) values (${workspaceId}, ${meetingId}, ${connectionId}, 'event-1', 'primary')`,
        );
        await tx.execute(
          sql`insert into meeting_attendees (workspace_id, meeting_id, email, position, match, person_record_id) values (${workspaceId}, ${meetingId}, 'bea@example.com', 0, 'linked', ${recordId})`,
        );
        await tx.execute(
          sql`insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at) values (${workspaceId}, ${meetingId}, ${recordId}, 'attendee', now())`,
        );
        await tx.execute(
          sql`insert into calendar_settings (workspace_id, created_by_type, updated_by_type) values (${workspaceId}, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into calendar_busy_times (workspace_id, connection_id, calendar_id, provider_event_id, starts_at, ends_at) values (${workspaceId}, ${connectionId}, 'primary', 'solo-1', now(), now() + interval '1 hour')`,
        );
        await tx.execute(
          sql`insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role, is_primary, is_destination, created_by_type, updated_by_type)
            values (${workspaceId}, ${connectionId}, ${memberId}, 'primary', 'Ada', 'owner', true, true, 'calendar', 'calendar')`,
        );
      });
      return { recordId, connectionId, meetingId };
    };
    const a = await workspaceWithMember('calendar-a');
    const b = await workspaceWithMember('calendar-b');
    const inA = await synced(a.workspaceId, a.memberId);
    const inB = await synced(b.workspaceId, b.memberId);
    const read = (table: string) =>
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute<{ workspace_id: string }>(sql.raw(`select workspace_id::text from ${table}`)),
      );
    for (const table of [
      'calendar_connections',
      'meetings',
      'meeting_sources',
      'meeting_attendees',
      'meeting_records',
      'calendar_settings',
      'calendar_busy_times',
      'calendar_calendars',
    ]) {
      expect((await read(table)).rows, table).toEqual([{ workspace_id: a.workspaceId }]);
    }
    // A link in A to B's record, or to B's meeting: the composite keys find no such rows in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at) values (${a.workspaceId}, ${inA.meetingId}, ${inB.recordId}, 'attendee', now())`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'meeting_records_record' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id) values (${a.workspaceId}, ${inB.meetingId}, ${inA.connectionId}, 'event-2', 'primary')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'meeting_sources_meeting' } });
    // A busy time in A under B's connection: the composite key finds no such connection in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into calendar_busy_times (workspace_id, connection_id, calendar_id, provider_event_id, starts_at, ends_at) values (${a.workspaceId}, ${inB.connectionId}, 'primary', 'solo-2', now(), now() + interval '1 hour')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'calendar_busy_times_connection' } });
    // A calendar in A under B's connection (milestone 5): the composite key finds no such connection in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role, created_by_type, updated_by_type)
            values (${a.workspaceId}, ${inB.connectionId}, ${a.memberId}, 'team', 'Team', 'owner', 'calendar', 'calendar')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'calendar_calendars_connection' } });
    // A destination the member can only read, or a second destination: refused by the checks (AC-996, AC-1004).
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role, is_destination, created_by_type, updated_by_type)
            values (${a.workspaceId}, ${inA.connectionId}, ${a.memberId}, 'holidays', 'Holidays', 'reader', true, 'calendar', 'calendar')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'calendar_calendars_destination_writable' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role, is_destination, created_by_type, updated_by_type)
            values (${a.workspaceId}, ${inA.connectionId}, ${a.memberId}, 'work', 'Work', 'writer', true, 'calendar', 'calendar')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'calendar_calendars_destination' } });
    // A record removed for good while a meeting still shows on it fails: the purge removes the links first.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`delete from records where id = ${inA.recordId}`)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    // Only calendar sync and the system act with no id: any other actor type still needs one.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into meetings (workspace_id, ical_uid, title, starts_at, ends_at, created_by_type, updated_by_type) values (${a.workspaceId}, 'uid-x', 'X', now(), now(), 'automation', 'calendar')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'meetings_created_by_actor' } });
    // And a table that admits no calendar actor refuses it.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into tasks (workspace_id, id, title, created_by_type, updated_by_type) values (${a.workspaceId}, ${randomUUID()}, 'Call', 'calendar', 'calendar')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'tasks_created_by_actor' } });
  });
});

describe('forms (spec 0023, milestone 1)', () => {
  /** A form with one version, one submission and one record it touched, made inside the workspace. */
  const formIn = async (workspaceId: string) => {
    const objectId = await objectIn(workspaceId);
    const recordId = randomUUID();
    const formId = randomUUID();
    const versionId = randomUUID();
    const submissionId = randomUUID();
    const publicKey = `key${randomUUID().replaceAll('-', '')}`;
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(
        sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type) values (${workspaceId}, ${recordId}, ${objectId}, 'system', 'system')`,
      );
      await tx.execute(
        sql`insert into forms (workspace_id, id, name, main_object_id, public_key, signing_secret, created_by_type, updated_by_type) values (${workspaceId}, ${formId}, 'Contact us', ${objectId}, ${publicKey}, 'secret', 'system', 'system')`,
      );
      await tx.execute(
        sql`insert into form_versions (workspace_id, id, form_id, number, document, created_by_type, updated_by_type) values (${workspaceId}, ${versionId}, ${formId}, 1, '{}', 'system', 'system')`,
      );
      await tx.execute(
        sql`insert into form_submissions (workspace_id, id, form_id, version_id, idempotency_key, answers) values (${workspaceId}, ${submissionId}, ${formId}, ${versionId}, ${randomUUID()}, '{}')`,
      );
      await tx.execute(
        sql`insert into form_submission_records (workspace_id, submission_id, object_id, record_id, action, role) values (${workspaceId}, ${submissionId}, ${objectId}, ${recordId}, 'created', 'main')`,
      );
    });
    return { objectId, recordId, formId, versionId, submissionId, publicKey };
  };

  it("reads none of another workspace's forms, versions, submissions or touched records", async () => {
    const a = await workspaceWithMember('forms-a');
    const b = await workspaceWithMember('forms-b');
    const inA = await formIn(a.workspaceId);
    const inB = await formIn(b.workspaceId);
    for (const table of ['forms', 'form_versions', 'form_submissions']) {
      const rows = await db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute<{ id: string }>(sql.raw(`select id::text as id from ${table}`)),
      );
      expect(rows.rows, table).toEqual([
        { id: table === 'forms' ? inA.formId : table === 'form_versions' ? inA.versionId : inA.submissionId },
      ]);
    }
    const touched = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ record_id: string }>(sql`select record_id::text from form_submission_records`),
    );
    expect(touched.rows).toEqual([{ record_id: inA.recordId }]);
    // A's submission naming B's record: the composite key finds no such record in A.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into form_submission_records (workspace_id, submission_id, object_id, record_id, action, role) values (${a.workspaceId}, ${inA.submissionId}, ${inA.objectId}, ${inB.recordId}, 'matched', 'person')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'form_submission_records_record' } });
    // One submission per attempt: the same idempotency key twice is refused by the database.
    await expect(
      db.withWorkspace(a.workspaceId, async (tx) => {
        const key = randomUUID();
        for (let i = 0; i < 2; i += 1) {
          await tx.execute(
            sql`insert into form_submissions (workspace_id, form_id, version_id, idempotency_key, answers) values (${a.workspaceId}, ${inA.formId}, ${inA.versionId}, ${key}, '{}')`,
          );
        }
      }),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'form_submissions_attempt' } });
  });

  it('finds a form by its public key across workspaces, answering ids only', async () => {
    const a = await workspaceWithMember('forms-key');
    const inA = await formIn(a.workspaceId);
    // Outside any workspace, as the public endpoint asks before it knows one.
    const found = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute<{ workspace_id: string; form_id: string }>(
        sql`select workspace_id::text, form_id::text from crm_form_by_key(${inA.publicKey})`,
      ),
    );
    expect(found.rows).toEqual([{ workspace_id: a.workspaceId, form_id: inA.formId }]);
    const missing = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute(sql`select * from crm_form_by_key('no-such-key-at-all')`),
    );
    expect(missing.rows).toEqual([]);
  });

  it('takes a form as an actor on records and values (AC-564), with an id and no member', async () => {
    const a = await workspaceWithMember('forms-actor');
    const inA = await formIn(a.workspaceId);
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(
        sql`update records set updated_by_type = 'form', updated_by_id = ${inA.formId} where id = ${inA.recordId}`,
      ),
    );
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update records set updated_by_type = 'form', updated_by_id = null where id = ${inA.recordId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'records_updated_by_actor' } });
  });
});

describe('booking pages (spec 0025, milestone 1)', () => {
  /** A personal page with its owner as its member, made inside the workspace. */
  const pageIn = async (workspaceId: string, memberId: string) => {
    const pageId = randomUUID();
    const publicKey = randomUUID().replaceAll('-', '').slice(0, 16);
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(
        sql`insert into booking_pages (workspace_id, id, public_key, slug, owner_member_id, title, durations, location, availability, created_by_type, updated_by_type) values (${workspaceId}, ${pageId}, ${publicKey}, 'intro', ${memberId}, 'Intro call', '{30}', '{"type":"video"}', '{}', 'system', 'system')`,
      );
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${workspaceId}, ${pageId}, ${memberId}, 0)`,
      );
      await tx.execute(
        sql`insert into booking_member_hours (workspace_id, member_id, availability, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, '{}', 'system', 'system') on conflict do nothing`,
      );
    });
    return { pageId, publicKey };
  };
  /** A booking on the page, `[from, to)` in UTC, blocking exactly the meeting. */
  const book = (
    workspaceId: string,
    pageId: string,
    hostId: string,
    from: string,
    to: string,
    status = 'confirmed',
    hash = randomUUID(),
  ) =>
    db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into bookings (workspace_id, page_id, host_member_id, starts_at, ends_at, during, visitor_name, visitor_email, visitor_time_zone, status, manage_token_hash, idempotency_key, created_by_type, updated_by_type) values (${workspaceId}, ${pageId}, ${hostId}, ${from}::timestamptz, ${to}::timestamptz, tstzrange(${from}::timestamptz, ${to}::timestamptz), 'Ada', 'ada@example.com', 'UTC', ${status}, ${hash}, ${randomUUID()}, 'system', 'system')`,
      ),
    );

  it("reads none of another workspace's pages, members or bookings, and refuses a booking on its page", async () => {
    const a = await workspaceWithMember('booking-a');
    const b = await workspaceWithMember('booking-b');
    const inA = await pageIn(a.workspaceId, a.memberId);
    const inB = await pageIn(b.workspaceId, b.memberId);
    await book(a.workspaceId, inA.pageId, a.memberId, '2026-11-02T09:00Z', '2026-11-02T09:30Z');
    await book(b.workspaceId, inB.pageId, b.memberId, '2026-11-02T09:00Z', '2026-11-02T09:30Z');
    for (const table of ['booking_pages', 'booking_page_members', 'bookings', 'booking_member_hours']) {
      const rows = await db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute<{ workspace_id: string }>(sql.raw(`select workspace_id::text from ${table}`)),
      );
      expect(rows.rows, table).toEqual([{ workspace_id: a.workspaceId }]);
    }
    await expect(
      book(a.workspaceId, inB.pageId, a.memberId, '2026-11-03T09:00Z', '2026-11-03T09:30Z'),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'bookings_page' } });
  });

  it('refuses two confirmed bookings of one host that overlap, but not touching ones, cancelled ones or another host', async () => {
    const a = await workspaceWithMember('booking-overlap');
    const inA = await pageIn(a.workspaceId, a.memberId);
    await book(a.workspaceId, inA.pageId, a.memberId, '2026-11-02T09:00Z', '2026-11-02T10:00Z');
    await expect(
      book(a.workspaceId, inA.pageId, a.memberId, '2026-11-02T09:30Z', '2026-11-02T10:30Z'),
    ).rejects.toMatchObject({ cause: { code: '23P01', constraint: 'bookings_no_overlap' } });
    await book(a.workspaceId, inA.pageId, a.memberId, '2026-11-02T10:00Z', '2026-11-02T10:30Z');
    await book(a.workspaceId, inA.pageId, a.memberId, '2026-11-02T09:30Z', '2026-11-02T10:30Z', 'cancelled');
    const other = randomUUID();
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${a.workspaceId}, ${other}, 'Other', ${`other-${other}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    await book(a.workspaceId, inA.pageId, other, '2026-11-02T09:30Z', '2026-11-02T10:30Z');
  });

  it('finds a page by its public key across workspaces, answering ids only', async () => {
    const a = await workspaceWithMember('booking-key');
    const inA = await pageIn(a.workspaceId, a.memberId);
    const found = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute<{ workspace_id: string; page_id: string }>(
        sql`select workspace_id::text, page_id::text from crm_booking_page_by_key(${inA.publicKey})`,
      ),
    );
    expect(found.rows).toEqual([{ workspace_id: a.workspaceId, page_id: inA.pageId }]);
    const missing = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute(sql`select * from crm_booking_page_by_key('no-such-key-0000')`),
    );
    expect(missing.rows).toEqual([]);
  });

  it('finds a booking by its manage token’s hash across workspaces, answering ids only', async () => {
    const a = await workspaceWithMember('booking-token');
    const inA = await pageIn(a.workspaceId, a.memberId);
    const hash = randomUUID();
    await book(a.workspaceId, inA.pageId, a.memberId, '2026-11-04T09:00Z', '2026-11-04T09:30Z', 'confirmed', hash);
    const found = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute<{ workspace_id: string; page_id: string }>(
        sql`select workspace_id::text, page_id::text from crm_booking_by_token(${hash})`,
      ),
    );
    expect(found.rows).toEqual([{ workspace_id: a.workspaceId, page_id: inA.pageId }]);
    const missing = await db.withWorkspace(randomUUID(), (tx) =>
      tx.execute(sql`select * from crm_booking_by_token('no-such-hash')`),
    );
    expect(missing.rows).toEqual([]);
  });

  /** A schedule of the member's (spec 0035), made inside the workspace. */
  const scheduleIn = async (workspaceId: string, memberId: string, name = 'Working hours', isDefault = true) => {
    const id = randomUUID();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into availability_schedules (workspace_id, id, member_id, name, is_default, availability, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${memberId}, ${name}, ${isDefault}, '{}', 'system', 'system')`,
      ),
    );
    return id;
  };

  it("reads none of another workspace's schedules, and refuses a page naming one (spec 0035, AC-978)", async () => {
    const a = await workspaceWithMember('schedules-a');
    const b = await workspaceWithMember('schedules-b');
    await scheduleIn(a.workspaceId, a.memberId);
    const inB = await scheduleIn(b.workspaceId, b.memberId);
    const rows = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id::text from availability_schedules`),
    );
    expect(rows.rows).toEqual([{ workspace_id: a.workspaceId }]);
    const outside = await db.withWorkspace(randomUUID(), (tx) => tx.execute(sql`select * from availability_schedules`));
    expect(outside.rows).toEqual([]);
    const page = await pageIn(a.workspaceId, a.memberId);
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update booking_pages set schedule_id = ${inB} where id = ${page.pageId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'booking_pages_schedule' } });
  });

  it('keeps one default per member and names unique ignoring case; deleting a schedule frees its pages', async () => {
    const a = await workspaceWithMember('schedules-rules');
    await scheduleIn(a.workspaceId, a.memberId);
    await expect(scheduleIn(a.workspaceId, a.memberId, 'Evenings', true)).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'availability_schedules_default' },
    });
    await expect(scheduleIn(a.workspaceId, a.memberId, 'WORKING HOURS', false)).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'availability_schedules_name' },
    });
    await expect(scheduleIn(a.workspaceId, a.memberId, '', false)).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'availability_schedules_name_length' },
    });
    const evenings = await scheduleIn(a.workspaceId, a.memberId, 'Evenings', false);
    const page = await pageIn(a.workspaceId, a.memberId);
    await db.withWorkspace(a.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set schedule_id = ${evenings} where id = ${page.pageId}`);
      await tx.execute(sql`delete from availability_schedules where id = ${evenings}`);
    });
    const after = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ workspace_id: string; schedule_id: string | null }>(
        sql`select workspace_id::text, schedule_id::text from booking_pages where id = ${page.pageId}`,
      ),
    );
    expect(after.rows).toEqual([{ workspace_id: a.workspaceId, schedule_id: null }]);
  });

  it('takes a booking page as an actor on records, with an id and no member', async () => {
    const a = await workspaceWithMember('booking-actor');
    const inA = await pageIn(a.workspaceId, a.memberId);
    const objectId = await objectIn(a.workspaceId);
    const recordId = randomUUID();
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(
        sql`insert into records (workspace_id, id, object_id, created_by_type, created_by_id, updated_by_type, updated_by_id) values (${a.workspaceId}, ${recordId}, ${objectId}, 'booking', ${inA.pageId}, 'booking', ${inA.pageId})`,
      ),
    );
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update records set updated_by_type = 'booking', updated_by_id = null where id = ${recordId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'records_updated_by_actor' } });
  });
});

describe('the auth schema: global identity, outside row level security (spec 0005)', () => {
  const AUTH_TABLES = [
    'account',
    'known_device',
    'passkey',
    'public_handles',
    'public_profiles',
    'rate_limit',
    'security_event',
    'session',
    'two_factor',
    'user',
    'user_prefs',
    'verification',
    'workspace_addresses',
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
      'workspace_addresses',
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
    // But the purge (spec 0031, AC-823), which removes a purged workspace's directory rows through its functions,
    // the address claim (migration 0083), which moves a workspace's address through its one function, and the
    // handles (migration 0086), which claim a person's handle and read it back through theirs.
    expect(schema.rows.map((row) => row.grantee).sort()).toEqual(['crm_address', 'crm_handle', 'crm_purge']);
    const tables = await owner.query<{ grant: string }>(`
      select table_name || ' ' || privilege_type as grant from information_schema.role_table_grants
      where table_schema = 'auth'
        and grantee not in (
          'crm_app', 'crm_identity', (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth')
        )
      order by 1
    `);
    expect(tables.rows.map((row) => row.grant)).toEqual([
      'public_handles INSERT',
      'public_handles SELECT',
      'public_profiles INSERT',
      'public_profiles SELECT',
      'workspace_addresses INSERT',
      'workspace_addresses SELECT',
      'workspace_directory DELETE',
      'workspace_membership DELETE',
    ]);
    const columns = await owner.query<{ grant: string }>(`
      select att.attrelid::regclass || '.' || att.attname || ' ' || a.privilege_type as grant
      from pg_attribute att cross join lateral aclexplode(att.attacl) a
      join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and a.grantee = 'crm_purge'::regrole
      order by 1
    `);
    expect(columns.rows.map((row) => row.grant)).toEqual([
      'auth.user_prefs.last_workspace_id SELECT',
      'auth.user_prefs.last_workspace_id UPDATE',
      'auth.workspace_directory.workspace_id SELECT',
      'auth.workspace_membership.workspace_id SELECT',
    ]);
    const claim = await owner.query<{ grant: string }>(`
      select att.attrelid::regclass || '.' || att.attname || ' ' || a.privilege_type as grant
      from pg_attribute att cross join lateral aclexplode(att.attacl) a
      join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where a.grantee = 'crm_address'::regrole
      order by 1
    `);
    // The claim reads the directory's address and moves it, and touches nothing else there.
    expect(claim.rows.map((row) => row.grant)).toEqual([
      'auth.workspace_directory.slug SELECT',
      'auth.workspace_directory.slug UPDATE',
      'auth.workspace_directory.workspace_id SELECT',
    ]);
    const handles = await owner.query<{ grant: string }>(`
      select att.attrelid::regclass || '.' || att.attname || ' ' || a.privilege_type as grant
      from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_handle'::regrole
      order by 1
    `);
    // The handles read a person's name and picture for their profile, and change only the handle and bio; and
    // (migration 0092) read and set whether the picture stays off their public pages, never where `/` takes them.
    expect(handles.rows.map((row) => row.grant)).toEqual([
      'auth."user".id SELECT',
      'auth."user".image SELECT',
      'auth."user".name SELECT',
      'auth.public_profiles.bio UPDATE',
      'auth.public_profiles.handle UPDATE',
      'auth.public_profiles.updated_at UPDATE',
      'auth.user_prefs.picture_hidden INSERT',
      'auth.user_prefs.picture_hidden SELECT',
      'auth.user_prefs.picture_hidden UPDATE',
      'auth.user_prefs.updated_at UPDATE',
      'auth.user_prefs.user_id INSERT',
      'auth.user_prefs.user_id SELECT',
    ]);
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

describe('workspace milestones (spec 0010, AC-177)', () => {
  /** One statement as the app, inside the workspace. */
  const inside = <Row extends Record<string, unknown>>(workspaceId: string, statement: ReturnType<typeof sql>) =>
    db.withWorkspace(workspaceId, (tx) => tx.execute<Row>(statement));
  const reach = (workspaceId: string, milestone: string, into: string = workspaceId) =>
    inside<{ milestone: string }>(
      workspaceId,
      sql`insert into workspace_milestones (workspace_id, milestone) values (${into}, ${milestone}) on conflict do nothing returning milestone`,
    );

  it('lets the app read milestones and insert only their workspace and name, and no other role anything', async () => {
    const table = await owner.query<{ privileges: string }>(`
      select string_agg(p.privilege, ',' order by p.privilege) as privileges
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where has_table_privilege('crm_app', 'public.workspace_milestones', p.privilege)
    `);
    expect(table.rows).toEqual([{ privileges: 'SELECT' }]);
    // Column grants (pg_attribute.attacl): insert of workspace_id and milestone, never reached_at, and nothing else.
    const columns = await owner.query<{ grant: string }>(`
      select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') || ' ' || a.privilege_type || ' ' || att.attname
        as grant
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'public.workspace_milestones'::regclass and att.attnum > 0 and not att.attisdropped
      order by att.attname, a.privilege_type
    `);
    // And the purge (spec 0031, AC-823), which removes a purged workspace's milestones through its functions.
    expect(columns.rows.map((row) => row.grant)).toEqual([
      'crm_app INSERT milestone',
      'crm_app INSERT workspace_id',
      'crm_purge SELECT workspace_id',
    ]);
    const others = await owner.query<{ grant: string }>(`
      select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') || ' ' || a.privilege_type as grant
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'public.workspace_milestones'::regclass and a.grantee not in (c.relowner, 'crm_app'::regrole)
    `);
    expect(others.rows.map((row) => row.grant)).toEqual(['crm_purge DELETE']);
  });

  it("fails the migration's closing check on a stray table or column grant", async () => {
    const migration = await readFile(new URL('../migrations/0027_workspace_milestones.sql', import.meta.url), 'utf8');
    const check = /do \$\$[\s\S]*?\$\$;/.exec(migration.slice(migration.indexOf('Refuse to finish')))?.[0];
    expect(check).toBeDefined();
    // As 0027 left the table: the purge's grants (0058) came later, with their own check.
    const before0058 = [
      'revoke delete on workspace_milestones from crm_purge',
      'revoke select (workspace_id) on workspace_milestones from crm_purge',
    ];
    for (const stray of [
      'grant update (reached_at) on workspace_milestones to crm_app',
      'grant insert (reached_at) on workspace_milestones to crm_app',
      'grant select (milestone) on workspace_milestones to crm_search',
      'grant delete on workspace_milestones to crm_app',
      'grant select on workspace_milestones to public',
    ]) {
      await owner.query('begin');
      try {
        for (const revoke of before0058) await owner.query(revoke);
        await owner.query(stray);
        await expect(owner.query(check ?? ''), stray).rejects.toThrow(/workspace_milestones must reach the owner/);
      } finally {
        await owner.query('rollback');
      }
    }
    // As the migration left it, the check passes.
    await owner.query('begin');
    try {
      for (const revoke of before0058) await owner.query(revoke);
      await owner.query(check ?? '');
    } finally {
      await owner.query('rollback');
    }
  });

  it('never lets the app choose when a milestone was reached', async () => {
    const { workspaceId } = await workspaceWithMember('milestone-time');
    await expect(
      inside(
        workspaceId,
        sql`insert into workspace_milestones (workspace_id, milestone, reached_at) values (${workspaceId}, 'workspace_created', now() - interval '1 year')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect((await inside(workspaceId, sql`select 1 from workspace_milestones`)).rows).toEqual([]);
  });

  it('stores a milestone once: the insert returns its row the first time only', async () => {
    const { workspaceId } = await workspaceWithMember('milestone-once');
    expect((await reach(workspaceId, 'first_record_created')).rows).toEqual([{ milestone: 'first_record_created' }]);
    expect((await reach(workspaceId, 'first_record_created')).rows).toEqual([]);
    await expect(reach(workspaceId, 'first_login')).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'workspace_milestones_milestone' },
    });
  });

  it('never lets the app change or remove a milestone', async () => {
    const { workspaceId } = await workspaceWithMember('milestone-fixed');
    await reach(workspaceId, 'workspace_created');
    for (const statement of [
      sql`update workspace_milestones set reached_at = now() - interval '1 day'`,
      sql`delete from workspace_milestones`,
    ]) {
      await expect(inside(workspaceId, statement)).rejects.toMatchObject({ cause: { code: '42501' } });
    }
    expect((await inside(workspaceId, sql`select milestone from workspace_milestones`)).rows).toEqual([
      { milestone: 'workspace_created' },
    ]);
  });

  it("reads none of another workspace's milestones, even with no filter, nor writes one into it", async () => {
    const a = await workspaceWithMember('milestone-iso-a');
    const b = await workspaceWithMember('milestone-iso-b');
    await reach(a.workspaceId, 'workspace_created');
    await reach(b.workspaceId, 'workspace_created');
    const seenFromA = await inside<{ workspace_id: string }>(
      a.workspaceId,
      sql`select workspace_id from workspace_milestones`,
    );
    expect(seenFromA.rows).toEqual([{ workspace_id: a.workspaceId }]);
    await expect(reach(a.workspaceId, 'first_record_created', b.workspaceId)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
    const pool = new pg.Pool({ connectionString: appUrl });
    try {
      expect((await pool.query('select 1 from workspace_milestones')).rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('goes with its workspace (on delete cascade)', async () => {
    const key = await owner.query<{ action: string }>(
      `select confdeltype as action from pg_constraint where conname = 'workspace_milestones_workspace'`,
    );
    expect(key.rows).toEqual([{ action: 'c' }]);
  });
});

describe('the audit log (spec 0031, AC-830)', () => {
  it('lets the app insert and select audit rows, and nothing more', async () => {
    const grants = await owner.query<{ privilege: string }>(`
      select p.privilege
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where has_table_privilege('crm_app', 'public.audit_events', p.privilege)
      order by 1
    `);
    expect(grants.rows.map((row) => row.privilege)).toEqual(['INSERT', 'SELECT']);
  });

  it('refuses an update, a delete and a truncate from anyone, the owner included', async () => {
    const { workspaceId } = await workspaceWithMember('audit');
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into audit_events (workspace_id, actor_type, action, target_type, target_id) values (${workspaceId}, 'system', 'member.removed', 'member', 'x')`,
      ),
    );
    await expect(
      owner.query('update audit_events set action = $2 where workspace_id = $1', [workspaceId, 'member.left']),
    ).rejects.toMatchObject({ code: 'CRM02' });
    await expect(owner.query('delete from audit_events where workspace_id = $1', [workspaceId])).rejects.toMatchObject({
      code: 'CRM02',
    });
    await expect(owner.query('truncate audit_events')).rejects.toMatchObject({ code: 'CRM02' });
  });

  it('gives crm_invitation_lookup select on seven columns of invitations and nothing else', async () => {
    const columns = await owner.query<{ column: string; privilege: string }>(`
      select att.attname as column, a.privilege_type as privilege
      from pg_attribute att cross join lateral aclexplode(att.attacl) a
      where a.grantee = 'crm_invitation_lookup'::regrole order by 1
    `);
    expect(columns.rows).toEqual(
      ['email', 'expires_at', 'id', 'kind', 'status', 'token_hash', 'workspace_id'].map((column) => ({
        column,
        privilege: 'SELECT',
      })),
    );
  });
});

describe('first run answers (spec 0036)', () => {
  it('let the app insert only a member’s answers and never read them, and the purge only clear them', async () => {
    const table = await owner.query<{ privileges: string | null }>(`
      select string_agg(p.privilege, ',' order by p.privilege) as privileges
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(privilege)
      where has_table_privilege('crm_app', 'public.member_onboarding', p.privilege)
    `);
    // Nothing on the table as a whole: the inserts are column grants.
    expect(table.rows).toEqual([{ privileges: null }]);
    const columns = await owner.query<{ grant: string }>(`
      select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') || ' ' || a.privilege_type || ' ' || att.attname
        as grant
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'public.member_onboarding'::regclass and att.attnum > 0 and not att.attisdropped
      order by att.attname, a.privilege_type
    `);
    expect(columns.rows.map((row) => row.grant)).toEqual([
      'crm_app INSERT answers',
      'crm_app INSERT member_id',
      'crm_app INSERT workspace_id',
      // The purge (0078): crm_purge_workspace_begin finds a workspace's rows and deletes them.
      'crm_purge SELECT workspace_id',
    ]);
    const others = await owner.query<{ grantee: string; privilege: string }>(`
      select coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') as grantee, a.privilege_type as privilege
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'public.member_onboarding'::regclass and a.grantee not in (c.relowner, 'crm_app'::regrole)
    `);
    expect(others.rows).toEqual([{ grantee: 'crm_purge', privilege: 'DELETE' }]);
  });
});
