// The Insights screen's reads (spec 0067, AC-6710 to AC-6715, AC-6717): the numbers and the sessions, over the pages
// the reader may see, in the member's own scope.
//
// Which pages a reader may see is each product's own rule, never a new one: a form through `canSeeForm` (the rule
// Submissions follows), a booking page through `listBookingPages` (their own, the workspace's links, and those
// their scheduling reach or editing opens), and their own link page. A page they can't see is absent, not locked.
//
// Names (AC-6715): a finished session names its person only when the reader may read that submission (its main
// record visible to them, `visibleRows`, and its email answer through the field rules, `answersOf`) or that booking
// (a page they may change, as its Bookings list requires). Everyone else reads "Finished" with no name.
import {
  INSIGHT_CUSTOM_MAX_DAYS,
  INSIGHT_SESSIONS_PAGE,
  PAGE_STEPS,
  VisitLanding,
  type InsightHeard,
  type InsightPage,
  type InsightPages,
  type InsightPeriod,
  type Insights,
  type InsightSession,
  type InsightSessionFilter,
  type InsightSessionPage,
  type PageKind,
} from '@crm/contracts';
import { inArray, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { can, fieldLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { listBookingPages } from '../booking/pages.ts';
import { publicProfilesOf } from '../booking/handles.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { canSeeForm, loadForms, loadVersions } from '../forms/shared.ts';
import { answersOf, COLUMNS, displays, visibleRows, type Row } from '../forms/submissions.ts';
import { daysIn, insightNumbers, resolvePeriod, type CoveredPage } from './numbers.ts';

const { bookings, formSubmissions } = schema;

/** A page the reader may see, and whether a finished session on it may name its person. */
export interface VisiblePage extends InsightPage {
  /** Booking pages: whether the reader may read its bookings. Forms check each submission instead. */
  readonly namesBookings: boolean;
}

/** The member's own user id, or undefined (a key, the system). */
function userOf(scope: EngineScope): string | undefined {
  const { principal } = scope.access;
  return principal.kind === 'member' ? principal.userId : undefined;
}

/** Every page the reader may see (AC-6710), forms first, then booking pages, then their own link page. */
export async function visiblePages(scope: EngineScope): Promise<readonly VisiblePage[]> {
  // Booking pages through their own list, which carries the whole reach rule; a reader without booking.manage
  // has none to see.
  const booking = can(scope.access, 'booking.manage') ? await listBookingPages(scope) : [];
  const user = userOf(scope);
  return inWorkspace(scope, async (tx) => {
    const ids = await tx.execute<{ id: string }>(
      // Every form: a workspace's older forms count as much as its newest.
      sql`select id::text as id from forms order by created_at desc`,
    );
    const forms = await loadForms(
      tx,
      ids.rows.map((row) => row.id),
    );
    const formPages = [...forms.values()]
      .filter((form) => canSeeForm(scope.access, form))
      .map((form): VisiblePage => ({ kind: 'form', id: form.id, name: form.name, namesBookings: false }));
    const bookingPages = booking.map((page): VisiblePage => ({
      kind: 'booking',
      id: page.id,
      name: page.ownerName === undefined ? page.title : `${page.title} (${page.ownerName})`,
      namesBookings: page.canChange,
    }));
    const handle = user === undefined ? undefined : (await publicProfilesOf(tx, scope.workspaceId, [user])).get(user);
    const link: VisiblePage[] =
      user === undefined || handle === undefined
        ? []
        : [{ kind: 'link', id: user, name: `@${handle.handle}`, namesBookings: false }];
    return [...formPages, ...bookingPages, ...link];
  });
}

/** The pages a filter picks out of the visible ones; a page the reader can't see is NOT_FOUND. */
export function pickPages(visible: readonly VisiblePage[], pages: InsightPages): readonly VisiblePage[] {
  if (pages.pageId !== undefined) {
    const found = visible.find(
      (page) => page.id === pages.pageId && (pages.kind === undefined || page.kind === pages.kind),
    );
    if (found === undefined) throw refuse('NOT_FOUND', 'That page does not exist.');
    return [found];
  }
  return pages.kind === undefined ? visible : visible.filter((page) => page.kind === pages.kind);
}

/** A custom range in the right order and no longer than the longest one, or INPUT_INVALID. */
export function checkPeriod(period: InsightPeriod): void {
  if (!('from' in period)) return;
  if (period.from > period.to) throw inputInvalid('period', 'Pick a start on or before the end.');
  if (daysIn(period) > INSIGHT_CUSTOM_MAX_DAYS) {
    throw inputInvalid('period', `Pick at most ${String(INSIGHT_CUSTOM_MAX_DAYS)} days.`);
  }
}

/** The Insights numbers (AC-6711 to AC-6714) over the pages picked, and the pages the picker offers. */
export async function readInsights(
  scope: EngineScope,
  input: { readonly period: InsightPeriod; readonly pages: InsightPages },
  now: Date = new Date(),
): Promise<Insights> {
  checkPeriod(input.period);
  const visible = await visiblePages(scope);
  const picked = pickPages(visible, input.pages);
  const covered: CoveredPage[] = picked.map((page) => ({ kind: page.kind, id: page.id }));
  return inWorkspace(scope, async (tx) => {
    const period = await resolvePeriod(tx, scope.workspaceId, covered, input.period, now);
    const numbers = await insightNumbers(tx, scope.workspaceId, covered, period, { previous: period.compare });
    const heard = await heardAnswers(
      tx,
      scope,
      picked.flatMap((page) => (page.kind === 'form' ? [page.id] : [])),
      period,
    );
    return {
      ...numbers,
      heard,
      sources: [...numbers.sources],
      buckets: [...numbers.buckets],
      others: [...numbers.others],
      pages: visible.map((page) => ({ kind: page.kind, id: page.id, name: page.name })),
    };
  });
}

/** The most answers the How did you hear list shows. */
const HEARD_MAX = 30;

/**
 * The How did you hear about us answers (AC-6703, AC-6714) of the forms in view that mark a source question, over
 * the period's submissions the spam check let through, most first. A question filed onto a field hidden from the
 * reader is left out, as Submissions leaves that answer out.
 */
async function heardAnswers(
  tx: WorkspaceTx,
  scope: EngineScope,
  formIds: readonly string[],
  period: { readonly from: string; readonly to: string },
): Promise<InsightHeard[]> {
  if (formIds.length === 0) return [];
  const forms = await loadForms(tx, formIds);
  const live = [...forms.values()].flatMap((form) => (form.liveVersionId === null ? [] : [form]));
  const versions = await loadVersions(
    tx,
    live.map((form) => form.liveVersionId ?? ''),
  );
  const asks = live.flatMap((form) => {
    const document = versions.get(form.liveVersionId ?? '')?.document;
    const question = document?.questions.find((each) => each.source === true);
    if (document === undefined || question === undefined) return [];
    const objectId = document.targets.main?.objectId;
    const attributeId = question.filedOn?.attributeId;
    if (
      attributeId !== undefined &&
      objectId !== undefined &&
      fieldLevel(scope.access, { id: attributeId, objectId }) === 'hidden'
    ) {
      return [];
    }
    return [{ formId: form.id, key: question.key }];
  });
  if (asks.length === 0) return [];
  const found = await tx.execute<{ answer: string; submissions: number }>(sql`
    select answer, count(*)::int as submissions
    from (
      ${sql.join(
        asks.map(
          (ask) => sql`
            select left(trim(s.answers ->> ${ask.key}), 80) as answer
            from form_submissions s
            where s.form_id = ${ask.formId} and s.state <> 'spam'
              and s.received_at >= (${period.from}::date)::timestamp at time zone 'UTC'
              and s.received_at < (${period.to}::date + 1)::timestamp at time zone 'UTC'`,
        ),
        sql` union all `,
      )}
    ) answered
    where answer is not null and answer <> ''
    group by answer
    order by submissions desc, answer
    limit ${HEARD_MAX}
  `);
  return found.rows.map((row) => ({ answer: row.answer, submissions: row.submissions }));
}

/** A sessions cursor: the last row's first time (microseconds, as Postgres writes it), kind, page and visitor. */
interface Cursor {
  readonly at: string;
  readonly kind: string;
  readonly pageId: string;
  readonly visitor: string;
}

const CURSOR_MESSAGE = 'That page of sessions is out of date. Start from the top.';

function encodeCursor(cursor: Cursor): string {
  return Buffer.from([cursor.at, cursor.kind, cursor.pageId, cursor.visitor].join('|'), 'utf8').toString('base64url');
}

function decodeCursor(text: string): Cursor {
  const parts = Buffer.from(text, 'base64url').toString('utf8').split('|');
  const [at, kind, pageId, visitor] = parts;
  if (
    parts.length !== 4 ||
    at === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(at) ||
    kind === undefined ||
    !(kind in PAGE_STEPS) ||
    pageId === undefined ||
    !/^[0-9a-f-]{36}$/u.test(pageId) ||
    visitor === undefined ||
    !/^[0-9a-f]{32}$/u.test(visitor)
  ) {
    throw inputInvalid('cursor', CURSOR_MESSAGE);
  }
  return { at, kind, pageId, visitor };
}

/** One raw visit as the sessions read takes it. */
interface SessionRow extends Record<string, unknown> {
  readonly page_kind: PageKind;
  readonly page_id: string;
  readonly day: string;
  readonly visitor: string;
  readonly at: string;
  readonly at_micros: string;
  readonly finished: boolean;
  readonly source: string;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly referrer_host: string | null;
  readonly furthest_step: string;
  readonly outcome_id: string | null;
  readonly landing: unknown;
}

/** The column filters as SQL. */
function filterSql(filter: InsightSessionFilter) {
  return sql.join(
    [
      filter.finished === undefined
        ? sql`true`
        : filter.finished
          ? sql`v.finished_at is not null`
          : sql`v.finished_at is null`,
      filter.source === undefined ? sql`true` : sql`v.source = ${filter.source}`,
      filter.medium === undefined ? sql`true` : sql`coalesce(v.medium, '') = ${filter.medium}`,
      filter.campaign === undefined ? sql`true` : sql`coalesce(v.campaign, '') = ${filter.campaign}`,
      filter.step === undefined
        ? sql`true`
        : filter.step === 'finish'
          ? sql`v.finished_at is not null`
          : sql`v.finished_at is null and v.furthest_step = ${filter.step}`,
    ],
    sql` and `,
  );
}

/** Names for finished form sessions the reader may read: by submission id. */
async function submissionPeople(
  tx: WorkspaceTx,
  scope: EngineScope,
  ids: readonly string[],
): Promise<ReadonlyMap<string, { name?: string; email?: string }>> {
  if (ids.length === 0) return new Map();
  const rows: Row[] = await tx
    .select(COLUMNS)
    .from(formSubmissions)
    .where(inArray(formSubmissions.id, [...ids]));
  const shown = await visibleRows(tx, scope, rows);
  const names = await displays(
    tx,
    scope,
    shown.flatMap((row) => (row.mainRecordId === null ? [] : [row.mainRecordId])),
  );
  const versions = await loadVersions(tx, [...new Set(shown.map((row) => row.versionId))]);
  return new Map(
    shown.map((row) => {
      const version = versions.get(row.versionId);
      const answers = version === undefined ? [] : answersOf(scope, version.document, row.answers);
      const email = answers.find((answer) => answer.answerType === 'email' && typeof answer.value === 'string');
      const name = row.mainRecordId === null ? undefined : names.get(row.mainRecordId)?.name;
      return [
        row.id,
        {
          ...(name === undefined || name === '' ? {} : { name }),
          ...(typeof email?.value === 'string' ? { email: email.value } : {}),
        },
      ] as const;
    }),
  );
}

/** Names for finished booking sessions on pages the reader may read the bookings of: by booking id. */
async function bookingPeople(
  tx: WorkspaceTx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, { name?: string; email?: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: bookings.id, name: bookings.visitorName, email: bookings.visitorEmail })
    .from(bookings)
    .where(inArray(bookings.id, [...ids]));
  return new Map(rows.map((row) => [row.id, { name: row.name, email: row.email }] as const));
}

/** A stored landing, read back through its schema; a bad one shows nothing. */
function landingOf(stored: unknown): VisitLanding | undefined {
  if (stored === null || stored === undefined) return undefined;
  const parsed = VisitLanding.safeParse(stored);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
}

/**
 * A page of recent sessions, newest first (AC-6715), over the pages picked and the period, filtered by column. A
 * finished one names its person only through the access door (see the file's head).
 */
export async function readInsightSessions(
  scope: EngineScope,
  input: {
    readonly period: InsightPeriod;
    readonly pages: InsightPages;
    readonly filter: InsightSessionFilter;
    readonly cursor?: string;
  },
  now: Date = new Date(),
): Promise<InsightSessionPage> {
  checkPeriod(input.period);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const visible = await visiblePages(scope);
  const picked = pickPages(visible, input.pages);
  if (picked.length === 0) return { items: [] };
  const byKey = new Map(picked.map((page) => [`${page.kind}:${page.id}`, page]));
  const kinds = `{${picked.map((page) => page.kind).join(',')}}`;
  const ids = `{${picked.map((page) => page.id).join(',')}}`;
  return inWorkspace(scope, async (tx) => {
    const period = await resolvePeriod(
      tx,
      scope.workspaceId,
      picked.map((page) => ({ kind: page.kind, id: page.id })),
      input.period,
      now,
    );
    const found = await tx.execute<SessionRow>(sql`
      select v.page_kind, v.page_id::text as page_id, v.day::text as day, v.visitor,
        to_char(v.first_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
        to_char(v.first_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_micros,
        v.finished_at is not null as finished, v.source, v.medium, v.campaign, v.referrer_host, v.furthest_step,
        v.outcome_id::text as outcome_id, v.landing
      from page_visits v
      where v.workspace_id = ${scope.workspaceId}
        and v.day between ${period.from}::date and ${period.to}::date
        -- The same period on first_at (a visit's day is its first moment's UTC day), so page_visits_recent walks
        -- only the period, newest first, and stops at a page.
        and v.first_at >= (${period.from}::date)::timestamp at time zone 'UTC'
        and v.first_at < (${period.to}::date + 1)::timestamp at time zone 'UTC'
        and (v.page_kind, v.page_id) in (select p.k, p.i from unnest(${kinds}::text[], ${ids}::uuid[]) as p(k, i))
        and ${filterSql(input.filter)}
        ${
          after === undefined
            ? sql``
            : sql`and (v.first_at, v.page_kind, v.page_id, v.visitor)
                < (${after.at}::timestamptz, ${after.kind}, ${after.pageId}::uuid, ${after.visitor})`
        }
      order by v.first_at desc, v.page_kind desc, v.page_id desc, v.visitor desc
      limit ${INSIGHT_SESSIONS_PAGE + 1}
    `);
    const rows = found.rows.slice(0, INSIGHT_SESSIONS_PAGE);
    const formOutcomes = rows.flatMap((row) =>
      row.finished && row.page_kind === 'form' && row.outcome_id !== null ? [row.outcome_id] : [],
    );
    const bookingOutcomes = rows.flatMap((row) =>
      row.finished &&
      row.page_kind === 'booking' &&
      row.outcome_id !== null &&
      byKey.get(`booking:${row.page_id}`)?.namesBookings === true
        ? [row.outcome_id]
        : [],
    );
    const formNames = await submissionPeople(tx, scope, formOutcomes);
    const bookingNames = await bookingPeople(tx, bookingOutcomes);
    const items = rows.map((row): InsightSession => {
      const page = byKey.get(`${row.page_kind}:${row.page_id}`);
      const person =
        row.outcome_id === null
          ? undefined
          : row.page_kind === 'form'
            ? formNames.get(row.outcome_id)
            : row.page_kind === 'booking'
              ? bookingNames.get(row.outcome_id)
              : undefined;
      const landing = landingOf(row.landing);
      return {
        id: `${row.page_kind}.${row.page_id}.${row.day}.${row.visitor}`,
        at: row.at,
        pageKind: row.page_kind,
        pageId: row.page_id,
        pageName: page?.name ?? '',
        finished: row.finished,
        source: row.source === 'other' && row.referrer_host !== null ? row.referrer_host : row.source,
        ...(row.medium === null ? {} : { medium: row.medium }),
        ...(row.campaign === null ? {} : { campaign: row.campaign }),
        furthestStep: row.finished ? 'finish' : row.furthest_step,
        ...(person === undefined || (person.name === undefined && person.email === undefined) ? {} : { person }),
        ...(landing === undefined ? {} : { landing }),
      };
    });
    const last = found.rows.length > INSIGHT_SESSIONS_PAGE ? rows.at(-1) : undefined;
    return {
      items,
      ...(last === undefined
        ? {}
        : {
            nextCursor: encodeCursor({
              at: last.at_micros,
              kind: last.page_kind,
              pageId: last.page_id,
              visitor: last.visitor,
            }),
          }),
    };
  });
}
