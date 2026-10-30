// Where an attribute is read by an access rule (spec 0032, AC-849): an Owner field that a record scope reads can't be
// archived while it does, or the scope would read nothing and hide every record from the people it limits. Apart from
// `rules.ts` so the definitions engine can ask without importing the whole rules service.
import { and, eq } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';

const { objects, recordRules } = schema;

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
