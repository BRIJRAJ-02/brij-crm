// The Team day (spec 0030, as spec 0037 amends it, job J12), against the real Postgres: columns from the reader's See
// reach and never anyone else, however `memberIds` is crafted (AC-769, AC-1434); a colleague's outside calendar as
// Busy with no title (AC-770); time off as the Away band (AC-1437); the Needs a host lane for those who manage someone
// (AC-1435); job title order (AC-1438). The pure parts (open hours, issues) are tested on their own.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { defaultAvailability } from '@crm/contracts';
import { enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { grantDelegation } from '../scheduling/delegations.ts';
import { createTimeOff } from '../scheduling/time-off.ts';
import { rescope, testScope } from '../testing.ts';
import { createTimeBlock } from './blocks.ts';
import { NO_CALENDAR } from './calendar.ts';
import { createBookingPage } from './pages.ts';
import { bookPublicSlot } from './public.ts';
import { openSpans, readTeamDay, teamDayIssues } from './team-day.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-team-day-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date();
/** A Monday at least a week ahead, as `yyyy-MM-dd`: inside every page's horizon, on default working hours. */
const DAY = (() => {
  const at = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 7));
  at.setUTCDate(at.getUTCDate() + ((8 - at.getUTCDay()) % 7));
  return at.toISOString().slice(0, 10);
})();
const at = (time: string) => `${DAY}T${time}:00.000Z`;

const memberOf = (scope: EngineScope) =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : '';

async function workspace() {
  const created = await createWorkspace(db, {
    name: 'Team day',
    slug: `team-day-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, role: 'admin' | 'member' | 'guest', jobTitle?: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, job_title, created_by_type, updated_by_type)
          values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, ${jobTitle ?? null},
            'system', 'system')`,
      ),
    );
    return rescope(owner, { actor: { type: 'member', id }, role });
  };
  return { ...created, owner, addMember };
}

/** A connection with one calendar checked for conflicts, and a meeting on it. */
async function busyMeeting(scope: EngineScope, title: string, start: string, end: string) {
  const connection = newId();
  const calendar = newId();
  const meeting = newId();
  await db.withWorkspace(scope.workspaceId, async (tx) => {
    await tx.execute(sql`
      insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, sharing, tokens,
        created_by_type, updated_by_type)
      values (${scope.workspaceId}, ${connection}, ${memberOf(scope)}, 'google', ${`${connection}@example.com`},
        'connected', 'shared', '\\x00'::bytea, 'system', 'system')
    `);
    await tx.execute(sql`
      insert into calendar_calendars (workspace_id, id, connection_id, member_id, provider_calendar_id, name,
        access_role, is_primary, check_conflicts, show_in_week, sync, is_destination, created_by_type, updated_by_type)
      values (${scope.workspaceId}, ${calendar}, ${connection}, ${memberOf(scope)}, 'primary', 'Work', 'owner', true,
        true, true, true, false, 'system', 'system')
    `);
    await tx.execute(sql`
      insert into meetings (workspace_id, id, ical_uid, title, location, starts_at, ends_at, created_by_type, updated_by_type)
      values (${scope.workspaceId}, ${meeting}, ${`uid-${meeting}`}, ${title}, 'Room 4', ${start}::timestamptz,
        ${end}::timestamptz, 'calendar', 'calendar')
    `);
    await tx.execute(sql`
      insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id, marked_private)
      values (${scope.workspaceId}, ${meeting}, ${connection}, ${`event-${meeting}`}, 'primary', false)
    `);
  });
}

const book = async (publicKey: string, start: string, name: string) => {
  const entry = await enterBookingPage({ db }, publicKey);
  return bookPublicSlot(
    entry,
    { calendar: NO_CALENDAR, now: () => NOW, linkKey: Buffer.alloc(32, 7) },
    {
      idempotencyKey: newId(),
      start,
      duration: 30,
      name,
      email: `${name.toLowerCase()}@example.org`,
      timeZone: 'Europe/London',
    },
  );
};

const input = { day: DAY, timeZone: 'UTC' } as const;

describe('Team day', () => {
  it('shows a member only their own column, whatever they ask for, and nothing of anyone else', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const linus = await w.addMember('Linus', 'member');
    const page = await createBookingPage(linus, { id: newId(), title: 'Linus intro', timeZone: 'UTC' }, NOW);
    await book(page.publicKey, at('10:00'), 'Visitor');

    const crafted = await readTeamDay(
      grace,
      { ...input, memberIds: [w.memberId, memberOf(linus), memberOf(grace)] },
      { now: NOW },
    );
    expect(crafted.columns.map((column) => column.memberId)).toEqual([memberOf(grace)]);
    expect(crafted.needsHost).toBeUndefined();
    expect(JSON.stringify(crafted)).not.toContain('Linus');
    // Asking only for others answers no column at all.
    const others = await readTeamDay(grace, { ...input, memberIds: [memberOf(linus)] }, { now: NOW });
    expect(others.columns).toEqual([]);
  });

  it('shows an admin everyone, a colleague’s calendar as Busy with no title, and bookings in full', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const linus = await w.addMember('Linus', 'member');
    const admin = await w.addMember('Barbara', 'admin');
    await busyMeeting(grace, 'Salary talk', at('12:00'), at('13:00'));
    const page = await createBookingPage(linus, { id: newId(), title: 'Linus intro', timeZone: 'UTC' }, NOW);
    const booked = await book(page.publicKey, at('10:00'), 'Visitor');

    const day = await readTeamDay(admin, input, { now: NOW });
    expect(day.columns[0]?.memberId).toBe(memberOf(admin));
    expect(day.columns.map((column) => column.memberId).toSorted()).toEqual(
      [w.memberId, memberOf(grace), memberOf(linus), memberOf(admin)].toSorted(),
    );
    const of = (id: string) => day.columns.find((column) => column.memberId === id);
    expect(of(memberOf(grace))?.items).toEqual([{ kind: 'busy', startsAt: at('12:00'), endsAt: at('13:00') }]);
    expect(JSON.stringify(day)).not.toContain('Salary talk');
    expect(JSON.stringify(day)).not.toContain('Room 4');
    expect(of(memberOf(linus))?.items).toEqual([
      { kind: 'booking', bookingId: booked.bookingId, startsAt: at('10:00'), endsAt: at('10:30') },
    ]);
    expect(of(memberOf(linus))?.booked).toBe(1);
    expect(day.bookings).toEqual([
      expect.objectContaining({ id: booked.bookingId, visitorName: 'Visitor', pageTitle: 'Linus intro' }),
    ]);
    // Default hours, 9 to 5 in UTC, on the reader's clock.
    expect(of(memberOf(linus))?.open).toEqual([{ startsAt: at('09:00'), endsAt: at('17:00') }]);
    expect(day.issues).toEqual([]);
    // Grace's own column shows her meeting in full, as her week does (it is on her week).
    const own = await readTeamDay(grace, input, { now: NOW });
    const titles = own.columns[0]?.items.map((item) => (item.kind === 'event' ? item.event.title : item.kind));
    expect(titles).toEqual(['Salary talk']);
  });

  it('draws time off as Away, lists Host away and Needs a host in the lane, and orders by job title', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member', 'Sales lead');
    const linus = await w.addMember('Linus', 'member', 'Account executive');
    const admin = await w.addMember('Barbara', 'admin');
    const page = await createBookingPage(linus, { id: newId(), title: 'Linus intro', timeZone: 'UTC' }, NOW);
    const booked = await book(page.publicKey, at('10:00'), 'Visitor');
    const gracePage = await createBookingPage(grace, { id: newId(), title: 'Grace demo', timeZone: 'UTC' }, NOW);
    const flagged = await book(gracePage.publicKey, at('11:00'), 'Guest');
    await createTimeOff(
      linus,
      { now: () => NOW },
      { id: newId(), fromDate: DAY, toDate: DAY, reason: 'vacation', note: 'Lisbon' },
    );
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update bookings set needs_host_at = now() where id = ${flagged.bookingId}::uuid`),
    );

    const day = await readTeamDay(admin, { ...input, order: 'title' }, { now: NOW });
    // By job title, those without one last, then by name.
    expect(day.columns.map((column) => column.name)).toEqual(['Linus', 'Grace', 'Ada Host', 'Barbara']);
    const linusColumn = day.columns[0];
    expect(linusColumn?.jobTitle).toBe('Account executive');
    expect(linusColumn?.away).toEqual({
      reason: 'vacation',
      note: 'Lisbon',
      span: { startsAt: at('00:00'), endsAt: new Date(Date.parse(at('00:00')) + 86_400_000).toISOString() },
    });
    expect(day.needsHost?.toSorted()).toEqual([booked.bookingId, flagged.bookingId].toSorted());
    // Away isn't outside hours: Bookings already says Host away.
    expect(day.issues).toEqual([]);
  });

  it('shows See reach a colleague’s day with no labels, notes or guest details, and Manage reach in full', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const bea = await w.addMember('Bea', 'member');
    const linus = await w.addMember('Linus', 'member');
    const page = await createBookingPage(linus, { id: newId(), title: 'Linus intro', timeZone: 'UTC' }, NOW);
    const booked = await book(page.publicKey, at('10:00'), 'Visitor');
    await createTimeBlock(linus, {
      id: newId(),
      kind: 'block',
      repeat: 'once',
      date: DAY,
      startMinute: 13 * 60,
      endMinute: 14 * 60,
      timeZone: 'UTC',
      label: 'Dentist',
    });
    await createTimeOff(
      linus,
      { now: () => NOW },
      { id: newId(), fromDate: DAY, toDate: DAY, reason: 'sick', note: 'Flu' },
    );
    // Grace may See Linus's scheduling, Bea may Manage it (delegations an admin grants, spec 0037).
    await grantDelegation(w.owner, {
      delegateMemberId: memberOf(grace),
      target: { type: 'member', memberId: memberOf(linus) },
      level: 'view',
    });
    await grantDelegation(w.owner, {
      delegateMemberId: memberOf(bea),
      target: { type: 'member', memberId: memberOf(linus) },
      level: 'manage',
    });

    const seen = await readTeamDay(grace, input, { now: NOW });
    expect(seen.columns.map((column) => column.memberId)).toEqual([memberOf(grace), memberOf(linus)]);
    const linusSeen = seen.columns[1];
    expect(linusSeen?.canManage).toBe(false);
    expect(linusSeen?.away).toEqual({ span: expect.any(Object) as unknown });
    expect(linusSeen?.items).toContainEqual(expect.objectContaining({ kind: 'block' }));
    expect(linusSeen?.items.some((item) => item.kind === 'block' && item.label !== undefined)).toBe(false);
    expect(seen.bookings).toEqual([
      expect.objectContaining({ id: booked.bookingId, seeOnly: true, visitorEmail: '', visitorName: 'Visitor' }),
    ]);
    expect(seen.needsHost).toBeUndefined();
    const said = JSON.stringify(seen);
    expect(said).not.toContain('Dentist');
    expect(said).not.toContain('Flu');
    expect(said).not.toContain('visitor@example.org');

    const managed = await readTeamDay(bea, input, { now: NOW });
    const linusManaged = managed.columns.find((column) => column.memberId === memberOf(linus));
    expect(linusManaged?.canManage).toBe(true);
    expect(linusManaged?.away).toMatchObject({ reason: 'sick', note: 'Flu' });
    expect(linusManaged?.items).toContainEqual(expect.objectContaining({ kind: 'block', label: 'Dentist' }));
    expect(managed.bookings[0]?.seeOnly).toBeUndefined();
    expect(managed.needsHost).toEqual([booked.bookingId]);
  });

  it('never answers another workspace’s members, whatever is asked for', async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const stranger = await theirs.addMember('Stranger', 'member');
    const admin = await mine.addMember('Barbara', 'admin');
    const day = await readTeamDay(admin, { ...input, memberIds: [memberOf(stranger), theirs.memberId] }, { now: NOW });
    expect(day.columns).toEqual([]);
    expect(day.bookings).toEqual([]);
  });

  it('gives a guest no column, even to an admin who names them (spec 0031, slice 9)', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const gus = await w.addMember('Gus', 'guest');
    const admin = await w.addMember('Barbara', 'admin');
    const day = await readTeamDay(admin, input, { now: NOW });
    expect(day.columns.map((column) => column.memberId)).toContain(memberOf(grace));
    expect(day.columns.map((column) => column.memberId)).not.toContain(memberOf(gus));
    const asked = await readTeamDay(admin, { ...input, memberIds: [memberOf(gus)] }, { now: NOW });
    expect(asked.columns).toEqual([]);
  });
});

describe('open hours and issues', () => {
  const from = new Date('2030-01-07T00:00:00.000Z');
  const to = new Date('2030-01-08T00:00:00.000Z');
  const ms = (time: string) => Date.parse(`2030-01-07T${time}:00.000Z`);

  it('reads hours in the member’s own zone onto the reader’s day', () => {
    // 9 to 5 in Kolkata is 3:30 to 11:30 UTC.
    expect(openSpans(defaultAvailability('Asia/Kolkata'), from, to)).toEqual([
      { start: ms('03:30'), end: ms('11:30') },
    ]);
    const changed = {
      ...defaultAvailability('UTC'),
      overrides: [
        {
          date: '2030-01-07',
          ranges: [
            ['10:00', '12:00'],
            ['11:00', '14:00'],
          ] as [string, string][],
        },
      ],
    };
    expect(openSpans(changed, from, to)).toEqual([{ start: ms('10:00'), end: ms('14:00') }]);
  });

  it('counts a booking outside hours and each clash once', () => {
    const issues = teamDayIssues([
      {
        memberId: 'sam',
        open: [{ start: ms('09:00'), end: ms('17:00') }],
        bookings: [
          { id: 'a', start: ms('08:30'), end: ms('09:30') },
          { id: 'b', start: ms('09:00'), end: ms('10:00') },
          { id: 'c', start: ms('12:00'), end: ms('12:30') },
        ],
        calendar: [{ start: ms('12:15'), end: ms('13:00') }],
      },
      {
        memberId: 'bea',
        open: [],
        away: { start: ms('00:00'), end: ms('23:59') },
        bookings: [{ id: 'd', start: ms('10:00'), end: ms('10:30') }],
        calendar: [],
      },
    ]);
    expect(issues).toEqual([
      { kind: 'outsideHours', memberId: 'sam', bookingId: 'a' },
      { kind: 'clash', memberId: 'sam', bookingId: 'a', withBookingId: 'b' },
      { kind: 'clash', memberId: 'sam', bookingId: 'c' },
    ]);
  });
});
