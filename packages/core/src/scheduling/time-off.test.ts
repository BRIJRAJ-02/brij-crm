// Time off (spec 0037, job J2), against a real Postgres as the app role: whole days away close every page (a
// personal page and a round robin page offer no time with the member), a returning guest goes to the stand in, the
// stand in is emailed once, a manager's sick leave over booked meetings lists them and flags them Host away and
// tells the doctor, See reads "Away" alone and changes nothing, no reach finds nothing, the 50 entry limit, a stale
// editor, and every change audited without its note.
import { sql } from 'drizzle-orm';
import { defaultAvailability, type PublicBookInput, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, systemScope } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { removeTimeBlock } from '../booking/blocks.ts';
import { listWorkspaceBookings } from '../booking/list.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { readTeamToday } from '../home/team-today.ts';
import { bookingAssignments } from '../rotation/assignments.ts';
import { pickLeadOwner } from '../rotation/owner.ts';
import { createRotation } from '../rotation/rotations.ts';
import { testScope } from '../testing.ts';
import { grantDelegation } from './delegations.ts';
import { runSchedulingNotice, timeOffLines } from './notice.ts';
import { awayDates, createTimeOff, deleteTimeOff, listTimeOff, updateTimeOff } from './time-off.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-time-off-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the clock every booking here reads. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const now = () => NOW;
const LINK_KEY = Buffer.alloc(32, 9);
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};
const deps = { calendar, now, linkKey: LINK_KEY };

let made = 0;
/** A workspace: Olga the owner, and members with weekday hours 09:00 to 17:00 UTC. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Away',
    slug: `away-${String(made)}-${String(Date.now())}`,
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
  const audit = async (action: string) =>
    testQuery<{ actor_member_id: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select actor_member_id::text, target_id, before, after from audit_events
         where workspace_id = $1 and action = $2 order by at, id`,
      [created.workspaceId, action],
    );
  const emails = async (kind: string) =>
    testQuery<{ to_member_id: string; params: Record<string, unknown> }>(
      ownerUrl,
      `select to_member_id::text, params from emails where workspace_id = $1 and kind = $2 order by created_at, id`,
      [created.workspaceId, kind],
    );
  const noticeJobs = async () =>
    testQuery<{ key: string }>(ownerUrl, `select key from graphile_worker._private_jobs where key like $1`, [
      `scheduling-notice:${created.workspaceId}:%`,
    ]);
  return { ...created, as, owner, add, audit, emails, noticeJobs };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

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

const dayOf = (entry: Awaited<ReturnType<typeof enterBookingPage>>, date: string) =>
  readPublicSlots(entry, deps, {
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.000Z`,
    duration: 30,
    tz: 'UTC',
  }).then((answer) => answer.slots);

async function hostOf(w: Awaited<ReturnType<typeof world>>, bookingId: string) {
  const rows = await testQuery<{ host: string }>(
    ownerUrl,
    'select host_member_id::text as host from bookings where id = $1',
    [bookingId],
  );
  return rows[0]?.host;
}

describe('time off closes pages and rotations cover (AC-1281, AC-1283, AC-1284)', () => {
  it('closes a personal page and a round robin page those days, and a returning guest goes to the stand in', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const bo = await w.add('Bo Stand');
    // A round robin of Sam and Kim, returning guests to the host they met last.
    const rotation = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'last_host' },
        members: [sam, kim].map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    const team = await createBookingPage(
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
    const roundRobin = await enterBookingPage({ db }, team.publicKey);
    // A guest meets whoever the rotation picks on Monday; that host then takes Tuesday to Thursday off.
    const guest = { email: 'loyal@client.example', name: 'Loyal Client' };
    const first = await bookPublicSlot(roundRobin, deps, bookInput('2026-11-02T09:00:00.000Z', guest));
    const met = (await hostOf(w, first.bookingId)) ?? '';
    const other = met === sam ? kim : sam;
    // Their own page too.
    const page = await createBookingPage(w.as(met), { id: newId(), title: 'My call', timeZone: 'UTC' }, NOW);
    const personal = await enterBookingPage({ db }, page.publicKey);
    const saved = await createTimeOff(
      w.as(met),
      { now },
      {
        id: newId(),
        fromDate: '2026-11-03',
        toDate: '2026-11-05',
        reason: 'vacation',
        note: 'Lisbon',
        standinMemberId: bo,
      },
    );
    expect(saved.entry).toMatchObject({ fromDate: '2026-11-03', toDate: '2026-11-05', timeZone: 'UTC' });
    expect(saved.bookingsInside).toEqual([]);
    // Their own page offers nothing while they're away, and Monday still.
    expect(await dayOf(personal, '2026-11-03')).toEqual([]);
    expect(await dayOf(personal, '2026-11-05')).toEqual([]);
    expect((await dayOf(personal, '2026-11-02')).length).toBeGreaterThan(0);
    expect((await dayOf(personal, '2026-11-06')).length).toBeGreaterThan(0);
    // The round robin page still offers Tuesday through the other member; a new visitor goes to them.
    const fresh = await bookPublicSlot(roundRobin, deps, bookInput('2026-11-03T10:00:00.000Z'));
    expect(await hostOf(w, fresh.bookingId)).toBe(other);
    // The returning guest goes to the stand in, outside the rotation, with reason `standin`.
    const again = await bookPublicSlot(roundRobin, deps, bookInput('2026-11-03T11:00:00.000Z', guest));
    expect(await hostOf(w, again.bookingId)).toBe(bo);
    expect((await bookingAssignments(w.owner, { bookingId: again.bookingId }))[0]?.reason).toBe('standin');
    // The stand in was emailed once; saving again with the same dates sends nothing more.
    await updateTimeOff(w.as(met), { ...saved.entry, reason: 'travel', standinMemberId: bo, fromDate: '2026-11-03' });
    const told = await w.emails('standin_covering');
    expect(told.map((each) => [each.to_member_id, each.params.dates])).toEqual([[bo, 'from 3 to 5 November']]);
  });

  it('skips a member away now when a rotation picks a lead’s owner', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const kim = await w.add('Kim Park');
    const rotation = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { name: 'Leads', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' },
        members: [sam, kim].map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          isOn: true,
        })),
      },
      NOW,
    );
    await createTimeOff(
      w.as(sam),
      { now },
      { id: newId(), fromDate: '2026-11-01', toDate: '2026-11-02', reason: 'sick' },
    );
    const picks = await db.withWorkspace(w.workspaceId, async (tx) => [
      await pickLeadOwner(tx, {
        workspaceId: w.workspaceId,
        rotationId: rotation.id,
        now: new Date('2026-11-01T12:00:00Z'),
      }),
      await pickLeadOwner(tx, {
        workspaceId: w.workspaceId,
        rotationId: rotation.id,
        now: new Date('2026-11-01T13:00:00Z'),
      }),
    ]);
    expect(picks.map((pick) => (pick.kind === 'picked' ? pick.memberId : pick.kind))).toEqual([kim, kim]);
  });
});

describe('time off for someone else (AC-1282, AC-1285, AC-1286, AC-1287)', () => {
  it('lists the meetings inside, flags them Host away, audits without the note and tells the member once', async () => {
    const w = await world();
    const doctor = await w.add('Dee Doctor');
    const manager = await w.add('Max Manager');
    await grantDelegation(w.as(doctor), {
      delegateMemberId: manager,
      target: { type: 'member', memberId: doctor },
      level: 'manage',
    });
    const page = await createBookingPage(w.as(doctor), { id: newId(), title: 'Check up', timeZone: 'UTC' }, NOW);
    const entry = await enterBookingPage({ db }, page.publicKey);
    const one = await bookPublicSlot(entry, deps, bookInput('2026-11-03T09:00:00.000Z', { name: 'Pat One' }));
    const two = await bookPublicSlot(entry, deps, bookInput('2026-11-03T14:00:00.000Z', { name: 'Pat Two' }));
    const saved = await createTimeOff(
      w.as(manager),
      { now },
      { id: newId(), memberId: doctor, fromDate: '2026-11-03', toDate: '2026-11-03', reason: 'sick', note: 'Flu' },
    );
    expect(saved.bookingsInside.map((each) => [each.id, each.visitorName, each.pageTitle])).toEqual([
      [one.bookingId, 'Pat One', 'Check up'],
      [two.bookingId, 'Pat Two', 'Check up'],
    ]);
    expect(saved.entry.changedBy?.memberId).toBe(manager);
    // Both show Host away on Bookings; nothing moved or cancelled.
    const listed = await listWorkspaceBookings(w.as(doctor), { when: 'upcoming', hosts: 'mine' }, NOW);
    expect(
      listed
        .filter((each) => each.hostAway === true)
        .map((each) => each.id)
        .sort(),
    ).toEqual([one.bookingId, two.bookingId].sort());
    expect(listed.every((each) => each.status === 'confirmed')).toBe(true);
    // Audited once, naming the doctor, with the reason code and never the note.
    const rows = await w.audit('time_off.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_member_id: manager, target_id: doctor });
    expect(JSON.stringify(rows[0]?.after)).not.toContain('Flu');
    expect(rows[0]?.after).toMatchObject({ reason: 'sick', fromDate: '2026-11-03', toDate: '2026-11-03' });
    // One notice for the doctor, worded from the audit row.
    expect((await w.noticeJobs()).map((job) => job.key)).toEqual([
      `scheduling-notice:${w.workspaceId}:${manager}:${doctor}`,
    ]);
    expect(
      await runSchedulingNotice(systemScope(db, w.workspaceId), { actorMemberId: manager, memberId: doctor }),
    ).toBe('queued');
    const notices = await w.emails('scheduling_changed');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.params).toMatchObject({ lines: ['Time off added: Sick leave, 3 Nov'] });
    // Home's Team today reads "Away" for the doctor that day.
    const today = await readTeamToday(
      w.as(manager),
      { from: '2026-11-03T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' },
      { now: new Date('2026-11-03T08:00:00.000Z') },
    );
    expect(today.members.find((each) => each.memberId === doctor)?.away).toBe(true);
    expect(today.members.find((each) => each.memberId === manager)?.away).toBeUndefined();
  });

  it('shows See "Away" and the dates alone and refuses a change; no reach finds nothing', async () => {
    const w = await world();
    const bea = await w.add('Bea Rao');
    const priya = await w.add('Priya Shah');
    const bo = await w.add('Bo Lee');
    await grantDelegation(w.as(bea), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: bea },
      level: 'view',
    });
    const saved = await createTimeOff(
      w.as(bea),
      { now },
      {
        id: newId(),
        fromDate: '2026-12-21',
        toDate: '2026-12-31',
        reason: 'holiday',
        note: 'Home',
        standinMemberId: bo,
      },
    );
    const seen = await listTimeOff(w.as(priya), { now }, { memberId: bea });
    expect(seen.canManage).toBe(false);
    expect(seen.upcoming).toHaveLength(1);
    expect(seen.upcoming[0]).not.toHaveProperty('reason');
    expect(seen.upcoming[0]).not.toHaveProperty('note');
    expect(seen.upcoming[0]).not.toHaveProperty('standinMemberId');
    const own = await listTimeOff(w.as(bea), { now }, {});
    expect(own.upcoming[0]).toMatchObject({ reason: 'holiday', note: 'Home', standinMemberId: bo });
    expect(
      await refusalOf(
        createTimeOff(
          w.as(priya),
          { now },
          { id: newId(), memberId: bea, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'other' },
        ),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'You can see Bea’s scheduling but not change it.' });
    expect(await refusalOf(deleteTimeOff(w.as(priya), { id: saved.entry.id }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(updateTimeOff(w.as(priya), { ...saved.entry, reason: 'other' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // See learns nothing of who changed it either.
    expect(seen.upcoming[0]).not.toHaveProperty('changedBy');
    // Bo reaches nobody: Bea's time off is absent to him, read or changed.
    expect(await refusalOf(listTimeOff(w.as(bo), { now }, { memberId: bea }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(updateTimeOff(w.as(bo), { ...saved.entry, reason: 'other' }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'That time off could not be found.',
    });
    expect(await refusalOf(deleteTimeOff(w.as(bo), { id: saved.entry.id }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'That time off could not be found.',
    });
    // Time off is never removed as a block, which would skip its own audit.
    expect(await refusalOf(removeTimeBlock(w.as(bea), { id: saved.entry.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('limits, checks and changes (AC-1281, AC-1288)', () => {
  it('holds at most 50 upcoming entries, refuses a stand in who can’t cover, and a stale editor', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const scope = w.as(sam);
    for (let index = 0; index < 50; index += 1) {
      const date = new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10);
      await createTimeOff(scope, { now }, { id: newId(), fromDate: date, toDate: date, reason: 'other' });
    }
    expect(
      await refusalOf(
        createTimeOff(scope, { now }, { id: newId(), fromDate: '2027-06-01', toDate: '2027-06-01', reason: 'other' }),
      ),
    ).toEqual({ code: 'TIME_OFF_LIMIT', message: 'Someone can have at most 50 upcoming time off entries.' });

    const v = await world();
    const kim = await v.add('Kim Park');
    // Someone removed from the workspace can't cover.
    const gone = await v.add('Gus Gone');
    await testQuery(ownerUrl, `update members set status = 'removed' where id = $1`, [gone]);
    for (const standin of [kim, gone]) {
      expect(
        await refusalOf(
          createTimeOff(
            v.as(kim),
            { now },
            { id: newId(), fromDate: '2027-01-04', toDate: '2027-01-04', reason: 'travel', standinMemberId: standin },
          ),
        ),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    const saved = await createTimeOff(
      v.as(kim),
      { now },
      { id: newId(), fromDate: '2027-01-04', toDate: '2027-01-08', reason: 'travel' },
    );
    const changed = await updateTimeOff(v.as(kim), { ...saved.entry, reason: 'vacation', toDate: '2027-01-09' });
    expect(changed.entry).toMatchObject({ toDate: '2027-01-09', reason: 'vacation' });
    expect(await refusalOf(updateTimeOff(v.as(kim), { ...saved.entry, reason: 'sick' }))).toMatchObject({
      code: 'STALE',
    });
    await deleteTimeOff(v.as(kim), { id: saved.entry.id });
    expect((await listTimeOff(v.as(kim), { now }, {})).upcoming).toEqual([]);
    expect((await v.audit('time_off.changed')).map((row) => row.actor_member_id)).toEqual([kim]);
    expect((await v.audit('time_off.deleted')).map((row) => row.target_id)).toEqual([kim]);
    // Her own changes tell nobody.
    expect(await v.noticeJobs()).toEqual([]);
  });

  it('words the days and the notice lines (pure)', () => {
    expect(awayDates('2026-11-03', '2026-11-07')).toBe('from 3 to 7 November');
    expect(awayDates('2026-11-03', '2026-11-03')).toBe('on 3 November');
    expect(awayDates('2026-10-30', '2026-11-02')).toBe('from 30 October to 2 November');
    expect(awayDates('2026-12-30', '2027-01-02')).toBe('from 30 December 2026 to 2 January 2027');
    const id = newId();
    const side = (fromDate: string, toDate: string, reason: string) => ({ timeOffId: id, fromDate, toDate, reason });
    expect(timeOffLines([{ before: null, after: side('2026-11-03', '2026-11-07', 'vacation') }])).toEqual([
      'Time off added: Vacation, 3 Nov to 7 Nov',
    ]);
    // Added then removed inside one window says nothing; changed says the last state.
    expect(
      timeOffLines([
        { before: null, after: side('2026-11-03', '2026-11-07', 'vacation') },
        { before: side('2026-11-03', '2026-11-07', 'vacation'), after: null },
      ]),
    ).toEqual([]);
    expect(
      timeOffLines([
        { before: side('2026-11-03', '2026-11-07', 'vacation'), after: side('2026-11-04', '2026-11-07', 'sick') },
      ]),
    ).toEqual(['Time off changed: Sick leave, 4 Nov to 7 Nov']);
  });
});
