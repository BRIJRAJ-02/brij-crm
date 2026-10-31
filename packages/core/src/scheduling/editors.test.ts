// Page and rotation editors (spec 0037, lane L2), against a real Postgres as the app role: an admin names editors
// (audited, each person added emailed, at most 20), an editor lists the rotation with its counts and changes it but
// may not add or change people they don't Manage, delete it or change its editors (AC-1331, AC-1337, AC-1340); the
// Distribution tab and adjustments open to editors (AC-1329, AC-1330); a page's editor sees it in Captures › Links
// with the badge, changes it and its bookings, but can't delete it (AC-1332, AC-1262); a removed member's editor rows
// go with them; and an away owner's stand in takes a lead from a form (AC-1284).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { defaultAvailability, type PublicBookInput, type RotationMemberInput, type Role } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { listWorkspaceBookings } from '../booking/list.ts';
import {
  createBookingPage,
  deleteBookingPage,
  listBookingPages,
  listBookings,
  updateBookingPage,
} from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import { adjustCount, rotationDistribution, undoAdjustment } from '../rotation/distribution.ts';
import { pickLeadOwner } from '../rotation/owner.ts';
import { createRotation, deleteRotation, listRotations, updateRotation } from '../rotation/rotations.ts';
import { testScope } from '../testing.ts';
import { grantDelegation } from './delegations.ts';
import { listEditors, setEditors } from './editors.ts';
import { createTimeOff } from './time-off.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-editors-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const now = () => NOW;
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};
const deps = { calendar, now, linkKey: Buffer.alloc(32, 5) };

let made = 0;
/** A workspace: Olga the owner, and members with weekday hours 09:00 to 17:00 UTC. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Editors',
    slug: `editors-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    const range: [string, string] = ['09:00', '17:00'];
    await saveDefaultHours(as(id, role), {
      availability: {
        ...defaultAvailability('UTC'),
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
    return id;
  };
  const rows = async <T extends Record<string, unknown>>(query: string, params: readonly unknown[] = []) =>
    testQuery<T>(ownerUrl, query, [created.workspaceId, ...params]);
  return { ...created, as, owner, add, rows };
}

const pooled = (memberId: string, over: Partial<RotationMemberInput> = {}): RotationMemberInput => ({
  memberId,
  weight: 100,
  priority: 2,
  dailyCap: null,
  weeklyCap: null,
  isOn: true,
  ...over,
});

const settings = (name: string, returning: 'owner' | 'none' = 'owner') => ({
  name,
  strategy: 'fair' as const,
  windowDays: 30 as const,
  evenGap: 3,
  returning,
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const visitor = (start: string): PublicBookInput => ({
  idempotencyKey: newId(),
  start,
  duration: 30,
  name: 'Grace Hopper',
  email: `grace-${newId().slice(-6)}@navy.example`,
  timeZone: 'UTC',
});

describe('rotation editors (AC-1331, AC-1337, AC-1340, AC-1329, AC-1330)', () => {
  it('lets an editor change the rotation, guarded by Manage, but not delete it or change its editors', async () => {
    const w = await world();
    const lead = await w.add('Lena Lead');
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const ivy = await w.add('Ivy New');
    const rotation = await createRotation(
      w.owner,
      { id: newId(), settings: settings('Sales'), members: [pooled(sam), pooled(kim)] },
      NOW,
    );
    // Before: the lead isn't in it and doesn't edit it, so it is absent to them.
    expect((await listRotations(w.as(lead), NOW)).map((each) => each.id)).toEqual([]);
    expect(
      (await refusalOf(updateRotation(w.as(lead), { rotationId: rotation.id, settings: { name: 'X' } }))).code,
    ).toBe('NOT_FOUND');

    const set = await setEditors(w.owner, { resourceType: 'rotation', resourceId: rotation.id, memberIds: [lead] });
    expect(set).toEqual({ editors: [{ id: lead, name: 'Lena Lead' }], canChange: true });
    // Audited, and the lead is told by email.
    const audited = await w.rows<{ after: unknown }>(
      `select after from audit_events where workspace_id = $1 and action = 'editors.changed'`,
    );
    expect(audited.map((row) => row.after)).toEqual([{ name: 'Sales', added: [lead], removed: [] }]);
    const told = await w.rows<{ to_member_id: string; params: Record<string, unknown> }>(
      `select to_member_id::text, params from emails where workspace_id = $1 and kind = 'editor_added'`,
    );
    expect(told.map((row) => [row.to_member_id, row.params.resourceName, row.params.byName])).toEqual([
      [lead, 'Sales', 'Olga Owner'],
    ]);

    // Listed with the badge and everyone's counts, but no calendar facts (decision 21).
    const [listed] = await listRotations(w.as(lead), NOW);
    expect(listed).toMatchObject({ id: rotation.id, canChange: true, isEditor: true, canManage: false });
    expect(listed?.members.map((member) => [member.count, member.hasCalendar])).toEqual([
      [0, undefined],
      [0, undefined],
    ]);
    expect((await listEditors(w.as(lead), { resourceType: 'rotation', resourceId: rotation.id })).canChange).toBe(
      false,
    );

    // Its settings change.
    const renamed = await updateRotation(
      w.as(lead),
      { rotationId: rotation.id, settings: { name: 'Sales team', strategy: 'even' } },
      NOW,
    );
    expect(renamed).toMatchObject({ name: 'Sales team', strategy: 'even' });
    // Adding Ivy, or changing Sam's weight, needs Manage over them (AC-1340).
    expect(
      await refusalOf(
        updateRotation(
          w.as(lead),
          { rotationId: rotation.id, settings: {}, members: [pooled(sam), pooled(kim), pooled(ivy)] },
          NOW,
        ),
      ),
    ).toEqual({
      code: 'FORBIDDEN',
      message: 'You can only add people whose scheduling you manage.',
      field: 'members.2',
    });
    expect(
      (
        await refusalOf(
          updateRotation(
            w.as(lead),
            { rotationId: rotation.id, settings: {}, members: [pooled(sam, { weight: 50 }), pooled(kim)] },
            NOW,
          ),
        )
      ).code,
    ).toBe('FORBIDDEN');
    // With Manage over Ivy and Sam (their own delegations), both go through.
    for (const id of [ivy, sam]) {
      await grantDelegation(w.as(id), {
        delegateMemberId: lead,
        target: { type: 'member', memberId: id },
        level: 'manage',
      });
    }
    const grown = await updateRotation(
      w.as(lead),
      { rotationId: rotation.id, settings: {}, members: [pooled(sam, { weight: 50 }), pooled(kim), pooled(ivy)] },
      NOW,
    );
    expect(grown.members.map((member) => [member.memberId, member.weight])).toEqual([
      [sam, 50],
      [kim, 100],
      [ivy, 100],
    ]);
    // Anyone who may edit it may take someone out (Kim, whom the lead doesn't manage).
    const shrunk = await updateRotation(
      w.as(lead),
      { rotationId: rotation.id, settings: {}, members: [pooled(sam, { weight: 50 }), pooled(ivy)] },
      NOW,
    );
    expect(shrunk.members.map((member) => member.memberId)).toEqual([sam, ivy]);

    // Not its deletion, nor its editors.
    expect((await refusalOf(deleteRotation(w.as(lead), { rotationId: rotation.id }))).code).toBe('FORBIDDEN');
    expect(
      (await refusalOf(setEditors(w.as(lead), { resourceType: 'rotation', resourceId: rotation.id, memberIds: [] })))
        .code,
    ).toBe('FORBIDDEN');
    // A member in it who doesn't edit it is refused, not shown it as missing.
    expect(
      (await refusalOf(updateRotation(w.as(sam), { rotationId: rotation.id, settings: { name: 'Mine' } }))).code,
    ).toBe('FORBIDDEN');

    // Distribution and adjustments are the editor's too (AC-1329, AC-1330).
    const shown = await rotationDistribution(w.as(lead), { rotationId: rotation.id }, NOW);
    expect(shown.canAdjust).toBe(true);
    expect(shown.rows.map((row) => row.memberId)).toEqual([sam, ivy]);
    expect(shown.rows[0]?.fairShare).toBeDefined();
    const adjusted = await adjustCount(w.as(lead), {
      rotationId: rotation.id,
      memberId: ivy,
      units: 2,
      note: 'Covered',
    });
    expect(adjusted).toMatchObject({ units: 2, byName: 'Lena Lead' });
    const undone = await undoAdjustment(w.as(lead), { rotationId: rotation.id, adjustmentId: adjusted.id });
    expect(undone.voidedAt).toBeDefined();
    // Sam sees their own row, and Ivy's only once Ivy lets Sam see their scheduling.
    const own = await rotationDistribution(w.as(sam), { rotationId: rotation.id }, NOW);
    expect(own.rows.map((row) => row.memberId)).toEqual([sam]);
    await grantDelegation(w.as(ivy), {
      delegateMemberId: sam,
      target: { type: 'member', memberId: ivy },
      level: 'view',
    });
    const seen = await rotationDistribution(w.as(sam), { rotationId: rotation.id }, NOW);
    expect(seen.rows.map((row) => row.memberId)).toEqual([sam, ivy]);
    expect(seen.canAdjust).toBe(false);
    expect(seen.rows[0]?.fairShare).toBeUndefined();

    // Taken off: the lead no longer reaches it.
    await setEditors(w.owner, { resourceType: 'rotation', resourceId: rotation.id, memberIds: [] });
    expect((await listRotations(w.as(lead), NOW)).map((each) => each.id)).toEqual([]);
  });

  it('refuses a 21st editor (EDITOR_LIMIT) and someone not here, and drops the editors with the rotation', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const rotation = await createRotation(
      w.owner,
      { id: newId(), settings: settings('Sales'), members: [pooled(sam), pooled(kim)] },
      NOW,
    );
    const many = await Promise.all(Array.from({ length: 21 }, (_, index) => w.add(`Person ${String(index)}`)));
    expect(
      await refusalOf(setEditors(w.owner, { resourceType: 'rotation', resourceId: rotation.id, memberIds: many })),
    ).toEqual({ code: 'EDITOR_LIMIT', message: 'A page or rotation can have at most 20 editors.' });
    const twenty = await setEditors(w.owner, {
      resourceType: 'rotation',
      resourceId: rotation.id,
      memberIds: many.slice(0, 20),
    });
    expect(twenty.editors).toHaveLength(20);
    // Someone who isn't an active member here (removed, or never one) is refused on their place in the list.
    expect(
      await refusalOf(
        setEditors(w.owner, { resourceType: 'rotation', resourceId: rotation.id, memberIds: [sam, newId()] }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'memberIds.1' });
    // Deleting the rotation takes its editors with it.
    await deleteRotation(w.owner, { rotationId: rotation.id });
    expect(
      await w.rows(`select 1 from scheduling_editors where workspace_id = $1 and resource_id = $2`, [rotation.id]),
    ).toEqual([]);
  });
});

describe('page editors (AC-1331, AC-1332, AC-1262, AC-1340)', () => {
  it('lists a team page to its editor with the badge, lets them change it and its bookings, not delete it', async () => {
    const w = await world();
    const lead = await w.add('Lena Lead');
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const rotation = await createRotation(
      w.owner,
      { id: newId(), settings: settings('Sales', 'none'), members: [pooled(sam), pooled(kim)] },
      NOW,
    );
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Demo',
        timeZone: 'UTC',
        kind: 'round_robin',
        hosts: { fixed: [], rotations: [rotation.id] },
      },
      NOW,
    );
    const entry = await enterBookingPage({ db }, page.publicKey);
    const booked = await bookPublicSlot(entry, deps, visitor('2026-11-02T10:00:00.000Z'));
    // Not theirs yet: absent.
    expect((await listBookingPages(w.as(lead), NOW)).map((each) => each.id)).not.toContain(page.id);
    expect((await refusalOf(listBookings(w.as(lead), { pageId: page.id, when: 'upcoming' }, NOW))).code).toBe(
      'NOT_FOUND',
    );

    await setEditors(w.owner, { resourceType: 'booking_page', resourceId: page.id, memberIds: [lead] });
    const listed = (await listBookingPages(w.as(lead), NOW)).find((each) => each.id === page.id);
    expect(listed).toMatchObject({ canChange: true, isEditor: true, ownerName: 'Olga Owner' });
    expect(listed?.hosts).toEqual({ fixed: [], rotations: [rotation.id] });
    const changed = await updateBookingPage(w.as(lead), { pageId: page.id, settings: { title: 'Sales demo' } }, NOW);
    expect(changed).toMatchObject({ title: 'Sales demo', isEditor: true });
    // The page's bookings are theirs to manage, as its owner's are (AC-1262).
    const upcoming = await listBookings(w.as(lead), { pageId: page.id, when: 'upcoming' }, NOW);
    expect(upcoming.map((each) => each.id)).toEqual([booked.bookingId]);
    const all = await listWorkspaceBookings(w.as(lead), { when: 'upcoming', hosts: 'all' }, NOW);
    expect(all.map((each) => each.id)).toContain(booked.bookingId);
    // Adding a fixed host they don't manage is refused (AC-1340); a rotation they can't see answers as absent.
    expect(
      await refusalOf(
        updateBookingPage(
          w.as(lead),
          { pageId: page.id, settings: {}, hosts: { fixed: [sam], rotations: [rotation.id] } },
          NOW,
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', message: 'You can only add people whose scheduling you manage.' });
    const other = await createRotation(
      w.owner,
      { id: newId(), settings: settings('Support', 'none'), members: [pooled(sam), pooled(kim)] },
      NOW,
    );
    expect(
      (
        await refusalOf(
          updateBookingPage(
            w.as(lead),
            { pageId: page.id, settings: {}, hosts: { fixed: [], rotations: [other.id] } },
            NOW,
          ),
        )
      ).code,
    ).toBe('NOT_FOUND');
    // Not its deletion.
    expect(await refusalOf(deleteBookingPage(w.as(lead), { pageId: page.id }))).toMatchObject({ code: 'FORBIDDEN' });
    // The owner deletes it, and its editors go with it.
    await deleteBookingPage(w.owner, { pageId: page.id });
    expect(
      await w.rows(`select 1 from scheduling_editors where workspace_id = $1 and resource_id = $2`, [page.id]),
    ).toEqual([]);
  });

  it('drops a removed member’s editor rows', async () => {
    const w = await world();
    const lead = await w.add('Lena Lead');
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' }, NOW);
    await setEditors(w.owner, { resourceType: 'booking_page', resourceId: page.id, memberIds: [lead] });
    await removeMember(w.owner, { memberId: lead });
    expect(await w.rows(`select 1 from scheduling_editors where workspace_id = $1`)).toEqual([]);
    expect((await listEditors(w.owner, { resourceType: 'booking_page', resourceId: page.id })).editors).toEqual([]);
  });
});

describe('a lead’s away owner (AC-1284)', () => {
  it('gives the lead to the owner’s stand in, inside or outside the rotation', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const bo = await w.add('Bo Standin');
    const rotation = await createRotation(
      w.owner,
      { id: newId(), settings: settings('Leads'), members: [pooled(sam), pooled(kim)] },
      NOW,
    );
    const at = new Date('2026-11-02T12:00:00Z');
    const lead = (memberId: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        pickLeadOwner(tx, {
          workspaceId: w.workspaceId,
          rotationId: rotation.id,
          now: at,
          recordId: newId(),
          current: { memberId },
        }),
      );
    const away = (memberId: string, standinMemberId?: string) =>
      createTimeOff(
        w.as(memberId),
        { now },
        {
          id: newId(),
          fromDate: '2026-11-02',
          toDate: '2026-11-02',
          reason: 'vacation',
          ...(standinMemberId === undefined ? {} : { standinMemberId }),
        },
      );
    // Kim away, Sam standing in from inside the rotation: Sam takes it.
    await away(kim, sam);
    expect(await lead(kim)).toMatchObject({ kind: 'picked', memberId: sam, reason: 'standin' });
    // Sam away too, Bo standing in from outside it and free: Bo takes it.
    await away(sam, bo);
    expect(await lead(sam)).toMatchObject({ kind: 'picked', memberId: bo, reason: 'standin' });
    // Bo away as well: the record keeps its owner, and nobody is counted.
    await away(bo);
    expect(await lead(sam)).toEqual({ kind: 'kept', rotationId: rotation.id });
  });
});
