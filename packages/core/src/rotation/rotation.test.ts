// Round robin end to end in core (spec 0029, milestone 1), against the real
// Postgres: rotations and who may touch them, a round robin page's slots as
// the union of its members' own, a booking going to the fairest free member
// with its ledger row, its host's event and records, the recheck under the
// locks, the race, and collective pages counting every member's bookings.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  defaultAvailability,
  type PublicBookInput,
  type RotationMemberInput,
  type RotationSettings,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage, systemScope } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import type { BookingCalendar, BookingEvent, BusyAnswer } from '../booking/calendar.ts';
import { bookAsHost } from '../booking/host.ts';
import { cancelBooking, hostTarget, moveBooking, readMoveSlots } from '../booking/change.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, getPublicBookingPage, readPublicSlots } from '../booking/public.ts';
import { prepareBookingMail } from '../booking/mail.ts';
import { loadPage } from '../booking/slots.ts';
import { chooseHosts } from './assign.ts';
import { bookingAssignments } from './assignments.ts';
import { reassignBooking } from './reassign.ts';
import { createRotation, deleteRotation, listRotations, updateRotation } from './rotations.ts';
import { loadTeam } from './team.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 7);
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-rotation-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the clock every booking here reads. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY = '2026-11-02';
const at = (time: string) => `${MONDAY}T${time}:00.000Z`;

let made = 0;
/** A workspace whose owner (an admin of everything) is Ada, and a way to add members with their own hours. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `rotation-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  /** A member with weekdays `from` to `to` UTC as their own hours (none set when `hours` is false). */
  const addMember = async (
    name: string,
    options: { from?: string; to?: string; hours?: boolean; role?: 'admin' | 'member' } = {},
  ) => {
    const id = newId();
    const role = options.role ?? 'member';
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase().replace(/ /g, '.')}-${id.slice(-6)}@acme.example`}, ${role}, 'system', 'system')`,
      ),
    );
    const scope = rescope(owner, { actor: { type: 'member', id }, role });
    if (options.hours !== false) {
      const range: [string, string] = [options.from ?? '09:00', options.to ?? '17:00'];
      const hours = defaultAvailability('UTC');
      await saveDefaultHours(scope, {
        availability: {
          ...hours,
          weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
        },
      });
    }
    return { id, scope };
  };
  return { ...created, owner, addMember };
}

type World = Awaited<ReturnType<typeof workspace>>;

const pooled = (memberId: string, over: Partial<RotationMemberInput> = {}): RotationMemberInput => ({
  memberId,
  weight: 100,
  priority: 2,
  dailyCap: null,
  weeklyCap: null,
  isOn: true,
  ...over,
});

/** A rotation of these members and a live round robin page on it: 30 minutes, video, each member's own hours. */
async function roundRobin(w: World, memberIds: readonly string[], over: Partial<RotationMemberInput>[] = []) {
  const rotation = await createRotation(
    w.owner,
    {
      id: newId(),
      settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
      members: memberIds.map((id, index) => pooled(id, over[index])),
    },
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
  return { rotation, page, entry };
}

/** A rotation of these members with these settings. */
async function rotationOf(
  w: World,
  name: string,
  memberIds: readonly string[],
  settings: Partial<RotationSettings> = {},
  over: Partial<RotationMemberInput>[] = [],
) {
  return createRotation(
    w.owner,
    {
      id: newId(),
      settings: { name, strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner', ...settings },
      members: memberIds.map((id, index) => pooled(id, over[index])),
    },
    NOW,
  );
}

/** A live round robin page with these fixed hosts and rotations. */
async function teamPage(w: World, fixed: readonly string[], rotations: readonly string[]) {
  const page = await createBookingPage(
    w.owner,
    {
      id: newId(),
      title: 'Demo',
      timeZone: 'UTC',
      kind: 'round_robin',
      hosts: { fixed: [...fixed], rotations: [...rotations] },
    },
    NOW,
  );
  return { page, entry: await enterBookingPage({ db }, page.publicKey) };
}

/** A calendar each member's busy answer is set on, recording the events it writes. */
function fakeCalendar(busy: Readonly<Record<string, BusyAnswer>> = {}) {
  const events: BookingEvent[] = [];
  const calendar: BookingCalendar = {
    busy: ({ memberId }) => Promise.resolve(busy[memberId] ?? { status: 'none' }),
    events: (event) => {
      events.push(event);
      return Promise.resolve({ meetingId: newId() });
    },
  };
  return { calendar, events };
}

const deps = (calendar: BookingCalendar = fakeCalendar().calendar) => ({ calendar, now: () => NOW, linkKey: LINK_KEY });

let visitors = 0;
const bookInput = (start: string, over: Partial<PublicBookInput> = {}): PublicBookInput => {
  visitors += 1;
  return {
    idempotencyKey: newId(),
    start,
    duration: 30,
    name: `Visitor ${String(visitors)}`,
    email: `visitor-${String(visitors)}@client${String(visitors)}.example`,
    timeZone: 'UTC',
    ...over,
  };
};

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const mondaySlots = (entry: Awaited<ReturnType<typeof enterBookingPage>>, calendar?: BookingCalendar) =>
  readPublicSlots(entry, deps(calendar), {
    from: `${MONDAY}T00:00:00.000Z`,
    to: '2026-11-03T00:00:00.000Z',
    duration: 30,
    tz: 'UTC',
  });

/** The host each booking went to, by id. */
async function hostsOf(w: World, bookingIds: readonly string[]) {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ id: string; host: string }>(
      sql`select id::text, host_member_id::text as host from bookings where id = any(${`{${bookingIds.join(',')}}`}::uuid[])`,
    ),
  );
  return new Map(rows.rows.map((row) => [row.id, row.host]));
}

describe('rotations (AC-728, AC-729, AC-751, AC-752, AC-758)', () => {
  it('makes a rotation with its members, and refuses anyone without booking.admin', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const rotation = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
        members: [pooled(sam.id), pooled(kim.id, { weight: 50, priority: 4, dailyCap: 3 })],
      },
      NOW,
    );
    expect(rotation).toMatchObject({
      name: 'Sales',
      strategy: 'fair',
      windowDays: 30,
      pages: 0,
      canChange: true,
      members: [
        { memberId: sam.id, name: 'Sam Lee', weight: 100, priority: 2, isOn: true, hasCalendar: false, count: 0 },
        { memberId: kim.id, name: 'Kim Park', weight: 50, priority: 4, dailyCap: 3, count: 0 },
      ],
    });
    const refused = await refusalOf(
      createRotation(sam.scope, {
        id: newId(),
        settings: { name: 'Mine', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' },
        members: [pooled(sam.id), pooled(kim.id)],
      }),
    );
    expect(refused).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await refusalOf(updateRotation(sam.scope, { rotationId: rotation.id, settings: { name: 'X' } })),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(deleteRotation(sam.scope, { rotationId: rotation.id }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses a member with neither hours nor a calendar, and anyone not an active member (AC-729)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const bare = await w.addMember('No Hours', { hours: false });
    const settings = { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' } as const;
    expect(
      await refusalOf(createRotation(w.owner, { id: newId(), settings, members: [pooled(sam.id), pooled(bare.id)] })),
    ).toEqual({
      code: 'CONFIG_INVALID',
      message: 'No Hours needs to set hours or connect a calendar first.',
      field: 'members.1',
    });
    expect(
      await refusalOf(createRotation(w.owner, { id: newId(), settings, members: [pooled(sam.id), pooled(newId())] })),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'members.1' });
  });

  it('shows a pool member their rotations with only their own count, and no one else theirs (AC-752)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const outsider = await w.addMember('Out Sider');
    const { entry } = await roundRobin(w, [sam.id, kim.id]);
    await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    const mine = await listRotations(sam.scope, NOW);
    expect(mine).toHaveLength(1);
    const counts = mine[0]?.members.map((member) => [member.memberId === sam.id, member.count]);
    expect(counts).toContainEqual([true, expect.any(Number)]);
    expect(counts?.filter(([own, count]) => !own && count !== undefined)).toEqual([]);
    expect(mine[0]?.canChange).toBe(false);
    expect(await listRotations(outsider.scope, NOW)).toEqual([]);
    const all = await listRotations(w.owner, NOW);
    expect(all[0]?.members.map((member) => member.count).sort()).toEqual([0, 1]);
    expect(all[0]?.pages).toBe(1);
  });

  it('refuses to delete a rotation a page books from, and deletes an unused one (AC-758)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { rotation } = await roundRobin(w, [sam.id, kim.id]);
    expect(await refusalOf(deleteRotation(w.owner, { rotationId: rotation.id }))).toEqual({
      code: 'IN_USE',
      message: 'Used by 1 page. Move them to another rotation first.',
    });
    const spare = await createRotation(w.owner, {
      id: newId(),
      settings: { name: 'Spare', strategy: 'fair', windowDays: 7, evenGap: 3, returning: 'none' },
      members: [pooled(sam.id), pooled(kim.id)],
    });
    expect(await deleteRotation(w.owner, { rotationId: spare.id })).toEqual({ rotationId: spare.id });
    expect((await listRotations(w.owner)).map((each) => each.id)).toEqual([rotation.id]);
  });

  it('starts a member who joins at the pool’s average count, so they aren’t flooded (AC-730)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const lee = await w.addMember('Lee Joiner');
    const { rotation, entry } = await roundRobin(w, [sam.id, kim.id]);
    for (const time of ['09:00', '09:00', '10:00', '10:00']) await bookPublicSlot(entry, deps(), bookInput(at(time)));
    const changed = await updateRotation(
      w.owner,
      { rotationId: rotation.id, settings: {}, members: [pooled(sam.id), pooled(kim.id), pooled(lee.id)] },
      NOW,
    );
    expect(changed.members.map((member) => member.count)).toEqual([2, 2, 2]);
  });
});

describe('a round robin page (AC-732 to AC-734, AC-738, AC-742 to AC-745, AC-754)', () => {
  it('needs booking.admin to make, and names no member before booking', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { page, entry, rotation } = await roundRobin(w, [sam.id, kim.id]);
    expect(page).toMatchObject({
      kind: 'round_robin',
      hosts: { fixed: [], rotations: [rotation.id] },
    });
    expect(
      await refusalOf(
        createBookingPage(sam.scope, {
          id: newId(),
          title: 'Mine',
          timeZone: 'UTC',
          kind: 'round_robin',
          hosts: { fixed: [], rotations: [rotation.id] },
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // Even its owner can't change it without booking.admin (AC-751).
    expect(await refusalOf(updateBookingPage(sam.scope, { pageId: page.id, settings: { title: 'X' } }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const facts = await getPublicBookingPage(entry);
    expect(facts).toMatchObject({
      hostName: 'Acme',
      team: { avatars: [{ initials: 'SL' }, { initials: 'KP' }], more: 0 },
    });
    expect(JSON.stringify(facts)).not.toMatch(/Sam|Kim|acme\.example/);
  });

  it('offers every time someone is free, by each member’s own hours (AC-734)', async () => {
    const w = await workspace();
    const early = await w.addMember('Early Bird', { from: '08:00', to: '10:00' });
    const late = await w.addMember('Late Owl', { from: '15:00', to: '17:00' });
    const { entry } = await roundRobin(w, [early.id, late.id]);
    const slots = await mondaySlots(entry);
    expect(slots.calendar).toBe('ok');
    expect(slots.slots.map((slot) => slot.start.slice(11, 16))).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
    ]);
    expect(JSON.stringify(slots)).not.toContain(early.id);
  });

  it('books the least booked free member, with the ledger row, the event, the emails and the new person (AC-738, AC-742 to AC-745)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { entry, rotation } = await roundRobin(w, [sam.id, kim.id]);
    const { calendar, events } = fakeCalendar();
    const first = await bookPublicSlot(entry, deps(calendar), bookInput(at('09:00')));
    const second = await bookPublicSlot(entry, deps(calendar), bookInput(at('11:00')));
    const hosts = await hostsOf(w, [first.bookingId, second.bookingId]);
    // Both at 0: the tie goes to the lower id; then the other one has fewer.
    expect(new Set(hosts.values())).toEqual(new Set([sam.id, kim.id]));
    const firstHost = hosts.get(first.bookingId);
    expect(first.booking.hostName).toBe(firstHost === sam.id ? 'Sam Lee' : 'Kim Park');
    expect(events.map((event) => event.hostMemberId)).toEqual([firstHost, hosts.get(second.bookingId)]);
    const ledger = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ booking: string; member: string; reason: string; units: number; rotation: string }>(sql`
        select booking_id::text as booking, member_id::text as member, reason, units, rotation_id::text as rotation
        from rotation_assignments order by assigned_at`),
    );
    expect(ledger.rows).toEqual([
      { booking: first.bookingId, member: firstHost, reason: 'fair', units: 1, rotation: rotation.id },
      {
        booking: second.bookingId,
        member: hosts.get(second.bookingId),
        reason: 'fair',
        units: 1,
        rotation: rotation.id,
      },
    ]);
    // It occupies its host on every page (AC-745).
    const occupied = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ member: string; status: string }>(
        sql`select member_id::text as member, status from booking_hosts where booking_id = ${first.bookingId}::uuid`,
      ),
    );
    expect(occupied.rows).toEqual([{ member: firstHost, status: 'confirmed' }]);
    // The new person is the host's (AC-744).
    const owner = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ owner: unknown }>(sql`
        select v.actor_member_id::text as owner from bookings b
        join "values" v on v.record_id = b.person_record_id and v.active_until is null
        join attributes a on a.id = v.attribute_id and a.api_slug = 'owner'
        where b.id = ${first.bookingId}::uuid`),
    );
    expect(JSON.stringify(owner.rows)).toContain(firstHost ?? 'none');
    // Its detail says why, to its host and an admin; anyone else finds nothing (AC-742, AC-753).
    const hostScope = firstHost === sam.id ? sam.scope : kim.scope;
    const otherScope = firstHost === sam.id ? kim.scope : sam.scope;
    expect(await bookingAssignments(hostScope, { bookingId: first.bookingId })).toMatchObject([
      { memberId: firstHost, reason: 'fair', count: 0, weight: 100, windowDays: 30, rotationName: 'Sales' },
    ]);
    expect(await bookingAssignments(w.owner, { bookingId: first.bookingId })).toHaveLength(1);
    expect(await refusalOf(bookingAssignments(otherScope, { bookingId: first.bookingId }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('gives the slot to the only free member, and says so (only_free)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee', { from: '09:00', to: '10:00' });
    const kim = await w.addMember('Kim Park', { from: '13:00', to: '17:00' });
    const { entry } = await roundRobin(w, [sam.id, kim.id]);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    expect((await hostsOf(w, [booked.bookingId])).get(booked.bookingId)).toBe(sam.id);
    const reasons = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(reasons[0]?.reason).toBe('only_free');
  });

  it('counts a member’s personal bookings against their round robin times (AC-734, AC-745)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee', { from: '09:00', to: '10:00' });
    const kim = await w.addMember('Kim Park', { from: '09:00', to: '10:00' });
    const { entry } = await roundRobin(w, [sam.id, kim.id]);
    const personal = await createBookingPage(sam.scope, { id: newId(), title: 'Sam’s own', timeZone: 'UTC' }, NOW);
    await bookAsHost(
      sam.scope,
      { calendar: fakeCalendar().calendar, linkKey: LINK_KEY, now: () => NOW },
      {
        idempotencyKey: newId(),
        pageId: personal.id,
        start: new Date(at('09:00')),
        minutes: 60,
        name: 'Busy Maker',
        email: 'busy@maker.example',
        timeZone: 'UTC',
        guests: [],
      },
    );
    // Kim is still free at 09:00, so it is offered, and goes to Kim.
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    expect((await hostsOf(w, [booked.bookingId])).get(booked.bookingId)).toBe(kim.id);
    // Nobody is left at 09:00 now; Kim is free again at 09:30, Sam isn't until 10:00.
    expect((await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16))).toEqual(['09:30']);
    expect(await refusalOf(bookPublicSlot(entry, deps(), bookInput(at('09:00'))))).toMatchObject({
      code: 'SLOT_TAKEN',
    });
  });

  it('rechecks under the locks: a candidate taken since the read is passed over (AC-740)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { page } = await roundRobin(w, [sam.id, kim.id]);
    // Sam was free when the slots were read, then took a personal booking at 09:00.
    const personal = await createBookingPage(sam.scope, { id: newId(), title: 'Sam’s own', timeZone: 'UTC' }, NOW);
    await bookAsHost(
      sam.scope,
      { calendar: fakeCalendar().calendar, linkKey: LINK_KEY, now: () => NOW },
      {
        idempotencyKey: newId(),
        pageId: personal.id,
        start: new Date(at('09:00')),
        minutes: 30,
        name: 'Busy Maker',
        email: 'busy@maker.example',
        timeZone: 'UTC',
        guests: [],
      },
    );
    const choose = (candidates: readonly string[]) =>
      db.withWorkspace(w.workspaceId, async (tx) => {
        const loaded = await loadPage(tx, page.id);
        const team = loaded === undefined ? undefined : await loadTeam(tx, loaded);
        if (loaded === undefined || team?.kind !== 'round_robin') throw new Error('no page');
        return chooseHosts(tx, loaded, team, {
          workspaceId: w.workspaceId,
          start: new Date(at('09:00')),
          duration: 30,
          candidates: [candidates],
          busy: new Map(),
          from: new Date('2026-11-01T09:00:00Z'),
          to: new Date('2026-11-03T09:00:00Z'),
          now: NOW,
        });
      });
    expect((await choose([sam.id, kim.id])).organiser).toBe(kim.id);
    expect(await refusalOf(choose([sam.id]))).toEqual({
      code: 'SLOT_TAKEN',
      message: 'That time was just taken. Pick another.',
    });
  });

  it('leaves out a member whose calendar refuses us, and closes only when everyone’s does (AC-736)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { entry } = await roundRobin(w, [sam.id, kim.id]);
    const one = fakeCalendar({ [sam.id]: { status: 'blocked' } });
    expect((await mondaySlots(entry, one.calendar)).calendar).toBe('ok');
    const booked = await bookPublicSlot(entry, deps(one.calendar), bookInput(at('09:00')));
    expect((await hostsOf(w, [booked.bookingId])).get(booked.bookingId)).toBe(kim.id);
    const both = fakeCalendar({ [sam.id]: { status: 'blocked' }, [kim.id]: { status: 'blocked' } });
    expect(await mondaySlots(entry, both.calendar)).toEqual({ slots: [], calendar: 'unreachable' });
    expect(await refusalOf(bookPublicSlot(entry, deps(both.calendar), bookInput(at('10:00'))))).toMatchObject({
      code: 'BOOKING_CLOSED',
    });
  });

  it('serialises a crowd (AC-741): one slot gives each free member one booking, and many slots spread evenly', async () => {
    const w = await workspace();
    const members = await Promise.all(['Sam Lee', 'Kim Park', 'Ray Chen'].map((name) => w.addMember(name)));
    const ids = members.map((member) => member.id);
    const { entry } = await roundRobin(w, ids);
    // Five visitors at one slot: three bookings, one per member, two refused.
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => bookPublicSlot(entry, deps(), bookInput(at('09:00')))),
    );
    const booked = settled.flatMap((each) => (each.status === 'fulfilled' ? [each.value.bookingId] : []));
    expect(booked).toHaveLength(3);
    for (const each of settled) {
      if (each.status === 'rejected') expect(isRefusal(each.reason) && each.reason.refusal.code).toBe('SLOT_TAKEN');
    }
    expect(new Set((await hostsOf(w, booked)).values())).toEqual(new Set(ids));
    // Twelve more at twelve different times, all at once: the counts stay within one of each other.
    const times = [
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
    ];
    const spread = await Promise.all(times.map((time) => bookPublicSlot(entry, deps(), bookInput(at(time)))));
    const counts = new Map<string, number>();
    for (const host of (await hostsOf(w, [...booked, ...spread.map((each) => each.bookingId)])).values()) {
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(15);
    // Nobody is double booked anywhere.
    const overlaps = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        select 1 from booking_hosts a join booking_hosts b on a.member_id = b.member_id and a.booking_id < b.booking_id
        where a.status = 'confirmed' and b.status = 'confirmed' and a.during && b.during`),
    );
    expect(overlaps.rows).toEqual([]);
  });

  it('moves keeping the host when free, else through the rotation, and tells everyone (AC-746, AC-1324)', async () => {
    const w = await workspace();
    const early = await w.addMember('Early Bird', { from: '08:00', to: '10:00' });
    const late = await w.addMember('Late Owl', { from: '15:00', to: '17:00' });
    const { entry } = await roundRobin(w, [early.id, late.id]);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('08:00')));
    const target = hostTarget(w.owner, booked.bookingId);
    const offered = await readMoveSlots(target, deps(), {
      from: new Date(`${MONDAY}T00:00:00.000Z`),
      to: new Date('2026-11-03T00:00:00.000Z'),
    });
    // Every time someone can take it: the booking's own 08:00 is free for it, and Late Owl's afternoon too.
    expect(offered.slots.map((slot) => slot.start.slice(11, 16))).toContain('15:00');
    expect(offered.slots.map((slot) => slot.start.slice(11, 16))).toContain('09:30');
    // Same host when free: 09:00 keeps Early Bird and the ledger row.
    const [before] = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(await moveBooking(target, deps(), { start: new Date(at('09:00')) })).toEqual({ moved: true });
    expect((await hostsOf(w, [booked.bookingId])).get(booked.bookingId)).toBe(early.id);
    const kept = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(kept.map((row) => row.id)).toEqual([before?.id]);
    // 15:00: Early Bird isn't free, so the rotation picks Late Owl; the old row stops counting.
    expect(await moveBooking(target, deps(), { start: new Date(at('15:00')) })).toEqual({ moved: true });
    expect((await hostsOf(w, [booked.bookingId])).get(booked.bookingId)).toBe(late.id);
    const after = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(after.map((row) => [row.memberId, row.voidedAt === undefined])).toEqual([
      [late.id, true],
      [early.id, false],
    ]);
    const hosts = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ member: string }>(
        sql`select member_id::text as member from booking_hosts where booking_id = ${booked.bookingId}::uuid`,
      ),
    );
    expect(hosts.rows).toEqual([{ member: late.id }]);
    const mail = await prepareBookingMail(
      systemScope(db, w.workspaceId),
      { appOrigin: 'https://app.example', linkKey: LINK_KEY, organizerEmail: 'bookings@app.example', now: () => NOW },
      { bookingId: booked.bookingId, kind: 'reassigned' },
    );
    expect(mail.messages[0]?.subject).toBe('Your meeting is now with Late Owl');
    expect(mail.messages[1]?.subject).toMatch(/^New booking: Demo with /u);
    expect(mail.messages[2]?.subject).toMatch(/^Reassigned: Demo with /u);
    expect(mail.messages[1]?.to).toContain('late.owl');
    expect(mail.messages[2]?.to).toContain('early.bird');
  });

  it('picks again through the rotation when the page says so, even when the host is free (AC-746)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { page, entry } = await roundRobin(w, [sam.id, kim.id]);
    await updateBookingPage(w.owner, { pageId: page.id, settings: { rescheduleHost: 'rotation' } }, NOW);
    const first = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    const firstHost = (await hostsOf(w, [first.bookingId])).get(first.bookingId);
    // A second booking for the other member at another time, so the counts are even before the move.
    await bookPublicSlot(entry, deps(), bookInput(at('13:00')));
    await moveBooking(hostTarget(w.owner, first.bookingId), deps(), { start: new Date(at('11:00')) });
    const rows = await bookingAssignments(w.owner, { bookingId: first.bookingId });
    // Picked again: one live row, whoever the fair pick is now, and the first one kept or voided accordingly.
    const live = rows.filter((row) => row.voidedAt === undefined);
    expect(live).toHaveLength(1);
    expect([sam.id, kim.id]).toContain(firstHost);
  });

  it('shows a host only their own assignment rows, never another member’s counts (AC-752)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const fixedSales = await rotationOf(w, 'Sales', [sam.id, kim.id]);
    const other = await w.addMember('Mo Ali');
    const otherPool = await rotationOf(w, 'Support', [other.id, kim.id]);
    const { entry } = await teamPage(w, [], [fixedSales.id, otherPool.id]);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    const all = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(all).toHaveLength(2);
    const host = (await hostsOf(w, [booked.bookingId])).get(booked.bookingId);
    const hostScope = [sam, kim, other].find((member) => member.id === host)?.scope;
    if (hostScope === undefined) throw new Error('No host.');
    const own = await bookingAssignments(hostScope, { bookingId: booked.bookingId });
    expect(own.map((row) => row.memberId)).toEqual([host]);
  });

  it('reassigns a seat to a named member or the next in rotation, by someone who manages both (AC-748, AC-1337)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const mo = await w.addMember('Mo Ali', { from: '13:00', to: '17:00' });
    const { rotation, entry } = await roundRobin(w, [sam.id, kim.id, mo.id]);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    const first = (await hostsOf(w, [booked.bookingId])).get(booked.bookingId);
    const other = first === sam.id ? kim.id : sam.id;
    // A member can't hand their meeting to a colleague they don't manage.
    const host = [sam, kim].find((member) => member.id === first);
    if (host === undefined) throw new Error('No host.');
    const denied = await refusalOf(
      reassignBooking(host.scope, deps(), { bookingId: booked.bookingId, memberId: other }),
    );
    expect(denied.code).toBe('FORBIDDEN');
    // Mo isn't free at 09:00.
    const busy = await refusalOf(reassignBooking(w.owner, deps(), { bookingId: booked.bookingId, memberId: mo.id }));
    expect(busy.code).toBe('SLOT_TAKEN');
    // Named: to the other free member, recorded as manual with who did it.
    const named = await reassignBooking(w.owner, deps(), { bookingId: booked.bookingId, memberId: other });
    expect(named).toEqual({ hostMemberId: other, changed: true });
    const rows = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(rows[0]).toMatchObject({ memberId: other, reason: 'manual', rotationId: rotation.id });
    expect(rows[1]?.voidedAt).toBeDefined();
    // Next in rotation: back to the only other free member.
    const next = await reassignBooking(w.owner, deps(), { bookingId: booked.bookingId });
    expect(next).toEqual({ hostMemberId: first, changed: true });
    expect((await bookingAssignments(w.owner, { bookingId: booked.bookingId }))[0]?.reason).toBe('reassigned');
  });

  it('voids the ledger row of a cancelled booking, so it stops counting (AC-747)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { entry } = await roundRobin(w, [sam.id, kim.id]);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    await cancelBooking(
      hostTarget(w.owner, booked.bookingId),
      { calendar: fakeCalendar().calendar, now: () => NOW },
      {},
    );
    const [row] = await bookingAssignments(w.owner, { bookingId: booked.bookingId });
    expect(row?.voidedAt).toBeDefined();
    const hosts = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ status: string }>(
        sql`select status from booking_hosts where booking_id = ${booked.bookingId}::uuid`,
      ),
    );
    expect(hosts.rows).toEqual([{ status: 'cancelled' }]);
    expect((await listRotations(w.owner, NOW))[0]?.members.map((member) => member.count)).toEqual([0, 0]);
  });
});

/** Makes the page collective with these required members (no builder for it yet: spec 0025's milestone 3). */
async function collective(w: World, scope: EngineScope, memberIds: readonly string[]) {
  const page = await createBookingPage(scope, { id: newId(), title: 'Panel', timeZone: 'UTC' }, NOW);
  await db.withWorkspace(w.workspaceId, async (tx) => {
    await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${page.id}::uuid`);
    await tx.execute(sql`delete from booking_page_members where page_id = ${page.id}::uuid`);
    for (const [position, memberId] of memberIds.entries()) {
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${w.workspaceId}, ${page.id}, ${memberId}, ${position})`,
      );
    }
  });
  return { page, entry: await enterBookingPage({ db }, page.publicKey) };
}

describe('a collective page counts every member’s bookings (AC-735, AC-745)', () => {
  it('offers no time a second member is booked elsewhere, books everyone, and blocks them all', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const { entry } = await collective(w, w.owner, [w.memberId, kim.id]);
    // Kim's own page has a booking at 09:00: before this fix the panel offered it and double booked Kim.
    const kims = await createBookingPage(kim.scope, { id: newId(), title: 'Kim’s own', timeZone: 'UTC' }, NOW);
    const kimEntry = await enterBookingPage({ db }, kims.publicKey);
    await bookPublicSlot(kimEntry, deps(), bookInput(at('09:00')));
    const offered = (await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16));
    expect(offered).not.toContain('09:00');
    expect(offered).toContain('09:30');
    expect(await refusalOf(bookPublicSlot(entry, deps(), bookInput(at('09:00'))))).toMatchObject({
      code: 'SLOT_TAKEN',
    });
    // A panel booking at 10:00 holds both members.
    const { calendar, events } = fakeCalendar();
    const panel = await bookPublicSlot(entry, deps(calendar), bookInput(at('10:00')));
    const held = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ member: string }>(
        sql`select member_id::text as member from booking_hosts where booking_id = ${panel.bookingId}::uuid order by member_id`,
      ),
    );
    expect(held.rows.map((row) => row.member).sort()).toEqual([w.memberId, kim.id].sort());
    expect(events[0]?.attendees.map((attendee) => attendee.name)).toContain('Kim Park');
    // So Kim's own page no longer offers 10:00, and Sam (not on the panel) is untouched.
    const kimsTimes = (await mondaySlots(kimEntry)).slots.map((slot) => slot.start.slice(11, 16));
    expect(kimsTimes).not.toContain('10:00');
    expect(sam.id).toBeDefined();
  });
});

describe('fixed hosts and several rotations (spec 0037, AC-1319 to AC-1322)', () => {
  it('books the fixed host plus one from each rotation, never one person twice, with a ledger row each', async () => {
    const w = await workspace();
    const [alice, ae, both, se] = await Promise.all(
      ['Alice Fixed', 'Ann Exec', 'Bo Both', 'Sol Eng'].map((name) => w.addMember(name)),
    );
    if (alice === undefined || ae === undefined || both === undefined || se === undefined) throw new Error('members');
    const sales = await rotationOf(w, 'Sales', [both.id, ae.id]);
    const solutions = await rotationOf(w, 'Solutions', [both.id, se.id], {}, [{}, { weight: 10 }]);
    const { entry } = await teamPage(w, [alice.id], [sales.id, solutions.id]);
    const { calendar, events } = fakeCalendar();
    const booked = await bookPublicSlot(entry, deps(calendar), bookInput(at('09:00')));
    const held = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ member: string }>(
        sql`select member_id::text as member from booking_hosts where booking_id = ${booked.bookingId}::uuid`,
      ),
    );
    const hosts = held.rows.map((row) => row.member);
    expect(hosts).toHaveLength(3);
    expect(new Set(hosts).size).toBe(3);
    expect(hosts).toContain(alice.id);
    // Sales went first: Bo (lower id or not, both at 0) or Ann; Solutions then took whoever is left of Bo and Sol.
    const ledger = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ rotation: string; member: string }>(sql`
        select rotation_id::text as rotation, member_id::text as member from rotation_assignments
        where booking_id = ${booked.bookingId}::uuid`),
    );
    expect(ledger.rows.map((row) => row.rotation).sort()).toEqual([sales.id, solutions.id].sort());
    // The event is on the fixed host's calendar, with the other hosts invited (AC-1322).
    expect(events[0]?.hostMemberId).toBe(alice.id);
    expect(events[0]?.attendees).toHaveLength(3);
    expect(booked.booking.hostName).toMatch(/^Alice Fixed, .+ and .+$/);
  });

  it('offers no time when a fixed host is booked elsewhere (AC-1320)', async () => {
    const w = await workspace();
    const alice = await w.addMember('Alice Fixed', { from: '09:00', to: '10:00' });
    const ae = await w.addMember('Ann Exec');
    const bo = await w.addMember('Bo Both');
    const sales = await rotationOf(w, 'Sales', [ae.id, bo.id]);
    const { entry } = await teamPage(w, [alice.id], [sales.id]);
    expect((await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16))).toEqual(['09:00', '09:30']);
    const own = await createBookingPage(alice.scope, { id: newId(), title: 'Own', timeZone: 'UTC' }, NOW);
    await bookPublicSlot(await enterBookingPage({ db }, own.publicKey), deps(), bookInput(at('09:00')));
    expect((await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16))).toEqual(['09:30']);
  });

  it('refuses hosts that don’t fit (HOSTS_INVALID)', async () => {
    const w = await workspace();
    const people = await Promise.all(Array.from({ length: 8 }, (_, index) => w.addMember(`Person ${String(index)}`)));
    const ids = people.map((person) => person.id);
    const sales = await rotationOf(w, 'Sales', ids.slice(0, 2));
    const refused = await refusalOf(
      createBookingPage(w.owner, {
        id: newId(),
        title: 'Too many',
        timeZone: 'UTC',
        kind: 'round_robin',
        hosts: { fixed: ids.slice(0, 7), rotations: [sales.id, sales.id] },
      }),
    );
    expect(refused).toMatchObject({ code: 'HOSTS_INVALID', field: 'hosts' });
  });

  it('serialises 30 parallel bookings on two pages sharing members, with no deadlock (AC-1431)', async () => {
    const w = await workspace();
    const people = await Promise.all(['A', 'B', 'C', 'D'].map((name) => w.addMember(`Member ${name}`)));
    const ids = people.map((person) => person.id);
    const one = await rotationOf(w, 'One', [ids[0] ?? '', ids[1] ?? '', ids[2] ?? '']);
    const two = await rotationOf(w, 'Two', [ids[2] ?? '', ids[3] ?? '', ids[1] ?? '']);
    const first = await teamPage(w, [], [one.id]);
    const second = await teamPage(w, [], [two.id, one.id]);
    const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'];
    const settled = await Promise.allSettled(
      Array.from({ length: 30 }, (_, index) =>
        bookPublicSlot(
          index % 2 === 0 ? first.entry : second.entry,
          deps(),
          bookInput(at(times[index % times.length] ?? '09:00')),
        ),
      ),
    );
    for (const each of settled) {
      if (each.status === 'rejected') expect(isRefusal(each.reason) && each.reason.refusal.code).toBe('SLOT_TAKEN');
    }
    expect(settled.filter((each) => each.status === 'fulfilled').length).toBeGreaterThan(8);
    const overlaps = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        select 1 from booking_hosts a join booking_hosts b on a.member_id = b.member_id and a.booking_id < b.booking_id
        where a.status = 'confirmed' and b.status = 'confirmed' and a.during && b.during`),
    );
    expect(overlaps.rows).toEqual([]);
  });
});

describe('Even, caps and returning guests (AC-731, AC-739, AC-1325, AC-1326, AC-1328)', () => {
  it('holds back a member the gap ahead until the others catch up (Even)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee', { from: '09:00', to: '12:00' });
    const kim = await w.addMember('Kim Park', { from: '13:00', to: '17:00' });
    const even = await rotationOf(w, 'Even', [sam.id, kim.id], { strategy: 'even', evenGap: 2 });
    const { entry } = await teamPage(w, [], [even.id]);
    // Sam alone is free in the morning: two bookings put Sam 2 ahead of Kim.
    await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    await bookPublicSlot(entry, deps(), bookInput(at('10:00')));
    const morning = (await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16));
    expect(morning.filter((time) => time < '12:00')).toEqual([]);
    expect(morning).toContain('13:00');
  });

  it('stops offering a member past their daily cap', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee', { from: '09:00', to: '11:00' });
    const kim = await w.addMember('Kim Park', { from: '15:00', to: '16:00' });
    const capped = await rotationOf(w, 'Capped', [sam.id, kim.id], {}, [{ dailyCap: 1 }, {}]);
    const { entry } = await teamPage(w, [], [capped.id]);
    await bookPublicSlot(entry, deps(), bookInput(at('09:00')));
    const left = (await mondaySlots(entry)).slots.map((slot) => slot.start.slice(11, 16));
    expect(left).toEqual(['15:00', '15:30']);
  });

  it('sends a returning guest to the host they met last, when that is the rule', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const lastHost = await rotationOf(w, 'Last', [sam.id, kim.id], { returning: 'last_host' });
    const { entry } = await teamPage(w, [], [lastHost.id]);
    const guest = { email: 'loyal@client.example', name: 'Loyal Client' };
    const first = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), guest));
    const met = (await hostsOf(w, [first.bookingId])).get(first.bookingId);
    // Someone else books, so fairness alone would now pick the other member.
    await bookPublicSlot(entry, deps(), bookInput(at('10:00')));
    await bookPublicSlot(entry, deps(), bookInput(at('10:00')));
    const again = await bookPublicSlot(entry, deps(), bookInput(at('11:00'), guest));
    expect((await hostsOf(w, [again.bookingId])).get(again.bookingId)).toBe(met);
    expect((await bookingAssignments(w.owner, { bookingId: again.bookingId }))[0]?.reason).toBe('last_host');
  });

  it('sends a known person to their owner when free, whatever the counts (AC-739)', async () => {
    const w = await workspace();
    const sam = await w.addMember('Sam Lee');
    const kim = await w.addMember('Kim Park');
    const owned = await rotationOf(w, 'Owned', [sam.id, kim.id]);
    const { entry } = await teamPage(w, [], [owned.id]);
    // A first booking files the visitor as a person owned by whoever got it.
    const guest = { email: 'known@client.example', name: 'Known Person' };
    const first = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), guest));
    const owner = (await hostsOf(w, [first.bookingId])).get(first.bookingId);
    const again = await bookPublicSlot(entry, deps(), bookInput(at('10:00'), guest));
    expect((await hostsOf(w, [again.bookingId])).get(again.bookingId)).toBe(owner);
    expect((await bookingAssignments(w.owner, { bookingId: again.bookingId }))[0]?.reason).toBe('owner');
  });
});
