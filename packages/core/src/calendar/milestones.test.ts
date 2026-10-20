// Spec 0024, milestones 2 and 3, against a real Postgres as the app role and
// the fake provider: busy times (the owner's call, 20 October 2026), the
// `failed` rule and its healing, push channels and their notices, Add as
// person and the workspace setting that makes people by itself, and free and
// busy with the event writes.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { readBookingsCalendar } from '../booking/list.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { connectCalendar, listCalendarConnections } from './connections.ts';
import { createCalendarEvents } from './events.ts';
import { createFakeCalendarProvider } from './fake.ts';
import { listMeetingsForRecord } from './meetings.ts';
import { addMeetingAttendee, readCalendarSettings, updateCalendarSettings } from './people.ts';
import type { ProviderAttendee, ProviderEvent } from './provider.ts';
import { takeCalendarNotice } from './push.ts';
import { syncConnection, type CalendarSyncDeps } from './sync.ts';
import { decodeTokenKey } from './tokens.ts';

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
  const created = await createWorkspace(db, {
    name: 'Calendar two',
    slug: `calendar-two-${String(count)}-${String(Date.now())}`,
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
    expect(week.busy).toEqual([
      { connectionId: mine.id, startsAt: new Date(day(1)).toISOString(), endsAt: plus(day(1), 30) },
      { connectionId: mine.id, startsAt: new Date(day(2)).toISOString(), endsAt: plus(day(2), 30) },
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
    expect(opened?.token.startsWith(`${w.workspaceId}.${conn.id}.`)).toBe(true);
    const [stored] = await w.query<{ channel: Record<string, unknown> }>(sql`select channel from calendar_connections`);
    expect(stored?.channel).toMatchObject({ id: opened?.channel.id, resourceId: 'fake-resource' });
    // Only a hash of the secret is kept.
    expect(JSON.stringify(stored?.channel)).not.toContain(opened?.token.split('.')[2] ?? '-');
    await w.sync(conn.id);
    expect(w.fake.calls('watch')).toBe(1);
    // Within 48 hours of its end: a new one, and the old one stopped.
    await w.query(
      sql`update calendar_connections set channel = jsonb_set(channel, '{expiresAt}', to_jsonb((now() + interval '1 day')::text))`,
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
    const [stored] = await pushed.query<{ channel: unknown }>(sql`select channel from calendar_connections`);
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
    expect(await takeCalendarNotice(db, { channelId, token, state: 'sync' })).toBe('ignored');
    expect(await takeCalendarNotice(db, { channelId: 'other', token, state: 'exists' })).toBe('refused');
    expect(await takeCalendarNotice(db, { channelId, token: `${token}x`, state: 'exists' })).toBe('refused');
    expect(await takeCalendarNotice(db, { channelId, token: 'not.a.token', state: 'exists' })).toBe('refused');
    expect(await takeCalendarNotice(db, { channelId, token: undefined, state: 'exists' })).toBe('refused');
    expect(await queued()).toEqual([]);
    expect(await takeCalendarNotice(db, { channelId, token, state: 'exists' })).toBe('queued');
    expect(await queued()).toHaveLength(1);
    // Another workspace's ids with this secret find nothing.
    const other = await world({ push: true });
    const forged = token.replace(w.workspaceId, other.workspaceId);
    expect(await takeCalendarNotice(db, { channelId, token: forged, state: 'exists' })).toBe('refused');
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
    w.fake.failNext('freeBusy', 'CALENDAR_UNAVAILABLE');
    expect(await w.events.freeBusy(w.system, ask, { fresh: true })).toContainEqual({
      memberId: w.ownerId,
      status: 'unavailable',
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
