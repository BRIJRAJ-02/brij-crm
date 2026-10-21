// The sidebar on real Postgres (spec 0034): defaults with nothing stored, the
// first change making the row, two changes at the same moment both kept under
// the row lock, the `nav` outbox row naming only the member, favourites
// resolved through the door (a hidden object's record and a trashed record
// drop out and come back), the star check and limit, pruning a purged id, a
// removed member's row going with them, and a cross workspace read finding
// nothing.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { MAX_NAV_FAVOURITES, NAV_FAVOURITES_LIMIT_MESSAGE } from '@crm/contracts/navigation';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { deleteRecords, restoreRecords } from '../engine/trash.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import type { AccessRules } from '../access/policy.ts';
import { rescope, testScope } from '../testing.ts';
import { createView, deleteView } from '../views/manage.ts';
import { listViews } from '../views/views.ts';
import { changeNav, NAV_ITEM_NOT_FOUND, readNav } from './navigation.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-nav-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace with its owner Ada and a member Bea, and its standard objects. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Nav',
    slug: `nav-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const beaId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${beaId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const bea = testScope({ db, workspaceId, actor: { type: 'member', id: beaId }, role: 'member' });
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const deals = created.objects.deals ?? '';
  const names = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const attribute = (slug: string) => names.rows.find((row) => row.slug === slug)?.id ?? '';
  /** A named record of People (or of Deals), made by Ada. */
  const record = async (id: string, objectId = people) => {
    const values =
      objectId === people
        ? { [attribute('people.name')]: { firstName: 'Ada' } }
        : { [attribute('deals.name')]: 'Deal' };
    await createRecord(owner, { objectId, id, values });
  };
  return { ...created, owner, bea, beaId, people, companies, deals, record, attribute };
}

async function refusal(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

async function outboxOf(w: Awaited<ReturnType<typeof workspace>>) {
  const result = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ kind: string; item_ids: string[]; mutation_id: string | null }>(
      sql`select kind::text, item_ids::text[] as item_ids, mutation_id::text from outbox order by seq`,
    ),
  );
  return result.rows.filter((row) => row.kind === 'nav');
}

// Each case makes its own workspace; under a busy shared Postgres that takes a while.
describe('the sidebar', { timeout: 120_000 }, () => {
  it('reads the defaults with nothing stored, and the first change makes the row (AC-936)', async () => {
    const w = await workspace();
    const before = await readNav(w.bea);
    expect(before).toMatchObject({
      items: [],
      sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
      rail: false,
      version: 0,
      favourites: [],
      // Tasks (My tasks, spec 0019) for every member; Inbox waits for notifications (#28).
      top: ['tasks'],
      scheduling: ['bookings', 'availability', 'booking_pages', 'forms'],
    });
    const changed = await changeNav(w.bea, { op: 'fold', section: 'scheduling', folded: true });
    expect(changed.version).toBe(2);
    const after = await readNav(w.bea);
    expect(after.sections.folded).toEqual(['scheduling']);
    expect(after.version).toBe(2);
    // Ada's sidebar is her own.
    expect((await readNav(w.owner)).sections.folded).toEqual([]);
  });

  it('stores one nav event naming only the member, with the mutation id (AC-937)', async () => {
    const w = await workspace();
    const mutationId = newId();
    await changeNav(w.bea, { op: 'rail', on: true }, [outboxHook({ mutationId })]);
    expect(await outboxOf(w)).toEqual([{ kind: 'nav', item_ids: [w.beaId], mutation_id: mutationId }]);
  });

  it('keeps both of two changes made at the same moment (AC-938)', async () => {
    const w = await workspace();
    await Promise.all([
      changeNav(w.bea, { op: 'moveSection', section: 'scheduling', toIndex: 0 }),
      changeNav(w.bea, { op: 'hide', kind: 'object', id: w.deals }),
      changeNav(w.bea, { op: 'rail', on: true }),
    ]);
    const nav = await readNav(w.bea);
    expect(nav.sections.order[0]).toBe('scheduling');
    expect(nav.items).toContainEqual({ kind: 'object', id: w.deals, hidden: true });
    expect(nav.rail).toBe(true);
    expect(nav.version).toBe(4);
  });

  it('never answers an object the member can no longer read, and brings it back with access (AC-939)', async () => {
    const w = await workspace();
    await changeNav(w.bea, { op: 'move', kind: 'object', id: w.deals, toIndex: 0 });
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
      ],
      records: [],
    };
    const hidden = rescope(w.bea, { rules });
    const read = await readNav(hidden);
    expect(JSON.stringify(read)).not.toContain(w.deals);
    // A change made meanwhile keeps Deals' place in the row.
    await changeNav(hidden, { op: 'move', kind: 'object', id: w.companies, toIndex: 0 });
    const back = await readNav(w.bea);
    expect(back.items.map((item) => item.id)).toEqual(
      [w.companies, w.people, w.deals].filter((id) => back.items.some((item) => item.id === id)),
    );
    expect(back.items.map((item) => item.id)).toContain(w.deals);
  });

  it('stars a view and a record, resolving their names, and drops a record in the trash until it is restored', async () => {
    const w = await workspace();
    const { defaultViewId } = await listViews(w.bea, w.people);
    const recordId = newId();
    await w.record(recordId);
    await changeNav(w.bea, { op: 'star', kind: 'view', id: defaultViewId ?? '' });
    await changeNav(w.bea, { op: 'star', kind: 'record', id: recordId });
    const starred = await readNav(w.bea);
    expect(starred.favourites.map((favourite) => [favourite.kind, favourite.id, favourite.objectId])).toEqual([
      ['view', defaultViewId, w.people],
      ['record', recordId, w.people],
    ]);
    expect(starred.favourites[0]?.objectName).toBe('People');
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [recordId], batchId: newId() });
    const trashed = await readNav(w.bea);
    expect(trashed.favourites.map((favourite) => favourite.id)).toEqual([defaultViewId]);
    expect(JSON.stringify(trashed)).not.toContain(recordId);
    // A change while it is in the trash keeps it in the row: it still exists.
    await changeNav(w.bea, { op: 'rail', on: true });
    await restoreRecords(w.owner, { recordIds: [recordId] });
    expect((await readNav(w.bea)).favourites.map((favourite) => favourite.id)).toEqual([defaultViewId, recordId]);
  });

  it('refuses a star of a record the member can’t read, the same as a missing one (AC-934)', async () => {
    const w = await workspace();
    const recordId = newId();
    await w.record(recordId, w.deals);
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
      ],
      records: [],
    };
    const hidden = rescope(w.bea, { rules });
    const unreadable = await refusal(changeNav(hidden, { op: 'star', kind: 'record', id: recordId }));
    const missing = await refusal(changeNav(hidden, { op: 'star', kind: 'record', id: newId() }));
    expect(unreadable).toEqual({ code: 'NOT_FOUND', message: NAV_ITEM_NOT_FOUND });
    expect(missing).toEqual(unreadable);
  });

  it('refuses a star of a view the member can’t see, the same as a missing one (AC-934)', async () => {
    const w = await workspace();
    // Ada's private view, and Deals' views under a rule that hides Deals from members.
    const privateId = newId();
    await createView(w.owner, {
      id: privateId,
      objectId: w.people,
      name: 'Ada’s',
      kind: 'table',
      visibility: 'private',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    });
    const { defaultViewId: dealsView } = await listViews(w.bea, w.deals);
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.deals }, level: 'none' },
      ],
      records: [],
    };
    const hidden = rescope(w.bea, { rules });
    const missing = await refusal(changeNav(w.bea, { op: 'star', kind: 'view', id: newId() }));
    expect(missing).toEqual({ code: 'NOT_FOUND', message: NAV_ITEM_NOT_FOUND });
    expect(await refusal(changeNav(w.bea, { op: 'star', kind: 'view', id: privateId }))).toEqual(missing);
    expect(await refusal(changeNav(hidden, { op: 'star', kind: 'view', id: dealsView ?? '' }))).toEqual(missing);
    expect((await readNav(w.bea)).version).toBe(0);
  });

  it('drops a starred record a record rule hides, leaving no trace, and brings it back without it (AC-939)', async () => {
    const w = await workspace();
    const recordId = newId();
    await w.record(recordId);
    await changeNav(w.bea, { op: 'star', kind: 'record', id: recordId });
    // Owner is empty, so a rule on the member's own records leaves this one out.
    const ruled = rescope(w.bea, {
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: w.people,
            kind: 'own',
            attributeId: w.attribute('people.owner'),
          },
        ],
      },
    });
    const read = await readNav(ruled);
    expect(read.favourites).toEqual([]);
    expect(JSON.stringify(read)).not.toContain(recordId);
    expect((await readNav(w.bea)).favourites.map((favourite) => favourite.id)).toEqual([recordId]);
  });

  it('either refuses a change racing the member’s removal, or the removal takes the row it made (AC-941)', async () => {
    const w = await workspace();
    const [changed] = await Promise.allSettled([
      changeNav(w.bea, { op: 'rail', on: true }),
      removeMember(w.owner, { memberId: w.beaId }),
    ]);
    if (changed.status === 'rejected') expect(isRefusal(changed.reason)).toBe(true);
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`select 1 from member_nav_prefs where member_id = ${w.beaId}`),
    );
    expect(rows.rows).toEqual([]);
  });

  it('refuses the 51st favourite with NAV_LIMIT and changes nothing', async () => {
    const w = await workspace();
    const ids = Array.from({ length: MAX_NAV_FAVOURITES + 1 }, () => newId());
    // Bare record rows, as fast as one statement makes them: the limit counts stars, not what the records hold.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type)
            select ${w.workspaceId}, id, ${w.people}, 'system', 'system' from unnest(${`{${ids.join(',')}}`}::uuid[]) as id`,
      ),
    );
    // Fifty favourites already, stored as fifty stars would leave them.
    const items = JSON.stringify(ids.slice(0, MAX_NAV_FAVOURITES).map((id) => ({ kind: 'record', id, pinned: true })));
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into member_nav_prefs (workspace_id, member_id, items, created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
            values (${w.workspaceId}, ${w.beaId}, ${items}::jsonb, 'member', ${w.beaId}, ${w.beaId}, 'member', ${w.beaId}, ${w.beaId})`,
      ),
    );
    const before = await readNav(w.bea);
    expect(before.favourites).toHaveLength(MAX_NAV_FAVOURITES);
    expect(await refusal(changeNav(w.bea, { op: 'star', kind: 'record', id: ids[MAX_NAV_FAVOURITES] ?? '' }))).toEqual({
      code: 'NAV_LIMIT',
      message: NAV_FAVOURITES_LIMIT_MESSAGE,
    });
    expect((await readNav(w.bea)).version).toBe(before.version);
  });

  it('prunes a starred view deleted for good on the next write (AC-940)', async () => {
    const w = await workspace();
    const viewId = newId();
    await createView(w.bea, {
      id: viewId,
      objectId: w.people,
      name: 'Mine',
      kind: 'table',
      visibility: 'private',
      config: { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] },
    });
    await changeNav(w.bea, { op: 'star', kind: 'view', id: viewId });
    await deleteView(w.bea, { viewId });
    await changeNav(w.bea, { op: 'rail', on: true });
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ items: unknown }>(sql`select items from member_nav_prefs where member_id = ${w.beaId}`),
    );
    expect(stored.rows[0]?.items).toEqual([]);
  });

  it('deletes a removed member’s row with them (AC-941), and refuses their later change', async () => {
    const w = await workspace();
    await changeNav(w.bea, { op: 'rail', on: true });
    await removeMember(w.owner, { memberId: w.beaId });
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`select 1 from member_nav_prefs where member_id = ${w.beaId}`),
    );
    expect(rows.rows).toEqual([]);
    expect(await refusal(changeNav(w.bea, { op: 'rail', on: false }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('gives an API key, which has no sidebar, the defaults with no pages, and refuses its change', async () => {
    const w = await workspace();
    const key = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() } });
    expect(await readNav(key)).toMatchObject({ items: [], rail: false, version: 0, top: [], scheduling: [] });
    expect(await refusal(changeNav(key, { op: 'rail', on: true }))).toMatchObject({ code: 'FORBIDDEN' });
    const rows = await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`select 1 from member_nav_prefs`));
    expect(rows.rows).toEqual([]);
  });

  it('finds nothing of another workspace’s rows, even with the filter left out', async () => {
    const a = await workspace();
    const b = await workspace();
    await changeNav(a.bea, { op: 'rail', on: true });
    const seen = await db.withWorkspace(b.workspaceId, (tx) => tx.execute(sql`select * from member_nav_prefs`));
    expect(seen.rows).toEqual([]);
  });
});
