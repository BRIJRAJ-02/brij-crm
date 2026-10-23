// The operator console's reads (spec 0047) against a real Postgres: crm_operator's
// six definers as the app login calls them (outside any workspace), and the
// identity login's global rows. Rows here are dated in 2003, a year no other
// test writes, so the counts across every workspace are this file's alone.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import { addWorkspaceToDirectory } from './identity/directory.ts';
import { createIdentityStore, type IdentityStore } from './identity/store.ts';
import { createTestUser } from './testing.ts';

const { appUrl, identityUrl } = inject('testDatabase');

const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';
const RANGE = { from: '2003-03-01', to: '2003-03-08' } as const;

let db: Database;
let identity: IdentityStore;
let identitySql: pg.Client;

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-operator-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-operator-tests' });
  identitySql = new pg.Client({ connectionString: identityUrl });
  await identitySql.connect();
});

afterAll(async () => {
  await identitySql.end();
  await identity.close();
  await db.close();
});

const unique = () => randomUUID().slice(0, 8);

/** A definer's rows, called as the console calls them: the app login, outside every workspace. */
async function call<Row extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.withWorkspace(NO_WORKSPACE, (tx) => tx.execute<Row>(query));
  return result.rows;
}

/** A workspace in 2003 with its owner, an object and a booking page, listed in the directory. */
async function workspace(userId: string) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const objectId = randomUUID();
  const pageId = randomUUID();
  const slug = `op-${unique()}`;
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_at, created_by_type, updated_by_type) values (${workspaceId}, ${`Name ${slug}`}, ${slug}, '2003-03-02T10:00:00Z', 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${userId}, 'Ada', 'ada@example.com', 'owner', 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into objects (workspace_id, id, api_slug, singular_name, plural_name, icon, hue, position, created_by_type, updated_by_type) values (${workspaceId}, ${objectId}, ${`things-${unique()}`}, ${`Thing ${unique()}`}, ${`Things ${unique()}`}, 'box', 'gray', 0, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into booking_pages (workspace_id, id, public_key, slug, owner_member_id, title, durations, location, availability, created_by_type, updated_by_type) values (${workspaceId}, ${pageId}, ${randomUUID().replaceAll('-', '').slice(0, 16)}, ${`intro-${unique()}`}, ${memberId}, 'Intro call', '{30}', '{"type":"video"}', '{}', 'system', 'system')`,
    );
    await addWorkspaceToDirectory(tx, { workspaceId, slug, name: `Name ${slug}`, userId, memberId });
  });
  return { workspaceId, memberId, objectId, pageId, slug };
}

/** Records, a note, a booking and page views, all on 2 and 3 March 2003. */
async function activity(ws: Awaited<ReturnType<typeof workspace>>) {
  await db.withWorkspace(ws.workspaceId, async (tx) => {
    const recordId = randomUUID();
    await tx.execute(
      sql`insert into records (workspace_id, id, object_id, created_at, created_by_type, created_by_id, created_by_member_id, updated_by_type) values (${ws.workspaceId}, ${recordId}, ${ws.objectId}, '2003-03-02T09:00:00Z', 'member', ${ws.memberId}, ${ws.memberId}, 'system')`,
    );
    await tx.execute(
      sql`insert into records (workspace_id, object_id, created_at, created_by_type, created_by_id, created_by_member_id, updated_by_type) values (${ws.workspaceId}, ${ws.objectId}, '2003-03-03T09:00:00Z', 'member', ${ws.memberId}, ${ws.memberId}, 'system')`,
    );
    // Made by the system (workspace setup): never counted as made.
    await tx.execute(
      sql`insert into records (workspace_id, object_id, created_at, created_by_type, updated_by_type) values (${ws.workspaceId}, ${ws.objectId}, '2003-03-03T09:00:00Z', 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into notes (workspace_id, id, record_id, content, created_at, created_by_type, created_by_id, created_by_member_id, updated_by_type) values (${ws.workspaceId}, ${randomUUID()}, ${recordId}, '{}', '2003-03-03T09:00:00Z', 'member', ${ws.memberId}, ${ws.memberId}, 'system')`,
    );
    for (const [at, cancelled] of [
      ['2003-03-02T12:00:00Z', null],
      ['2003-03-03T12:00:00Z', '2003-03-04T12:00:00Z'],
    ] as const) {
      const starts = '2003-04-01T09:00:00Z';
      await tx.execute(
        sql`insert into bookings (workspace_id, page_id, host_member_id, starts_at, ends_at, during, visitor_name, visitor_email, visitor_time_zone, status, manage_token_hash, idempotency_key, created_at, cancelled_at, cancelled_by, created_by_type, updated_by_type) values (${ws.workspaceId}, ${ws.pageId}, ${ws.memberId}, ${starts}::timestamptz, ${starts}::timestamptz + interval '30 minutes', tstzrange(${starts}::timestamptz, ${starts}::timestamptz + interval '30 minutes'), 'Ada', 'ada@example.com', 'UTC', ${cancelled === null ? 'confirmed' : 'cancelled'}, ${randomUUID()}, ${randomUUID()}, ${at}::timestamptz, ${cancelled}::timestamptz, ${cancelled === null ? null : 'guest'}, 'system', 'system')`,
      );
    }
    for (const [day, visitor, views] of [
      ['2003-03-02', 'a'.repeat(32), 3],
      ['2003-03-02', 'b'.repeat(32), 1],
      ['2003-03-03', 'a'.repeat(32), 2],
    ] as const) {
      await tx.execute(
        sql`insert into booking_page_views (workspace_id, page_id, day, visitor, views) values (${ws.workspaceId}, ${ws.pageId}, ${day}, ${visitor}, ${views})`,
      );
    }
  });
}

describe('crm_operator (spec 0047, AC-1621)', () => {
  it('counts each workspace, each member, and the whole app, from no workspace at all', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const a = await workspace(userId);
    const b = await workspace(userId);
    await activity(a);

    const workspaces = await call<Record<string, unknown>>(
      sql`select * from crm_operator_workspaces(${`{${a.workspaceId},${b.workspaceId}}`}::uuid[], ${RANGE.from}::date, ${RANGE.to}::date) order by records desc`,
    );
    expect(workspaces).toMatchObject([
      { workspace_id: a.workspaceId, slug: a.slug, members: 1, records: 3, records_made: 2, bookings_made: 2 },
      { workspace_id: b.workspaceId, slug: b.slug, members: 1, records: 0, records_made: 0, bookings_made: 0 },
    ]);

    const members = await call<Record<string, unknown>>(
      sql`select * from crm_operator_members(${`{${userId}}`}::uuid[], ${RANGE.from}::date, ${RANGE.to}::date) order by records_made desc`,
    );
    expect(members).toMatchObject([
      {
        workspace_id: a.workspaceId,
        role: 'owner',
        records_made: 2,
        notes_made: 1,
        bookings_hosted: 2,
        pages_owned: 1,
      },
      {
        workspace_id: b.workspaceId,
        role: 'owner',
        records_made: 0,
        notes_made: 0,
        bookings_hosted: 0,
        pages_owned: 1,
      },
    ]);

    const [totals] = await call<Record<string, number>>(
      sql`select * from crm_operator_totals(${RANGE.from}::date, ${RANGE.to}::date)`,
    );
    expect(totals).toMatchObject({ workspaces_made: 2, records_made: 2, bookings_made: 2 });

    const daily = await call<{ day: string; records_made: number; bookings_made: number; workspaces_made: number }>(
      sql`select to_char(day, 'YYYY-MM-DD') as day, workspaces_made, records_made, bookings_made from crm_operator_daily(${RANGE.from}::date, ${RANGE.to}::date)`,
    );
    expect(daily.map((row) => row.day)).toEqual([
      '2003-03-01',
      '2003-03-02',
      '2003-03-03',
      '2003-03-04',
      '2003-03-05',
      '2003-03-06',
      '2003-03-07',
    ]);
    expect(daily[1]).toMatchObject({ workspaces_made: 2, records_made: 1, bookings_made: 1 });
    expect(daily[2]).toMatchObject({ workspaces_made: 0, records_made: 1, bookings_made: 1 });
  });

  it('counts each booking page and its days, one page or every page', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const a = await workspace(userId);
    await activity(a);

    const [page] = await call<Record<string, unknown>>(
      sql`select * from crm_operator_pages(${RANGE.from}::date, ${RANGE.to}::date, ${a.pageId}::uuid)`,
    );
    expect(page).toMatchObject({
      workspace_id: a.workspaceId,
      title: 'Intro call',
      owner_user_id: userId,
      views: 6,
      visitors: 3,
      bookings: 2,
      cancelled: 1,
    });

    const days = await call<{ day: string; views: number; visitors: number; bookings: number; cancelled: number }>(
      sql`select to_char(day, 'YYYY-MM-DD') as day, views, visitors, bookings, cancelled from crm_operator_page_days(${RANGE.from}::date, ${RANGE.to}::date, ${a.workspaceId}::uuid, ${a.pageId}::uuid)`,
    );
    expect(days).toHaveLength(7);
    expect(days[1]).toEqual({ day: '2003-03-02', views: 4, visitors: 2, bookings: 1, cancelled: 0 });
    expect(days[2]).toEqual({ day: '2003-03-03', views: 2, visitors: 1, bookings: 1, cancelled: 1 });

    // Every page: this file's rows are the only ones in 2003.
    const all = await call<{ views: number }>(
      sql`select sum(views)::int as views from crm_operator_page_days(${RANGE.from}::date, ${RANGE.to}::date, null, null)`,
    );
    expect(all[0]?.views).toBeGreaterThanOrEqual(6);
  });

  it('answers nothing for a range it refuses: backwards, empty, or over 400 days', async () => {
    for (const [from, to] of [
      ['2003-03-08', '2003-03-01'],
      ['2003-03-01', '2003-03-01'],
      ['2001-01-01', '2003-01-01'],
    ] as const) {
      expect(await call(sql`select * from crm_operator_daily(${from}::date, ${to}::date)`)).toEqual([]);
      expect(await call(sql`select * from crm_operator_page_days(${from}::date, ${to}::date, null, null)`)).toEqual([]);
    }
  });

  it('keeps booking page views to their workspace under row level security', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const a = await workspace(userId);
    const b = await workspace(userId);
    await activity(a);
    const seen = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(sql`select count(*)::int as count from booking_page_views where page_id = ${a.pageId}`),
    );
    expect(seen.rows).toEqual([{ count: 0 }]);
  });
});

describe('the console in schema auth (spec 0047)', () => {
  it('keeps one activity row per person and day however often they are seen', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    await identity.noteActivity(userId);
    await identity.noteActivity(userId);
    const rows = await identitySql.query('select day from auth.activity_day where user_id = $1', [userId]);
    expect(rows.rowCount).toBe(1);
  });

  it('lists people newest first, by pages, finds them by name or email, and reads one', async () => {
    const tag = unique();
    const ids: string[] = [];
    for (const [index, name] of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'].entries()) {
      const id = await createTestUser(identityUrl, { email: `${tag}-${String(index)}@example.com`, name });
      await identitySql.query(`update auth.user set created_at = $2 where id = $1`, [
        id,
        `2003-03-0${String(index + 2)}T10:00:00Z`,
      ]);
      ids.push(id);
    }
    const range = { from: RANGE.from, to: RANGE.to, before: '2003-02-22' };
    const firstAda = ids[0] ?? '';
    await identitySql.query(
      `insert into auth.activity_day (user_id, day, last_at) values ($1, '2003-03-04', '2003-03-04T18:00:00Z')`,
      [firstAda],
    );

    const first = await identity.operatorPersons({ range, search: tag, max: 2 });
    expect(first.total).toBe(3);
    expect(first.people.map((person) => person.name)).toEqual(['Alan Turing', 'Grace Hopper']);
    const next = await identity.operatorPersons({ range, search: tag, max: 2, after: first.people[1]?.cursor });
    expect(next.people.map((person) => person.name)).toEqual(['Ada Lovelace']);
    expect(next.people[0]).toMatchObject({ activeDays: 1, lastActiveAt: '2003-03-04T18:00:00.000Z' });

    // A search is text, never a pattern: `%` finds only a literal percent sign.
    expect((await identity.operatorPersons({ range, search: '%', max: 5 })).people).toEqual([]);
    expect((await identity.operatorPersons({ range, search: 'grace hopper', max: 5 })).people.length).toBeGreaterThan(
      0,
    );

    const one = await identity.operatorPerson(firstAda, range);
    expect(one).toMatchObject({ name: 'Ada Lovelace', google: false, days: ['2003-03-04'], workspaceIds: [] });
    expect(await identity.operatorPerson(randomUUID(), range)).toBeUndefined();
  });

  it('counts the website by visitor and day, ranks pages, sources and countries, and compares the range before', async () => {
    const visits = [
      ['2003-03-02T10:00:00Z', '/', 'google.com', null, 'DE', 'desktop', 'c'],
      ['2003-03-02T10:05:00Z', '/pricing', 'google.com', null, 'DE', 'desktop', 'c'],
      ['2003-03-03T11:00:00Z', '/', null, 'newsletter', 'IN', 'mobile', 'd'],
      ['2003-02-25T11:00:00Z', '/', null, null, 'IN', 'mobile', 'e'],
    ] as const;
    for (const [at, path, referrer, source, country, device, visitor] of visits) {
      await identitySql.query(
        `insert into auth.site_visit (at, site, path, referrer, source, country, device, visitor) values ($1, 'timefix.ai', $2, $3, $4, $5, $6, $7)`,
        [at, path, referrer, source, country, device, visitor.repeat(32)],
      );
    }
    const facts = await identity.siteFacts({ from: RANGE.from, to: RANGE.to, before: '2003-02-22' });
    expect(facts).toMatchObject({ visitors: 2, views: 3, visitorsBefore: 1, viewsBefore: 1 });
    expect(facts.days[1]).toEqual({ day: '2003-03-02', visitors: 1, views: 2 });
    expect(facts.pages[0]).toEqual({ name: '/', visitors: 2, views: 2 });
    expect(facts.referrers).toEqual([{ name: 'google.com', visitors: 1, views: 2 }]);
    expect(facts.sources).toEqual([{ name: 'newsletter', visitors: 1, views: 1 }]);
    expect(facts.devices.map((device) => device.name)).toEqual(['desktop', 'mobile']);
  });

  it('writes the console log, refuses a malformed row, and sweeps a year old rows', async () => {
    const userId = await createTestUser(identityUrl, { email: `${unique()}@example.com` });
    const requestId = randomUUID();
    await identity.logOperatorEvent({ userId, action: 'operator.user', target: userId, period: '30d', requestId });
    const logged = await identitySql.query('select action, target from auth.operator_event where request_id = $1', [
      requestId,
    ]);
    expect(logged.rows).toEqual([{ action: 'operator.user', target: userId }]);
    await expect(
      identity.logOperatorEvent({ userId, action: 'drop table', period: '30d', requestId }),
    ).rejects.toBeDefined();

    await identitySql.query(
      `insert into auth.site_visit (at, site, path, device, visitor) values ('1999-01-01T00:00:00Z', 'timefix.ai', '/', 'desktop', $1)`,
      ['f'.repeat(32)],
    );
    await identity.sweepAuthHistory(new Date('2000-01-01T00:00:00Z'), 1000);
    const left = await identitySql.query(`select 1 from auth.site_visit where at < '2000-01-01'`);
    expect(left.rowCount).toBe(0);
  });
});
