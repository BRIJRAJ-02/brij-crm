// Counting a visit to any public page (spec 0067, AC-6701, AC-6702): one row per page kind, page, UTC day and
// visitor in `page_visits`, made or moved on by one statement. Callers are the forms beacon, the booking page beacon
// and booking, and the link page's view and press, each in the scope or transaction its own public door made.
//
// The privacy line (AC-6701): a visitor is spec 0047's daily keyed hash and nothing else; a source is a short word
// the server normalised (`classifySource`); a landing address keeps its UTM tags and a click id's presence only.
import { classifySource, stepRank, VisitLanding, type PageKind, type VisitSource } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';

/** A daily visitor id (spec 0047, AC-1626): 32 lowercase hex digits, an HMAC the api made; never an address. */
export const VISITOR_ID = /^[0-9a-f]{32}$/u;

/** Where a visit came from, as the server read it, and the landing parameters it keeps. */
export interface VisitOrigin {
  readonly source: VisitSource;
  readonly landing?: VisitLanding;
}

/** The origin of a visit from what its page sent: the landing parameters parsed again, then classified. */
export function originOf(input: {
  readonly landing?: unknown;
  readonly referrer?: string;
  readonly ownHosts?: readonly string[];
}): VisitOrigin {
  const parsed = input.landing === undefined ? undefined : VisitLanding.safeParse(input.landing);
  const landing = parsed?.success === true && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
  const source = classifySource({
    ...(landing === undefined ? {} : { landing }),
    ...(input.referrer === undefined ? {} : { referrer: input.referrer }),
    ...(input.ownHosts === undefined ? {} : { ownHosts: input.ownHosts }),
  });
  return { source, ...(landing === undefined ? {} : { landing }) };
}

/** What one visit event takes. */
export interface PageVisitEvent {
  readonly workspaceId: string;
  readonly kind: PageKind;
  readonly pageId: string;
  readonly visitor: string;
  /** The step reached (`view` for a plain view); a step the kind doesn't have counts as a view. */
  readonly step: string;
  /** Kept only when the visit is new today: the first touch names the source. */
  readonly origin?: VisitOrigin;
  /** A form's question reached, moved on only forwards in `detailOrder`. */
  readonly detail?: string;
  readonly detailOrder?: readonly string[];
}

/**
 * Counts one event of a visit (AC-6702). Today's row is made, or moved on:
 *
 * - its source, medium, campaign, referrer host and landing are the first touch's and never change after;
 * - `furthest_step` moves only forwards in the kind's order, so a visitor going Back never pulls the funnel back;
 * - `started_at` is stamped the first time a step past the view is reached, and never again;
 * - a form's furthest question moves only forwards in the form's question order.
 */
export async function countPageVisit(tx: WorkspaceTx, event: PageVisitEvent): Promise<void> {
  if (!VISITOR_ID.test(event.visitor)) throw new TypeError('A visitor is 32 lowercase hex digits.');
  const rank = stepRank(event.kind, event.step) ?? 0;
  const step = rank === 0 ? 'view' : event.step;
  const origin = event.origin ?? { source: { source: 'direct' } };
  const { source } = origin;
  const started = rank > 0 ? sql`now()` : sql`null`;
  const detail = event.detail === undefined ? null : event.detail.slice(0, 40);
  const order = event.detailOrder ?? [];
  await tx.execute(sql`
    insert into page_visits (
      workspace_id, page_kind, page_id, day, visitor, source, medium, campaign, referrer_host, landing,
      started_at, furthest_step, step_rank, furthest_detail
    ) values (
      ${event.workspaceId}, ${event.kind}, ${event.pageId}, (now() at time zone 'UTC')::date, ${event.visitor},
      ${source.source}, ${source.medium ?? null}, ${source.campaign ?? null}, ${source.referrerHost ?? null},
      ${origin.landing === undefined ? null : JSON.stringify(origin.landing)}::jsonb,
      ${started}, ${step}, ${rank}, ${detail}
    )
    on conflict (workspace_id, page_kind, page_id, day, visitor) do update set
      last_at = now(),
      started_at = coalesce(page_visits.started_at, excluded.started_at),
      furthest_step = case when excluded.step_rank > page_visits.step_rank
        then excluded.furthest_step else page_visits.furthest_step end,
      step_rank = greatest(page_visits.step_rank, excluded.step_rank),
      -- Forwards only (the Back case): a question replaces the kept one just when it sits later in the form's order;
      -- one the form no longer has scores 0, so it never beats one that is still there.
      furthest_detail = case
        when excluded.furthest_detail is null then page_visits.furthest_detail
        when page_visits.furthest_detail is null then excluded.furthest_detail
        when coalesce(array_position(${sql.param(order)}::text[], excluded.furthest_detail), 0)
           > coalesce(array_position(${sql.param(order)}::text[], page_visits.furthest_detail), 0)
          then excluded.furthest_detail
        else page_visits.furthest_detail
      end
  `);
}

/** What a finish takes. */
export interface PageVisitFinish {
  readonly workspaceId: string;
  readonly kind: PageKind;
  readonly pageId: string;
  readonly visitor: string | undefined;
  /** The submission or booking the finish made. */
  readonly outcomeId?: string;
  readonly origin?: VisitOrigin;
  /**
   * Only finish a visit already counted today, never make one: a link page's press, which any page could send, so
   * it can't make a finished visit out of nothing.
   */
  readonly onlyCounted?: boolean;
}

/**
 * Marks today's visit finished (AC-6702), in the finishing write's own transaction, so a submission or booking that
 * doesn't commit counts as nothing. A visitor whose beacons never arrived (an ad blocker) still counts, as a visit
 * that finished with no time to add to the average. The time to finish runs from the first step past the view,
 * else from the first view. A second finish the same day changes nothing.
 */
export async function finishPageVisit(tx: WorkspaceTx, finish: PageVisitFinish): Promise<void> {
  if (finish.visitor === undefined || !VISITOR_ID.test(finish.visitor)) return;
  if (finish.onlyCounted === true) {
    await tx.execute(sql`
      update page_visits set
        finished_at = now(),
        last_at = now(),
        duration_ms = greatest(0, (extract(epoch from (now() - coalesce(started_at, first_at))) * 1000)::bigint)::integer
      where workspace_id = ${finish.workspaceId} and page_kind = ${finish.kind} and page_id = ${finish.pageId}
        and day = (now() at time zone 'UTC')::date and visitor = ${finish.visitor} and finished_at is null
    `);
    return;
  }
  const source = finish.origin?.source ?? { source: 'direct' };
  const landing = finish.origin?.landing;
  await tx.execute(sql`
    insert into page_visits (
      workspace_id, page_kind, page_id, day, visitor, source, medium, campaign, referrer_host, landing,
      finished_at, outcome_id
    ) values (
      ${finish.workspaceId}, ${finish.kind}, ${finish.pageId}, (now() at time zone 'UTC')::date, ${finish.visitor},
      ${source.source}, ${source.medium ?? null}, ${source.campaign ?? null}, ${source.referrerHost ?? null},
      ${landing === undefined ? null : JSON.stringify(landing)}::jsonb, now(), ${finish.outcomeId ?? null}
    )
    on conflict (workspace_id, page_kind, page_id, day, visitor) do update set
      finished_at = now(),
      last_at = now(),
      outcome_id = coalesce(excluded.outcome_id, page_visits.outcome_id),
      duration_ms = greatest(0, (extract(epoch from (now() - coalesce(page_visits.started_at, page_visits.first_at))) * 1000)::bigint)::integer
    where page_visits.finished_at is null
  `);
}
