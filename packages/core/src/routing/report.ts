// Each rule's report (spec 0043, AC-1612): how many leads it matched in the
// last 30 or 90 days, how many booked, how many didn't show, and how many it
// tagged qualified or not. One indexed range of a surface's decisions joined
// to their bookings by key, grouped by rule. Only those who may edit the
// surface read it: `forms.manage` and the form in sight, or `booking.admin`
// for a team page.
import { sql } from 'drizzle-orm';
import type { RoutingReport, RoutingReportInput } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { canSeeForm, loadForm } from '../forms/shared.ts';

const UNKNOWN_FORM = 'That form does not exist.';
const UNKNOWN_PAGE = 'That booking page doesn’t exist, or isn’t yours.';

/** Refuses a surface the reader may not edit, as NOT_FOUND. */
async function checkSurface(
  tx: WorkspaceTx,
  scope: EngineScope,
  surface: RoutingReportInput['surface'],
): Promise<string> {
  if (surface.kind === 'form') {
    requirePermission(scope, 'forms.manage');
    const form = await loadForm(tx, checkId(surface.formId, UNKNOWN_FORM));
    if (form === undefined || !canSeeForm(scope.access, form)) throw refuse('NOT_FOUND', UNKNOWN_FORM);
    return form.id;
  }
  requirePermission(scope, 'booking.admin');
  const found = await tx.execute<{ id: string }>(sql`
    select id::text from booking_pages where id = ${checkId(surface.pageId, UNKNOWN_PAGE)}::uuid and deleted_at is null
  `);
  const [page] = found.rows;
  if (page === undefined) throw refuse('NOT_FOUND', UNKNOWN_PAGE);
  return page.id;
}

/** A surface's report over the window (AC-1612): one row per rule that decided, the fallback's with no rule id. */
export async function routingReport(
  scope: EngineScope,
  input: Pick<RoutingReportInput, 'surface' | 'days'>,
  now: Date = new Date(),
): Promise<RoutingReport> {
  const days = input.days === 90 ? 90 : 30;
  return inWorkspace(scope, async (tx) => {
    const surfaceId = await checkSurface(tx, scope, input.surface);
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    const found = await tx.execute<{
      rule_id: string | null;
      matched: number;
      booked: number;
      no_show: number;
      qualified: number;
      not_qualified: number;
    }>(sql`
      select d.rule_id,
        count(*)::int as matched,
        count(b.id)::int as booked,
        count(b.no_show_at)::int as no_show,
        count(*) filter (where d.qualified)::int as qualified,
        count(*) filter (where not d.qualified)::int as not_qualified
      from routing_decisions d
      left join bookings b on b.workspace_id = d.workspace_id and b.id = d.booking_id
      where d.surface_id = ${surfaceId}::uuid and d.decided_at >= ${since}::timestamptz
      group by d.rule_id
    `);
    return {
      days,
      rows: found.rows.map((row) => ({
        ...(row.rule_id === null ? {} : { ruleId: row.rule_id }),
        matched: row.matched,
        booked: row.booked,
        noShow: row.no_show,
        qualified: row.qualified,
        notQualified: row.not_qualified,
      })),
    };
  });
}
