// Page and rotation editors' rows (spec 0037, AC-1331, AC-1332): what a reader edits, read once per transaction where
// pages and rotations decide who may change them, and the cleanup when a page or a rotation is deleted. No service
// here: `editors.ts` lists and sets them. Only members are editors until teams arrive (spec 0031 slice 8, lane L3a).
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { EditorResource } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';

const { schedulingEditors } = schema;

/** Nothing edited: the system, a key, a form, `booking.admin` (who changes everything anyway). */
const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the live pages or rotations the reader edits (AC-1331): one indexed read (`scheduling_editors_by_member`),
 * skipped for anyone who isn't a member and for `booking.admin`, who needs no editor row. A deleted page or rotation
 * counts for nothing, and so does a person's page whose owner is no longer an active member who isn't a guest (their
 * pages pause when they leave, and only an admin opens them then), so a left over row never reaches a page or its
 * bookings.
 */
export async function editedBy(
  tx: WorkspaceTx,
  scope: EngineScope,
  resourceType: EditorResource,
): Promise<ReadonlySet<string>> {
  const { principal } = scope.access;
  if (principal.kind !== 'member' || can(scope.access, 'booking.admin')) return NONE;
  const live =
    resourceType === 'rotation'
      ? sql`exists (select 1 from rotations r where r.workspace_id = e.workspace_id and r.id = e.resource_id
          and r.deleted_at is null)`
      : sql`exists (select 1 from booking_pages p
          left join members o on o.workspace_id = p.workspace_id and o.id = p.owner_member_id
          where p.workspace_id = e.workspace_id and p.id = e.resource_id and p.deleted_at is null
            and (p.scope = 'workspace' or (o.status = 'active' and o.role::text <> 'guest')))`;
  const found = await tx.execute<{ id: string }>(sql`
    select e.resource_id::text as id from scheduling_editors e
    where e.member_id = ${principal.memberId}::uuid and e.resource_type = ${resourceType} and ${live}
  `);
  return new Set(found.rows.map((row) => row.id));
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
