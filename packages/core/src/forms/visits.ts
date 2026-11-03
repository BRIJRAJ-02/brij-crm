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
  FORM_SOURCE_MAX,
  normaliseSource,
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

/** A daily visitor id (spec 0047, AC-1626): 32 lowercase hex digits, an HMAC the api made; never an address. */
const VISITOR_ID = /^[0-9a-f]{32}$/u;

/** What counting one event takes. */
export interface FormEventInput {
  readonly formId: string;
  /** The daily keyed hash (spec 0047), and nothing else about the visitor. */
  readonly visitor: string;
  readonly kind: FormEventKind;
  /** Which question was reached, on a `reach`. */
  readonly questionId?: string;
  /** Where they came from, as the page saw it; normalised here, and the server's answer is what is kept. */
  readonly source?: { readonly utmSource?: string; readonly referrer?: string };
}

/** Refuses (a programming error) any scope but the one the form's own public key made. */
function checkPublicScope(scope: EngineScope, formId: string): void {
  const { principal } = scope.access;
  if (principal.kind !== 'form' || principal.formId !== formId) {
    throw new Error('Only the form’s own public scope counts its visits.');
  }
}

/**
 * Counts one beacon event (AC-6320). Today's row for this form and visitor is
 * made or moved on, in one statement:
 *
 * - `view` makes the row and nothing more; a second view the same day changes
 *   only `last_at`, so views are visitors, not page loads.
 * - `start` stamps `started_at` the first time an answer was given, and never
 *   again, so the median time is measured from the real first answer.
 * - `reach` moves `furthest_question_id` on, and only forwards: a visitor
 *   going Back never pulls the drop off bar backwards with them.
 *
 * Nothing here can fail a visitor's fill: the caller answers 204 whatever
 * happens, since analytics are lossy by design.
 */
export async function countFormEvent(scope: EngineScope, input: FormEventInput): Promise<void> {
  checkPublicScope(scope, input.formId);
  if (!VISITOR_ID.test(input.visitor)) throw new TypeError('A visitor is 32 lowercase hex digits.');
  const source = normaliseSource(input.source ?? {}).slice(0, FORM_SOURCE_MAX);
  await runWrite(scope, async ({ tx }) => {
    const form = await loadForm(tx, input.formId);
    if (form === undefined || form.liveVersionId === null || form.status === 'draft' || form.status === 'archived') {
      return;
    }
    const started = input.kind === 'start' ? sql`now()` : sql`null`;
    const reached = input.kind === 'reach' && input.questionId !== undefined ? input.questionId : null;
    // The form's own question order, so "furthest" can be compared at all: the database has no idea which of two
    // question ids comes first, and a visitor pressing Back must not pull their drop off bar back with them.
    const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
    const order = (live?.document.questions ?? []).map((question) => question.id);
    await tx.execute(sql`
      insert into form_visits (workspace_id, form_id, day, visitor, version_id, source, started_at, furthest_question_id)
      values (
        ${scope.workspaceId}, ${input.formId}, (now() at time zone 'UTC')::date, ${input.visitor},
        ${form.liveVersionId}, ${source}, ${started}, ${reached}
      )
      on conflict (workspace_id, form_id, day, visitor) do update set
        last_at = now(),
        -- The first answer wins: a later start never moves the clock the median is measured from.
        started_at = coalesce(form_visits.started_at, excluded.started_at),
        -- Forwards only (the Back case): the new question replaces the kept one just when it sits later in the
        -- form's order. A question the live form no longer has scores 0, so it never beats one that is still there.
        furthest_question_id = case
          when excluded.furthest_question_id is null then form_visits.furthest_question_id
          when form_visits.furthest_question_id is null then excluded.furthest_question_id
          when coalesce(array_position(${sql.param(order)}::text[], excluded.furthest_question_id), 0)
             > coalesce(array_position(${sql.param(order)}::text[], form_visits.furthest_question_id), 0)
            then excluded.furthest_question_id
          else form_visits.furthest_question_id
        end
    `);
  });
}

/**
 * Marks today's visit complete when a submission is accepted (AC-6320), in
 * the submit's own transaction, so a submission that doesn't commit counts as
 * nothing. Spam and held submissions never reach here: only an accepted one
 * is a completion. A visitor who never sent a `start` beacon (an ad blocker,
 * a fast fill) still completes, with no duration to add to the median.
 */
export async function completeFormVisit(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly formId: string; readonly visitor: string | undefined },
): Promise<void> {
  if (input.visitor === undefined || !VISITOR_ID.test(input.visitor)) return;
  await tx.execute(sql`
    update form_visits set
      completed_at = now(),
      last_at = now(),
      duration_ms = case
        when started_at is null then null
        else greatest(0, (extract(epoch from (now() - started_at)) * 1000)::bigint)::integer
      end
    where workspace_id = ${input.workspaceId} and form_id = ${input.formId}
      and day = (now() at time zone 'UTC')::date and visitor = ${input.visitor}
      and completed_at is null
  `);
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
      count(*) filter (where started_at is not null)::int as starts,
      count(*) filter (where completed_at is not null)::int as completions,
      (percentile_cont(0.5) within group (order by duration_ms)
        filter (where duration_ms is not null))::int as median_ms
    from form_visits where ${where}
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
    const inRange = sql`workspace_id = ${workspaceId} and form_id = ${input.formId} and day >= ${since}`;
    const inPrevious = sql`workspace_id = ${workspaceId} and form_id = ${input.formId}
      and day >= ${before} and day < ${since}`;
    const [totals, previous] = await Promise.all([totalsIn(tx, inRange), totalsIn(tx, inPrevious)]);

    const days = await tx.execute<{ day: string; views: number; starts: number; completions: number }>(sql`
      select day::text as day, count(*)::int as views,
        count(*) filter (where started_at is not null)::int as starts,
        count(*) filter (where completed_at is not null)::int as completions
      from form_visits where ${inRange} group by day order by day
    `);
    const byDay: FormAnalyticsDay[] = days.rows.map((row) => ({
      day: row.day,
      views: row.views,
      starts: row.starts,
      completions: row.completions,
    }));

    const sources = await tx.execute<{ source: string; views: number; completions: number }>(sql`
      select source, count(*)::int as views,
        count(*) filter (where completed_at is not null)::int as completions
      from form_visits where ${inRange} group by source order by views desc, source limit 20
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
    select furthest_question_id as furthest, completed_at is not null as completed, count(*)::int as visits
    from form_visits where ${inRange} and (furthest_question_id is not null or completed_at is not null)
    group by furthest_question_id, completed_at is not null
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
