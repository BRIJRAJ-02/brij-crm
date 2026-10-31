// Page and rotation editors' rows (spec 0037, AC-1331, AC-1332): what a reader edits, read once per transaction where
// pages and rotations decide who may change them, and the cleanup when a page or a rotation is deleted. No service
// here: `editors.ts` lists and sets them. Only members are editors until teams arrive (spec 0031 slice 8, lane L3a).
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { EditorResource } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';

const { schedulingEditors } = schema;

/** Nothing edited: the system, a key, a form, `booking.admin` (who changes everything anyway). */
const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the pages or rotations the reader edits (AC-1331): one indexed read (`scheduling_editors_by_member`),
 * skipped for anyone who isn't a member and for `booking.admin`, who needs no editor row.
 */
export async function editedBy(
  tx: WorkspaceTx,
  scope: EngineScope,
  resourceType: EditorResource,
): Promise<ReadonlySet<string>> {
  const { principal } = scope.access;
  if (principal.kind !== 'member' || can(scope.access, 'booking.admin')) return NONE;
  const rows = await tx
    .select({ id: schedulingEditors.resourceId })
    .from(schedulingEditors)
    .where(
      and(
        eq(schedulingEditors.memberId, principal.memberId),
        eq(schedulingEditors.resourceType, resourceType),
        isNotNull(schedulingEditors.memberId),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** Deletes every editor of the resources named, in the transaction that deletes them (AC-1331's data model). */
export async function deleteEditorsOf(
  tx: WorkspaceTx,
  resourceType: EditorResource,
  resourceIds: readonly string[],
): Promise<void> {
  if (resourceIds.length === 0) return;
  await tx
    .delete(schedulingEditors)
    .where(
      and(eq(schedulingEditors.resourceType, resourceType), inArray(schedulingEditors.resourceId, [...resourceIds])),
    );
}
