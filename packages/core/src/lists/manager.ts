// Who manages a list (spec 0048, decision 1, AC-4834): changing a list and its
// fields is `schema.manage`'s, or its maker's with `lists.manage`. Apart from
// the lists service so the attribute services can ask without a cycle.
import { and, eq } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../engine/scope.ts';
import { refuse } from '../engine/refusals.ts';
import { checkId } from '../engine/ids.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { can } from '../access/policy.ts';

const { attributeOptions, attributes, lists, members } = schema;

/**
 * Whether the caller may change a list and its fields: `schema.manage`, or
 * `lists.manage` as the member who made it, while they are still an active
 * member (`makerActive`). A list the system made is `schema.manage`'s alone.
 */
export function canManageList(
  scope: EngineScope,
  list: { readonly createdByMemberId: string | null },
  makerActive: boolean,
): boolean {
  if (can(scope.access, 'schema.manage')) return true;
  const caller = scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;
  return makerActive && caller !== undefined && list.createdByMemberId === caller && can(scope.access, 'lists.manage');
}

/**
 * Who may change a list (AC-4834): "Only <maker>, owners and admins can change
 * this list.", or, when its maker has gone or the system made it, "Only owners
 * and admins can change this list."
 */
export async function listManagersSentence(tx: WorkspaceTx, scope: EngineScope, listId: string): Promise<string> {
  const [maker] = await tx
    .select({ name: members.name, status: members.status })
    .from(lists)
    .innerJoin(members, and(eq(members.workspaceId, lists.workspaceId), eq(members.id, lists.createdByMemberId)))
    .where(and(eq(lists.workspaceId, scope.workspaceId), eq(lists.id, listId)));
  return maker === undefined || maker.status !== 'active'
    ? 'Only owners and admins can change this list.'
    : `Only ${maker.name}, owners and admins can change this list.`;
}

/**
 * The check before a change to an attribute or one of its options (AC-4834):
 * an object's attribute needs `schema.manage`; a list's field needs the list's
 * manager, so a maker edits, moves and archives their own list's fields.
 * Anyone else is 403 `FORBIDDEN` naming who may. An attribute that isn't there
 * answers `NOT_FOUND`, as the write itself would.
 */
export async function requireFieldManager(scope: EngineScope, attributeId: string): Promise<void> {
  if (can(scope.access, 'schema.manage')) return;
  const id = checkId(attributeId, 'That attribute does not exist.');
  await inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({
        listId: attributes.listId,
        createdByMemberId: lists.createdByMemberId,
        makerStatus: members.status,
      })
      .from(attributes)
      .leftJoin(lists, and(eq(lists.workspaceId, attributes.workspaceId), eq(lists.id, attributes.listId)))
      .leftJoin(members, and(eq(members.workspaceId, lists.workspaceId), eq(members.id, lists.createdByMemberId)))
      .where(and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.id, id)));
    // An object's attribute, or none at all: the permission check says no, as it did before lists had fields.
    if (row?.listId === null || row?.listId === undefined) { requirePermission(scope, 'schema.manage'); return; }
    const maker = row.createdByMemberId ?? null;
    if (!canManageList(scope, { createdByMemberId: maker }, row.makerStatus === 'active')) {
      throw refuse('FORBIDDEN', await listManagersSentence(tx, scope, row.listId));
    }
  });
}

/** The same check for a change to an option: it asks about the option's attribute. */
export async function requireOptionManager(scope: EngineScope, optionId: string): Promise<void> {
  if (can(scope.access, 'schema.manage')) return;
  const id = checkId(optionId, 'That option does not exist.');
  const attributeId = await inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ attributeId: attributeOptions.attributeId })
      .from(attributeOptions)
      .where(and(eq(attributeOptions.workspaceId, scope.workspaceId), eq(attributeOptions.id, id)));
    return row?.attributeId;
  });
  if (attributeId === undefined) { requirePermission(scope, 'schema.manage'); return; }
  return requireFieldManager(scope, attributeId);
}
