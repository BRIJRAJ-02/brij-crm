// Spec 0024, milestones 2 and 3, against a real Postgres as the app role and
// the fake provider: busy times (the owner's call, 20 October 2026), the
// `failed` rule and its healing, push channels and their notices (with what
// each channel and notice did, for the log), a deleted workspace's channels
// ended at the provider (spec 0031, AC-823), Add as person and the workspace
// setting that makes people by itself, and free and busy with the event writes.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { connectedCalendar } from '../booking/connected.ts';
import { bookAsHost } from '../booking/host.ts';
import { listMeetings, readBookingsCalendar } from '../booking/list.ts';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { readTeamToday } from '../home/team-today.ts';
import { rescope, testScope } from '../testing.ts';
import { deleteWorkspace, restoreWorkspace } from '../workspace/settings.ts';
import { updateMemberCalendar } from './calendars.ts';
import { connectCalendar, listCalendarConnections, syncCalendarNow, updateCalendarConnection } from './connections.ts';
import { createCalendarEvents } from './events.ts';
import { createFakeCalendarProvider } from './fake.ts';
import { listMeetingsForRecord } from './meetings.ts';
import { addMeetingAttendee, readCalendarSettings, updateCalendarSettings } from './people.ts';
import type { ProviderAttendee, ProviderEvent } from './provider.ts';
import { openChannel, takeCalendarNotice } from './push.ts';
import { syncConnection, type CalendarSyncDeps } from './sync.ts';
import { decodeTokenKey, sealTokens } from './tokens.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-calendar-milestones-tests' });
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

let count = 0;
async function world(options: { readonly push?: boolean } = {}) {
  count += 1;
  const slug = `calendar-two-${String(count)}-${String(Date.now())}`;
  const created = await createWorkspace(db, {
    name: 'Calendar two',
    slug,
    firstMember: { name: 'Ada', email: 'ada@acme.dev' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(owner.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => ids[slug] ?? '';
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${bea}, 'Bea', 'bea@acme.dev', 'member', 'system', 'system')`,
    ),
  );
  const company = async (name: string, domains: readonly string[]) =>
    (
      await createRecord(owner, {
        objectId: created.objects.companies ?? '',
        values: { [attribute('companies.name')]: name, [attribute('companies.domains')]: [...domains] },
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
  });
  return {
    ...created,
    slug,
    owner,
    ownerId: created.memberId,
    bea,
    attribute,
    company,
    as,
    fake,
    connect,
    sync,
    query,
    events,
    system: systemScope(db, created.workspaceId),
  };
}

const self = (email: string): ProviderAttendee => ({ email, response: 'accepted', isOrganizer: true, isSelf: true });
const guest = (email: string, name?: string): ProviderAttendee => ({
  email,
  response: 'accepted',
  isOrganizer: false,
  isSelf: false,
  ...(name === undefined ? {} : { name }),
});

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

type World = Awaited<ReturnType<typeof world>>;
const busyOf = (w: World) =>
  w.query<{ event: string; starts_at: string }>(
    sql`select provider_event_id as event, to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at from calendar_busy_times order by 1`,
  );
const meetingIds = (w: World) => w.query<{ ical_uid: string }>(sql`select ical_uid from meetings order by ical_uid`);
const statusOf = async (w: World) =>
  (await w.query<{ status: string }>(sql`select status::text as status from calendar_connections`))[0]?.status;

describe('busy times (the owner’s call, 20 October 2026)', () => {
  it('keeps an event with nobody else as busy time, never a meeting, and moves it as it changes', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    const solo = event('solo', day(2), [self('ada@acme.dev')], { title: 'Dentist' });
    const lone = event('lone', day(3), []);
    w.fake.put('ada@acme.dev', solo);
    w.fake.put('ada@acme.dev', lone);
    // Shown as free, all day, or declined: no busy time.
    w.fake.put('ada@acme.dev', event('free', day(2, 12), [], { isFree: true }));
    w.fake.put(
      'ada@acme.dev',
      event('allday', day(4), [], {
        start: { at: day(4, 0), allDay: true },
        end: { at: day(5, 0), allDay: true },
      }),
    );
    w.fake.put(
      'ada@acme.dev',
      event('declined', day(4, 14), [{ ...self('ada@acme.dev'), isOrganizer: false, response: 'declined' }]),
    );
    await w.sync(conn.id);
    expect((await busyOf(w)).map((row) => row.event)).toEqual(['lone', 'solo']);
    expect(await meetingIds(w)).toEqual([]);
    // Nothing of the event but its time is kept.
    const [kept] = await w.query<Record<string, unknown>>(sql`select * from calendar_busy_times limit 1`);
    expect(Object.keys(kept ?? {}).sort()).toEqual([
      'calendar_id',
      'connection_id',
      'ends_at',
      'provider_event_id',
      'starts_at',
      'updated_at',
      'workspace_id',
    ]);

    // Someone invited: a meeting now, no longer busy time; moved and cancelled ones follow.
    w.fake.put('ada@acme.dev', { ...solo, attendees: [self('ada@acme.dev'), guest('cy@northwind.com')] });
    w.fake.put('ada@acme.dev', {
      ...lone,
      start: { at: day(5), allDay: false },
      end: { at: plus(day(5), 45), allDay: false },
    });
    await w.sync(conn.id);
    expect(await busyOf(w)).toEqual([{ event: 'lone', starts_at: new Date(day(5)).toISOString() }]);
    expect(await meetingIds(w)).toEqual([{ ical_uid: 'solo@google.com' }]);
    w.fake.cancel('ada@acme.dev', 'lone');
    await w.sync(conn.id);
    expect(await busyOf(w)).toEqual([]);
  });

  it('drops busy times a full sync no longer lists, and shows the reader only their own on the week', async () => {
    const w = await world();
    const mine = await w.connect(w.ownerId, 'ada@acme.dev');
    const beas = await w.connect(w.bea, 'bea@acme.dev');
    w.fake.put('ada@acme.dev', event('a1', day(1), []));
    w.fake.put('ada@acme.dev', event('a2', day(2), []));
    w.fake.put('bea@acme.dev', event('b1', day(1, 13), []));
    await w.sync(mine.id);
    await w.sync(beas.id);
    const range = { from: day(0, 0), to: day(7, 0) };
    const week = await readBookingsCalendar(w.owner, range);
    const [main] = await w.query<{ id: string }>(
      sql`select id::text as id from calendar_calendars where connection_id = ${mine.id}::uuid and is_primary`,
    );
    expect(week.busy).toEqual([
      {
        connectionId: mine.id,
        calendarId: main?.id,
        startsAt: new Date(day(1)).toISOString(),
        endsAt: plus(day(1), 30),
      },
      {
        connectionId: mine.id,
        calendarId: main?.id,
        startsAt: new Date(day(2)).toISOString(),
        endsAt: plus(day(2), 30),
      },
    ]);
    expect((await readBookingsCalendar(w.as(w.bea), range)).busy.map((each) => each.connectionId)).toEqual([beas.id]);
    // A token the provider no longer honours: the full sync drops what it no longer lists.
    w.fake.cancel('ada@acme.dev', 'a2');
    w.fake.expireSyncToken('ada@acme.dev');
    await w.sync(mine.id);
    expect((await readBookingsCalendar(w.owner, range)).busy).toHaveLength(1);
    // Busy times go with their connection.
    await w.query(sql`delete from calendar_connections where id = ${mine.id}::uuid`);
    expect((await readBookingsCalendar(w.owner, range)).busy).toEqual([]);
  });
});

describe('health (AC-619, AC-620)', () => {
  it('marks a connection failed after 6 hours of failures, keeps trying, and heals on the next sync', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    w.fake.failNext('listChanges', 'CALENDAR_UNAVAILABLE');
    expect(await w.sync(conn.id)).toMatchObject({ kind: 'retry', code: 'CALENDAR_UNAVAILABLE' });
    expect(await statusOf(w)).toBe('connected');
    // Failing for longer than 6 hours.
    await testQuery(
      ownerUrl,
      `update calendar_connections set failing_since = now() - interval '7 hours' where id = $1`,
      [conn.id],
    );
    w.fake.failNext('listChanges', 'CALENDAR_UNAVAILABLE');
    expect(await w.sync(conn.id)).toMatchObject({ kind: 'retry' });
    expect(await statusOf(w)).toBe('failed');
    const [view] = await listCalendarConnections(w.owner);
    expect(view).toMatchObject({ status: 'failed', lastError: { code: 'CALENDAR_UNAVAILABLE' } });
    // Still tried: the next success is connected again, the error cleared.
    expect(await w.sync(conn.id)).toMatchObject({ kind: 'synced' });
    const [healed] = await listCalendarConnections(w.owner);
    expect(healed?.status).toBe('connected');
    expect(healed).not.toHaveProperty('lastError');
  });
});

describe('push channels (AC-602, AC-622)', () => {
  it('opens a channel after a sync, keeps it, and renews it before it runs out', async () => {
    const w = await world({ push: true });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(1);
    const [opened] = w.fake.watched();
    expect(opened?.address).toBe(PUSH);
    const [stored] = await w.query<{ id: string; channel: Record<string, unknown> }>(
      sql`select id::text as id, channel from calendar_calendars where is_primary`,
    );
    // Milestone 5: a channel per calendar, its token naming the calendar (AC-1003).
    expect(opened?.token.startsWith(`${w.workspaceId}.${stored?.id ?? '-'}.`)).toBe(true);
    expect(stored?.channel).toMatchObject({ id: opened?.channel.id, resourceId: 'fake-resource:ada@acme.dev' });
    // Only a hash of the secret is kept.
    expect(JSON.stringify(stored?.channel)).not.toContain(opened?.token.split('.')[2] ?? '-');
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(1);
    // Within 48 hours of its end: a new one, and the old one stopped.
    await w.query(
      sql`update calendar_calendars set channel = jsonb_set(channel, '{expiresAt}', to_jsonb((now() + interval '1 day')::text))`,
    );
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(2);
    expect(w.fake.calls('stopWatch')).toBe(1);
  });

  it('opens none without a push address, and a failed watch never fails the sync', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(0);
    const pushed = await world({ push: true });
    const other = await pushed.connect(pushed.ownerId, 'ada@acme.dev');
    pushed.fake.failNext('watch', 'CALENDAR_UNAVAILABLE');
    expect(await pushed.sync(other.id)).toMatchObject({ kind: 'synced' });
    const [stored] = await pushed.query<{ channel: unknown }>(sql`select channel from calendar_calendars`);
    expect(stored?.channel).toBeNull();
  });

  it('queues a sync for a notice with the channel’s id and token, and nothing for any other', async () => {
    const w = await world({ push: true });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    const [opened] = w.fake.watched();
    const token = opened?.token ?? '';
    const channelId = opened?.channel.id ?? '';
    const key = `crm-calendar:${w.workspaceId}:${conn.id}`;
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [key]);
    const queued = () =>
      testQuery<{ key: string }>(ownerUrl, `select key from graphile_worker.jobs where key = $1`, [key]);
    const [calendar] = await w.query<{ id: string }>(sql`select id::text as id from calendar_calendars`);
    const matched = { workspaceId: w.workspaceId, calendarId: calendar?.id, connectionId: conn.id };
    expect(await takeCalendarNotice(db, { channelId, token, state: 'sync' })).toEqual({
      ...matched,
      outcome: 'ignored',
      reason: 'handshake',
    });
    expect(await takeCalendarNotice(db, { channelId: 'other', token, state: 'exists' })).toEqual({
      outcome: 'refused',
      reason: 'mismatch',
    });
    expect(await takeCalendarNotice(db, { channelId, token: `${token}x`, state: 'exists' })).toEqual({
      outcome: 'refused',
      reason: 'mismatch',
    });
    expect(await takeCalendarNotice(db, { channelId, token: 'not.a.token', state: 'exists' })).toEqual({
      outcome: 'refused',
      reason: 'malformed',
    });
    expect(await takeCalendarNotice(db, { channelId, token: undefined, state: 'exists' })).toEqual({
      outcome: 'refused',
      reason: 'malformed',
    });
    expect(await queued()).toEqual([]);
    expect(await takeCalendarNotice(db, { channelId, token, state: 'exists' })).toEqual({
      ...matched,
      outcome: 'queued',
      reason: 'change',
    });
    expect(await queued()).toHaveLength(1);
    // Sync now (the member's own connection) moves the same keyed row: still one waiting sync.
    expect(await syncCalendarNow(w.owner, { connectionId: conn.id })).toEqual({ queued: true });
    expect(await queued()).toHaveLength(1);
    // Another workspace's ids with this secret find nothing.
    const other = await world({ push: true });
    const forged = token.replace(w.workspaceId, other.workspaceId);
    expect(await takeCalendarNotice(db, { channelId, token: forged, state: 'exists' })).toEqual({
      outcome: 'refused',
      reason: 'unknown',
    });
    // An account that no longer syncs is matched, and asks for nothing.
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [key]);
    await testQuery(ownerUrl, `update calendar_connections set status = 'expired' where id = $1`, [conn.id]);
    expect(await takeCalendarNotice(db, { channelId, token, state: 'exists' })).toEqual({
      ...matched,
      outcome: 'ignored',
      reason: 'not-syncing',
    });
    expect(await queued()).toEqual([]);
  });

  it('says what became of each channel: opened, renewed, refused with the provider’s code, dropped and stopped', async () => {
    const w = await world({ push: true });
    w.fake.addCalendar('ada@acme.dev', { id: 'team@acme.dev', name: 'Team', accessRole: 'writer' });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    const first = await w.sync(conn.id);
    const calendars = await w.query<{ id: string; provider_calendar_id: string }>(
      sql`select id::text as id, provider_calendar_id from calendar_calendars order by is_primary desc`,
    );
    const main = calendars[0]?.id ?? '';
    const team = calendars.find((each) => each.provider_calendar_id === 'team@acme.dev')?.id ?? '';
    const [opened] = w.fake.watched();
    expect(first.channels).toEqual([
      { calendarId: main, outcome: 'opened', expiresAt: opened?.channel.expiresAt, renewed: false },
    ]);
    // Nothing to do while it lasts: no report at all.
    expect((await w.sync(conn.id)).channels).toBeUndefined();
    // About to run out: a new one takes over.
    await w.query(
      sql`update calendar_calendars set channel = jsonb_set(channel, '{expiresAt}', to_jsonb((now() + interval '1 day')::text)) where id = ${main}::uuid`,
    );
    expect((await w.sync(conn.id)).channels).toEqual([
      { calendarId: main, outcome: 'opened', expiresAt: w.fake.watched()[1]?.channel.expiresAt, renewed: true },
    ]);
    // The provider refuses a calendar it can't watch: the code, its status and its reason, never its words.
    await updateMemberCalendar(w.owner, { calendarId: team, showInWeek: true });
    w.fake.failNext('watch', 'CALENDAR_UNAVAILABLE', 1, {
      status: 400,
      reason: 'pushNotSupportedForRequestedResource',
    });
    const refused = await w.sync(conn.id);
    expect(refused).toMatchObject({ kind: 'synced' });
    expect(refused.channels).toEqual([
      {
        calendarId: team,
        outcome: 'failed',
        code: 'CALENDAR_UNAVAILABLE',
        status: 400,
        reason: 'pushNotSupportedForRequestedResource',
      },
    ]);
    // The next run tries again, and opens it.
    expect((await w.sync(conn.id)).channels).toMatchObject([{ calendarId: team, outcome: 'opened' }]);
    // Switched off: its channel ends at the provider.
    await updateMemberCalendar(w.owner, { calendarId: team, showInWeek: false });
    const teamChannel = w.fake.watched().at(-1)?.channel.id;
    expect((await w.sync(conn.id)).channels).toEqual([{ calendarId: team, outcome: 'stopped', why: 'not-pulled' }]);
    expect(w.fake.stopped()).toContain(teamChannel);
    // Opened while the calendar was switched off (or its workspace deleted): stopped at once, never stored.
    const tokens = w.fake.tokensFor('ada@acme.dev');
    const dropped = await openChannel(w.system, {
      provider: w.fake.provider,
      tokens,
      calendarRowId: team,
      calendarId: 'team@acme.dev',
      address: PUSH,
      previous: undefined,
    });
    expect(dropped).toEqual({ calendarId: team, outcome: 'dropped' });
    expect(w.fake.stopped()).toContain(w.fake.watched().at(-1)?.channel.id);
    const [teamRow] = await w.query<{ channel: unknown }>(
      sql`select channel from calendar_calendars where id = ${team}::uuid`,
    );
    expect(teamRow?.channel).toBeNull();
  });
});

describe('a calendar a run couldn’t read (owner ask A115)', () => {
  it('names it with the provider’s code and status while the account still syncs', async () => {
    const w = await world();
    w.fake.addCalendar('ada@acme.dev', { id: 'team@acme.dev', name: 'Team', accessRole: 'writer' });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    const [main] = await w.query<{ id: string }>(sql`select id::text as id from calendar_calendars where is_primary`);
    const [team] = await w.query<{ id: string }>(
      sql`select id::text as id from calendar_calendars where provider_calendar_id = 'team@acme.dev'`,
    );
    await updateMemberCalendar(w.owner, { calendarId: team?.id ?? '', showInWeek: true });
    // The main calendar is read first, and Google doesn't answer for it this once.
    w.fake.failNext('listChanges', 'CALENDAR_UNAVAILABLE', 1, { status: 503 });
    const outcome = await w.sync(conn.id);
    expect(outcome).toMatchObject({ kind: 'synced' });
    expect(outcome.failedCalendars).toEqual([{ calendarId: main?.id, code: 'CALENDAR_UNAVAILABLE', status: 503 }]);
    // Read again on the next run: nothing to name.
    expect((await w.sync(conn.id)).failedCalendars).toBeUndefined();
  });
});

describe('a deleted workspace’s calendars (spec 0031, AC-823)', () => {
  const channelOf = async (w: World) =>
    (
      await w.query<{ channel: { id?: string } | null }>(sql`select channel from calendar_calendars where is_primary`)
    )[0]?.channel ?? null;
  const mainOf = async (w: World) =>
    (await w.query<{ id: string }>(sql`select id::text as id from calendar_calendars where is_primary`))[0]?.id;
  const jobsOf = (connectionId: string) =>
    testQuery<{ run_at: Date }>(
      ownerUrl,
      `select run_at from graphile_worker._private_jobs where payload->>'connectionId' = $1`,
      [connectionId],
    );

  it('ends its channels at the provider on the deletion’s run, syncs nothing, and opens new ones after a restore', async () => {
    const w = await world({ push: true });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    const opened = w.fake.watched()[0];
    expect((await channelOf(w))?.id).toBe(opened?.channel.id);
    const key = `crm-calendar:${w.workspaceId}:${conn.id}`;
    // The poll's row waits 15 minutes on: the deletion brings it forward to now, in its own transaction.
    await testQuery(
      ownerUrl,
      `update graphile_worker._private_jobs set run_at = now() + interval '15 minutes' where key = $1`,
      [key],
    );
    await deleteWorkspace(w.owner, { confirmName: 'Calendar two' });
    const [job] = await jobsOf(conn.id);
    expect(job?.run_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    const listed = w.fake.calls('listChanges');
    const ended = await w.sync(conn.id);
    expect(ended).toEqual({
      kind: 'stopped',
      reason: 'workspace-deleted',
      channels: [{ calendarId: await mainOf(w), outcome: 'stopped', why: 'workspace-deleted' }],
    });
    expect(w.fake.stopped()).toEqual([opened?.channel.id]);
    expect(w.fake.calls('listChanges')).toBe(listed);
    expect(await channelOf(w)).toBeNull();
    // A run that began before the deletion and opens a channel after it: the channel is stopped at once, never kept.
    const late = await openChannel(w.system, {
      provider: w.fake.provider,
      tokens: w.fake.tokensFor('ada@acme.dev'),
      calendarRowId: (await mainOf(w)) ?? '',
      calendarId: 'ada@acme.dev',
      address: PUSH,
      previous: undefined,
    });
    expect(late).toEqual({ calendarId: await mainOf(w), outcome: 'dropped' });
    expect(w.fake.stopped()).toEqual([opened?.channel.id, w.fake.watched().at(-1)?.channel.id]);
    expect(await channelOf(w)).toBeNull();
    // A notice from that channel now names nothing; a run again has nothing to end.
    expect(
      await takeCalendarNotice(db, { channelId: opened?.channel.id, token: opened?.token, state: 'exists' }),
    ).toEqual({ outcome: 'refused', reason: 'unknown' });
    expect(await w.sync(conn.id)).toEqual({ kind: 'stopped', reason: 'workspace-deleted' });
    // Restored: its accounts sync again, and open new channels.
    await restoreWorkspace(w.owner);
    expect(await jobsOf(conn.id)).toHaveLength(1);
    expect((await w.sync(conn.id)).channels).toMatchObject([{ outcome: 'opened', renewed: false }]);
    expect(await channelOf(w)).not.toBeNull();
  });

  it('keeps a channel the provider couldn’t end for now, so its next notice queues the stop again', async () => {
    const w = await world({ push: true });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(conn.id);
    const opened = w.fake.watched()[0];
    await deleteWorkspace(w.owner, { confirmName: 'Calendar two' });
    w.fake.failNext('stopWatch', 'CALENDAR_UNAVAILABLE');
    expect((await w.sync(conn.id)).channels).toEqual([
      {
        calendarId: await mainOf(w),
        outcome: 'unstopped',
        why: 'workspace-deleted',
        code: 'CALENDAR_UNAVAILABLE',
      },
    ]);
    expect((await channelOf(w))?.id).toBe(opened?.channel.id);
    // The provider still posts: the notice queues the run that ends it, never a sync.
    const key = `crm-calendar:${w.workspaceId}:${conn.id}`;
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [key]);
    expect(
      await takeCalendarNotice(db, { channelId: opened?.channel.id, token: opened?.token, state: 'exists' }),
    ).toMatchObject({ outcome: 'queued', reason: 'stop', connectionId: conn.id });
    expect(await jobsOf(conn.id)).toHaveLength(1);
    expect((await w.sync(conn.id)).channels).toMatchObject([{ outcome: 'stopped', why: 'workspace-deleted' }]);
    expect(w.fake.stopped()).toEqual([opened?.channel.id]);
    expect(await channelOf(w)).toBeNull();
    // A grant the provider refuses can never end one: it is forgotten, and runs out by itself.
    const other = await world({ push: true });
    const theirs = await other.connect(other.ownerId, 'bea@acme.dev');
    await other.sync(theirs.id);
    await deleteWorkspace(other.owner, { confirmName: 'Calendar two' });
    // Its access token has run out, and the account took the grant back: the refresh is refused.
    const binding = {
      workspaceId: other.workspaceId,
      memberId: other.ownerId,
      provider: 'google' as const,
      accountEmail: 'bea@acme.dev',
    };
    const lapsed = other.fake.tokensFor('bea@acme.dev', new Date(Date.now() - 60_000).toISOString());
    await testQuery(ownerUrl, `update calendar_connections set tokens = $2 where id = $1`, [
      theirs.id,
      sealTokens(tokenKey, lapsed, binding),
    ]);
    other.fake.revoke('bea@acme.dev');
    expect((await other.sync(theirs.id)).channels).toMatchObject([
      { outcome: 'unstopped', why: 'workspace-deleted', code: 'CALENDAR_AUTH_REVOKED' },
    ]);
    expect(await channelOf(other)).toBeNull();
  });

  it('refuses a connect into a workspace deleted while its member was at the consent screen', async () => {
    const w = await world();
    // The door let the member in before the deletion: the connect itself finds the workspace gone.
    await deleteWorkspace(w.owner, { confirmName: 'Calendar two' });
    const refusal = await refusalOf(w.connect(w.ownerId, 'ada@acme.dev'));
    expect(refusal).toMatchObject({ code: 'NOT_FOUND' });
    expect(await w.query(sql`select 1 from calendar_connections`)).toEqual([]);
    expect(await w.query(sql`select 1 from calendar_calendars`)).toEqual([]);
    const queued = await testQuery(
      ownerUrl,
      `select 1 from graphile_worker._private_jobs where payload->>'workspaceId' = $1`,
      [w.workspaceId],
    );
    expect(queued).toEqual([]);
  });
});

describe('unknown attendees (AC-609)', () => {
  it('adds an attendee as a person with their company, linking every meeting that listed them', async () => {
    const w = await world();
    const northwind = await w.company('Northwind', ['northwind.com']);
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put('ada@acme.dev', event('m1', day(1), [self('ada@acme.dev'), guest('cy@northwind.com', 'Cy Ng')]));
    w.fake.put('ada@acme.dev', event('m2', day(2), [self('ada@acme.dev'), guest('cy@northwind.com')]));
    await w.sync(conn.id);
    const page = await listMeetingsForRecord(w.owner, { recordId: northwind });
    const first = page.items.find((each) => each.title === 'Event m1');
    expect(first?.attendees.find((each) => each.email === 'cy@northwind.com')?.match).toBe('unknown');
    const added = await addMeetingAttendee(
      w.owner,
      { recordId: northwind, meetingId: first?.id ?? '', email: ' Cy@Northwind.com ' },
      { isFreeDomain: () => false },
      [outboxHook()],
    );
    const personPage = await listMeetingsForRecord(w.owner, { recordId: added.recordId });
    expect(personPage.items.map((each) => each.title).sort()).toEqual(['Event m1', 'Event m2']);
    const [person] = await w.query<{ company: string | null }>(sql`
      select (select l.to_record_id::text from record_links l where l.from_record_id = r.id and l.active_until is null limit 1) as company
      from records r where r.id = ${added.recordId}::uuid
    `);
    expect(person?.company).toBe(northwind);
    // Once known, never added twice.
    expect(
      await refusalOf(
        addMeetingAttendee(
          w.owner,
          { recordId: northwind, meetingId: first?.id ?? '', email: 'cy@northwind.com' },
          { isFreeDomain: () => false },
        ),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    const outbox = await w.query<{ record_ids: string[] }>(
      sql`select record_ids::text[] as record_ids from outbox where kind = 'meetings' order by seq desc limit 1`,
    );
    expect(outbox[0]?.record_ids).toEqual(expect.arrayContaining([added.recordId, northwind]));
  });

  it('refuses an attendee on a private meeting the reader doesn’t hold, or on no meeting of the record', async () => {
    const w = await world();
    const northwind = await w.company('Northwind', ['northwind.com']);
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put(
      'ada@acme.dev',
      event('secret', day(1), [self('ada@acme.dev'), guest('dee@northwind.com')], { isPrivate: true }),
    );
    await w.sync(conn.id);
    const [meeting] = await w.query<{ id: string }>(sql`select id::text from meetings`);
    const ask = { recordId: northwind, meetingId: meeting?.id ?? '', email: 'dee@northwind.com' };
    expect(await refusalOf(addMeetingAttendee(w.as(w.bea), ask, { isFreeDomain: () => false }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await refusalOf(
        addMeetingAttendee(w.owner, { ...ask, email: 'nobody@northwind.com' }, { isFreeDomain: () => false }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    // The holder may: no name from the calendar, so the address before the @ names them.
    const added = await addMeetingAttendee(w.owner, ask, { isFreeDomain: () => false });
    expect(added.recordId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets only owners and admins turn on making people, which the sync then does as the system', async () => {
    const w = await world();
    expect(await readCalendarSettings(w.as(w.bea))).toEqual({ createUnknownPeople: false, canManage: false });
    expect(await refusalOf(updateCalendarSettings(w.as(w.bea), { createUnknownPeople: true }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await updateCalendarSettings(w.owner, { createUnknownPeople: true })).toEqual({
      createUnknownPeople: true,
      canManage: true,
    });
    const northwind = await w.company('Northwind', ['northwind.com']);
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put(
      'ada@acme.dev',
      event('auto', day(1), [self('ada@acme.dev'), guest('eve@northwind.com', 'Eve Ro'), guest('bea@acme.dev')]),
    );
    await w.sync(conn.id);
    const attendees = await w.query<{ email: string; match: string; person: string | null }>(
      sql`select email, match::text as match, person_record_id::text as person from meeting_attendees order by email`,
    );
    expect(attendees.map((each) => [each.email, each.match])).toEqual([
      ['ada@acme.dev', 'member'],
      ['bea@acme.dev', 'member'],
      ['eve@northwind.com', 'linked'],
    ]);
    const eve = attendees.find((each) => each.email === 'eve@northwind.com')?.person ?? '';
    const [made] = await w.query<{ created_by_type: string }>(
      sql`select created_by_type::text from records where id = ${eve}::uuid`,
    );
    expect(made?.created_by_type).toBe('system');
    expect((await listMeetingsForRecord(w.owner, { recordId: eve })).items).toHaveLength(1);
    expect((await listMeetingsForRecord(w.owner, { recordId: northwind })).items).toHaveLength(1);
  });

  it('makes nobody from a private event or a private calendar (AC-611, AC-612)', async () => {
    const w = await world();
    await updateCalendarSettings(w.owner, { createUnknownPeople: true });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put(
      'ada@acme.dev',
      event('therapy', day(1), [self('ada@acme.dev'), guest('dee@therapist.example', 'Dee')], { isPrivate: true }),
    );
    await w.sync(conn.id);
    const beas = await w.connect(w.bea, 'bea@acme.dev');
    await updateCalendarConnection(w.as(w.bea), { connectionId: beas.id, sharing: 'private' });
    w.fake.put('bea@acme.dev', event('quiet', day(2), [self('bea@acme.dev'), guest('fay@elsewhere.example', 'Fay')]));
    await w.sync(beas.id);
    expect(
      await w.query(sql`select match::text as match from meeting_attendees where match <> 'member' order by email`),
    ).toEqual([{ match: 'unknown' }, { match: 'unknown' }]);
  });
});

describe('free and busy, and events (AC-615 to AC-618)', () => {
  it('answers each member’s busy times, none without a calendar, and keeps an answer for a minute', async () => {
    const w = await world();
    await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put('ada@acme.dev', event('busy', day(1), []));
    const ask = { memberIds: [w.ownerId, w.bea], from: day(0, 0), to: day(7, 0) };
    const answers = await w.events.freeBusy(w.system, ask);
    expect(answers).toEqual([
      {
        memberId: w.ownerId,
        status: 'read',
        busy: [{ start: new Date(day(1)).toISOString(), end: plus(day(1), 30) }],
      },
      { memberId: w.bea, status: 'none' },
    ]);
    await w.events.freeBusy(w.system, ask);
    expect(w.fake.calls('freeBusy')).toBe(1);
    await w.events.freeBusy(w.system, ask, { fresh: true });
    expect(w.fake.calls('freeBusy')).toBe(2);
    // Its only conflict calendar failing closes the member (AC-995), and the calendar is named for its member.
    w.fake.failNext('freeBusy', 'CALENDAR_UNAVAILABLE');
    expect(await w.events.freeBusy(w.system, ask, { fresh: true })).toContainEqual({
      memberId: w.ownerId,
      status: 'blocked',
      skipped: [expect.objectContaining({ code: 'CALENDAR_UNAVAILABLE', reason: 'unavailable' })],
    });
    const tooWide = { ...ask, to: new Date(Date.parse(ask.from) + 63 * 86_400_000).toISOString() };
    expect(await refusalOf(w.events.freeBusy(w.system, tooWide))).toMatchObject({ code: 'INPUT_INVALID', field: 'to' });
  });

  it('creates an event with its meeting at once, which the sync then finds in place, and moves and cancels it', async () => {
    const w = await world();
    const northwind = await w.company('Northwind', ['northwind.com']);
    const input = {
      memberId: w.ownerId,
      title: 'Intro with Cy',
      start: day(3),
      end: plus(day(3), 30),
      attendees: [{ email: 'cy@northwind.com', name: 'Cy' }],
      timeZone: 'UTC',
      video: true,
      description: 'Never stored',
      requestId: newId(),
    };
    expect(await refusalOf(w.events.createEvent(w.system, input))).toMatchObject({ code: 'CALENDAR_NOT_CONNECTED' });
    // Never a member's: these are booking's services, run as the system.
    expect(await refusalOf(w.events.createEvent(w.owner, input))).toMatchObject({ code: 'FORBIDDEN' });
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    const made = await w.events.createEvent(w.system, input);
    expect(made.videoUrl).toMatch(/^https:\/\/meet\.fake\//);
    const [meeting] = await w.query<{ id: string; created_by_crm: boolean }>(
      sql`select id::text, created_by_crm from meetings`,
    );
    expect(meeting).toEqual({ id: made.meetingId, created_by_crm: true });
    expect((await listMeetingsForRecord(w.owner, { recordId: northwind })).items.map((each) => each.id)).toEqual([
      made.meetingId,
    ]);
    // The sync meets the same event: still one meeting, still the CRM's.
    await w.sync(conn.id);
    expect(await w.query(sql`select id::text, created_by_crm from meetings`)).toEqual([
      { id: made.meetingId, created_by_crm: true },
    ]);
    await w.events.moveEvent(w.system, {
      meetingId: made.meetingId ?? '',
      start: day(4),
      end: plus(day(4), 60),
      timeZone: 'UTC',
    });
    const [moved] = await w.query<{ starts_at: string }>(sql`select starts_at::text from meetings`);
    expect(new Date(moved?.starts_at ?? 0).toISOString()).toBe(new Date(day(4)).toISOString());
    await w.events.cancelEvent(w.system, { meetingId: made.meetingId ?? '' });
    expect(w.fake.calls('cancelEvent')).toBe(1);
    expect(await w.query(sql`select id from meetings`)).toEqual([]);
    // A meeting the CRM didn't make can't be moved or cancelled.
    w.fake.put('ada@acme.dev', event('theirs', day(5), [self('ada@acme.dev'), guest('cy@northwind.com')]));
    await w.sync(conn.id);
    const [theirs] = await w.query<{ id: string }>(sql`select id::text from meetings`);
    expect(await refusalOf(w.events.cancelEvent(w.system, { meetingId: theirs?.id ?? '' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('a booking whose event the host removes (owner report, 20 October 2026)', () => {
  /** A booking the owner made for Grace `offset` days from now, its event on the owner's calendar. */
  async function booked(w: World, offset: number) {
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const calendar = connectedCalendar({ db, providers: { google: w.fake.provider }, tokenKey, hooks: [outboxHook()] });
    const made = await bookAsHost(
      w.owner,
      { calendar, linkKey: Buffer.alloc(32, 1), now: () => new Date(Date.parse(day(offset)) - 3_600_000) },
      {
        idempotencyKey: newId(),
        pageId: page.id,
        start: new Date(day(offset)),
        minutes: 30,
        name: 'Grace Hopper',
        email: 'grace@navy.example',
        timeZone: 'UTC',
        guests: [],
        message: '',
      },
    );
    const [source] = await w.query<{ event: string }>(sql`
      select s.provider_event_id as event from meeting_sources s
      join meetings m on m.id = s.meeting_id where m.booking_id = ${made.bookingId}::uuid
    `);
    return { bookingId: made.bookingId, eventId: source?.event ?? '' };
  }
  const bookingOf = async (w: World, id: string) =>
    (
      await w.query<{ status: string; cancel_reason: string | null; meeting_id: string | null }>(
        sql`select status, cancel_reason, meeting_id::text from bookings where id = ${id}::uuid`,
      )
    )[0];

  it('cancels an upcoming booking when the host deletes its event, in the sync’s write', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    const { bookingId, eventId } = await booked(w, 3);
    await w.sync(conn.id);
    expect(await bookingOf(w, bookingId)).toMatchObject({ status: 'confirmed' });
    w.fake.cancel('ada@acme.dev', eventId);
    await w.sync(conn.id);
    expect(await bookingOf(w, bookingId)).toEqual({
      status: 'cancelled',
      cancel_reason: 'Removed from the host calendar',
      meeting_id: null,
    });
    // The host is told in the same write; the guest gets nothing from Timefix.
    const notices = await w.query<{
      to_member_id: string | null;
      to_address: string | null;
      key: string;
      params: { title?: unknown; guestEmail?: unknown; bookingsPath?: unknown };
    }>(sql`select to_member_id::text, to_address, key, params from emails where kind = 'booking_calendar_removed'`);
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    expect(notice).toMatchObject({
      to_member_id: w.ownerId,
      to_address: null,
      key: `booking_calendar_removed:${bookingId}`,
    });
    expect(typeof notice?.params.title).toBe('string');
    expect(typeof notice?.params.guestEmail).toBe('string');
    expect(notice?.params.bookingsPath).toBe(`/w/${w.slug}/bookings/list`);
    const others = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind <> 'booking_calendar_removed'`,
    );
    expect(others[0]?.n).toBe(0);
    // The meeting's change event went with it, so open timelines read again.
    const events = await w.query<{ n: number }>(sql`select count(*)::int as n from outbox where kind = 'meetings'`);
    expect(events[0]?.n).toBeGreaterThan(0);
    // The slot is free again: the same time books.
    const again = await booked(w, 3);
    expect(again.bookingId).not.toBe(bookingId);
  });

  it('leaves a booking alone when another member’s copy goes, or when it already began', async () => {
    const w = await world();
    const mine = await w.connect(w.ownerId, 'ada@acme.dev');
    const beas = await w.connect(w.bea, 'bea@acme.dev');
    const { bookingId, eventId } = await booked(w, 2);
    await w.sync(mine.id);
    // Bea was invited too: her calendar holds a copy of the same event (one meeting, AC-603).
    const [held] = await w.query<{ ical_uid: string; starts_at: string; ends_at: string }>(
      sql`select ical_uid, starts_at::text, ends_at::text from meetings where booking_id = ${bookingId}::uuid`,
    );
    const copy = event(
      'bea-copy',
      new Date(held?.starts_at ?? 0).toISOString(),
      [
        { email: 'bea@acme.dev', response: 'accepted', isOrganizer: false, isSelf: true },
        guest('ada@acme.dev'),
        guest('grace@navy.example'),
      ],
      { icalUid: held?.ical_uid ?? '', end: { at: new Date(held?.ends_at ?? 0).toISOString(), allDay: false } },
    );
    w.fake.put('bea@acme.dev', copy);
    await w.sync(beas.id);
    w.fake.cancel('bea@acme.dev', 'bea-copy');
    await w.sync(beas.id);
    expect(await bookingOf(w, bookingId)).toMatchObject({ status: 'confirmed' });
    // A booking that already began stays, whatever happens to its event.
    await testQuery(
      ownerUrl,
      `update bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
        during = tstzrange(now() - interval '2 hours', now() - interval '1 hour') where id = $1`,
      [bookingId],
    );
    w.fake.cancel('ada@acme.dev', eventId);
    await w.sync(mine.id);
    expect(await bookingOf(w, bookingId)).toMatchObject({ status: 'confirmed', meeting_id: null });
  });
});

describe('a cancelled booking whose event still lives in the calendar (owner report, 23 October 2026)', () => {
  /** A booking the owner made for Grace `offset` days from now, its event on the owner's main calendar. */
  async function booked(w: World, offset: number) {
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Quick Chat', timeZone: 'UTC' });
    const calendar = connectedCalendar({ db, providers: { google: w.fake.provider }, tokenKey, hooks: [outboxHook()] });
    const made = await bookAsHost(
      w.owner,
      { calendar, linkKey: Buffer.alloc(32, 1), now: () => new Date(Date.parse(day(offset)) - 3_600_000) },
      {
        idempotencyKey: newId(),
        pageId: page.id,
        start: new Date(day(offset)),
        minutes: 30,
        name: 'Grace Hopper',
        email: 'grace@navy.example',
        timeZone: 'UTC',
        guests: [],
        message: '',
      },
    );
    const [meeting] = await w.query<{ id: string; event: string; ical_uid: string }>(sql`
      select m.id::text, s.provider_event_id as event, m.ical_uid from meeting_sources s
      join meetings m on m.id = s.meeting_id where m.booking_id = ${made.bookingId}::uuid
    `);
    return {
      bookingId: made.bookingId,
      meetingId: meeting?.id ?? '',
      eventId: meeting?.event ?? '',
      icalUid: meeting?.ical_uid ?? '',
    };
  }

  /** The event as Google holds it in `account`'s calendar, under `id`. */
  const copyOf = (id: string, icalUid: string, offset: number, title: string, self: string) =>
    event(
      id,
      day(offset),
      [
        { email: self, response: 'accepted', isOrganizer: self === 'ada@acme.dev', isSelf: true },
        ...(self === 'ada@acme.dev' ? [] : [guest('ada@acme.dev')]),
        guest('grace@navy.example'),
      ],
      { icalUid, title },
    );

  /**
   * The production case: the booking is cancelled while its event stays confirmed in Google (renamed there), and
   * the meeting row still names the booking, as rows written before this fix do.
   */
  async function cancelledButLive(w: World) {
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    const made = await booked(w, 3);
    await w.sync(conn.id);
    const range = { from: day(3, 0), to: day(4, 0) };
    // While the booking is confirmed, it shows and its event doesn't.
    expect((await readBookingsCalendar(w.owner, range)).events).toEqual([]);
    await w.query(sql`update bookings set status = 'cancelled' where id = ${made.bookingId}::uuid`);
    w.fake.put('ada@acme.dev', copyOf(made.eventId, made.icalUid, 3, 'Meeting with Anish', 'ada@acme.dev'));
    await w.sync(conn.id);
    const [row] = await w.query<{ booking_id: string | null; created_by_crm: boolean }>(
      sql`select booking_id::text, created_by_crm from meetings where id = ${made.meetingId}::uuid`,
    );
    expect(row).toEqual({ booking_id: made.bookingId, created_by_crm: true });
    return { ...made, range };
  }

  it('shows the event on Bookings › Calendar beside the struck-through booking', async () => {
    const w = await world();
    const { bookingId, meetingId, range } = await cancelledButLive(w);
    const week = await readBookingsCalendar(w.owner, range);
    expect(week.bookings.map((each) => [each.id, each.status])).toEqual([[bookingId, 'cancelled']]);
    expect(week.events).toMatchObject([{ id: meetingId, title: 'Meeting with Anish', status: 'confirmed' }]);
    // A meeting the CRM made with no booking at all stays off the week.
    await w.events.createEvent(w.system, {
      memberId: w.ownerId,
      title: 'Made here',
      start: day(3, 12),
      end: plus(day(3, 12), 30),
      attendees: [{ email: 'cy@northwind.com' }],
      timeZone: 'UTC',
      video: false,
      requestId: newId(),
    });
    expect((await readBookingsCalendar(w.owner, range)).events.map((each) => each.title)).toEqual([
      'Meeting with Anish',
    ]);
  });

  it('lists the event among upcoming meetings, and the booking under cancelled', async () => {
    const w = await world();
    const { bookingId, meetingId } = await cancelledButLive(w);
    const upcoming = await listMeetings(w.owner, { when: 'upcoming' });
    expect(upcoming.items).toMatchObject([{ kind: 'event', event: { id: meetingId, title: 'Meeting with Anish' } }]);
    const cancelled = await listMeetings(w.owner, { when: 'cancelled' });
    expect(cancelled.items).toMatchObject([{ kind: 'booking', booking: { id: bookingId } }]);
  });

  it('shows the event in Home’s team today', async () => {
    const w = await world();
    const { meetingId, range } = await cancelledButLive(w);
    const view = await readTeamToday(w.owner, range, { now: new Date(range.from) });
    const mine = view.members.find((each) => each.memberId === w.ownerId)?.items ?? [];
    expect(mine).toMatchObject([{ id: meetingId, kind: 'meeting', title: 'Meeting with Anish' }]);
  });

  it('keeps the booking when its copy leaves one calendar while another of the host’s still holds it', async () => {
    const w = await world();
    const conn = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.addCalendar('ada@acme.dev', { id: 'team@group.calendar', name: 'Team', accessRole: 'writer' });
    await w.sync(conn.id);
    const [team] = await w.query<{ id: string }>(
      sql`select id::text from calendar_calendars where provider_calendar_id = 'team@group.calendar'`,
    );
    await updateMemberCalendar(w.owner, { calendarId: team?.id ?? '', showInWeek: true });
    const { bookingId, meetingId, eventId, icalUid } = await booked(w, 3);
    w.fake.put('ada@acme.dev', copyOf('team-copy', icalUid, 3, 'Quick Chat', 'ada@acme.dev'), 'team@group.calendar');
    await w.sync(conn.id);
    const status = async () =>
      (await w.query<{ status: string }>(sql`select status from bookings where id = ${bookingId}::uuid`))[0]?.status;
    // The host takes it off their main calendar; the Team calendar still holds the meeting.
    w.fake.cancel('ada@acme.dev', eventId);
    await w.sync(conn.id);
    expect(await status()).toBe('confirmed');
    expect(await w.query(sql`select calendar_id from meeting_sources where meeting_id = ${meetingId}::uuid`)).toEqual([
      { calendar_id: 'team@group.calendar' },
    ]);
    // Gone from every calendar: the booking goes too.
    w.fake.cancel('ada@acme.dev', 'team-copy', 'team@group.calendar');
    await w.sync(conn.id);
    expect(await status()).toBe('cancelled');
  });

  it('lets go of a meeting another calendar still holds when the sync cancels its booking', async () => {
    const w = await world();
    const mine = await w.connect(w.ownerId, 'ada@acme.dev');
    const beas = await w.connect(w.bea, 'bea@acme.dev');
    const { bookingId, meetingId, eventId, icalUid } = await booked(w, 2);
    await w.sync(mine.id);
    // Bea was invited too: her calendar holds a copy of the same meeting.
    w.fake.put('bea@acme.dev', copyOf('bea-copy', icalUid, 2, 'Quick Chat', 'bea@acme.dev'));
    await w.sync(beas.id);
    w.fake.cancel('ada@acme.dev', eventId);
    await w.sync(mine.id);
    expect(await w.query(sql`select status, meeting_id::text from bookings where id = ${bookingId}::uuid`)).toEqual([
      { status: 'cancelled', meeting_id: null },
    ]);
    // The meeting stays while Bea's calendar holds it, no longer the booking's or the CRM's.
    expect(
      await w.query(sql`select booking_id::text, created_by_crm from meetings where id = ${meetingId}::uuid`),
    ).toEqual([{ booking_id: null, created_by_crm: false }]);
    const range = { from: day(2, 0), to: day(3, 0) };
    expect((await readBookingsCalendar(w.as(w.bea), range)).events.map((each) => each.id)).toEqual([meetingId]);
  });
});
