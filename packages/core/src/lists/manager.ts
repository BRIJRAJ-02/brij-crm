// Who manages a list (spec 0048, decision 1, AC-4834): changing a list and its
// fields is `schema.manage`'s, or its maker's with `lists.manage`. Apart from
// the lists service so the attribute services can ask without a cycle.
import type { EngineScope } from '../engine/scope.ts';
import { can } from '../access/policy.ts';

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
