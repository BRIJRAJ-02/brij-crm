// Home's own reads (spec 0041), against the real Postgres. Team today: the
// days of the members the reader may view (a member only their own, an admin
// everyone's), with titles only where the reader may see them (a teammate's
// Busy only calendar and a private event read as Busy, never their titles; a
// co-hosted booking once in the co-host's day); nothing for a key. The
// metrics row: this week against last, a tile the reader may not see absent,
// the won value in the Value attribute's currency, and the figures kept a
// minute per workspace.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { listObjectAttributes } from '../attributes/attributes.ts';
import { enterBookingPage } from '../access/door.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { createHomeMetricsCache, readHomeMetrics } from './metrics.ts';
import { readTeamToday } from './team-today.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-home-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');
const DAY = { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z' };

async function workspace() {
  const created = await createWorkspace(db, {
    name: 'Home',
    slug: `home-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, role: 'admin' | 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return rescope(owner, { actor: { type: 'member', id }, role });
  };
  return { ...created, owner, addMember };
}

const memberOf = (scope: EngineScope) =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : '';

/** A calendar connection of the member's, sharing Full details (`shared`) or Busy only (`private`). */
async function connect(scope: EngineScope, sharing: 'shared' | 'private') {
  const id = newId();
  await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute(sql`
      insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, sharing, tokens,
        created_by_type, updated_by_type)
      values (${scope.workspaceId}, ${id}, ${memberOf(scope)}, 'google', ${`${id}@example.com`}, 'connected', ${sharing},
        '\\x00'::bytea, 'system', 'system')
    `),
  );
  return id;
}

/** A synced meeting held by each of `connections`, private in its calendar when `isPrivate`. */
async function meeting(
  workspaceId: string,
  connections: readonly string[],
  title: string,
  start: string,
  end: string,
  isPrivate = false,
) {
  const id = newId();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(sql`
      insert into meetings (workspace_id, id, ical_uid, title, starts_at, ends_at, is_private, created_by_type, updated_by_type)
      values (${workspaceId}, ${id}, ${`uid-${id}`}, ${title}, ${start}::timestamptz, ${end}::timestamptz, ${isPrivate},
        'calendar', 'calendar')
    `);
    for (const connection of connections) {
      await tx.execute(sql`
        insert into meeting_sources (workspace_id, meeting_id, connection_id, provider_event_id, calendar_id, marked_private)
        values (${workspaceId}, ${id}, ${connection}, ${`event-${id}`}, 'primary', ${isPrivate})
      `);
    }
  });
  return id;
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

describe('Team today', () => {
  it('shows a member only their own day, and an admin everyone’s, titles only where the reader may see them', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const linus = await w.addMember('Linus', 'member');
    const admin = await w.addMember('Barbara', 'admin');
    const graceOpen = await connect(grace, 'shared');
    const linusPrivate = await connect(linus, 'private');
    await meeting(w.workspaceId, [graceOpen], 'Pipeline review', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z');
    await meeting(w.workspaceId, [graceOpen], 'Doctor', '2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z', true);
    await meeting(w.workspaceId, [linusPrivate], 'Salary talk', '2026-11-02T14:00:00Z', '2026-11-02T15:00:00Z');
    // Another day: left out.
    await meeting(w.workspaceId, [graceOpen], 'Tomorrow', '2026-11-03T10:00:00Z', '2026-11-03T11:00:00Z');
    const linusPage = await createBookingPage(linus, { id: newId(), title: 'Linus intro', timeZone: 'UTC' }, NOW);
    await book(linusPage.publicKey, '2026-11-02T09:00:00.000Z', 'Visitor');
    const day = (scope: EngineScope, view: Awaited<ReturnType<typeof readTeamToday>>) =>
      view.members.find((each) => each.memberId === memberOf(scope))?.items ?? [];

    // A member sees their own day alone (the owner's ask of 29 October 2026): no colleague, no colleague's booking.
    const seen = await readTeamToday(grace, DAY, { now: NOW });
    expect(seen.members.map((each) => each.memberId)).toEqual([memberOf(grace)]);
    expect(day(grace, seen).map((item) => item.title)).toEqual(['Pipeline review', 'Doctor']);
    expect(JSON.stringify(seen)).not.toContain('Salary talk');
    expect(JSON.stringify(seen)).not.toContain('Linus intro');
    expect(JSON.stringify(seen)).not.toContain('2026-11-02T09:00:00.000Z');

    const fromLinus = await readTeamToday(linus, DAY, { now: NOW });
    expect(fromLinus.members.map((each) => each.memberId)).toEqual([memberOf(linus)]);
    expect(day(linus, fromLinus).map((item) => item.title)).toEqual(['Linus intro', 'Salary talk']);
    expect(JSON.stringify(fromLinus)).not.toContain('Pipeline review');

    // An admin sees everyone, the reader first: every booking's page title (as on Bookings), a shared calendar's
    // titles, and still never a Busy only calendar's or a private event's.
    const fromAdmin = await readTeamToday(admin, DAY, { now: NOW });
    expect(fromAdmin.members[0]?.memberId).toBe(memberOf(admin));
    expect(fromAdmin.members.map((each) => each.memberId).sort()).toEqual(
      [w.memberId, memberOf(grace), memberOf(linus), memberOf(admin)].sort(),
    );
    expect(day(linus, fromAdmin).map((item) => item.title)).toEqual(['Linus intro', undefined]);
    expect(day(grace, fromAdmin).map((item) => item.title)).toEqual(['Pipeline review', undefined]);
    expect(JSON.stringify(fromAdmin)).not.toContain('Doctor');
    expect(JSON.stringify(fromAdmin)).not.toContain('Salary talk');
  });

  it('holds a co-hosted booking in the co-host’s day once, its synced event not beside it', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const admin = await w.addMember('Barbara', 'admin');
    const graceCalendar = await connect(grace, 'shared');
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Team demo', timeZone: 'UTC' }, NOW);
    const booked = await book(page.publicKey, '2026-11-02T09:00:00.000Z', 'Visitor');
    // Grace co-hosts it (a collective page's other member), and her calendar holds its event too.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into booking_hosts (workspace_id, booking_id, member_id, during, status)
        select workspace_id, id, ${memberOf(grace)}::uuid, during, status from bookings where id = ${booked.bookingId}::uuid
      `),
    );
    await meeting(
      w.workspaceId,
      [graceCalendar],
      'Team demo with Visitor',
      '2026-11-02T09:00:00Z',
      '2026-11-02T09:30:00Z',
    );
    const graceDay = (await readTeamToday(grace, DAY, { now: NOW })).members[0]?.items ?? [];
    expect(graceDay).toEqual([expect.objectContaining({ kind: 'booking', id: booked.bookingId, title: 'Team demo' })]);
    const fromAdmin = await readTeamToday(admin, DAY, { now: NOW });
    const of = (id: string) => fromAdmin.members.find((each) => each.memberId === id)?.items ?? [];
    expect(of(memberOf(grace)).map((item) => [item.kind, item.title])).toEqual([['booking', 'Team demo']]);
    expect(of(w.memberId).map((item) => [item.kind, item.title])).toEqual([['booking', 'Team demo']]);
  });

  it('shows a meeting the reader’s own calendar also holds in full, and busy time by its time alone', async () => {
    const w = await workspace();
    const grace = await w.addMember('Grace', 'member');
    const graceHidden = await connect(grace, 'private');
    const ownerCalendar = await connect(w.owner, 'shared');
    await meeting(
      w.workspaceId,
      [graceHidden, ownerCalendar],
      'Both of us',
      '2026-11-02T10:00:00Z',
      '2026-11-02T11:00:00Z',
    );
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into calendar_busy_times (workspace_id, connection_id, calendar_id, provider_event_id, starts_at, ends_at)
        values (${w.workspaceId}, ${graceHidden}, 'primary', 'focus', '2026-11-02T15:00:00Z', '2026-11-02T16:00:00Z')
      `),
    );
    const view = await readTeamToday(w.owner, DAY, { now: NOW });
    const graceDay = view.members.find((each) => each.memberId === memberOf(grace))?.items ?? [];
    expect(graceDay).toEqual([
      expect.objectContaining({ kind: 'meeting', title: 'Both of us' }),
      {
        id: expect.any(String) as string,
        kind: 'busy',
        startsAt: '2026-11-02T15:00:00.000Z',
        endsAt: '2026-11-02T16:00:00.000Z',
        allDay: false,
      },
    ]);
  });

  it('answers nothing to anyone but a member, and nothing from another workspace', async () => {
    const w = await workspace();
    const other = await workspace();
    const otherCalendar = await connect(other.owner, 'shared');
    await meeting(other.workspaceId, [otherCalendar], 'Elsewhere', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z');
    const key = rescope(w.owner, { actor: { type: 'api_key', id: newId() } });
    expect(await readTeamToday(key, DAY, { now: NOW })).toEqual({ members: [] });
    const view = await readTeamToday(w.owner, DAY, { now: NOW });
    expect(view.members.map((each) => each.memberId)).toEqual([w.memberId]);
    expect(JSON.stringify(view)).not.toContain('Elsewhere');
  });

  it('refuses a day that isn’t today', async () => {
    const w = await workspace();
    await expect(
      readTeamToday(w.owner, { from: '2026-12-01T00:00:00.000Z', to: '2026-12-02T00:00:00.000Z' }, { now: NOW }),
    ).rejects.toMatchObject({ inputProblem: { field: 'from' } });
  });
});

describe('the metrics row', () => {
  /** The current week's Monday, so records made now fall in it. */
  const thisMonday = () => {
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString();
  };

  async function deals(scope: EngineScope) {
    const objects = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string; key: string }>(sql`select id::text as id, standard_key as key from objects`),
    );
    const objectOf = (key: string) => objects.rows.find((row) => row.key === key)?.id ?? '';
    const attributes = await listObjectAttributes(scope, objectOf('deals'));
    const slug = (name: string) => attributes.find((attribute) => attribute.apiSlug === name)?.id ?? '';
    const name = attributes.find((attribute) => attribute.isPrimary)?.id ?? '';
    const won = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text as id from attribute_options where attribute_id = ${slug('stage')} and outcome = 'won'`,
      ),
    );
    return {
      people: objectOf('people'),
      deals: objectOf('deals'),
      name,
      stage: slug('stage'),
      value: slug('value'),
      owner: slug('owner'),
      won: won.rows[0]?.id ?? '',
    };
  }

  it('counts this week against last, the won value in the Value currency, other currencies left out', async () => {
    const w = await workspace();
    const ids = await deals(w.owner);
    await createRecord(w.owner, {
      objectId: ids.deals,
      values: { [ids.name]: 'Big one', [ids.stage]: ids.won, [ids.value]: { amount: '1200.50', currency: 'USD' } },
    });
    await createRecord(w.owner, {
      objectId: ids.deals,
      values: { [ids.name]: 'Euro one', [ids.stage]: ids.won, [ids.value]: { amount: '99', currency: 'EUR' } },
    });
    await createRecord(w.owner, { objectId: ids.deals, values: { [ids.name]: 'Open one' } });
    const weekStart = thisMonday();
    const metrics = await readHomeMetrics(w.owner, { weekStart });
    expect(metrics.deals).toEqual({ thisWeek: 3, lastWeek: 0 });
    expect(metrics.people).toEqual({ thisWeek: 0, lastWeek: 0 });
    expect(metrics.won).toMatchObject({ currency: 'USD', lastWeek: '0', others: true });
    expect(Number(metrics.won?.thisWeek)).toBe(1200.5);
    expect(metrics.submissions).toEqual({ thisWeek: 0, lastWeek: 0 });
    expect(metrics.meetings).toEqual({ thisWeek: 0, lastWeek: 0 });

    // Moved to won last week: counted there (the deal was touched then too).
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        update values set active_from = ${weekStart}::timestamptz - interval '2 days'
        where attribute_id = ${ids.stage} and active_until is null and option_id = ${ids.won}
          and owner_id in (select owner_id from values where attribute_id = ${ids.value} and text_value = 'USD')
      `),
    );
    const moved = await readHomeMetrics(w.owner, { weekStart });
    expect(Number(moved.won?.thisWeek)).toBe(0);
    expect(Number(moved.won?.lastWeek)).toBe(1200.5);
  });

  it('leaves out what the reader may not see: forms, and an object read through a record rule', async () => {
    const w = await workspace();
    const ids = await deals(w.owner);
    const member = await w.addMember('Grace', 'member');
    const seen = await readHomeMetrics(member, { weekStart: thisMonday() });
    expect(seen.submissions).toBeUndefined();
    expect(seen.people).toBeDefined();
    expect(seen.meetings).toEqual({ thisWeek: 0, lastWeek: 0 });
    const ruled = rescope(member, {
      rules: {
        levels: [],
        records: [
          { subject: { type: 'role', role: 'member' }, objectId: ids.deals, kind: 'own', attributeId: ids.owner },
        ],
      },
    });
    const narrowed = await readHomeMetrics(ruled, { weekStart: thisMonday() });
    expect(narrowed.deals).toBeUndefined();
    expect(narrowed.won).toBeUndefined();
    expect(narrowed.people).toBeDefined();
  });

  it('refuses a week that isn’t this one, and keeps the figures a minute per workspace', async () => {
    const w = await workspace();
    await expect(readHomeMetrics(w.owner, { weekStart: '2020-01-06T00:00:00.000Z' })).rejects.toMatchObject({
      inputProblem: { field: 'weekStart' },
    });
    const odd = new Date(Date.parse(thisMonday()) + 1).toISOString();
    await expect(readHomeMetrics(w.owner, { weekStart: odd })).rejects.toMatchObject({
      inputProblem: { field: 'weekStart' },
    });
    let clock = 0;
    const cache = createHomeMetricsCache({ now: () => clock });
    const weekStart = thisMonday();
    const ids = await deals(w.owner);
    expect((await readHomeMetrics(w.owner, { weekStart }, { cache })).deals).toEqual({ thisWeek: 0, lastWeek: 0 });
    await createRecord(w.owner, { objectId: ids.deals, values: { [ids.name]: 'New' } });
    expect((await readHomeMetrics(w.owner, { weekStart }, { cache })).deals).toEqual({ thisWeek: 0, lastWeek: 0 });
    clock = 61_000;
    expect((await readHomeMetrics(w.owner, { weekStart }, { cache })).deals).toEqual({ thisWeek: 1, lastWeek: 0 });
  });
});
