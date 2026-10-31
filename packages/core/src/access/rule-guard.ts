// Where an attribute is read by an access rule (spec 0032, AC-849): an Owner field that a record scope reads can't be
// archived while it does, or the scope would read nothing and hide every record from the people it limits. Apart from
// `rules.ts` so the definitions engine can ask without importing the whole rules service.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from './mint.ts';
import { recordRule } from './policy.ts';
import { inWorkspace } from './run.ts';

const { members, objects, recordRules, records, values } = schema;

/**
 * The names of the objects whose record rules read `attributeId`, in order, or none. Read in the change's own
 * transaction.
 */
export async function objectsRuledBy(tx: WorkspaceTx, attributeId: string): Promise<readonly string[]> {
  const rows = await tx
    .selectDistinct({ name: objects.pluralName })
    .from(recordRules)
    .innerJoin(objects, and(eq(objects.workspaceId, recordRules.workspaceId), eq(objects.id, recordRules.objectId)))
    .where(eq(recordRules.attributeId, attributeId));
  return rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
}

/** "Deals", "Deals and People", "Deals, People and Notes". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * What a write that left its writer unable to see the record says (spec 0032, AC-848), or undefined when the write
 * did no such thing: the record is live, its object has a record rule for the writer, the write set the rule's own
 * field, and the record no longer matches it. "Saved. It's owned by Grace Hopper, so you can no longer see it." Names
 * the one value the writer just chose, never anything else of the record. Read in its own transaction after the write.
 */
export async function outOfScopeMessage(
  scope: EngineScope,
  recordId: string,
  written: ReadonlySet<string>,
): Promise<string | undefined> {
  return inWorkspace(scope, async (tx) => {
    const [record] = await tx
      .select({ objectId: records.objectId, deletedAt: records.deletedAt })
      .from(records)
      .where(and(eq(records.workspaceId, scope.workspaceId), eq(records.id, recordId)));
    if (record === undefined || record.deletedAt !== null) return undefined;
    const rule = recordRule(scope.access, record.objectId);
    if (rule === undefined || !written.has(rule.attributeId)) return undefined;
    const [owner] = await tx
      .select({ name: members.name })
      .from(values)
      .innerJoin(members, and(eq(members.workspaceId, values.workspaceId), eq(members.id, values.actorId)))
      .where(
        and(
          eq(values.workspaceId, scope.workspaceId),
          eq(values.ownerId, recordId),
          eq(values.attributeId, rule.attributeId),
          isNull(values.activeUntil),
          eq(values.isCleared, false),
        ),
      )
      .limit(1);
    return owner === undefined
      ? "Saved. It's not owned by anyone, so you can no longer see it."
      : `Saved. It's owned by ${owner.name}, so you can no longer see it.`;
  });
}
