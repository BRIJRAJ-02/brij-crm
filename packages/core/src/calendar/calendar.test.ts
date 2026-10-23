// Spec 0024, milestone 1, against a real Postgres as the app role and the
// fake provider: connecting (the sealed tokens, the queued first sync, the
// limit of 3), the sync (full and incremental, one meeting across members'
// calendars, recurring instances, skips, matching, records, the outbox row,
// a 410's full resync, refresh, a revoked grant, a passing failure), privacy,
// a record's meeting pages and timeline, disconnecting, and a member's
// removal.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import type { AccessRules } from '../access/policy.ts';
import { getActivity } from '../engine/activity.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import { rescope, testScope } from '../testing.ts';
import {
  connectCalendar,
  listCalendarConnections,
  removeCalendarConnection,
  updateCalendarConnection,
} from './connections.ts';
import { readMeetingFacts } from './facts.ts';
import { createFakeCalendarProvider, type FakeCalendar } from './fake.ts';
import { listMeetingsForRecord } from './meetings.ts';
import type { ProviderAttendee, ProviderEvent } from './provider.ts';
import { POLL_INTERVAL_MS, syncConnection, type CalendarSyncDeps } from './sync.ts';
import { decodeTokenKey, openTokens } from './tokens.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-calendar-tests' });
});
afterAll(async () => {
  await db.close();
});

const tokenKey = decodeTokenKey(Buffer.alloc(32, 9).toString('base64'));

/** Two weeks from the real now, at 09:00 UTC on whole days, so upcoming and past are certain. */
const day = (offset: number, hour = 9) => {
  const at = new Date();
  at.setUTCHours(hour, 0, 0, 0);
  return new Date(at.getTime() + offset * 86_400_000).toISOString();
};

let count = 0;
async function world() {
  count += 1;
  const slug = `calendar-${String(count)}-${String(Date.now())}`;
  const created = await createWorkspace(db, {
    name: 'Calendar',
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
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}@acme.dev`}, 'member', 'system', 'system')`,
      ),
    );
    return id;
  };
  const bea = await addMember('bea');
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const person = async (firstName: string, emails: readonly string[]) =>
    (
      await createRecord(owner, {
        objectId: people,
        values: { [attribute('people.name')]: { firstName }, [attribute('people.email_addresses')]: [...emails] },
      })
    ).recordId;
  const company = async (name: string, domains: readonly string[]) =>
    (
      await createRecord(owner, {
        objectId: companies,
        values: { [attribute('companies.name')]: name, [attribute('companies.domains')]: [...domains] },
      })
    ).recordId;
  const as = (memberId: string, rules?: AccessRules) =>
    rescope(owner, { actor: { type: 'member', id: memberId }, role: 'member', ...(rules ? { rules } : {}) });
  const fake = createFakeCalendarProvider();
  const deps: CalendarSyncDeps = {
    providers: { google: fake.provider },
    tokenKey,
    systemScope: (workspaceId) => systemScope(db, workspaceId),
    hooks: [outboxHook()],
    isFreeDomain: (domain) => domain === 'gmail.com',
  };
  /** Connects `account` for `memberId` through the fake's consent, as the OAuth callback does. */
  const connect = async (memberId: string, account: string) => {
    const exchanged = await fake.provider.exchangeCode(`code:${account}`, 'https://crm.test/callback');
    return connectCalendar(as(memberId), { provider: 'google', exchanged, tokenKey });
  };
  const sync = (connectionId: string) => syncConnection(deps, { workspaceId: created.workspaceId, connectionId });
  const query = <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, async (tx) => (await tx.execute<T>(statement)).rows);
  const outbox = () =>
    query<{ item_ids: string[]; record_ids: string[]; coarse: boolean }>(
      sql`select item_ids::text[] as item_ids, record_ids::text[] as record_ids, coarse from outbox where kind = 'meetings' order by seq`,
    );
  return {
    ...created,
    slug,
    owner,
    ownerId: created.memberId,
    bea,
    person,
    company,
    as,
    fake,
    deps,
    connect,
    sync,
    query,
    outbox,
  };
}

const self = (email: string): ProviderAttendee => ({ email, response: 'accepted', isOrganizer: true, isSelf: true });
const guest = (
  email: string,
  response: ProviderAttendee['response'] = 'accepted',
  name?: string,
): ProviderAttendee => ({
  email,
  response,
  isOrganizer: false,
  isSelf: false,
  ...(name === undefined ? {} : { name }),
});

/** A meeting at `start` for 30 minutes, with these attendees. */
function meeting(
  id: string,
  start: string,
  attendees: readonly ProviderAttendee[],
  changes: Partial<ProviderEvent> = {},
): ProviderEvent {
  return {
    id,
    status: 'confirmed',
    icalUid: `${id}@google.com`,
    title: `Meeting ${id}`,
    start: { at: start, allDay: false },
    end: { at: new Date(Date.parse(start) + 1_800_000).toISOString(), allDay: false },
    videoUrl: `https://meet.google.com/${id}`,
    organizerEmail: attendees.find((each) => each.isOrganizer)?.email ?? 'ada@acme.dev',
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
const meetingsOf = (w: World) =>
  w.query<{ id: string; title: string; ical_uid: string; is_private: boolean; is_internal: boolean }>(
    sql`select id::text, title, ical_uid, is_private, is_internal from meetings order by starts_at, ical_uid`,
  );
const linksOf = (w: World) =>
  w.query<{ meeting: string; record_id: string; via: string }>(
    sql`select m.ical_uid as meeting, l.record_id::text as record_id, l.via from meeting_records l join meetings m on m.id = l.meeting_id order by 1, 3, 2`,
  );

describe('connecting (AC-597, AC-599, AC-600)', () => {
  it('stores the tokens sealed, the connection syncing and default, and queues its first sync', async () => {
    const w = await world();
    const view = await w.connect(w.ownerId, ' Ada@Acme.dev ');
    expect(view).toMatchObject({
      provider: 'google',
      accountEmail: 'ada@acme.dev',
      status: 'syncing',
      sharing: 'shared',
      isDefault: true,
    });
    expect(view).not.toHaveProperty('tokens');
    const [stored] = await w.query<{ tokens: Buffer }>(sql`select tokens from calendar_connections`);
    expect(stored?.tokens.toString('latin1')).not.toContain('fake-refresh');
    const opened = openTokens(tokenKey, stored?.tokens ?? Buffer.alloc(0), {
      workspaceId: w.workspaceId,
      memberId: w.ownerId,
      provider: 'google',
      accountEmail: 'ada@acme.dev',
    });
    expect(opened.refreshToken).toBe('fake-refresh:ada@acme.dev');
    const queued = await testQuery<{ task: string; key: string }>(
      ownerUrl,
      `select task_identifier as task, key from graphile_worker.jobs where key = $1`,
      [`crm-calendar:${w.workspaceId}:${view.id}`],
    );
    expect(queued).toEqual([{ task: 'crm_calendar_sync', key: `crm-calendar:${w.workspaceId}:${view.id}` }]);
  });

  it('reconnects the same account in place, keeps the default, and refuses a seventh account (AC-1000)', async () => {
    const w = await world();
    const first = await w.connect(w.ownerId, 'ada@acme.dev');
    await updateCalendarConnection(w.owner, { connectionId: first.id, sharing: 'private' });
    const again = await w.connect(w.ownerId, 'ada@acme.dev');
    expect(again).toMatchObject({ id: first.id, sharing: 'private', isDefault: true, status: 'syncing' });
    await w.connect(w.ownerId, 'ada@gmail.com');
    const third = await w.connect(w.ownerId, 'ada@work.dev');
    expect(third.isDefault).toBe(false);
    for (const account of ['ada@four.dev', 'ada@five.dev', 'ada@six.dev']) await w.connect(w.ownerId, account);
    expect(await refusalOf(w.connect(w.ownerId, 'ada@seven.dev'))).toMatchObject({
      code: 'LIMIT_REACHED',
      message: 'Connect at most 6 calendar accounts.',
    });
    expect((await listCalendarConnections(w.owner)).map((each) => each.accountEmail)).toEqual([
      'ada@six.dev',
      'ada@five.dev',
      'ada@four.dev',
      'ada@work.dev',
      'ada@gmail.com',
      'ada@acme.dev',
    ]);
    // Another member sees only their own (none).
    expect(await listCalendarConnections(w.as(w.bea))).toEqual([]);
  });
});

describe('syncing (AC-601, AC-603 to AC-607, AC-610)', () => {
  it('syncs the window in full, matches attendees, links people and companies, and stores one outbox row a batch', async () => {
    const w = await world();
    const bea = await w.person('Bea', ['bea@globex.com']);
    const globex = await w.company('Globex', ['globex.com']);
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put(
      'ada@acme.dev',
      meeting('intro', day(2), [
        self('ada@acme.dev'),
        guest('bea@globex.com', 'accepted', 'Bea'),
        guest('new@initech.com', 'needs_action'),
      ]),
    );
    // Skipped (AC-605): declined, alone, cancelled; internal: synced, on no record.
    w.fake.put(
      'ada@acme.dev',
      meeting('declined', day(3), [{ ...self('ada@acme.dev'), response: 'declined' }, guest('bea@globex.com')]),
    );
    w.fake.put('ada@acme.dev', meeting('focus', day(4), [self('ada@acme.dev')]));
    w.fake.put('ada@acme.dev', meeting('standup', day(1), [self('ada@acme.dev'), guest('bea@acme.dev')]));
    // Outside the window: not read by a full sync.
    w.fake.put('ada@acme.dev', meeting('far', day(400), [self('ada@acme.dev'), guest('bea@globex.com')]));

    const outcome = await w.sync(connection.id);
    expect(outcome).toEqual({ kind: 'synced', full: true, events: 4, nextInMs: POLL_INTERVAL_MS });
    expect((await meetingsOf(w)).map((each) => [each.ical_uid, each.is_internal])).toEqual([
      ['standup@google.com', true],
      ['intro@google.com', false],
    ]);
    expect(await linksOf(w)).toEqual([
      { meeting: 'intro@google.com', record_id: bea, via: 'attendee' },
      { meeting: 'intro@google.com', record_id: globex, via: 'domain' },
    ]);
    const attendees = await w.query<{ email: string; match: string; member_id: string | null; name: string | null }>(
      sql`select email, match, member_id::text as member_id, name from meeting_attendees a join meetings m on m.id = a.meeting_id where m.ical_uid = 'intro@google.com' order by position`,
    );
    expect(attendees).toEqual([
      { email: 'ada@acme.dev', match: 'member', member_id: w.ownerId, name: null },
      { email: 'bea@globex.com', match: 'linked', member_id: null, name: 'Bea' },
      { email: 'new@initech.com', match: 'unknown', member_id: null, name: null },
    ]);
    const [row] = await w.outbox();
    expect(row?.record_ids.sort()).toEqual([bea, globex].sort());
    expect(row?.item_ids).toHaveLength(2);
    const [stored] = await w.query<{ status: string; synced: boolean; token: string }>(
      sql`select c.status, c.last_synced_at is not null as synced, k.sync_state ->> 'syncToken' as token
        from calendar_connections c join calendar_calendars k on k.connection_id = c.id and k.is_primary`,
    );
    expect(stored).toMatchObject({ status: 'connected', synced: true });
    expect(stored?.token).toMatch(/^fake-sync:/);
  });

  it('keeps one meeting for one event in two members’ calendars, and recurring instances apart (AC-603, AC-604)', async () => {
    const w = await world();
    await w.person('Bea', ['bea@globex.com']);
    const ada = await w.connect(w.ownerId, 'ada@acme.dev');
    const cal = await w.connect(w.bea, 'bea@acme.dev');
    const shared = (account: string, id: string) =>
      meeting(id, day(2), [self(account), guest('bea@globex.com')], { icalUid: 'shared@google.com' });
    w.fake.put('ada@acme.dev', shared('ada@acme.dev', 'ada-copy'));
    w.fake.put('bea@acme.dev', shared('bea@acme.dev', 'bea-copy'));
    // A weekly series: two instances, one UID.
    const instance = (week: number) =>
      meeting(`weekly_${String(week)}`, day(7 * week), [self('ada@acme.dev'), guest('bea@globex.com')], {
        icalUid: 'weekly@google.com',
        originalStart: day(7 * week),
      });
    w.fake.put('ada@acme.dev', instance(1));
    w.fake.put('ada@acme.dev', instance(2));
    await w.sync(ada.id);
    await w.sync(cal.id);
    const meetings = await meetingsOf(w);
    expect(meetings.map((each) => each.ical_uid)).toEqual([
      'shared@google.com',
      'weekly@google.com',
      'weekly@google.com',
    ]);
    const sources = await w.query<{ n: number }>(
      sql`select count(*)::int as n from meeting_sources s join meetings m on m.id = s.meeting_id where m.ical_uid = 'shared@google.com'`,
    );
    expect(sources).toEqual([{ n: 2 }]);

    // One instance moved on its own changes only that instance (incrementally).
    w.fake.put('ada@acme.dev', {
      ...instance(1),
      title: 'Moved',
      start: { at: day(8), allDay: false },
      end: { at: day(8, 10), allDay: false },
    });
    expect(await w.sync(ada.id)).toMatchObject({ kind: 'synced', full: false, events: 1 });
    const titles = (await meetingsOf(w))
      .filter((each) => each.ical_uid === 'weekly@google.com')
      .map((each) => each.title);
    expect(titles.sort()).toEqual(['Meeting weekly_2', 'Moved']);

    // Ada's copy cancelled: the meeting stays, held by Bea's calendar; Bea's too, and it goes.
    w.fake.cancel('ada@acme.dev', 'ada-copy');
    await w.sync(ada.id);
    expect((await meetingsOf(w)).filter((each) => each.ical_uid === 'shared@google.com')).toHaveLength(1);
    w.fake.cancel('bea@acme.dev', 'bea-copy');
    await w.sync(cal.id);
    expect((await meetingsOf(w)).filter((each) => each.ical_uid === 'shared@google.com')).toEqual([]);
  });

  it('syncs in full again after a 410, dropping copies the calendar no longer lists', async () => {
    const w = await world();
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put('ada@acme.dev', meeting('kept', day(2), [self('ada@acme.dev'), guest('x@globex.com')]));
    w.fake.put('ada@acme.dev', meeting('lost', day(3), [self('ada@acme.dev'), guest('x@globex.com')]));
    await w.sync(connection.id);
    // Deleted while the token was lost: the fake forgets it entirely, as a full list would.
    w.fake.put('ada@acme.dev', meeting('lost', day(3), [self('ada@acme.dev')]));
    w.fake.expireSyncToken('ada@acme.dev');
    expect(await w.sync(connection.id)).toMatchObject({ kind: 'synced', full: true });
    expect((await meetingsOf(w)).map((each) => each.ical_uid)).toEqual(['kept@google.com']);
  });

  it('refreshes a token expiring within 5 minutes, and stores it sealed', async () => {
    const w = await world();
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    await w.sync(connection.id);
    expect(w.fake.calls('refresh')).toBe(0);
    await db.withWorkspace(w.workspaceId, async (tx) => {
      const { sealTokens } = await import('./tokens.ts');
      const soon = w.fake.tokensFor('ada@acme.dev', new Date(Date.now() + 60_000).toISOString());
      await tx.execute(
        sql`update calendar_connections set tokens = ${sealTokens(tokenKey, soon, {
          workspaceId: w.workspaceId,
          memberId: w.ownerId,
          provider: 'google',
          accountEmail: 'ada@acme.dev',
        })}`,
      );
    });
    await w.sync(connection.id);
    expect(w.fake.calls('refresh')).toBe(1);
  });

  it('marks a revoked grant expired and stops; a passing failure is recorded and tried again', async () => {
    const w = await world();
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.failNext('listChanges', 'CALENDAR_UNAVAILABLE');
    const [main] = await w.query<{ id: string }>(sql`select id::text as id from calendar_calendars where is_primary`);
    // Its one calendar failed, so the account did: the calendar is named for the log too.
    expect(await w.sync(connection.id)).toEqual({
      kind: 'retry',
      code: 'CALENDAR_UNAVAILABLE',
      nextInMs: 60_000,
      failedCalendars: [{ calendarId: main?.id, code: 'CALENDAR_UNAVAILABLE' }],
    });
    const [failing] = await listCalendarConnections(w.owner);
    expect(failing).toMatchObject({ status: 'syncing', lastError: { code: 'CALENDAR_UNAVAILABLE' } });
    expect(await w.sync(connection.id)).toMatchObject({ kind: 'synced' });
    const [healed] = await listCalendarConnections(w.owner);
    expect(healed?.lastError).toBeUndefined();
    expect(healed?.lastSyncedAt).toBeDefined();

    // Revoked: the next refresh is refused for good.
    await db.withWorkspace(w.workspaceId, async (tx) => {
      const { sealTokens } = await import('./tokens.ts');
      const old = w.fake.tokensFor('ada@acme.dev', new Date(Date.now() - 1000).toISOString());
      await tx.execute(
        sql`update calendar_connections set tokens = ${sealTokens(tokenKey, old, {
          workspaceId: w.workspaceId,
          memberId: w.ownerId,
          provider: 'google',
          accountEmail: 'ada@acme.dev',
        })}`,
      );
    });
    w.fake.revoke('ada@acme.dev');
    expect(await w.sync(connection.id)).toEqual({ kind: 'stopped', reason: 'expired' });
    const [expired] = await listCalendarConnections(w.owner);
    expect(expired).toMatchObject({ status: 'expired', lastError: { code: 'CALENDAR_AUTH_REVOKED' } });
    expect(await w.sync(connection.id)).toEqual({ kind: 'stopped', reason: 'not-syncing' });
    // Its member is told once, in the failure's own write: the alert queued for them, ids in its key, no address.
    const alerts = await w.query<{ to_member_id: string; to_address: string | null; key: string; params: unknown }>(
      sql`select to_member_id::text, to_address, key, params from emails where kind = 'calendar_disconnected'`,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      to_member_id: w.ownerId,
      to_address: null,
      params: {
        provider: 'google',
        accountEmail: 'ada@acme.dev',
        reason: 'expired',
        settingsPath: `/w/${w.slug}/settings/scheduling/calendars`,
      },
    });
    expect(alerts[0]?.key).toMatch(new RegExp(`^calendar_disconnected:${connection.id}:expired:\\d+$`));
  });
});

describe('privacy (AC-611, AC-612) and reads (AC-608)', () => {
  it('shows a private connection’s meetings in full to their holder only, and coarse in the facts', async () => {
    const w = await world();
    const bea = await w.person('Bea', ['bea@globex.com']);
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    w.fake.put('ada@acme.dev', meeting('secret', day(2), [self('ada@acme.dev'), guest('bea@globex.com')]));
    w.fake.put(
      'ada@acme.dev',
      meeting('marked', day(3), [self('ada@acme.dev'), guest('bea@globex.com')], { isPrivate: true }),
    );
    await w.sync(connection.id);
    const seen = async (memberId: string) =>
      (await listMeetingsForRecord(w.as(memberId), { recordId: bea })).items.map((each) => [
        each.title,
        each.detailsHidden,
        each.attendees.length,
        each.videoUrl !== undefined,
      ]);
    // Marked private in the calendar itself: private whatever the connection's level.
    expect(await seen(w.bea)).toEqual([
      ['Meeting secret', false, 2, true],
      ['Private meeting', true, 0, false],
    ]);
    await updateCalendarConnection(w.owner, { connectionId: connection.id, sharing: 'private' }, [outboxHook()]);
    expect(await seen(w.bea)).toEqual([
      ['Private meeting', true, 0, false],
      ['Private meeting', true, 0, false],
    ]);
    expect(await seen(w.ownerId)).toEqual([
      ['Meeting secret', false, 2, true],
      ['Meeting marked', false, 2, true],
    ]);
    // The sharing change stored one meetings row naming both and their record.
    expect((await w.outbox()).at(-1)).toMatchObject({ record_ids: [bea] });
    const facts = await db.withWorkspace(w.workspaceId, async (tx) =>
      readMeetingFacts(
        tx,
        (await meetingsOf(w)).map((each) => each.id),
      ),
    );
    expect(Object.values(facts).map((fact) => [fact.isPrivate, fact.holderMemberIds])).toEqual([
      [true, [w.ownerId]],
      [true, [w.ownerId]],
    ]);
  });

  it('pages a record’s meetings, upcoming soonest first, then past newest first, and puts them in its timeline', async () => {
    const w = await world();
    const bea = await w.person('Bea', ['bea@globex.com']);
    const connection = await w.connect(w.ownerId, 'ada@acme.dev');
    for (const offset of [-20, -2, -1, 1, 2, 30]) {
      w.fake.put(
        'ada@acme.dev',
        meeting(`m${String(offset)}`, day(offset), [self('ada@acme.dev'), guest('bea@globex.com')]),
      );
    }
    await w.sync(connection.id);
    const first = await listMeetingsForRecord(w.owner, { recordId: bea, limit: 4 });
    expect(first.items.map((each) => each.title)).toEqual(['Meeting m1', 'Meeting m2', 'Meeting m30', 'Meeting m-1']);
    const second = await listMeetingsForRecord(w.owner, { recordId: bea, limit: 4, cursor: first.nextCursor ?? '' });
    expect(second.items.map((each) => each.title)).toEqual(['Meeting m-2', 'Meeting m-20']);
    expect(second.nextCursor).toBeUndefined();
    expect(await refusalOf(listMeetingsForRecord(w.owner, { recordId: bea, cursor: 'bad' }))).toMatchObject({
      code: 'INPUT_INVALID',
      field: 'cursor',
    });

    const activity = await getActivity(w.owner, { recordId: bea });
    const meetingEntries = activity.entries.filter((entry) => entry.kind === 'meeting');
    // Newest first: the furthest upcoming at the top.
    expect(meetingEntries.map((entry) => entry.title)).toEqual([
      'Meeting m30',
      'Meeting m2',
      'Meeting m1',
      'Meeting m-1',
      'Meeting m-2',
      'Meeting m-20',
    ]);
    expect(meetingEntries[0]?.meeting).toMatchObject({ title: 'Meeting m30', videoUrl: 'https://meet.google.com/m30' });
  });

  it('answers NOT_FOUND for a record the reader can’t see', async () => {
    const w = await world();
    const bea = await w.person('Bea', ['bea@globex.com']);
    const people = w.objects.people ?? '';
    const hidden: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: people }, level: 'none' },
      ],
      records: [],
    };
    expect(await refusalOf(listMeetingsForRecord(w.as(w.bea, hidden), { recordId: bea }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

/** A calendar account no other test connects: whether a grant is shared looks across every workspace (AC-815). */
const soleAccount = (name: string) => `${name}-${newId().slice(-12)}@acme.dev`;

describe('disconnecting (AC-599) and removing a member (AC-614)', () => {
  it('removes the tokens with the connection and the meetings only it held, keeping shared ones', async () => {
    const w = await world();
    const bea = await w.person('Bea', ['bea@globex.com']);
    const ada = await w.connect(w.ownerId, 'ada@acme.dev');
    const other = await w.connect(w.ownerId, 'ada@gmail.com');
    // An account no other test's workspace holds: its grant is revoked only when nothing else holds it.
    const beas = soleAccount('bea');
    const cal = await w.connect(w.bea, beas);
    w.fake.put('ada@acme.dev', meeting('only-ada', day(2), [self('ada@acme.dev'), guest('bea@globex.com')]));
    w.fake.put('ada@acme.dev', meeting('shared', day(3), [self('ada@acme.dev'), guest('bea@globex.com')]));
    w.fake.put(
      beas,
      meeting('shared-b', day(3), [self(beas), guest('bea@globex.com')], { icalUid: 'shared@google.com' }),
    );
    await w.sync(ada.id);
    await w.sync(cal.id);
    // Another member can't remove it: it isn't theirs to see.
    expect(await refusalOf(removeCalendarConnection(w.as(w.bea), { connectionId: ada.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const removed = await removeCalendarConnection(w.owner, { connectionId: ada.id }, [outboxHook()]);
    expect(removed).toEqual({ connectionId: ada.id, meetingsRemoved: 1 });
    expect((await meetingsOf(w)).map((each) => each.ical_uid)).toEqual(['shared@google.com']);
    expect((await w.outbox()).at(-1)?.record_ids).toEqual([bea]);
    // The default moved to the member's other connection.
    expect(await listCalendarConnections(w.owner)).toEqual([
      expect.objectContaining({ id: other.id, isDefault: true }),
    ]);
    // Its queued sync finds it gone.
    expect(await w.sync(ada.id)).toEqual({ kind: 'stopped', reason: 'gone' });

    // Removing Bea (spec 0031, AC-614 as AC-815 changed it): her meetings stay, flagged; her connection is
    // marked revoked and queued, and its sync ends the grant, then deletes the row and its tokens.
    await removeMember(w.owner, { memberId: w.bea }, [outboxHook()]);
    expect(await w.query(sql`select ical_uid, organizer_removed from meetings order by ical_uid`)).toEqual([
      { ical_uid: 'shared@google.com', organizer_removed: true },
    ]);
    expect(
      await w.query(
        sql`select status::text as status, is_default from calendar_connections where member_id = ${w.bea}::uuid`,
      ),
    ).toEqual([{ status: 'revoked', is_default: false }]);
    expect(await w.sync(cal.id)).toEqual({ kind: 'stopped', reason: 'revoked' });
    expect(w.fake.calls('revoke')).toBe(1);
    expect(await w.query(sql`select id from calendar_connections where member_id = ${w.bea}::uuid`)).toEqual([]);
    expect(await meetingsOf(w)).toHaveLength(1);
  });

  it('removes an expired connection at once and revokes a failed one', async () => {
    const w = await world();
    const cal = await w.connect(w.bea, soleAccount('bea'));
    const failed = await w.connect(w.bea, soleAccount('bea'));
    await w.query(sql`update calendar_connections set status = 'expired' where id = ${cal.id}::uuid`);
    await w.query(sql`update calendar_connections set status = 'failed' where id = ${failed.id}::uuid`);
    await removeMember(w.owner, { memberId: w.bea }, [outboxHook()]);
    // The expired one goes at once; the failed one's grant may live, so it is revoked through its sync.
    expect(
      await w.query(
        sql`select id::text as id, status::text as status from calendar_connections where member_id = ${w.bea}::uuid`,
      ),
    ).toEqual([{ id: failed.id, status: 'revoked' }]);
    expect(w.fake.calls('revoke')).toBe(0);
    expect(await w.sync(failed.id)).toEqual({ kind: 'stopped', reason: 'revoked' });
    expect(w.fake.calls('revoke')).toBe(1);
  });
});

describe('the fake provider', () => {
  it('fails a call as told, then answers again', async () => {
    const fake: FakeCalendar = createFakeCalendarProvider();
    const tokens = fake.tokensFor('ada@acme.dev');
    fake.failNext('refresh', 'CALENDAR_UNAVAILABLE', 2);
    await expect(fake.provider.refresh(tokens)).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
    await expect(fake.provider.refresh(tokens)).rejects.toMatchObject({ code: 'CALENDAR_UNAVAILABLE' });
    await expect(fake.provider.refresh(tokens)).resolves.toMatchObject({ refreshToken: 'fake-refresh:ada@acme.dev' });
    expect(fake.calls('refresh')).toBe(3);
  });
});
