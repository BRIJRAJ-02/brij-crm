// Forms analytics (spec 0063, AC-6320, AC-6321): counting a visit, and
// reading a form's numbers back.
//
// The privacy line (AC-6320), which the database holds too through
// `form_visits_visitor`: a visit is known only by the daily keyed hash of
// spec 0047, which the api mints from the address and the user agent and
// keeps neither. The same browser tomorrow is a different visitor, on
// purpose. There is no cookie here, no stored address and no lasting visitor
// id, and `source` is a UTM word or a referring host, never a whole address.
//
// Counting runs in the public form scope (the form as the actor, no data
// access). Reading runs in a member's scope and goes through the same door
// Submissions does: a member who may not see the form sees no numbers.
import {
  type FormAnalytics,
  type FormAnalyticsDay,
  type FormAnalyticsQuestion,
  type FormAnalyticsRange,
  type FormAnalyticsSource,
  type FormAnalyticsTotals,
  type FormEventKind,
} from '@crm/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { runWrite } from '../engine/write.ts';
import { canSeeForm, loadForm, loadVersions } from './shared.ts';
import { countPageVisit, finishPageVisit, VISITOR_ID, type VisitOrigin } from '../insights/visits.ts';

/** What counting one event takes. */
export interface FormEventInput {
  readonly formId: string;
  /** The daily keyed hash (spec 0047), and nothing else about the visitor. */
  readonly visitor: string;
  readonly kind: FormEventKind;
  /** Which question was reached, on a `reach`. */
  readonly questionId?: string;
  /** Where they came from, as the server read it from what the page sent (`originOf`, spec 0067). */
  readonly origin?: VisitOrigin;
}

/** Refuses (a programming error) any scope but the one the form's own public key made. */
function checkPublicScope(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope counts its visits.');
  }
}

/**
 * Counts one beacon event (AC-6320), since spec 0067 as a `form` page visit (`countPageVisit`):
 *
 * - `view` makes today's row and nothing more; a second view the same day changes only `last_at`, so views are
 *   visitors, not page loads.
 * - `start` and `reach` move the visit to the form's `start` step, stamping `started_at` the first time, so the
 *   time to finish is measured from the real first answer.
 * - `reach` moves the furthest question on, and only forwards: a visitor going Back never pulls the drop off bar
 *   backwards with them.
 *
 * Nothing here can fail a visitor's fill: the caller answers 204 whatever happens, since analytics are lossy by
 * design.
 */
export async function countFormEvent(scope: EngineScope, input: FormEventInput): Promise<void> {
  checkPublicScope(scope, input.formId);
  if (!VISITOR_ID.test(input.visitor)) throw new TypeError('A visitor is 32 lowercase hex digits.');
  await runWrite(scope, async ({ tx }) => {
    const form = await loadForm(tx, input.formId);
    if (form === undefined || form.liveVersionId === null || form.status === 'draft' || form.status === 'archived') {
      return;
    }
    // The form's own question order, so "furthest" can be compared at all.
    const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
    const order = (live?.document.questions ?? []).map((question) => question.id);
    await countPageVisit(tx, {
      workspaceId: scope.workspaceId,
      kind: 'form',
      pageId: input.formId,
      visitor: input.visitor,
      step: input.kind === 'view' ? 'view' : 'start',
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.kind === 'reach' && input.questionId !== undefined
        ? { detail: input.questionId, detailOrder: order }
        : {}),
    });
  });
}

/**
 * Marks today's visit complete when a submission is accepted (AC-6320), in the submit's own transaction, so a
 * submission that doesn't commit counts as nothing. Spam and held submissions never reach here: only an accepted
 * one is a completion. Since spec 0067 the visit is a `form` page visit, and keeps the submission it made, so
 * Insights can name the person to a member who may read that submission.
 */
export async function completeFormVisit(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly formId: string;
    readonly visitor: string | undefined;
    readonly submissionId?: string;
  },
): Promise<void> {
  await finishPageVisit(tx, {
    workspaceId: input.workspaceId,
    kind: 'form',
    pageId: input.formId,
    visitor: input.visitor,
    ...(input.submissionId === undefined ? {} : { outcomeId: input.submissionId }),
  });
}

/** One range's rows, as the counting queries hand them back. */
interface TotalsRow extends Record<string, unknown> {
  readonly views: number;
  readonly starts: number;
  readonly completions: number;
  readonly median_ms: number | null;
}

/** The headline numbers over one window. */
async function totalsIn(tx: WorkspaceTx, where: SQL): Promise<FormAnalyticsTotals> {
  const found = await tx.execute<TotalsRow>(sql`
    select
      count(*)::int as views,
      count(*) filter (where step_rank > 0)::int as starts,
      count(*) filter (where finished_at is not null)::int as completions,
      (percentile_cont(0.5) within group (order by duration_ms)
        filter (where duration_ms is not null))::int as median_ms
    from page_visits where ${where}
  `);
  const row = found.rows[0];
  return {
    views: row?.views ?? 0,
    starts: row?.starts ?? 0,
    completions: row?.completions ?? 0,
    ...(row?.median_ms === null || row?.median_ms === undefined ? {} : { medianMs: row.median_ms }),
  };
}

/** What a form's analytics read takes. */
export interface FormAnalyticsInputs {
  readonly formId: string;
  readonly range: FormAnalyticsRange;
}

/**
 * A form's analytics over a range (AC-6321), with the range before it for the
 * change line. The reader must be able to see the form, through the same
 * check Submissions uses (`canSeeForm`), so hidden stays absent rather than
 * locked.
 *
 * Every number comes from `form_visits` rows in range, counted in the
 * database: four grouped reads over one index (`form_visits_by_form_day`), no
 * row of which carries an address or anything lasting about a person.
 */
export async function formAnalytics(scope: EngineScope, input: FormAnalyticsInputs): Promise<FormAnalytics> {
  return inWorkspace(scope, async (tx) => {
    const form = await loadForm(tx, input.formId);
    if (form === undefined || !canSeeForm(scope.access, form)) {
      throw refuse('NOT_FOUND', 'That form does not exist.');
    }
    const { workspaceId } = scope;
    const { range } = input;
    const since = sql`(now() at time zone 'UTC')::date - ${range - 1}::integer`;
    const before = sql`(now() at time zone 'UTC')::date - ${range * 2 - 1}::integer`;
    const inRange = sql`workspace_id = ${workspaceId} and page_kind = 'form' and page_id = ${input.formId}
      and day >= ${since}`;
    const inPrevious = sql`workspace_id = ${workspaceId} and page_kind = 'form' and page_id = ${input.formId}
      and day >= ${before} and day < ${since}`;
    const [totals, previous] = await Promise.all([totalsIn(tx, inRange), totalsIn(tx, inPrevious)]);

    const days = await tx.execute<{ day: string; views: number; starts: number; completions: number }>(sql`
      select day::text as day, count(*)::int as views,
        count(*) filter (where step_rank > 0)::int as starts,
        count(*) filter (where finished_at is not null)::int as completions
      from page_visits where ${inRange} group by day order by day
    `);
    const byDay: FormAnalyticsDay[] = days.rows.map((row) => ({
      day: row.day,
      views: row.views,
      starts: row.starts,
      completions: row.completions,
    }));

    const sources = await tx.execute<{ source: string; views: number; completions: number }>(sql`
      select case when source = 'other' and referrer_host is not null then referrer_host else source end as source,
        count(*)::int as views,
        count(*) filter (where finished_at is not null)::int as completions
      from page_visits where ${inRange} group by 1 order by views desc, 1 limit 20
    `);
    const bySource: FormAnalyticsSource[] = sources.rows.map((row) => ({
      source: row.source,
      views: row.views,
      completions: row.completions,
    }));

    // Drop off needs the questions in the live form's own order, so a visit's furthest question becomes a position.
    const live =
      form.liveVersionId === null ? undefined : (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
    const questionIds = (live?.document.questions ?? []).map((question) => question.id);
    const byQuestion = questionIds.length === 0 ? [] : await dropOff(tx, inRange, questionIds);
    return { range, totals, previous, byDay, byQuestion, bySource };
  });
}

/**
 * Each question's drop off (AC-6321, AC-6322), worked out from the furthest
 * question each visit reached:
 *
 * - `reached`: visits whose furthest question is this one or a later one. A
 *   completion counts as having reached every question, since it got to the
 *   end.
 * - `answered`: visits that went past this question, or completed.
 * - `leftHere`: the difference, which is the bar the tab draws.
 *
 * A visit whose furthest question is no longer in the live form (it was
 * deleted since) counts towards nothing: it can't be placed in the order.
 */
async function dropOff(
  tx: WorkspaceTx,
  inRange: SQL,
  questionIds: readonly string[],
): Promise<FormAnalyticsQuestion[]> {
  const found = await tx.execute<{ furthest: string | null; completed: boolean; visits: number }>(sql`
    select furthest_detail as furthest, finished_at is not null as completed, count(*)::int as visits
    from page_visits where ${inRange} and (furthest_detail is not null or finished_at is not null)
    group by furthest_detail, finished_at is not null
  `);
  const positionOf = new Map(questionIds.map((id, at) => [id, at]));
  const last = questionIds.length - 1;
  /** How many visits stopped at each position, and how many reached the end. */
  const stoppedAt = new Array<number>(questionIds.length).fill(0);
  let completed = 0;
  for (const row of found.rows) {
    if (row.completed) {
      completed += row.visits;
      continue;
    }
    const at = row.furthest === null ? undefined : positionOf.get(row.furthest);
    if (at !== undefined) stoppedAt[at] = (stoppedAt[at] ?? 0) + row.visits;
  }
  // From the end backwards: everyone who stopped at or past a position reached it.
  const reachedAt = new Array<number>(questionIds.length).fill(0);
  let running = completed;
  for (let at = last; at >= 0; at -= 1) {
    running += stoppedAt[at] ?? 0;
    reachedAt[at] = running;
  }
  return questionIds.map((questionId, at) => {
    const reached = reachedAt[at] ?? 0;
    const leftHere = stoppedAt[at] ?? 0;
    return { questionId, reached, answered: reached - leftHere, leftHere };
  });
}
