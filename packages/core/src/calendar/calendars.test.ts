// Spec 0024 milestone 5 (calendars, AC-991 to AC-1005) and spec 0037's
// calendar health (AC-1307), against a real Postgres as the app role and the
// fake provider: listing an account's calendars, the three switches and what
// each pulls, per calendar copies, sync tokens and channels, free and busy per
// calendar with skips and the closed rule, the destination and a page's own,
// the fallback when the provider removes a calendar, and health statuses that
// carry no names.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PERMISSIONS } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import { mintScope } from '../access/mint.ts';
import { NO_RULES, roleAccess } from '../access/policy.ts';
import { listMeetings, readBookingsCalendar } from '../booking/list.ts';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import {
  dismissCalendarNotice,
  listMemberCalendars,
  moveDestinationOff,
  refreshCalendarConnection,
  setCalendarDestination,
  updateMemberCalendar,
} from './calendars.ts';
import { connectCalendar, removeCalendarConnection, updateCalendarConnection } from './connections.ts';
import { createCalendarEvents } from './events.ts';
import { createFakeCalendarProvider } from './fake.ts';
import { readCalendarHealth } from './health.ts';
import { listMeetingsForRecord } from './meetings.ts';
import { addMeetingAttendee } from './people.ts';
import { readPageDestination, setPageDestination } from './page-destination.ts';
import type { ProviderAttendee, ProviderEvent } from './provider.ts';
import { takeCalendarNotice } from './push.ts';
import { syncConnection, type CalendarSyncDeps } from './sync.ts';
import { decodeTokenKey } from './tokens.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-calendar-calendars-tests' });
});
afterAll(async () => {
  await db.close();
});

const tokenKey = decodeTokenKey(Buffer.alloc(32, 7).toString('base64'));
const PUSH = 'https://hooks.crm.test/api/calendar/google/notify';

/** A day from the real now at `hour` UTC, so the sync window holds it. */
const day = (offset: number, hour = 9) => {
  const at = new Date();
  at.setUTCHours(hour, 0, 0, 0);
  return new Date(at.getTime() + offset * 86_400_000).toISOString();
};
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

const self = (email: string): ProviderAttendee => ({ email, response: 'accepted', isOrganizer: true, isSelf: true });
const guest = (email: string): ProviderAttendee => ({ email, response: 'accepted', isOrganizer: false, isSelf: false });

/** An event at `start` for 30 minutes with these attendees. */
function event(
  id: string,
  start: string,
  attendees: readonly ProviderAttendee[],
  changes: Partial<ProviderEvent> = {},
): ProviderEvent {
  return {
    id,
    status: 'confirmed',
    icalUid: `${id}@google.com`,
    title: `Event ${id}`,
    start: { at: start, allDay: false },
    end: { at: plus(start, 30), allDay: false },
    attendees,
    isPrivate: false,
    ...changes,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (isInputError(error)) return { code: 'INPUT_INVALID', ...error.inputProblem };
    throw error;
  }
  throw new Error('It was let through.');
}

let count = 0;
async function world(options: { readonly push?: boolean; readonly timeoutMs?: number } = {}) {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Calendars',
    slug: `calendars-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@acme.dev' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const attributeIds = await db.withWorkspace(owner.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const attribute = (slug: string): string => attributeIds.rows.find((row) => row.slug === slug)?.id ?? '';
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${bea}, 'Bea', 'bea@acme.dev', 'member', 'system', 'system')`,
    ),
  );
  const globex = (
    await createRecord(owner, {
      objectId: created.objects.companies ?? '',
      values: { [attribute('companies.name')]: 'Globex', [attribute('companies.domains')]: ['globex.com'] },
    })
  ).recordId;
  const as = (memberId: string) => rescope(owner, { actor: { type: 'member', id: memberId }, role: 'member' });
  const fake = createFakeCalendarProvider();
  const deps: CalendarSyncDeps = {
    providers: { google: fake.provider },
    tokenKey,
    systemScope: (workspaceId) => systemScope(db, workspaceId),
    hooks: [outboxHook()],
    isFreeDomain: (domain) => domain === 'gmail.com',
    ...(options.push === true ? { pushAddress: PUSH } : {}),
  };
  const connect = async (memberId: string, account: string) => {
    const exchanged = await fake.provider.exchangeCode(`code:${account}`, 'https://crm.test/callback');
    return connectCalendar(as(memberId), { provider: 'google', exchanged, tokenKey });
  };
  const sync = (connectionId: string) => syncConnection(deps, { workspaceId: created.workspaceId, connectionId });
  const query = <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, async (tx) => (await tx.execute<T>(statement)).rows);
  const events = createCalendarEvents({
    db,
    providers: { google: fake.provider },
    tokenKey,
    hooks: [outboxHook()],
    isFreeDomain: deps.isFreeDomain,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  /** The member's calendars by name. */
  const calendars = async (memberId = created.memberId) => {
    const list = await listMemberCalendars(as(memberId));
    return new Map(list.accounts.flatMap((account) => account.calendars).map((each) => [each.name, each]));
  };
  const calendar = async (name: string, memberId = created.memberId) => {
    const found = (await calendars(memberId)).get(name);
    if (found === undefined) throw new Error(`No calendar ${name}.`);
    return found;
  };
  return {
    ...created,
    owner,
    ownerId: created.memberId,
    bea,
    globex,
    as,
    fake,
    connect,
    sync,
    query,
    events,
    calendars,
    calendar,
    system: systemScope(db, created.workspaceId),
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** The record ids each meeting shows on, by title. */
const linksOf = (w: World) =>
  w.query<{ title: string; records: number }>(sql`
    select m.title, (select count(*)::int from meeting_records r where r.meeting_id = m.id) as records
    from meetings m order by m.title
  `);

/** A team calendar on Ada's account, with an event shared with Globex in it. */
async function withTeam(w: World) {
  const conn = await w.connect(w.ownerId, 'ada@acme.dev');
  w.fake.addCalendar('ada@acme.dev', {
    id: 'team@group.calendar',
    name: 'Team',
    colour: '#0b8043',
    accessRole: 'writer',
  });
  w.fake.addCalendar('ada@acme.dev', { id: 'holidays@group', name: 'Holidays', accessRole: 'reader' });
  w.fake.put(
    'ada@acme.dev',
    event('team-sync', day(1), [self('ada@acme.dev'), guest('cy@globex.com')]),
    'team@group.calendar',
  );
  w.fake.put('ada@acme.dev', event('team-solo', day(2), [self('ada@acme.dev')]), 'team@group.calendar');
  await w.sync(conn.id);
  return conn;
}

describe('listing an account’s calendars (AC-991, AC-992)', () => {
  it('gives the main calendar its real id with every switch on, adds the others off, and keeps 50 at most', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    // Before the first listing: the main calendar under its alias, already checking and taking bookings.
    const [before] = (await listMemberCalendars(w.owner)).accounts;
    expect(before?.calendars).toEqual([
      expect.objectContaining({ name: 'ada@acme.dev', isPrimary: true, checkConflicts: true, isDestination: true }),
    ]);
    w.fake.addCalendar('ada@acme.dev', {
      id: 'team@group.calendar',
      name: 'Team',
      colour: '#0b8043',
      accessRole: 'writer',
    });
    for (let index = 0; index < 55; index += 1) {
      w.fake.addCalendar('ada@acme.dev', {
        id: `extra-${String(index)}`,
        name: `Zone ${String(index).padStart(2, '0')}`,
        accessRole: 'reader',
      });
    }
    await w.sync(conn.id);
    const list = await listMemberCalendars(w.owner);
    const [account] = list.accounts;
    expect(account?.calendars).toHaveLength(50);
    expect(account?.calendars[0]).toMatchObject({
      name: 'ada@acme.dev',
      isPrimary: true,
      checkConflicts: true,
      showInWeek: true,
      sync: true,
      isDestination: true,
      hue: 'blue',
    });
    const team = account?.calendars.find((each) => each.name === 'Team');
    expect(team).toMatchObject({
      checkConflicts: false,
      showInWeek: false,
      sync: false,
      hue: 'green',
      canBeDestination: true,
    });
    expect(account?.calendars.find((each) => each.name === 'Zone 00')).toMatchObject({ canBeDestination: false });
    expect(list.destinationId).toBe(account?.calendars[0]?.id);
    const [row] = await w.query<{ provider_calendar_id: string }>(
      sql`select provider_calendar_id from calendar_calendars where is_primary`,
    );
    expect(row?.provider_calendar_id).toBe('ada@acme.dev');
    // Another member sees none of them.
    expect((await listMemberCalendars(w.as(w.bea))).accounts).toEqual([]);
  });

  it('keeps a calendar its account’s member’s: the database refuses another member', async () => {
    const w = await world();
    const conn = await withTeam(w);
    const moved = await db
      .withWorkspace(w.workspaceId, (tx) =>
        tx.execute(
          sql`update calendar_calendars set member_id = ${w.bea}::uuid where connection_id = ${conn.id}::uuid`,
        ),
      )
      .then(
        () => undefined,
        (error: unknown) => (error instanceof Error && error.cause instanceof Error ? error.cause : error),
      );
    // The connection's own foreign key refuses it (23503), not some other rule.
    expect(moved).toMatchObject({ code: '23503', constraint: 'calendar_calendars_connection' });
    expect((await listMemberCalendars(w.owner)).accounts[0]?.calendars.length).toBeGreaterThan(0);
  });

  it('lists again on Refresh only, and drops a calendar the provider removed, with its copy', async () => {
    const w = await world();
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true });
    await w.sync(conn.id);
    expect((await linksOf(w)).map((each) => each.title)).toContain('Event team-sync');
    const listings = w.fake.calls('listCalendars');
    await w.sync(conn.id);
    expect(w.fake.calls('listCalendars')).toBe(listings);
    w.fake.removeCalendar('ada@acme.dev', 'team@group.calendar');
    expect(await refreshCalendarConnection(w.owner, { connectionId: conn.id })).toEqual({ queued: true });
    expect(await refusalOf(refreshCalendarConnection(w.as(w.bea), { connectionId: conn.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    await w.sync(conn.id);
    expect(w.fake.calls('listCalendars')).toBe(listings + 1);
    expect((await w.calendars()).has('Team')).toBe(false);
    expect((await linksOf(w)).map((each) => each.title)).not.toContain('Event team-sync');
    expect(await w.query(sql`select 1 from calendar_busy_times where calendar_id = 'team@group.calendar'`)).toEqual([]);
  });
});

describe('the three switches (AC-993, AC-1002, AC-1003)', () => {
  it('pulls a calendar that shows on the week without putting its meetings on records, and syncing them does', async () => {
    const w = await world();
    const conn = await withTeam(w);
    // Off: nothing of it is kept, and it is never read.
    expect(await linksOf(w)).toEqual([]);
    const team = await w.calendar('Team');
    // Shown: on the member's week, on no record, and no people made from it.
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true });
    await w.sync(conn.id);
    expect(await linksOf(w)).toEqual([{ title: 'Event team-sync', records: 0 }]);
    const range = { from: day(0, 0), to: day(7, 0) };
    const week = await readBookingsCalendar(w.owner, range);
    expect(week.events).toEqual([expect.objectContaining({ title: 'Event team-sync', calendarId: team.id })]);
    expect(week.busy).toEqual([expect.objectContaining({ calendarId: team.id })]);
    // Synced: its window again in full, and its meetings on the records they're with.
    const synced = await updateMemberCalendar(w.owner, { calendarId: team.id, sync: true });
    expect(synced.calendar).toMatchObject({ sync: true, showInWeek: true });
    await w.sync(conn.id);
    expect(await linksOf(w)).toEqual([{ title: 'Event team-sync', records: 1 }]);
    expect((await listMeetingsForRecord(w.owner, { recordId: w.globex })).items).toHaveLength(1);
    // Sync off while it still shows: off every record, still on the week.
    await updateMemberCalendar(w.owner, { calendarId: team.id, sync: false });
    expect(await linksOf(w)).toEqual([{ title: 'Event team-sync', records: 0 }]);
    expect((await readBookingsCalendar(w.owner, range)).events).toHaveLength(1);
    // Hidden from the week too: dropped at once, meetings, busy times and token.
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: false });
    expect(await linksOf(w)).toEqual([]);
    expect((await readBookingsCalendar(w.owner, range)).busy).toEqual([]);
    const [row] = await w.query<{ sync_state: unknown }>(
      sql`select sync_state from calendar_calendars where id = ${team.id}::uuid`,
    );
    expect(row?.sync_state).toEqual({});
    // Someone else's calendar: absent.
    expect(await refusalOf(updateMemberCalendar(w.as(w.bea), { calendarId: team.id, sync: true }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps a meeting only shown on the week off a person added from a synced one (AC-1002)', async () => {
    const w = await world();
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true });
    // The same guest on a meeting of the main calendar, which syncs.
    w.fake.put('ada@acme.dev', event('main-call', day(3), [self('ada@acme.dev'), guest('cy@globex.com')]));
    await w.sync(conn.id);
    const synced = (await listMeetingsForRecord(w.owner, { recordId: w.globex })).items;
    expect(synced.map((each) => each.title)).toEqual(['Event main-call']);
    const added = await addMeetingAttendee(
      w.owner,
      { recordId: w.globex, meetingId: synced[0]?.id ?? '', email: 'cy@globex.com' },
      { isFreeDomain: () => false },
    );
    const onPerson = (await listMeetingsForRecord(w.owner, { recordId: added.recordId })).items;
    expect(onPerson.map((each) => each.title)).toEqual(['Event main-call']);
    expect(await linksOf(w)).toEqual([
      { title: 'Event main-call', records: 2 },
      { title: 'Event team-sync', records: 0 },
    ]);
  });

  it('keeps an event two calendars hold as two copies, so one calendar letting go never drops it', async () => {
    const w = await world();
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    // The same event in the main calendar too (Google keeps one id across calendars).
    w.fake.put('ada@acme.dev', event('team-sync', day(1), [self('ada@acme.dev'), guest('cy@globex.com')]));
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true, sync: true });
    await w.sync(conn.id);
    expect(await w.query(sql`select calendar_id from meeting_sources order by calendar_id`)).toEqual([
      { calendar_id: 'ada@acme.dev' },
      { calendar_id: 'team@group.calendar' },
    ]);
    w.fake.cancel('ada@acme.dev', 'team-sync', 'team@group.calendar');
    await w.sync(conn.id);
    expect(await linksOf(w)).toEqual([{ title: 'Event team-sync', records: 1 }]);
    // Colours: the member's pick, and back to the provider's.
    expect(
      (await updateMemberCalendar(w.owner, { calendarId: team.id, colourOverride: 'purple' })).calendar,
    ).toMatchObject({
      hue: 'purple',
      colourOverride: 'purple',
    });
    const reset = await updateMemberCalendar(w.owner, { calendarId: team.id, colourOverride: null });
    expect(reset.calendar.hue).toBe('green');
    expect(reset.calendar).not.toHaveProperty('colourOverride');
  });

  it('opens a channel per pulled calendar, takes notices by either token, and stops one no longer pulled', async () => {
    const w = await world({ push: true });
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    expect(w.fake.watched().map((each) => each.calendarId)).toEqual(['ada@acme.dev']);
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true });
    await w.sync(conn.id);
    const opened = w.fake.watched().find((each) => each.calendarId === 'team@group.calendar');
    expect(opened?.token.startsWith(`${w.workspaceId}.${team.id}.`)).toBe(true);
    expect(
      await takeCalendarNotice(db, { channelId: opened?.channel.id, token: opened?.token, state: 'exists' }),
    ).toEqual({
      outcome: 'queued',
      reason: 'change',
      workspaceId: w.workspaceId,
      calendarId: team.id,
      connectionId: conn.id,
    });
    expect(
      await takeCalendarNotice(db, {
        channelId: opened?.channel.id,
        token: `${opened?.token ?? ''}x`,
        state: 'exists',
      }),
    ).toEqual({ outcome: 'refused', reason: 'mismatch' });
    // A lifecycle notice (Graph) marks the channel for renewal: the next sync opens another.
    expect(
      await takeCalendarNotice(db, {
        channelId: opened?.channel.id,
        token: opened?.token,
        state: 'reauthorizationRequired',
      }),
    ).toMatchObject({ outcome: 'queued', reason: 'renew', calendarId: team.id });
    const watches = w.fake.calls('watch');
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(watches + 1);
    // Switched off: the channel is stopped at the provider on the next sync.
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: false });
    await w.sync(conn.id);
    expect(w.fake.stopped().length).toBeGreaterThan(0);
    const [row] = await w.query<{ channel: unknown }>(
      sql`select channel from calendar_calendars where id = ${team.id}::uuid`,
    );
    expect(row?.channel).toBeNull();
  });
});

describe('Bookings’ list of every meeting (the owner’s ask of 21 October 2026)', () => {
  it('pages the reader’s calendar events by start, by calendar and by source, with attendees but not the reader', async () => {
    const w = await world();
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    await updateMemberCalendar(w.owner, { calendarId: team.id, showInWeek: true });
    w.fake.put('ada@acme.dev', event('main-a', day(3), [self('ada@acme.dev'), guest('cy@globex.com')]));
    w.fake.put('ada@acme.dev', event('main-b', day(4), [self('ada@acme.dev'), guest('di@globex.com')]));
    await w.sync(conn.id);
    const all = await listMeetings(w.owner, { when: 'upcoming' });
    const titles = (page: typeof all) =>
      page.items.map((item) => (item.kind === 'event' ? item.event.title : item.booking.pageTitle));
    expect(titles(all)).toEqual(['Event team-sync', 'Event main-a', 'Event main-b']);
    const first = all.items[1];
    expect(first?.kind === 'event' ? first.attendees : []).toEqual(['cy@globex.com']);
    expect(all.nextCursor).toBeUndefined();
    // A page at a time: each cursor picks up after the last.
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listMeetings(w.owner, {
        when: 'upcoming',
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...titles(page));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(seen).toEqual(titles(all));
    // The panel's pick, and the source.
    expect(titles(await listMeetings(w.owner, { when: 'upcoming', calendarIds: [team.id] }))).toEqual([
      'Event team-sync',
    ]);
    expect((await listMeetings(w.owner, { when: 'upcoming', source: 'bookings' })).items).toEqual([]);
    expect((await listMeetings(w.owner, { when: 'past' })).items).toEqual([]);
    // Another member reads none of Ada's events.
    expect((await listMeetings(w.as(w.bea), { when: 'upcoming' })).items).toEqual([]);
    // A cursor this read never gave is refused.
    await expect(listMeetings(w.owner, { when: 'upcoming', cursor: 'nonsense' })).rejects.toMatchObject({
      inputProblem: { field: 'cursor' },
    });
  });

  it('refuses a reader without booking.manage, and gives a key with it but no member nothing', async () => {
    const w = await world();
    const conn = await withTeam(w);
    w.fake.put('ada@acme.dev', event('main-a', day(3), [self('ada@acme.dev'), guest('cy@globex.com')]));
    await w.sync(conn.id);
    // Every member role holds booking.manage, so the reader without it is a key not given it.
    const bare = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'api_key', id: newId() }, scopes: [] });
    expect(await refusalOf(listMeetings(bare, { when: 'upcoming' }))).toMatchObject({ code: 'FORBIDDEN' });
    const key = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'api_key', id: newId() },
      scopes: ['booking.manage'],
    });
    expect(await listMeetings(key, { when: 'upcoming' })).toEqual({ items: [] });
  });

  it('refuses a member whose access lacks booking.manage, before reading anything', async () => {
    const w = await world();
    const conn = await withTeam(w);
    w.fake.put('ada@acme.dev', event('main-b', day(3), [self('ada@acme.dev'), guest('cy@globex.com')]));
    await w.sync(conn.id);
    // Every role holds booking.manage today, so the member is minted with it taken away, as a role without it would be.
    const full = roleAccess({ kind: 'member', memberId: w.ownerId, role: 'owner', teamIds: [] }, NO_RULES);
    const without = mintScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.ownerId },
      access: { ...full, permissions: full.permissions.filter((each) => each !== 'booking.manage') },
    });
    for (const when of ['upcoming', 'past', 'cancelled'] as const) {
      expect(await refusalOf(listMeetings(without, { when }))).toEqual({
        code: 'FORBIDDEN',
        message: PERMISSIONS['booking.manage'].message,
      });
    }
    // The same member with it reads their meetings.
    expect((await listMeetings(w.owner, { when: 'upcoming' })).items.length).toBeGreaterThan(0);
  });
});

describe('free and busy per calendar (AC-994, AC-995)', () => {
  it('reads every conflict calendar in one call per account, skips a slow or failing one, and closes by the rule', async () => {
    const w = await world({ timeoutMs: 200 });
    const conn = await withTeam(w);
    const work = await w.connect(w.ownerId, 'ada@work.dev');
    await w.sync(work.id);
    const team = await w.calendar('Team');
    await updateMemberCalendar(w.owner, { calendarId: team.id, checkConflicts: true });
    w.fake.put('ada@acme.dev', event('main', day(3), []));
    w.fake.put('ada@work.dev', event('work', day(4), []));
    const ask = { memberIds: [w.ownerId], from: day(0, 0), to: day(7, 0) };
    const [read] = await w.events.freeBusy(w.system, ask, { fresh: true });
    expect(read).toMatchObject({ status: 'read' });
    expect(read?.status === 'read' ? read.busy.map((each) => each.start) : []).toEqual([
      day(1),
      day(2),
      day(3),
      day(4),
    ]);
    // One request per account, each with its conflict calendars.
    expect(
      w.fake
        .freeBusyAsked()
        .slice(-2)
        .map((ids) => [...ids].sort()),
    ).toEqual(expect.arrayContaining([['ada@acme.dev', 'team@group.calendar'], ['ada@work.dev']]));
    // The work account doesn't answer in time: skipped, the rest still answer, and its member is told.
    w.fake.slowFreeBusy('ada@work.dev', 1_000);
    const [slow] = await w.events.freeBusy(w.system, ask, { fresh: true });
    expect(slow).toMatchObject({ status: 'read', skipped: [{ code: 'CALENDAR_UNAVAILABLE', reason: 'unavailable' }] });
    const warned = await w.calendar('ada@work.dev');
    expect(warned.warning).toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
    // Every conflict calendar failing: closed.
    w.fake.failFreeBusy('ada@acme.dev', 'CALENDAR_UNAVAILABLE');
    expect((await w.events.freeBusy(w.system, ask, { fresh: true }))[0]).toMatchObject({ status: 'blocked' });
    // Healed: answered again, and the warning goes.
    w.fake.slowFreeBusy('ada@work.dev', undefined);
    w.fake.failFreeBusy('ada@acme.dev', undefined);
    expect((await w.events.freeBusy(w.system, ask, { fresh: true }))[0]).toMatchObject({ status: 'read' });
    expect((await w.calendar('ada@work.dev')).warning).toBeUndefined();
    // The destination's grant revoked: closed, whatever the other account says.
    await w.query(sql`update calendar_connections set status = 'expired' where id = ${conn.id}::uuid`);
    expect((await w.events.freeBusy(w.system, ask, { fresh: true }))[0]).toMatchObject({ status: 'blocked' });
  });
});

describe('where bookings go (AC-996 to AC-998, AC-1004, AC-1005)', () => {
  it('puts one event on the calendar the member picked (New meeting), never on one they can only read', async () => {
    const w = await world();
    await withTeam(w);
    const main = await w.calendar('ada@acme.dev');
    const team = await w.calendar('Team');
    const holidays = await w.calendar('Holidays');
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' });
    await setPageDestination(w.owner, { pageId: page.id, calendarId: team.id });
    const input = {
      memberId: w.ownerId,
      title: 'Intro',
      start: day(5, 10),
      end: day(5, 11),
      attendees: [{ email: 'cy@globex.com' }],
      timeZone: 'UTC',
      video: false,
      pageId: page.id,
    };
    // The pick wins over the page's own calendar.
    const picked = await w.events.createEvent(w.system, { ...input, requestId: newId(), calendarId: main.id });
    expect(picked.calendarId).toBe(main.id);
    // One they can only read is passed over: the page's own takes it, as with no pick.
    const readOnly = await w.events.createEvent(w.system, { ...input, requestId: newId(), calendarId: holidays.id });
    expect(readOnly.calendarId).toBe(team.id);
    expect(w.fake.createdIn().slice(-2)).toEqual(['ada@acme.dev', 'team@group.calendar']);
  });

  it('writes to the destination or the page’s own, moves in the calendar it made the event in, and falls back', async () => {
    const w = await world();
    await withTeam(w);
    const main = await w.calendar('ada@acme.dev');
    const team = await w.calendar('Team');
    const holidays = await w.calendar('Holidays');
    expect(await refusalOf(setCalendarDestination(w.owner, { calendarId: holidays.id }))).toMatchObject({
      code: 'CALENDAR_NOT_WRITABLE',
    });
    expect(await refusalOf(setCalendarDestination(w.as(w.bea), { calendarId: team.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const input = {
      memberId: w.ownerId,
      title: 'Intro',
      start: day(5, 10),
      end: day(5, 11),
      attendees: [{ email: 'cy@globex.com' }],
      timeZone: 'UTC',
      video: true,
    };
    const first = await w.events.createEvent(w.system, { ...input, requestId: newId() });
    expect(first.calendarId).toBe(main.id);
    // A page's own calendar wins for its bookings.
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' });
    expect(await readPageDestination(w.owner, { pageId: page.id })).toEqual({ status: 'default', isOwner: true });
    expect(await refusalOf(setPageDestination(w.owner, { pageId: page.id, calendarId: holidays.id }))).toMatchObject({
      code: 'CALENDAR_NOT_WRITABLE',
    });
    expect(await setPageDestination(w.owner, { pageId: page.id, calendarId: team.id })).toEqual({
      calendarId: team.id,
      status: 'page',
      isOwner: true,
    });
    const onPage = await w.events.createEvent(w.system, { ...input, requestId: newId(), pageId: page.id });
    expect(onPage.calendarId).toBe(team.id);
    expect(w.fake.createdIn().slice(-2)).toEqual(['ada@acme.dev', 'team@group.calendar']);
    // The destination changes: a move still acts in the calendar the event was made in.
    await setCalendarDestination(w.owner, { calendarId: team.id });
    await w.events.moveEvent(w.system, {
      meetingId: first.meetingId ?? '',
      start: day(6, 10),
      end: day(6, 11),
      timeZone: 'UTC',
    });
    expect(w.fake.calls('updateEvent')).toBe(1);
    const [source] = await w.query<{ calendar_id: string }>(
      sql`select calendar_id from meeting_sources where meeting_id = ${first.meetingId ?? ''}::uuid and created_by_crm`,
    );
    expect(source?.calendar_id).toBe('ada@acme.dev');
    // The provider removes the destination: the main calendar takes bookings again, the member is told, and the
    // page's own choice goes with the calendar.
    w.fake.removeCalendar('ada@acme.dev', 'team@group.calendar');
    const conn = (await listMemberCalendars(w.owner)).accounts[0]?.id ?? '';
    await refreshCalendarConnection(w.owner, { connectionId: conn });
    await w.sync(conn);
    const list = await listMemberCalendars(w.owner);
    expect(list.destinationId).toBe(main.id);
    expect(list.fellBack).toEqual({ removedName: 'Team' });
    // The page falls back too, and its owner is told which calendar went.
    expect(await readPageDestination(w.owner, { pageId: page.id })).toEqual({
      status: 'unusable',
      isOwner: true,
      removedName: 'Team',
    });
    expect(await dismissCalendarNotice(w.owner)).toEqual({ destinationId: main.id });
    expect((await listMemberCalendars(w.owner)).fellBack).toBeUndefined();
  });

  it('falls back from a page calendar that stopped or went, for free and busy and for new bookings', async () => {
    const w = await world();
    const first = await w.connect(w.ownerId, 'ada@acme.dev');
    const work = await w.connect(w.ownerId, 'ada@work.dev');
    await w.sync(first.id);
    await w.sync(work.id);
    const main = await w.calendar('ada@acme.dev');
    const workMain = await w.calendar('ada@work.dev');
    // The member's default stays on the first account; this page's bookings go on the work account.
    expect((await listMemberCalendars(w.owner)).destinationId).toBe(main.id);
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' });
    await setPageDestination(w.owner, { pageId: page.id, calendarId: workMain.id });
    const input = {
      memberId: w.ownerId,
      title: 'Intro',
      start: day(5, 10),
      end: day(5, 11),
      attendees: [{ email: 'cy@globex.com' }],
      timeZone: 'UTC',
      video: false,
      pageId: page.id,
    };
    expect((await w.events.createEvent(w.system, { ...input, requestId: newId() })).calendarId).toBe(workMain.id);
    // The work account's grant is revoked: the page reads unusable but keeps its pick, new bookings go on the
    // default, and free and busy still reads the member (the page's calendar never closes them).
    await w.query(sql`update calendar_connections set status = 'revoked' where id = ${work.id}::uuid`);
    expect(await readPageDestination(w.owner, { pageId: page.id })).toEqual({
      calendarId: workMain.id,
      status: 'unusable',
      isOwner: true,
    });
    expect((await w.events.createEvent(w.system, { ...input, requestId: newId() })).calendarId).toBe(main.id);
    const [busy] = await w.events.freeBusy(
      w.system,
      { memberIds: [w.ownerId], from: day(0, 0), to: day(7, 0) },
      { fresh: true },
    );
    expect(busy?.status).toBe('read');
    // The account is disconnected: its calendars go, the page still falls back, and its owner reads which one went.
    await removeCalendarConnection(w.owner, { connectionId: work.id });
    expect(await readPageDestination(w.owner, { pageId: page.id })).toEqual({
      status: 'unusable',
      isOwner: true,
      removedName: 'ada@work.dev',
    });
    expect((await w.events.createEvent(w.system, { ...input, requestId: newId() })).calendarId).toBe(main.id);
    // An admin changing the page learns it fell back, never the calendar's name (spec 0037).
    const admin = rescope(w.owner, { actor: { type: 'member', id: w.bea }, role: 'admin' });
    expect(await readPageDestination(admin, { pageId: page.id })).toEqual({ status: 'unusable', isOwner: false });
    // Setting the page again clears the notice.
    expect(await setPageDestination(w.owner, { pageId: page.id, calendarId: null })).toEqual({
      status: 'default',
      isOwner: true,
    });
  });

  it('answers another member’s page by id only, and refuses a calendar that isn’t its owner’s', async () => {
    const w = await world();
    await withTeam(w);
    await w.connect(w.bea, 'bea@acme.dev');
    const beas = await w.calendar('bea@acme.dev', w.bea);
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro', timeZone: 'UTC' });
    expect(await refusalOf(setPageDestination(w.owner, { pageId: page.id, calendarId: beas.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Bea (a member) can't reach Ada's page at all.
    expect(await refusalOf(readPageDestination(w.as(w.bea), { pageId: page.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moves the destination to the default connection when its account is disconnected', async () => {
    const w = await world();
    const first = await w.connect(w.ownerId, 'ada@acme.dev');
    const work = await w.connect(w.ownerId, 'ada@work.dev');
    await updateCalendarConnection(w.owner, { connectionId: work.id, isDefault: true });
    expect((await listMemberCalendars(w.owner)).destinationId).toBe((await w.calendar('ada@work.dev')).id);
    await removeCalendarConnection(w.owner, { connectionId: work.id });
    const after = await listMemberCalendars(w.owner);
    expect(after.destinationId).toBe((await w.calendar('ada@acme.dev')).id);
    // The member is told which calendar it moved from.
    expect(after.fellBack).toEqual({ removedName: 'ada@work.dev' });
    expect(first.id).toBeDefined();
  });

  it('keeps the first account’s main calendar the default when a second connects, and moves it when that stops', async () => {
    const w = await world();
    const first = await w.connect(w.ownerId, 'ada@acme.dev');
    const main = await w.calendar('ada@acme.dev');
    expect((await listMemberCalendars(w.owner)).destinationId).toBe(main.id);
    // A second account never changes it.
    await w.connect(w.ownerId, 'ada@work.dev');
    const work = await w.calendar('ada@work.dev');
    const both = await listMemberCalendars(w.owner);
    expect(both.destinationId).toBe(main.id);
    expect(both.accounts.flatMap((each) => each.calendars).filter((each) => each.isDestination)).toHaveLength(1);
    expect(both.fellBack).toBeUndefined();
    // The first account's grant revoked at its next refresh: bookings go to the second account's main calendar,
    // and the member is told which calendar they moved from.
    await db.withWorkspace(w.workspaceId, async (tx) => {
      const { sealTokens } = await import('./tokens.ts');
      const old = w.fake.tokensFor('ada@acme.dev', new Date(Date.now() - 1000).toISOString());
      await tx.execute(
        sql`update calendar_connections set tokens = ${sealTokens(tokenKey, old, {
          workspaceId: w.workspaceId,
          memberId: w.ownerId,
          provider: 'google',
          accountEmail: 'ada@acme.dev',
        })} where id = ${first.id}::uuid`,
      );
    });
    w.fake.revoke('ada@acme.dev');
    expect(await w.sync(first.id)).toEqual({ kind: 'stopped', reason: 'expired' });
    const moved = await listMemberCalendars(w.owner);
    expect(moved.destinationId).toBe(work.id);
    expect(moved.fellBack).toEqual({ removedName: 'ada@acme.dev' });
    // Make default moves it back by hand, and the notice goes.
    await setCalendarDestination(w.owner, { calendarId: work.id });
    expect((await listMemberCalendars(w.owner)).fellBack).toBeUndefined();
  });

  it('leaves the destination where it is when the only account stops', async () => {
    const w = await world();
    const only = await w.connect(w.ownerId, 'ada@acme.dev');
    const main = await w.calendar('ada@acme.dev');
    await w.query(sql`update calendar_connections set status = 'expired' where id = ${only.id}::uuid`);
    await db.withWorkspace(w.workspaceId, async (tx) => moveDestinationOff(tx, only.id));
    expect((await listMemberCalendars(w.owner)).destinationId).toBe(main.id);
  });
});

describe('privacy and health for a team (AC-999, spec 0037 AC-1307)', () => {
  it('shows a private event in a secondary calendar to colleagues as private, never its details', async () => {
    const w = await world();
    const conn = await withTeam(w);
    w.fake.put(
      'ada@acme.dev',
      event('therapy', day(3), [self('ada@acme.dev'), guest('dee@globex.com')], { isPrivate: true, title: 'Therapy' }),
      'team@group.calendar',
    );
    const team = await w.calendar('Team');
    await updateMemberCalendar(w.owner, { calendarId: team.id, sync: true });
    await w.sync(conn.id);
    const asBea = await listMeetingsForRecord(w.as(w.bea), { recordId: w.globex });
    const hidden = asBea.items.find((each) => each.detailsHidden);
    expect(hidden).toMatchObject({ title: 'Private meeting', attendees: [] });
    expect(JSON.stringify(asBea)).not.toContain('Therapy');
    expect(JSON.stringify(asBea)).not.toContain('Team');
    const asAda = await listMeetingsForRecord(w.owner, { recordId: w.globex });
    expect(asAda.items.map((each) => each.title)).toContain('Therapy');
  });

  it('folds each member to one status, leaves out members outside the reach, and names nothing', async () => {
    const w = await world({ timeoutMs: 200 });
    const conn = await withTeam(w);
    const team = await w.calendar('Team');
    const cy = newId();
    await w.query(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${cy}, 'Cy', 'cy@acme.dev', 'member', 'system', 'system')`,
    );
    const ask = { memberIds: [w.ownerId, w.bea, cy, newId()] };
    expect(await readCalendarHealth(w.owner, ask)).toEqual([
      { memberId: w.ownerId, status: 'connected' },
      { memberId: w.bea, status: 'none' },
      { memberId: cy, status: 'none' },
    ]);
    // A member reads only their own.
    expect(await readCalendarHealth(w.as(w.bea), ask)).toEqual([{ memberId: w.bea, status: 'none' }]);
    // A secondary conflict calendar failing: some skipped.
    await updateMemberCalendar(w.owner, { calendarId: team.id, checkConflicts: true });
    w.fake.failFreeBusy('ada@acme.dev', 'CALENDAR_UNAVAILABLE', 'team@group.calendar');
    await w.events.freeBusy(w.system, { memberIds: [w.ownerId], from: day(0, 0), to: day(7, 0) }, { fresh: true });
    const [skipped] = await readCalendarHealth(w.owner, { memberIds: [w.ownerId] });
    expect(skipped).toMatchObject({ status: 'skipped', since: expect.any(String) as unknown });
    expect(JSON.stringify(skipped)).not.toMatch(/Team|acme\.dev|couldn/);
    // The destination's account stopped: reconnect needed.
    await w.query(
      sql`update calendar_connections set status = 'expired', failing_since = now() where id = ${conn.id}::uuid`,
    );
    expect(await readCalendarHealth(w.owner, { memberIds: [w.ownerId] })).toEqual([
      { memberId: w.ownerId, status: 'reconnect', since: expect.any(String) as unknown },
    ]);
  });
});
