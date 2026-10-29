// Reach everywhere, and the member told (spec 0037, job J4), against a real Postgres as the app role: a delegate
// with See reads a colleague's scheduling and bookings but changes nothing, with Manage acts on them, a member with
// no reach finds nothing (NOT_FOUND), owners and admins are never reached through a member's own say, a member
// without `availability.own` can't change their own hours, every change is audited, and the member's notice folds
// ten minutes of one person's changes into one email.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, systemScope } from '../access/door.ts';
import { mintScope } from '../access/mint.ts';
import { createSchedule, listSchedules, updateSchedule } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { cancelBooking, hostTarget } from '../booking/change.ts';
import { createTimeBlock, removeTimeBlock } from '../booking/blocks.ts';
import { bookAsHost } from '../booking/host.ts';
import { listWorkspaceBookings } from '../booking/list.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { grantDelegation } from './delegations.ts';
import { noticeLines, runSchedulingNotice } from './notice.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-reach-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';
const LINK_KEY = Buffer.alloc(32, 4);
const calendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId(), videoUrl: 'https://meet.example/x' }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};

let made = 0;
/**
 * A workspace: Olga the owner, Bea (a member with a page and a booking from a visitor), Priya (a member Bea lets
 * see or manage her scheduling) and Bo (a member with no reach at all).
 */
async function world(level: 'view' | 'manage') {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Reach',
    slug: `reach-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const add = async (name: string, role: Role) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return id;
  };
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const bea = await add('Bea Rao', 'member');
  const priya = await add('Priya Shah', 'member');
  const bo = await add('Bo Lee', 'member');
  const owner = created.memberId;
  await grantDelegation(as(bea), { delegateMemberId: priya, target: { type: 'member', memberId: bea }, level });
  const page = await createBookingPage(as(bea), { id: newId(), title: 'Bea’s call', timeZone: 'UTC' }, NOW);
  const entry = await enterBookingPage({ db }, page.publicKey);
  const { bookingId } = await bookPublicSlot(
    entry,
    { calendar, now: () => NOW, linkKey: LINK_KEY },
    {
      idempotencyKey: newId(),
      start: MONDAY_9,
      duration: 30,
      name: 'Vera Visitor',
      email: 'vera@example.org',
      timeZone: 'UTC',
    },
  );
  const audit = async (action: string) =>
    testQuery<{ actor_member_id: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select actor_member_id::text, target_id, before, after from audit_events
         where workspace_id = $1 and action = $2 order by at, id`,
      [created.workspaceId, action],
    );
  const noticeJobs = async () =>
    testQuery<{ key: string; run_at: Date }>(
      ownerUrl,
      `select key, run_at from graphile_worker._private_jobs where key like $1`,
      [`scheduling-notice:${created.workspaceId}:%`],
    );
  return { ...created, owner, bea, priya, bo, as, page, bookingId, audit, noticeJobs };
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

const WEEK = {
  mon: [['09:00', '17:00']],
  tue: [['09:00', '17:00']],
  wed: [['09:00', '17:00']],
  thu: [['09:00', '17:00']],
  fri: [['09:00', '17:00']],
  sat: [],
  sun: [],
} as const;
const hours = (mon: readonly (readonly [string, string])[]) => ({
  timeZone: 'UTC',
  weekly: { ...WEEK, mon: mon.map(([a, b]) => [a, b] as [string, string]) } as never,
  overrides: [],
});

describe('schedules on reach (AC-1258, AC-1260, AC-1444)', () => {
  it('lets See read a colleague’s hours and refuses a change; no reach answers as absent', async () => {
    const w = await world('view');
    const made = await createSchedule(w.as(w.bea), { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const list = await listSchedules(w.as(w.priya), { memberId: w.bea, timeZone: 'UTC' });
    expect(list.schedules.map((each) => each.name)).toContain('Evenings');
    expect(
      await refusalOf(
        updateSchedule(w.as(w.priya), { id: made.id ?? '', name: 'Late', updatedAt: made.updatedAt ?? '' }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'You can see this person’s scheduling but not change it.' });
    expect(await refusalOf(listSchedules(w.as(w.bo), { memberId: w.bea, timeZone: 'UTC' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // The owner is never reached through someone else's say: a plain member reads nothing of hers.
    expect(await refusalOf(listSchedules(w.as(w.priya), { memberId: w.owner, timeZone: 'UTC' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets Manage change them, audited with the member and only what changed, and queues the member’s notice', async () => {
    const w = await world('manage');
    const made = await createSchedule(w.as(w.bea), { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const changed = await updateSchedule(w.as(w.priya), {
      id: made.id ?? '',
      availability: hours([['10:00', '18:00']]),
      updatedAt: made.updatedAt ?? '',
    });
    expect(changed.changedBy).toEqual({ memberId: w.priya, at: changed.updatedAt });
    const rows = await w.audit('schedule.changed');
    // Bea's own create is audited too; Priya's change names Bea, and only the week.
    expect(rows.map((row) => row.actor_member_id)).toEqual([w.bea, w.priya]);
    const priyas = rows[1];
    expect(priyas?.target_id).toBe(w.bea);
    expect(priyas?.before).toMatchObject({ memberId: w.bea, kind: 'update', schedules: [{ name: 'Evenings' }] });
    expect(Object.keys((priyas?.after as { schedules: object[] }).schedules[0] ?? {}).sort()).toEqual([
      'id',
      'name',
      'weekly',
    ]);
    // One waiting notice for Priya over Bea, ten minutes out; Bea's own change queued none.
    const jobs = await w.noticeJobs();
    expect(jobs.map((job) => job.key)).toEqual([`scheduling-notice:${w.workspaceId}:${w.priya}:${w.bea}`]);
  });

  it('refuses a member without availability.own their own hours, with the sentence (AC-1260)', async () => {
    const w = await world('manage');
    const base = w.as(w.bea);
    const doctor = mintScope({
      db,
      workspaceId: w.workspaceId,
      actor: base.actor,
      access: { ...base.access, permissions: base.access.permissions.filter((each) => each !== 'availability.own') },
    });
    expect(await refusalOf(createSchedule(doctor, { id: newId(), name: 'Mine', timeZone: 'UTC' }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['availability.own'].message,
    });
    // Reading stays theirs, and their manager still changes them.
    await expect(listSchedules(doctor, { timeZone: 'UTC' })).resolves.toBeDefined();
    await expect(
      createSchedule(w.as(w.priya), { id: newId(), memberId: w.bea, name: 'Set for Bea', timeZone: 'UTC' }),
    ).resolves.toMatchObject({ memberId: w.bea });
  });
});

describe('bookings on reach (AC-1262)', () => {
  it('shows See a colleague’s booking on Everyone with the guest’s name only, and refuses acting on it', async () => {
    const w = await world('view');
    const everyone = await listWorkspaceBookings(w.as(w.priya), { when: 'upcoming', hosts: 'all' });
    const seen = everyone.find((each) => each.id === w.bookingId);
    expect(seen).toMatchObject({ visitorName: 'Vera Visitor', visitorEmail: '', seeOnly: true, guests: [] });
    expect(await listWorkspaceBookings(w.as(w.priya), { when: 'upcoming', hosts: 'mine' })).toEqual([]);
    expect(
      await refusalOf(cancelBooking(hostTarget(w.as(w.priya), w.bookingId), { calendar, now: () => NOW }, {})),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // Bo reaches nobody: Everyone holds nothing of Bea's, and her booking is absent to him.
    expect(await listWorkspaceBookings(w.as(w.bo), { when: 'upcoming', hosts: 'all' })).toEqual([]);
    expect(
      await refusalOf(cancelBooking(hostTarget(w.as(w.bo), w.bookingId), { calendar, now: () => NOW }, {})),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets Manage see the guest and cancel, audited as changed for Bea', async () => {
    const w = await world('manage');
    const everyone = await listWorkspaceBookings(w.as(w.priya), { when: 'upcoming', hosts: 'all' });
    const full = everyone.find((each) => each.id === w.bookingId);
    expect(full).toMatchObject({ visitorEmail: 'vera@example.org' });
    expect(full?.seeOnly).toBeUndefined();
    expect(await cancelBooking(hostTarget(w.as(w.priya), w.bookingId), { calendar, now: () => NOW }, {})).toEqual({
      cancelled: true,
    });
    const rows = await w.audit('booking.changed_for');
    expect(rows).toEqual([
      expect.objectContaining({
        actor_member_id: w.priya,
        target_id: w.bookingId,
        after: { memberId: w.bea, change: 'cancelled' },
      }),
    ]);
  });
});

describe('blocks and booking in for someone (AC-1272, AC-1275)', () => {
  it('lets Manage block and unblock a colleague’s time, audited; See is refused', async () => {
    const draft = {
      kind: 'block' as const,
      repeat: 'once' as const,
      date: '2030-01-07',
      startMinute: 540,
      endMinute: 600,
      timeZone: 'UTC',
    };
    const seeing = await world('view');
    expect(
      await refusalOf(createTimeBlock(seeing.as(seeing.priya), { ...draft, id: newId(), forMemberId: seeing.bea })),
    ).toMatchObject({ code: 'FORBIDDEN', message: 'You can see Bea’s scheduling but not change it.' });

    const w = await world('manage');
    const block = await createTimeBlock(w.as(w.priya), { ...draft, id: newId(), forMemberId: w.bea });
    expect(await refusalOf(removeTimeBlock(w.as(w.bo), { id: block.id }))).toMatchObject({ code: 'NOT_FOUND' });
    await removeTimeBlock(w.as(w.priya), { id: block.id });
    expect((await w.audit('block.created')).map((row) => [row.actor_member_id, row.target_id])).toEqual([
      [w.priya, w.bea],
    ]);
    expect((await w.audit('block.removed')).map((row) => [row.actor_member_id, row.target_id])).toEqual([
      [w.priya, w.bea],
    ]);
  });

  it('books in for a colleague they Manage on her page, never on a calendar they pick', async () => {
    const w = await world('manage');
    const input = {
      idempotencyKey: newId(),
      pageId: w.page.id,
      start: new Date('2030-01-07T09:00:00.000Z'),
      minutes: 30,
      name: 'Sam Guest',
      email: 'sam@example.org',
      timeZone: 'UTC',
      guests: [],
      forMemberId: w.bea,
    };
    const deps = { calendar, linkKey: LINK_KEY };
    expect(await refusalOf(bookAsHost(w.as(w.priya), deps, { ...input, calendarId: newId() }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(bookAsHost(w.as(w.bo), deps, input))).toMatchObject({ code: 'NOT_FOUND' });
    const { bookingId } = await bookAsHost(w.as(w.priya), deps, input);
    const host = await testQuery<{ host_member_id: string; created_by_member_id: string }>(
      ownerUrl,
      'select host_member_id::text, created_by_member_id::text from bookings where id = $1',
      [bookingId],
    );
    expect(host).toEqual([{ host_member_id: w.bea, created_by_member_id: w.priya }]);
    expect((await w.audit('booking.changed_for')).map((row) => row.after)).toEqual([
      { memberId: w.bea, change: 'made' },
    ]);
  });
});

describe('the member told (AC-1264)', () => {
  it('folds a run of changes into each item’s first before and last after, and says nothing when they cancel out', () => {
    const at = (mon: string, name = 'Working hours') => ({
      id: 's1',
      name,
      weekly: { ...WEEK, mon: [mon.split('-')] },
    });
    expect(
      noticeLines([
        { before: { schedules: [at('09:00-17:00')] }, after: { schedules: [at('10:00-18:00')] } },
        { before: { schedules: [at('10:00-18:00')] }, after: { schedules: [at('11:00-19:00')] } },
      ]),
    ).toEqual(['Working hours, Monday: 9:00 AM to 5:00 PM became 11:00 AM to 7:00 PM']);
    expect(
      noticeLines([
        { before: { schedules: [at('09:00-17:00')] }, after: { schedules: [at('10:00-18:00')] } },
        { before: { schedules: [at('10:00-18:00')] }, after: { schedules: [at('09:00-17:00')] } },
      ]),
    ).toEqual([]);
    expect(
      noticeLines([{ before: { schedules: [] }, after: { schedules: [{ id: 's2', name: 'Evenings' }] } }]),
    ).toEqual(['New schedule: Evenings']);
  });

  it('queues one email naming who changed what, once, and nothing for the member’s own changes', async () => {
    const w = await world('manage');
    const made = await createSchedule(w.as(w.bea), { id: newId(), name: 'Evenings', timeZone: 'UTC' });
    const first = await updateSchedule(w.as(w.priya), {
      id: made.id ?? '',
      availability: hours([['10:00', '18:00']]),
      updatedAt: made.updatedAt ?? '',
    });
    await updateSchedule(w.as(w.priya), { id: made.id ?? '', name: 'Late shift', updatedAt: first.updatedAt ?? '' });
    const system = systemScope(db, w.workspaceId);
    // Bea's own changes tell nobody.
    expect(await runSchedulingNotice(system, { actorMemberId: w.bea, memberId: w.bea })).toBe('nothing');
    expect(await runSchedulingNotice(system, { actorMemberId: w.priya, memberId: w.bea })).toBe('queued');
    // A retried run, or a later one with nothing new, sends nothing more.
    expect(await runSchedulingNotice(system, { actorMemberId: w.priya, memberId: w.bea })).toBe('nothing');
    const emails = await testQuery<{
      kind: string;
      to_member_id: string;
      params: { actorName: string; lines: string[] };
    }>(
      ownerUrl,
      `select kind, to_member_id::text, params from emails where workspace_id = $1 and kind = 'scheduling_changed'`,
      [w.workspaceId],
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to_member_id: w.bea, params: { actorName: 'Priya Shah' } });
    expect(emails[0]?.params.lines).toEqual([
      'Schedule renamed: Evenings to Late shift',
      'Late shift, Monday: 9:00 AM to 5:00 PM became 10:00 AM to 6:00 PM',
    ]);
  });

  it('runs only as the system', async () => {
    const w = await world('manage');
    await expect(runSchedulingNotice(w.as(w.priya), { actorMemberId: w.priya, memberId: w.bea })).rejects.toThrow(
      /Only the system/,
    );
  });
});
