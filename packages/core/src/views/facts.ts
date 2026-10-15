// The facts spec 0009's `views` rule needs (spec 0020, live events): each
// named view's visibility and creator, read in one batch by the relay with
// its system scope. `filterEvent` keeps a view id only on a channel whose
// every member may see the view; a view not found here (deleted since) counts
// as seen by nobody, so its event goes coarse.
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { ViewFact } from '../access/events.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';

const { views } = schema;

/** The most view ids one read looks up: an outbox row names a write's views, a handful at most. */
const MAX_FACTS = 1000;

/**
 * Each named view's visibility and creator, by id, for the views that still
 * exist. Only the system may ask: it is the relay's read, never a member's.
 */
export async function viewFacts(
  scope: EngineScope,
  viewIds: readonly string[] = [],
): Promise<Readonly<Record<string, ViewFact>>> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system reads view facts (the relay, with its system scope).');
  }
  const ids = [...new Set(viewIds.filter(isUuid))].slice(0, MAX_FACTS);
  if (ids.length === 0) return {};
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({ id: views.id, visibility: views.visibility, creatorMemberId: views.creatorMemberId })
      .from(views)
      .where(and(eq(views.workspaceId, scope.workspaceId), inArray(views.id, ids))),
  );
  const facts = new Map<string, ViewFact>();
  for (const row of rows) {
    facts.set(row.id, {
      visibility: row.visibility,
      ...(row.creatorMemberId === null ? {} : { ownerMemberId: row.creatorMemberId }),
    });
  }
  return Object.fromEntries(facts);
}
