// A booking page a published form still sends visitors to (spec 0037, AC-1341): deleting or pausing it is refused
// 409 `ROUTING_IN_USE`, naming the form and the rule, so no visitor is sent to a page that can't book. A rotation a
// page uses is kept by its foreign key already. One read of the workspace's live and paused forms' live versions,
// matched in the database on the version document's `after` and its rules' routes. A form the writer can't see is
// never named: the refusal then says only that a form sends people here.
import { sql } from 'drizzle-orm';
import { RoutingRules, type RoutingRule } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import type { Access } from '../access/policy.ts';
import { refuse } from '../engine/refusals.ts';
import { canSeeForm } from '../forms/shared.ts';

/** One published form that books the page: its name, what decides whether the writer sees it, and its rules. */
interface UsingForm extends Record<string, unknown> {
  readonly name: string;
  readonly main_object_id: string | null;
  readonly live_version_id: string | null;
  readonly live_object_id: string | null;
  readonly routing: unknown;
}

/** Where a form sends people to `pageId`: its first rule that books it, else its After someone sends it. */
function whereIn(form: UsingForm, pageId: string): string {
  const rules: readonly RoutingRule[] = RoutingRules.safeParse(form.routing).data?.rules ?? [];
  const at = rules.findIndex((rule) => rule.then.kind === 'book' && rule.then.bookingPageId === pageId);
  if (at !== -1) return `Rule ${String(at + 1)} of ${form.name} sends people here. Change the rule first.`;
  return `${form.name}’s After someone sends it sends people here. Change it first.`;
}

/**
 * Refuses `ROUTING_IN_USE` when a published (live or paused) form's live version books `pageId`, by a rule or by
 * After someone sends it: "Rule 3 of Contact us sends people here. Change the rule first." A form still in draft, or
 * archived, sends nobody, so it never holds a page.
 */
export async function checkNotRouted(tx: WorkspaceTx, access: Access, pageId: string): Promise<void> {
  const found = await tx.execute<UsingForm>(sql`
    select f.name, f.main_object_id::text, f.live_version_id::text,
      v.document -> 'targets' -> 'main' ->> 'objectId' as live_object_id, v.document -> 'routing' as routing
    from forms f
    join form_versions v on v.workspace_id = f.workspace_id and v.id = f.live_version_id
    where f.status in ('live', 'paused')
      and (
        (v.document -> 'after' ->> 'kind' = 'booking' and v.document -> 'after' ->> 'bookingPageId' = ${pageId})
        or v.document -> 'routing' -> 'rules' @> ${JSON.stringify([{ then: { kind: 'book', bookingPageId: pageId } }])}::jsonb
      )
    order by f.name
    limit 1
  `);
  const [form] = found.rows;
  if (form === undefined) return;
  const seen = canSeeForm(access, {
    mainObjectId: form.main_object_id,
    liveVersionId: form.live_version_id,
    liveObjectId: form.live_object_id,
  });
  throw refuse(
    'ROUTING_IN_USE',
    seen ? whereIn(form, pageId) : 'A form sends people here. Ask an admin to change it first.',
  );
}
