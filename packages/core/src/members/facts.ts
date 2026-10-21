// What the relay needs to cut a removed person off (spec 0031, AC-817): the
// user ids behind members an `access` row names who are no longer active, so
// their live subscription to the workspace's channel ends. System only.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { schema } from '@crm/db';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import type { EngineScope } from '../engine/scope.ts';

const { members } = schema;

/** At most this many ids a call: an `access` row names one removal's members. */
const MAX_IDS = 500;

/**
 * The user ids of the members in `memberIds` who are not active in the
 * scope's workspace any more (removed, or left): the people whose live
 * connection to it the relay cuts. Only the system reads it.
 */
export async function removedUserIds(scope: EngineScope, memberIds: readonly string[]): Promise<readonly string[]> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system reads removed members (the relay, with its system scope).');
  }
  const ids = [...new Set(memberIds.filter(isUuid))].slice(0, MAX_IDS);
  if (ids.length === 0) return [];
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(
          eq(members.workspaceId, scope.workspaceId),
          inArray(members.id, ids),
          ne(members.status, 'active'),
          isNotNull(members.userId),
        ),
      ),
  );
  return [...new Set(rows.flatMap((row) => (row.userId === null ? [] : [row.userId])))];
}
