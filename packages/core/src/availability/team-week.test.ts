// The Team week (spec 0037, job J6), against a real Postgres as the app role: the critical scenario (a manager sets
// Sam's Tuesday as an override, copies the week to the next, sets usual hours for three people; each write audited
// once, each person one email; See can't change a cell), Away from time off with its reason only for Manage, the
// overrides older than 8 weeks dropped and the 400 cap, a London week across the clock change, the read's statements
// (no query per member), paging and search, and the refusals: a week out of reach, a past week, a stale cell, a
// member out of reach.
import { sql } from 'drizzle-orm';
import { defaultAvailability, SCHEDULE_OVERRIDES_FULL, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { grantDelegation } from '../scheduling/delegations.ts';
import { runSchedulingNotice } from '../scheduling/notice.ts';
import { createTimeOff } from '../scheduling/time-off.ts';
import { testScope } from '../testing.ts';
import { createSchedule, saveDefaultHours, updateSchedule } from './schedules.ts';
import { footerOf, mergedMinutes, mondayOf, weekDates } from '@crm/contracts/roster';
import { copyWeek, readTeamWeek, setDayHours, setUsualHours } from './team-week.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let counted: Database;
/** Every statement the counting connection sends while `counting` is on, but its transaction's begin and commit. */
const statements: string[] = [];
let counting = false;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-team-week-tests' });
  counted = createDatabase({
    url: appUrl,
    applicationName: 'crm-team-week-count-tests',
    onPool: (pool) => {
      pool.on('connect', (client) => {
        const query = client.query.bind(client) as (...args: unknown[]) => unknown;
        Object.assign(client, {
          query: (...args: unknown[]) => {
            const first = args[0];
            const text =
              typeof first === 'string'
                ? first
                : typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string'
                  ? first.text
                  : '';
            if (counting && !/^\s*(begin|commit|rollback)\b/i.test(text)) statements.push(text);
            return query(...args);
          },
        });
      });
    },
  });
});
afterAll(async () => {
  await Promise.all([db.close(), counted.close()]);
});

// The writes prune by the database's own clock, so the scenario runs on today's real dates.
const realNow = () => new Date();
const today = () => realNow().toISOString().slice(0, 10);
const thisMonday = () => mondayOf(today());
const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const NINE_TO_FIVE: [string, string] = ['09:00', '17:00'];
const weekdaysNineToFive = (zone: string) => ({
  ...defaultAvailability(zone),
  weekly: {
    mon: [NINE_TO_FIVE],
    tue: [NINE_TO_FIVE],
    wed: [NINE_TO_FIVE],
    thu: [NINE_TO_FIVE],
    fri: [NINE_TO_FIVE],
    sat: [],
    sun: [],
  },
});

let made = 0;
/** A workspace: Olga the owner (who manages everyone), and members who save weekday hours 09:00 to 17:00. */
async function world(database: Database = db) {
  made += 1;
  const created = await createWorkspace(database, {
    name: 'Roster',
    slug: `roster-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const as = (id: string, role: Role = 'member') =>
    testScope({ db: database, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (
    name: string,
    options: { readonly role?: Role; readonly zone?: string; readonly hours?: boolean } = {},
  ) => {
    const id = newId();
    const role = options.role ?? 'member';
    await database.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    if (options.hours !== false) {
      await saveDefaultHours(as(id, role), { availability: weekdaysNineToFive(options.zone ?? 'UTC') });
    }
    return id;
  };
  const audit = async () =>
    testQuery<{ actor_member_id: string; target_id: string; after: unknown }>(
      ownerUrl,
      `select actor_member_id::text, target_id, after from audit_events
         where workspace_id = $1 and action = 'schedule.changed' and actor_member_id = $2 order by at, id`,
      [created.workspaceId, created.memberId],
    );
  const emails = async () =>
    testQuery<{ to_member_id: string; params: Record<string, unknown> }>(
      ownerUrl,
      `select to_member_id::text, params from emails where workspace_id = $1 and kind = 'scheduling_changed'
         order by created_at, id`,
      [created.workspaceId],
    );
  return { ...created, as, owner, add, audit, emails };
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

describe('the pure parts', () => {
  it('merges overlapping ranges rather than adding them', () => {
    expect(
      mergedMinutes([
        ['09:00', '12:00'],
        ['11:00', '13:00'],
        ['14:00', '15:00'],
      ]),
    ).toBe(300);
    expect(mergedMinutes([])).toBe(0);
  });
  it('counts the people working and their minutes per day, leaving Away out', () => {
    const dates = weekDates('2026-11-02');
    const day = (ranges: [string, string][], away = false) => ({
      date: '2026-11-02',
      ranges,
      usual: ranges,
      source: 'usual' as const,
      ...(away ? { away: {} } : {}),
    });
    const rows = [
      { days: dates.map(() => day([NINE_TO_FIVE])) },
      { days: dates.map((_, index) => day(index === 0 ? [NINE_TO_FIVE] : [], index === 0)) },
    ];
    const footer = footerOf(dates, rows);
    expect(footer[0]).toEqual({ date: '2026-11-02', working: 1, minutes: 480 });
    expect(footer[1]).toEqual({ date: '2026-11-03', working: 1, minutes: 480 });
  });
});

describe('the Team week scenario (AC-1289 to AC-1292)', () => {
  it('sets a Tuesday, copies the week, sets usual hours for three: each audited once, each told once; See changes nothing', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const ana = await w.add('Ana Diaz');
    const ben = await w.add('Ben Ode');
    const priya = await w.add('Priya Shah');
    // Priya may See Sam (his own grant), not Manage.
    await grantDelegation(w.as(sam), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: sam },
      level: 'view',
    });
    const monday = thisMonday();
    const tuesday = plusDays(monday, 1);
    const nextMonday = plusDays(monday, 7);

    const week = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday });
    // The reader first, then by name; guests never (none here).
    expect(week.rows.map((row) => row.name)).toEqual(['Olga Owner', 'Ana Diaz', 'Ben Ode', 'Priya Shah', 'Sam Lee']);
    const samRow = week.rows.find((row) => row.memberId === sam);
    expect(samRow?.canChange).toBe(true);
    expect(samRow?.days[1]).toMatchObject({ date: tuesday, ranges: [NINE_TO_FIVE], source: 'usual' });
    expect(samRow?.weekMinutes).toBe(5 * 480);

    // A cell: Sam's Tuesday becomes 10 to 2, this week only.
    const set = await setDayHours(
      w.owner,
      { now: realNow },
      { memberId: sam, date: tuesday, hours: [['10:00', '14:00']], updatedAt: samRow?.schedule.updatedAt ?? null },
    );
    expect(set.day).toMatchObject({ date: tuesday, ranges: [['10:00', '14:00']], source: 'override' });
    // The same version again is stale: someone changed it since.
    expect(
      (
        await refusalOf(
          setDayHours(
            w.owner,
            { now: realNow },
            { memberId: sam, date: tuesday, hours: 'off', updatedAt: samRow?.schedule.updatedAt ?? null },
          ),
        )
      ).code,
    ).toBe('STALE');

    // Copy the week to the next: next Tuesday is 10 to 2 too, the other days stay usual.
    expect(
      await copyWeek(w.owner, { now: realNow }, { memberIds: [sam], fromWeekStart: monday, toWeekStart: nextMonday }),
    ).toEqual({ changed: 1 });
    const next = await readTeamWeek(w.owner, { now: realNow }, { weekStart: nextMonday });
    const samNext = next.rows.find((row) => row.memberId === sam);
    expect(samNext?.days[1]).toMatchObject({ ranges: [['10:00', '14:00']], source: 'override' });
    expect(samNext?.days[0]?.source).toBe('usual');

    // Usual hours for three people: one write each.
    const ten: [string, string] = ['10:00', '18:00'];
    expect(
      await setUsualHours(w.owner, {
        memberIds: [ana, ben, sam],
        weekly: { mon: [ten], tue: [ten], wed: [ten], thu: [ten], fri: [], sat: [], sun: [] },
      }),
    ).toEqual({ changed: 3 });
    const after = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday });
    const anaRow = after.rows.find((row) => row.memberId === ana);
    expect(anaRow?.days[0]?.ranges).toEqual([ten]);
    expect(anaRow?.days[4]?.ranges).toEqual([]);
    // Sam's override stays over his new usual hours.
    expect(after.rows.find((row) => row.memberId === sam)?.days[1]?.ranges).toEqual([['10:00', '14:00']]);

    // Each write audited once: Sam three times (the cell, the copy, the usual hours), Ana and Ben once.
    const rows = await w.audit();
    const count = (id: string) => rows.filter((row) => row.target_id === id).length;
    expect([count(sam), count(ana), count(ben)]).toEqual([3, 1, 1]);
    // And each person told once: one notice per actor and member, however many changes.
    for (const member of [sam, ana, ben]) {
      expect(
        await runSchedulingNotice(systemScope(db, w.workspaceId), { actorMemberId: w.memberId, memberId: member }),
      ).toBe('queued');
    }
    const sent = await w.emails();
    expect(sent.map((each) => each.to_member_id).sort()).toEqual([sam, ana, ben].sort());

    // See: Priya reads Sam's row, can't change it, and a cell write is refused.
    const seen = await readTeamWeek(w.as(priya), { now: realNow }, { weekStart: monday });
    expect(seen.rows.map((row) => row.memberId)).toEqual([priya, sam]);
    expect(seen.rows.find((row) => row.memberId === sam)?.canChange).toBe(false);
    expect(
      (
        await refusalOf(
          setDayHours(w.as(priya), { now: realNow }, { memberId: sam, date: tuesday, hours: 'off', updatedAt: null }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    // Out of reach entirely: Ana answers as nobody.
    expect((await refusalOf(setUsualHours(w.as(priya), { memberIds: [ana], weekly: anaWeek() }))).code).toBe(
      'NOT_FOUND',
    );
    // A member with no reach sees only themself.
    const alone = await readTeamWeek(w.as(ben), { now: realNow }, { weekStart: monday });
    expect(alone.rows.map((row) => row.memberId)).toEqual([ben]);
    expect(alone.rows[0]?.canChange).toBe(true);
  });

  it('stores the default of someone who never saved hours on their first cell, and refuses a past week', async () => {
    const w = await world();
    const new_ = await w.add('Nia New', { hours: false });
    const monday = thisMonday();
    const week = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday });
    const row = week.rows.find((each) => each.memberId === new_);
    expect(row?.schedule).toEqual({ id: null, updatedAt: null });
    expect(row?.days[0]?.ranges).toEqual([NINE_TO_FIVE]);
    const set = await setDayHours(
      w.owner,
      { now: realNow },
      { memberId: new_, date: plusDays(monday, 7), hours: 'off', updatedAt: null },
    );
    expect(set.day).toMatchObject({ ranges: [], source: 'override' });
    expect(set.schedule.id).toBeTruthy();
    const past = await refusalOf(
      setDayHours(
        w.owner,
        { now: realNow },
        { memberId: new_, date: plusDays(monday, -1), hours: 'usual', updatedAt: set.schedule.updatedAt },
      ),
    );
    expect(past).toMatchObject({ code: 'CONFIG_INVALID', message: 'Weeks before this one are read only.' });
    // The stepper's reach: 8 weeks back reads, 9 doesn't.
    await readTeamWeek(w.owner, { now: realNow }, { weekStart: plusDays(monday, -56) });
    expect((await refusalOf(readTeamWeek(w.owner, { now: realNow }, { weekStart: plusDays(monday, -63) }))).code).toBe(
      'CONFIG_INVALID',
    );
    expect((await refusalOf(readTeamWeek(w.owner, { now: realNow }, { weekStart: plusDays(monday, 371) }))).code).toBe(
      'CONFIG_INVALID',
    );
  });

  it('shows Away from time off, with its reason only for the member and Manage', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const priya = await w.add('Priya Shah');
    await grantDelegation(w.as(sam), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: sam },
      level: 'view',
    });
    const monday = plusDays(thisMonday(), 7);
    await createTimeOff(
      w.as(sam),
      { now: realNow },
      { id: newId(), fromDate: plusDays(monday, 2), toDate: plusDays(monday, 3), reason: 'vacation', note: 'Lisbon' },
    );
    const managed = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday });
    const samRow = managed.rows.find((row) => row.memberId === sam);
    expect(samRow?.days[2]?.away).toEqual({ reason: 'vacation', note: 'Lisbon' });
    expect(samRow?.days[1]?.away).toBeUndefined();
    // Away days aren't worked: three days of eight hours.
    expect(samRow?.weekMinutes).toBe(3 * 480);
    // Olga and Priya work that Wednesday; Sam is away.
    expect(managed.footer[2]?.working).toBe(2);
    const seen = await readTeamWeek(w.as(priya), { now: realNow }, { weekStart: monday });
    expect(seen.rows.find((row) => row.memberId === sam)?.days[2]?.away).toEqual({});
  });

  it('counts the pages that book by another schedule (AC-1295)', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const evenings = await createSchedule(w.as(sam), {
      id: newId(),
      name: 'Evenings',
      timeZone: 'UTC',
      availability: weekdaysNineToFive('UTC'),
    });
    for (const title of ['Intro', 'Demo']) {
      const page = await createBookingPage(w.as(sam), { id: newId(), title, timeZone: 'UTC' }, realNow());
      await db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`update booking_pages set schedule_id = ${evenings.id}::uuid where id = ${page.id}::uuid`),
      );
    }
    await createBookingPage(w.as(sam), { id: newId(), title: 'Default one', timeZone: 'UTC' }, realNow());
    const week = await readTeamWeek(w.owner, { now: realNow }, { weekStart: thisMonday() });
    expect(week.rows.find((row) => row.memberId === sam)?.otherSchedules).toBe(2);
  });
});

/** A week of hours for the refusals. */
const anaWeek = () => ({
  mon: [NINE_TO_FIVE],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
});

describe('pruning and the cap (AC-1293)', () => {
  it('drops overrides older than 8 weeks on any schedule write, and refuses the 401st', async () => {
    const w = await world();
    const sam = await w.add('Sam Lee');
    const old = plusDays(today(), -60);
    const recent = plusDays(today(), -20);
    await saveDefaultHours(w.as(sam), {
      availability: {
        ...weekdaysNineToFive('UTC'),
        overrides: [
          { date: old, ranges: [] },
          { date: recent, ranges: [] },
        ],
      },
    });
    const stored = async () =>
      testQuery<{ availability: { overrides: { date: string }[] }; updated_at: string; id: string }>(
        ownerUrl,
        `select id::text, availability, updated_at from availability_schedules where member_id = $1 and is_default`,
        [sam],
      );
    // The save itself pruned the old one.
    expect((await stored())[0]?.availability.overrides.map((each) => each.date)).toEqual([recent]);

    // Fill to 400 with future dates (a rename keeps them all), then one more is refused with the spec's sentence.
    const first = (await stored())[0];
    const many = Array.from({ length: 399 }, (_, index) => ({ date: plusDays(today(), index + 1), ranges: [] }));
    const full = await updateSchedule(w.as(sam), {
      id: first?.id ?? '',
      availability: { ...weekdaysNineToFive('UTC'), overrides: [{ date: recent, ranges: [] }, ...many] },
      updatedAt: new Date(first?.updated_at ?? '').toISOString(),
    });
    expect(full.availability.overrides).toHaveLength(400);
    const refusal = await refusalOf(
      setDayHours(w.owner, { now: realNow }, { memberId: sam, date: today(), hours: 'off', updatedAt: full.updatedAt }),
    );
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', message: SCHEDULE_OVERRIDES_FULL });
  });
});

describe('a week across the clock change (AC-1290)', () => {
  it('keeps 9 to 5 local in London and moves the offset with the week', async () => {
    const w = await world();
    const lon = await w.add('Lena London', { zone: 'Europe/London' });
    // Read on Wednesday 21 October 2026: clocks go back on Sunday 25 October.
    const now = () => new Date('2026-10-21T12:00:00.000Z');
    const before = await readTeamWeek(w.owner, { now }, { weekStart: '2026-10-19' });
    const after = await readTeamWeek(w.owner, { now }, { weekStart: '2026-10-26' });
    const rowOf = (week: typeof before) => week.rows.find((row) => row.memberId === lon);
    expect(rowOf(before)?.offsetMinutes).toBe(60);
    expect(rowOf(after)?.offsetMinutes).toBe(0);
    for (const week of [before, after]) {
      expect(
        rowOf(week)
          ?.days.slice(0, 5)
          .every((day) => JSON.stringify(day.ranges) === '[["09:00","17:00"]]'),
      ).toBe(true);
      expect(rowOf(week)?.weekMinutes).toBe(5 * 480);
    }
    expect(rowOf(before)?.timeZone).toBe('Europe/London');
  });
});

describe('one request, no query per member (AC-1296)', () => {
  it('reads 30 members in the same statements as 3, and pages and searches by name', async () => {
    const w = await world(counted);
    for (let index = 0; index < 3; index += 1) await w.add(`Early ${String(index)}`);
    const monday = thisMonday();
    const measure = async () => {
      statements.length = 0;
      counting = true;
      try {
        return await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday });
      } finally {
        counting = false;
      }
    };
    await measure();
    const few = statements.length;
    for (let index = 0; index < 57; index += 1) await w.add(`Later ${String(index).padStart(2, '0')}`);
    const first = await measure();
    expect(statements.length).toBe(few);
    // The workspace setting, the members with their schedules, and their time off: owners read no reach.
    expect(statements.filter((text) => /from members m/.test(text))).toHaveLength(1);
    expect(statements.filter((text) => /booking_time_blocks/.test(text))).toHaveLength(1);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]?.memberId).toBe(w.memberId);
    expect(first.nextCursor).toBeDefined();
    const second = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday, cursor: first.nextCursor });
    expect(second.rows).toHaveLength(11);
    expect(second.nextCursor).toBeUndefined();
    const all = [...first.rows, ...second.rows].map((row) => row.memberId);
    expect(new Set(all).size).toBe(61);
    // The footer counts the page's rows.
    expect(first.footer[0]?.working).toBe(50);
    const found = await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday, search: 'early 1' });
    expect(found.rows.map((row) => row.name)).toEqual(['Early 1']);
    // A wildcard is taken literally.
    expect((await readTeamWeek(w.owner, { now: realNow }, { weekStart: monday, search: '%' })).rows).toEqual([]);
  });
});
