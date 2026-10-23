// The operator console's reads (spec 0047): the super admin's analytics across
// every workspace. Tenant numbers come only from crm_operator's six definers
// (counts, ids, names; migration 0092), called on the app login outside any
// workspace; people and website numbers from the identity login's global rows.
// Who may call these is the api's operator gate, never this module.
import {
  OPERATOR_USERS_PAGE,
  PERIOD_DAYS,
  type OperatorFigure,
  type OperatorOverview,
  type OperatorPageDay,
  type OperatorPageDetail,
  type OperatorPageRow,
  type OperatorPages,
  type OperatorPageTotals,
  type OperatorPeriod,
  type OperatorRange,
  type OperatorSite,
  type OperatorUserDetail,
  type OperatorUserPage,
  type OperatorUserRow,
  type OperatorUserWorkspace,
} from '@crm/contracts';
import type { Database, DayRange, OperatorIdentity } from '@crm/db';
import { sql, type SQL } from 'drizzle-orm';
import { refuse } from '../engine/refusals.ts';

/** What the console's reads need: the tenant database (for the definers) and the identity store's console piece. */
export interface OperatorDeps {
  readonly db: Database;
  readonly identity: OperatorIdentity;
  /** The clock, for tests. */
  readonly now?: () => Date;
}

/** The nil uuid: no workspace has it, so the definers run with every policy matching nothing around them. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The most ids one definer call takes. */
const IDS_MAX = 200;

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A period's days: `from` to `to` inclusive (the contract's), `end` exclusive, and `before` its earlier twin. */
export interface PeriodDays extends DayRange {
  readonly period: OperatorPeriod;
  readonly today: string;
  /** The last day, inclusive: today. */
  readonly last: string;
}

/** The days a period covers, ending today (UTC), and the same length before it. */
export function periodDays(period: OperatorPeriod, now: Date): PeriodDays {
  const days = PERIOD_DAYS[period];
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return {
    period,
    today: dayOf(today),
    last: dayOf(today),
    from: dayOf(today - (days - 1) * DAY_MS),
    to: dayOf(today + DAY_MS),
    before: dayOf(today - (2 * days - 1) * DAY_MS),
  };
}

const rangeOf = (days: PeriodDays): OperatorRange => ({ period: days.period, from: days.from, to: days.last });

/** A definer's rows, on the app login, outside every workspace. */
async function definer<Row extends Record<string, unknown>>(db: Database, query: SQL): Promise<Row[]> {
  const result = await db.withWorkspace(NO_WORKSPACE, (tx) => tx.execute(query));
  return result.rows as Row[];
}

/** A uuid array literal for a definer's argument. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;

/** `ids` in calls of at most 200, answers joined. */
async function chunked<Row>(
  ids: readonly string[],
  read: (chunk: readonly string[]) => Promise<Row[]>,
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += IDS_MAX) chunks.push(unique.slice(start, start + IDS_MAX));
  return (await Promise.all(chunks.map(read))).flat();
}

const figure = (value: number, before: number): OperatorFigure => ({ value, before });

interface TotalsRow extends Record<string, unknown> {
  workspaces: number;
  workspaces_made: number;
}

interface DailyRow extends Record<string, unknown> {
  day: string;
  records_made: number;
  bookings_made: number;
  submissions: number;
}

interface WorkspaceRow extends Record<string, unknown> {
  workspace_id: string;
  name: string;
  slug: string;
  deleted_at: string | null;
  members: number;
  records: number;
}

interface MemberRow extends Record<string, unknown> {
  user_id: string;
  workspace_id: string;
  role: string;
  status: string;
  records_made: number;
  bookings_hosted: number;
  pages_owned: number;
}

interface PageRow extends Record<string, unknown> {
  workspace_id: string;
  workspace_name: string;
  page_id: string;
  title: string;
  kind: string;
  status: string;
  owner_user_id: string | null;
  created_at: string;
  views: number;
  visitors: number;
  bookings: number;
  cancelled: number;
}

const totals = (db: Database, from: string, to: string) =>
  definer<TotalsRow>(db, sql`select * from crm_operator_totals(${from}::date, ${to}::date)`).then((rows) => rows[0]);

const workspacesOf = (db: Database, ids: readonly string[]) =>
  chunked(ids, (chunk) =>
    definer<WorkspaceRow>(
      db,
      sql`select workspace_id, name, slug, deleted_at::text, members, records from crm_operator_workspaces(${uuids(chunk)})`,
    ),
  );

/** The most (workspace, person) pairs one members call takes. */
const PAIRS_MAX = 400;

/** Each member row of these people, asked by the (workspace, person) pairs the directory holds. */
async function membersOf(deps: OperatorDeps, userIds: readonly string[], days: DayRange): Promise<MemberRow[]> {
  const pairs = await deps.identity.operatorMemberships(userIds);
  const chunks: (typeof pairs)[number][][] = [];
  for (let start = 0; start < pairs.length; start += PAIRS_MAX) chunks.push(pairs.slice(start, start + PAIRS_MAX));
  const answers = await Promise.all(
    chunks.map((chunk) =>
      definer<MemberRow>(
        deps.db,
        sql`select * from crm_operator_members(${uuids(chunk.map((pair) => pair.workspaceId))}, ${uuids(
          chunk.map((pair) => pair.userId),
        )}, ${days.from}::date, ${days.to}::date)`,
      ),
    ),
  );
  return answers.flat();
}

const pageDays = (db: Database, from: string, to: string, page?: { workspaceId: string; pageId: string }) =>
  definer<OperatorPageDay & Record<string, unknown>>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, views, visitors, bookings, cancelled
      from crm_operator_page_days(${from}::date, ${to}::date, ${page?.workspaceId ?? null}::uuid, ${page?.pageId ?? null}::uuid)`,
  );

const pageTotals = (days: readonly OperatorPageDay[], before: readonly OperatorPageDay[]): OperatorPageTotals => {
  const sum = (list: readonly OperatorPageDay[], key: 'views' | 'visitors' | 'bookings' | 'cancelled') =>
    list.reduce((total, day) => total + day[key], 0);
  return {
    views: figure(sum(days, 'views'), sum(before, 'views')),
    visitors: figure(sum(days, 'visitors'), sum(before, 'visitors')),
    bookings: figure(sum(days, 'bookings'), sum(before, 'bookings')),
    cancelled: figure(sum(days, 'cancelled'), sum(before, 'cancelled')),
  };
};

/** Overview (AC-1629): people, activity, workspaces, records, bookings and submissions, with daily bars. */
export async function operatorOverview(deps: OperatorDeps, period: OperatorPeriod): Promise<OperatorOverview> {
  const days = periodDays(period, deps.now?.() ?? new Date());
  // One daily read over both periods: each tenant's recent rows are read once, then summed on either side of `from`.
  const [people, now, before, daily] = await Promise.all([
    deps.identity.operatorPeople(days, days.today),
    totals(deps.db, days.from, days.to),
    totals(deps.db, days.before, days.from),
    definer<DailyRow>(
      deps.db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, records_made, bookings_made, submissions from crm_operator_daily(${days.before}::date, ${days.to}::date)`,
    ),
  ]);
  const made = new Map(daily.map((row) => [row.day, row]));
  const sum = (key: 'records_made' | 'bookings_made' | 'submissions', inPeriod: boolean) =>
    daily.reduce((total, row) => total + (row.day >= days.from === inPeriod ? row[key] : 0), 0);
  const both = (key: 'records_made' | 'bookings_made' | 'submissions') => figure(sum(key, true), sum(key, false));
  return {
    ...rangeOf(days),
    people: { total: people.total, new: figure(people.made, people.madeBefore) },
    active: {
      period: figure(people.activePeriod, people.activeBefore),
      today: people.activeToday,
      week: people.activeWeek,
      month: people.activeMonth,
    },
    workspaces: {
      total: now?.workspaces ?? 0,
      new: figure(now?.workspaces_made ?? 0, before?.workspaces_made ?? 0),
    },
    records: both('records_made'),
    bookings: both('bookings_made'),
    submissions: both('submissions'),
    days: people.days.map((day) => ({
      day: day.day,
      signups: day.signups,
      active: day.active,
      records: made.get(day.day)?.records_made ?? 0,
      bookings: made.get(day.day)?.bookings_made ?? 0,
    })),
  };
}

/** Each person's made counts across their workspaces. */
function usageByUser(rows: readonly MemberRow[]) {
  const usage = new Map<string, { records: number; bookings: number; pages: number }>();
  for (const row of rows) {
    const held = usage.get(row.user_id) ?? { records: 0, bookings: 0, pages: 0 };
    usage.set(row.user_id, {
      records: held.records + row.records_made,
      bookings: held.bookings + row.bookings_hosted,
      pages: held.pages + row.pages_owned,
    });
  }
  return usage;
}

/** Users (AC-1630): a page of people, newest first, with what they made in the period. */
export async function operatorUsers(
  deps: OperatorDeps,
  input: { readonly period: OperatorPeriod; readonly q?: string; readonly after?: string },
): Promise<OperatorUserPage> {
  const days = periodDays(input.period, deps.now?.() ?? new Date());
  const { people, total } = await deps.identity.operatorPersons({
    range: days,
    max: OPERATOR_USERS_PAGE,
    ...(input.q === undefined || input.q === '' ? {} : { search: input.q }),
    ...(input.after === undefined ? {} : { after: input.after }),
  });
  const usage = usageByUser(
    await membersOf(
      deps,
      people.map((person) => person.id),
      days,
    ),
  );
  const users: OperatorUserRow[] = people.map((person) => {
    const used = usage.get(person.id);
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      createdAt: person.createdAt,
      ...(person.lastActiveAt === undefined ? {} : { lastActiveAt: person.lastActiveAt }),
      activeDays: person.activeDays,
      workspaces: person.workspaces,
      recordsMade: used?.records ?? 0,
      bookingsHosted: used?.bookings ?? 0,
      pages: used?.pages ?? 0,
      twoFactor: person.twoFactor,
    };
  });
  const last = people.at(-1);
  return {
    ...rangeOf(days),
    total,
    users,
    ...(people.length === OPERATOR_USERS_PAGE && last !== undefined ? { next: last.cursor } : {}),
  };
}

/** Every day of a period, in order. */
function everyDay(days: PeriodDays): string[] {
  const list: string[] = [];
  for (let at = Date.parse(`${days.from}T00:00:00Z`); at < Date.parse(`${days.to}T00:00:00Z`); at += DAY_MS) {
    list.push(dayOf(at));
  }
  return list;
}

/** A person's page (AC-1630): their facts, active days, and each workspace with what they made there. */
export async function operatorUser(
  deps: OperatorDeps,
  input: { readonly userId: string; readonly period: OperatorPeriod },
): Promise<OperatorUserDetail> {
  const days = periodDays(input.period, deps.now?.() ?? new Date());
  const person = await deps.identity.operatorPerson(input.userId, days);
  if (person === undefined) throw refuse('NOT_FOUND', 'There is no account with that id.');
  const members = await membersOf(deps, [person.id], days);
  const ids = [...new Set([...person.workspaceIds, ...members.map((member) => member.workspace_id)])];
  const workspaces = new Map((await workspacesOf(deps.db, ids)).map((row) => [row.workspace_id, row]));
  const usage = usageByUser(members).get(person.id);
  const active = new Set(person.days);
  const list: OperatorUserWorkspace[] = members.flatMap((member) => {
    const workspace = workspaces.get(member.workspace_id);
    if (workspace === undefined) return [];
    return [
      {
        workspaceId: member.workspace_id,
        name: workspace.name,
        slug: workspace.slug,
        role: member.role,
        status: member.status,
        deleted: workspace.deleted_at !== null,
        members: workspace.members,
        records: workspace.records,
        recordsMade: member.records_made,
        bookingsHosted: member.bookings_hosted,
        pagesOwned: member.pages_owned,
      },
    ];
  });
  return {
    ...rangeOf(days),
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      emailVerified: person.emailVerified,
      createdAt: person.createdAt,
      ...(person.lastActiveAt === undefined ? {} : { lastActiveAt: person.lastActiveAt }),
      activeDays: person.activeDays,
      workspaces: person.workspaces,
      recordsMade: usage?.records ?? 0,
      bookingsHosted: usage?.bookings ?? 0,
      pages: usage?.pages ?? 0,
      twoFactor: person.twoFactor,
      methods: person.google ? ['email', 'google'] : ['email'],
      sessions: person.sessions,
    },
    days: everyDay(days).map((day) => ({ day, active: active.has(day) })),
    workspaces: list.sort((a, b) => b.recordsMade - a.recordsMade || a.name.localeCompare(b.name)),
  };
}

/** Booking page rows with their owner's name. */
async function pageRows(deps: OperatorDeps, rows: readonly PageRow[]): Promise<OperatorPageRow[]> {
  const owners = await deps.identity.operatorNames(
    rows.flatMap((row) => (row.owner_user_id === null ? [] : [row.owner_user_id])),
  );
  return rows.map((row) => {
    const owner = row.owner_user_id === null ? undefined : owners.get(row.owner_user_id);
    return {
      pageId: row.page_id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      title: row.title,
      kind: row.kind,
      status: row.status,
      ...(owner === undefined || row.owner_user_id === null
        ? {}
        : { owner: { id: row.owner_user_id, name: owner.name, email: owner.email } }),
      createdAt: new Date(row.created_at).toISOString(),
      views: row.views,
      visitors: row.visitors,
      bookings: row.bookings,
      cancelled: row.cancelled,
    };
  });
}

const PAGE_COLUMNS = sql`workspace_id, workspace_name, page_id, title, kind, status, owner_user_id, created_at::text, views, visitors, bookings, cancelled`;

/** Booking pages (AC-1631): every page together, by day, and each page, most viewed first. */
export async function operatorPages(deps: OperatorDeps, period: OperatorPeriod): Promise<OperatorPages> {
  const days = periodDays(period, deps.now?.() ?? new Date());
  const [rows, current, before] = await Promise.all([
    definer<PageRow>(
      deps.db,
      sql`select ${PAGE_COLUMNS} from crm_operator_pages(${days.from}::date, ${days.to}::date, null)`,
    ),
    pageDays(deps.db, days.from, days.to),
    pageDays(deps.db, days.before, days.from),
  ]);
  return {
    ...rangeOf(days),
    totals: pageTotals(current, before),
    days: current,
    pages: await pageRows(deps, rows),
  };
}

/** One booking page (AC-1631): its figures against the period before, and its days. */
export async function operatorPage(
  deps: OperatorDeps,
  input: { readonly pageId: string; readonly period: OperatorPeriod },
): Promise<OperatorPageDetail> {
  const days = periodDays(input.period, deps.now?.() ?? new Date());
  const [row] = await definer<PageRow>(
    deps.db,
    sql`select ${PAGE_COLUMNS} from crm_operator_pages(${days.from}::date, ${days.to}::date, ${input.pageId}::uuid)`,
  );
  if (row === undefined) throw refuse('NOT_FOUND', 'There is no booking page with that id.');
  const page = { workspaceId: row.workspace_id, pageId: row.page_id };
  const [current, before, [described]] = await Promise.all([
    pageDays(deps.db, days.from, days.to, page),
    pageDays(deps.db, days.before, days.from, page),
    pageRows(deps, [row]),
  ]);
  if (described === undefined) throw refuse('NOT_FOUND', 'There is no booking page with that id.');
  return { ...rangeOf(days), page: described, totals: pageTotals(current, before), days: current };
}

/** Website (AC-1632): the marketing site's visitors and views, by day, and its top pages and sources. */
export async function operatorSite(deps: OperatorDeps, period: OperatorPeriod): Promise<OperatorSite> {
  const days = periodDays(period, deps.now?.() ?? new Date());
  const facts = await deps.identity.siteFacts(days);
  return {
    ...rangeOf(days),
    hasVisits: facts.hasVisits,
    visitors: figure(facts.visitors, facts.visitorsBefore),
    views: figure(facts.views, facts.viewsBefore),
    days: [...facts.days],
    pages: [...facts.pages],
    referrers: [...facts.referrers],
    sources: [...facts.sources],
    countries: [...facts.countries],
    devices: [...facts.devices],
  };
}
