// The operator console's global reads and writes (spec 0047), on the identity
// login, which alone reads and writes schema `auth`: the days each person used
// the app, the marketing site's visits, the console's own log, and the
// people facts the console shows. Never a session token, an address, a user
// agent or a security event's detail.
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An instant as Postgres writes it, in the contracts' ISO 8601 UTC shape. */
const iso = (column: SQL) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The UTC midnight a day starts at. */
const startOf = (day: string) => sql`(${day}::date)::timestamp at time zone 'UTC'`;

/** The days a read covers: `from` inclusive, `to` exclusive, UTC; `before` starts the same length earlier. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
  readonly before: string;
}

/** One visit the marketing site's beacon reported, as kept (AC-1627). */
export interface SiteVisitInput {
  readonly site: string;
  readonly path: string;
  readonly referrer?: string;
  readonly source?: string;
  readonly country?: string;
  readonly device: 'mobile' | 'tablet' | 'desktop';
  readonly visitor: string;
}

/** One console read, written before it runs (AC-1620). */
export interface OperatorEventInput {
  readonly userId: string;
  readonly action: string;
  readonly target?: string;
  readonly period?: string;
  readonly requestId: string;
}

/** The people side of Overview. */
export interface OperatorPeopleFacts {
  readonly total: number;
  readonly made: number;
  readonly madeBefore: number;
  readonly activeToday: number;
  readonly activeWeek: number;
  readonly activeMonth: number;
  /** Every day in the range, in order. */
  readonly days: readonly { readonly day: string; readonly signups: number; readonly active: number }[];
}

/** One person as the users list shows them. */
export interface OperatorPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly twoFactor: boolean;
  readonly lastActiveAt?: string;
  readonly activeDays: number;
  readonly workspaces: number;
  /** Where a page that ends with this person ends: `<created_at in microseconds since 1970>.<id>`. */
  readonly cursor: string;
}

/** One person's page: their facts, sign in methods, live sessions, active days and workspaces. */
export interface OperatorPersonDetail extends Omit<OperatorPerson, 'cursor'> {
  readonly google: boolean;
  readonly sessions: number;
  readonly days: readonly string[];
  readonly workspaceIds: readonly string[];
}

/** A ranked count. */
export interface SiteRank {
  readonly name: string;
  readonly visitors: number;
  readonly views: number;
}

/** The website's figures. */
export interface SiteFacts {
  readonly visitors: number;
  readonly views: number;
  readonly visitorsBefore: number;
  readonly viewsBefore: number;
  readonly days: readonly { readonly day: string; readonly visitors: number; readonly views: number }[];
  readonly pages: readonly SiteRank[];
  readonly referrers: readonly SiteRank[];
  readonly sources: readonly SiteRank[];
  readonly countries: readonly SiteRank[];
  readonly devices: readonly SiteRank[];
}

/** The console's piece of the identity store. */
export interface OperatorIdentity {
  /** Notes that this person used the app today (AC-1624): one upsert of today's row. */
  noteActivity(userId: string): Promise<void>;
  /** Keeps one marketing site visit (AC-1627). */
  recordSiteVisit(visit: SiteVisitInput): Promise<void>;
  /** Writes one console read to the log (AC-1620); throws when it can't, so the read never runs unlogged. */
  logOperatorEvent(event: OperatorEventInput): Promise<void>;
  /** Overview's people: totals, made in the range and the one before, active now, and per day. */
  operatorPeople(range: DayRange, today: string): Promise<OperatorPeopleFacts>;
  /**
   * People newest first (a page of `max`, after `after`: the last row's `cursor`), matching `search` in the name
   * or email when given, with their activity in the range; and how many match in all.
   */
  operatorPersons(input: {
    readonly range: DayRange;
    readonly search?: string;
    readonly after?: string;
    readonly max: number;
  }): Promise<{ readonly people: readonly OperatorPerson[]; readonly total: number }>;
  /** One person's page, or undefined when there is no such account. */
  operatorPerson(userId: string, range: DayRange): Promise<OperatorPersonDetail | undefined>;
  /** People by id, for naming booking page owners: id, name and email only. */
  operatorNames(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly name: string; readonly email: string }>>;
  /** The website's figures in the range, and the range before it. */
  siteFacts(range: DayRange): Promise<SiteFacts>;
}

/** How many rows each ranking keeps. */
const RANK_MAX = 20;

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

const checkRange = (range: DayRange) => DAY.test(range.from) && DAY.test(range.to) && DAY.test(range.before);

/** The console's piece of the identity store, on the identity login's Drizzle instance. */
export function createOperatorIdentity(db: NodePgDatabase<Record<string, unknown>>): OperatorIdentity {
  const rank = async (range: DayRange, column: SQL): Promise<SiteRank[]> => {
    const result = await db.execute<{ name: string; visitors: number; views: number }>(sql`
      select ${column} as name, count(distinct (v.at at time zone 'UTC')::date || v.visitor)::int as visitors,
        count(*)::int as views
      from auth.site_visit v
      where v.at >= ${startOf(range.from)} and v.at < ${startOf(range.to)} and ${column} is not null
      group by 1
      order by 2 desc, 3 desc, 1
      limit ${RANK_MAX}
    `);
    return result.rows;
  };

  return {
    async noteActivity(userId) {
      if (!UUID.test(userId)) return;
      await db.execute(sql`
        insert into auth.activity_day (user_id, day)
        values (${userId}, (now() at time zone 'UTC')::date)
        on conflict (user_id, day) do update set last_at = now()
      `);
    },

    async recordSiteVisit(visit) {
      await db.execute(sql`
        insert into auth.site_visit (site, path, referrer, source, country, device, visitor)
        values (${visit.site}, ${visit.path}, ${visit.referrer ?? null}, ${visit.source ?? null},
          ${visit.country ?? null}, ${visit.device}, ${visit.visitor})
      `);
    },

    async logOperatorEvent(event) {
      await db.execute(sql`
        insert into auth.operator_event (user_id, action, target, period, request_id)
        values (${event.userId}, ${event.action}, ${event.target ?? null}, ${event.period ?? null}, ${event.requestId})
      `);
    },

    async operatorPeople(range, today) {
      if (!checkRange(range) || !DAY.test(today)) throw new TypeError('A range is UTC days, YYYY-MM-DD.');
      const totals = await db.execute<{
        total: number;
        made: number;
        made_before: number;
        today: number;
        week: number;
        month: number;
      }>(sql`
        select
          (select count(*)::int from auth.user) as total,
          (select count(*)::int from auth.user u
            where u.created_at >= ${startOf(range.from)} and u.created_at < ${startOf(range.to)}) as made,
          (select count(*)::int from auth.user u
            where u.created_at >= ${startOf(range.before)} and u.created_at < ${startOf(range.from)}) as made_before,
          (select count(*)::int from auth.activity_day a where a.day = ${today}::date) as today,
          (select count(distinct a.user_id)::int from auth.activity_day a
            where a.day > ${today}::date - 7 and a.day <= ${today}::date) as week,
          (select count(distinct a.user_id)::int from auth.activity_day a
            where a.day > ${today}::date - 30 and a.day <= ${today}::date) as month
      `);
      const days = await db.execute<{ day: string; signups: number; active: number }>(sql`
        select to_char(d.day, 'YYYY-MM-DD') as day,
          (select count(*)::int from auth.user u
            where u.created_at >= d.day::timestamp at time zone 'UTC'
              and u.created_at < (d.day + 1)::timestamp at time zone 'UTC') as signups,
          (select count(*)::int from auth.activity_day a where a.day = d.day) as active
        from (
          select g::date as day
          from generate_series(${range.from}::date::timestamp, ${range.to}::date::timestamp - interval '1 day',
            interval '1 day') g
        ) d
        order by d.day
      `);
      const row = totals.rows[0];
      return {
        total: row?.total ?? 0,
        made: row?.made ?? 0,
        madeBefore: row?.made_before ?? 0,
        activeToday: row?.today ?? 0,
        activeWeek: row?.week ?? 0,
        activeMonth: row?.month ?? 0,
        days: days.rows,
      };
    },

    async operatorPersons({ range, search, after, max }) {
      if (!checkRange(range)) throw new TypeError('A range is UTC days, YYYY-MM-DD.');
      const [micros, afterId] = after?.split('.') ?? [];
      if (
        after !== undefined &&
        (micros === undefined || !/^\d{1,17}$/.test(micros) || afterId === undefined || !UUID.test(afterId))
      )
        return { people: [], total: 0 };
      const term = search === undefined || search === '' ? undefined : likeTerm(search.toLowerCase());
      const matches = term === undefined ? sql`true` : sql`(lower(u.name) like ${term} or u.email like ${term})`;
      const page = await db.execute<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
        created_at: string;
        two_factor: boolean;
        last_active_at: string | null;
        active_days: number;
        workspaces: number;
        created_us: string;
      }>(sql`
        select u.id, u.name, u.email, u.email_verified, ${iso(sql`u.created_at`)} as created_at,
          (extract(epoch from u.created_at) * 1000000)::bigint::text as created_us,
          u.two_factor_enabled as two_factor,
          ${iso(sql`(select max(a.last_at) from auth.activity_day a where a.user_id = u.id)`)} as last_active_at,
          (select count(*)::int from auth.activity_day a
            where a.user_id = u.id and a.day >= ${range.from}::date and a.day < ${range.to}::date) as active_days,
          (select count(*)::int from auth.workspace_membership m where m.user_id = u.id) as workspaces
        from auth.user u
        where ${matches}
          ${
            micros === undefined || afterId === undefined
              ? sql``
              : sql`and (u.created_at, u.id) < (timestamptz 'epoch' + ${micros}::bigint * interval '1 microsecond', ${afterId}::uuid)`
          }
        order by u.created_at desc, u.id desc
        limit ${Math.max(1, Math.min(max, 200))}
      `);
      const counted = await db.execute<{ total: number }>(
        sql`select count(*)::int as total from auth.user u where ${matches}`,
      );
      return {
        people: page.rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          emailVerified: row.email_verified,
          createdAt: row.created_at,
          twoFactor: row.two_factor,
          ...(row.last_active_at === null ? {} : { lastActiveAt: row.last_active_at }),
          activeDays: row.active_days,
          workspaces: row.workspaces,
          cursor: `${row.created_us}.${row.id}`,
        })),
        total: counted.rows[0]?.total ?? 0,
      };
    },

    async operatorPerson(userId, range) {
      if (!UUID.test(userId) || !checkRange(range)) return undefined;
      const found = await db.execute<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
        created_at: string;
        two_factor: boolean;
        last_active_at: string | null;
        google: boolean;
        sessions: number;
      }>(sql`
        select u.id, u.name, u.email, u.email_verified, ${iso(sql`u.created_at`)} as created_at,
          u.two_factor_enabled as two_factor,
          ${iso(sql`(select max(a.last_at) from auth.activity_day a where a.user_id = u.id)`)} as last_active_at,
          exists (select 1 from auth.account c where c.user_id = u.id and c.provider_id = 'google') as google,
          (select count(*)::int from auth.session s where s.user_id = u.id and s.expires_at > now()) as sessions
        from auth.user u
        where u.id = ${userId}
      `);
      const row = found.rows[0];
      if (row === undefined) return undefined;
      const days = await db.execute<{ day: string }>(sql`
        select to_char(a.day, 'YYYY-MM-DD') as day from auth.activity_day a
        where a.user_id = ${userId} and a.day >= ${range.from}::date and a.day < ${range.to}::date
        order by a.day
      `);
      const memberships = await db.execute<{ workspace_id: string }>(sql`
        select m.workspace_id from auth.workspace_membership m where m.user_id = ${userId} order by m.created_at
      `);
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.email_verified,
        createdAt: row.created_at,
        twoFactor: row.two_factor,
        ...(row.last_active_at === null ? {} : { lastActiveAt: row.last_active_at }),
        activeDays: days.rows.length,
        workspaces: memberships.rows.length,
        google: row.google,
        sessions: row.sessions,
        days: days.rows.map((day) => day.day),
        workspaceIds: memberships.rows.map((membership) => membership.workspace_id),
      };
    },

    async operatorNames(userIds) {
      const ids = [...new Set(userIds.filter((id) => UUID.test(id)))];
      if (ids.length === 0) return new Map();
      const rows = await db.execute<{ id: string; name: string; email: string }>(sql`
        select u.id, u.name, u.email from auth.user u
        where u.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      `);
      return new Map(rows.rows.map((row) => [row.id, { name: row.name, email: row.email }]));
    },

    async siteFacts(range) {
      if (!checkRange(range)) throw new TypeError('A range is UTC days, YYYY-MM-DD.');
      const totals = await db.execute<{
        visitors: number;
        views: number;
        visitors_before: number;
        views_before: number;
      }>(sql`
        select
          count(distinct (v.at at time zone 'UTC')::date || v.visitor)
            filter (where v.at >= ${startOf(range.from)})::int as visitors,
          (count(*) filter (where v.at >= ${startOf(range.from)}))::int as views,
          count(distinct (v.at at time zone 'UTC')::date || v.visitor)
            filter (where v.at < ${startOf(range.from)})::int as visitors_before,
          (count(*) filter (where v.at < ${startOf(range.from)}))::int as views_before
        from auth.site_visit v
        where v.at >= ${startOf(range.before)} and v.at < ${startOf(range.to)}
      `);
      const days = await db.execute<{ day: string; visitors: number; views: number }>(sql`
        select to_char(d.day, 'YYYY-MM-DD') as day,
          coalesce(x.visitors, 0)::int as visitors, coalesce(x.views, 0)::int as views
        from (
          select g::date as day
          from generate_series(${range.from}::date::timestamp, ${range.to}::date::timestamp - interval '1 day',
            interval '1 day') g
        ) d
        left join (
          select (v.at at time zone 'UTC')::date as day, count(distinct v.visitor) as visitors, count(*) as views
          from auth.site_visit v
          where v.at >= ${startOf(range.from)} and v.at < ${startOf(range.to)}
          group by 1
        ) x on x.day = d.day
        order by d.day
      `);
      const row = totals.rows[0];
      const [pages, referrers, sources, countries, devices] = await Promise.all([
        rank(range, sql`v.path`),
        rank(range, sql`v.referrer`),
        rank(range, sql`v.source`),
        rank(range, sql`v.country`),
        rank(range, sql`v.device`),
      ]);
      return {
        visitors: row?.visitors ?? 0,
        views: row?.views ?? 0,
        visitorsBefore: row?.visitors_before ?? 0,
        viewsBefore: row?.views_before ?? 0,
        days: days.rows,
        pages,
        referrers,
        sources,
        countries,
        devices,
      };
    },
  };
}
