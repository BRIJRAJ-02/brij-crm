// Whose screens read again when a team's membership changes (spec 0031, AC-825): the one place that decides which
// members an `access` outbox row names after `changeTeamMembers` (and a team's creation or deletion) commits.
//
// Today that is the people who joined or left, whose teams (and so whose access) changed, and the team's other
// members, because a `team` record rule shows each of them the records of everyone in the team. Spec 0037 (AC-1274)
// extends this function with the delegates whose scheduling reach runs through the team, so their Bookings lists and
// weeks read again: add them to the result here, in the same transaction, and nothing else changes.
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';

const { teamMembers } = schema;

/**
 * The members an `access` row names after `teamId`'s membership changed by `changed`: those people and everyone who
 * is in the team now, each once. Read inside the change's own transaction, after the change.
 */
export async function membersAffectedByTeamChange(
  tx: WorkspaceTx,
  workspaceId: string,
  teamId: string,
  changed: readonly string[],
): Promise<readonly string[]> {
  const rows = await tx
    .select({ memberId: teamMembers.memberId })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspaceId, workspaceId), eq(teamMembers.teamId, teamId)));
  return [...new Set([...changed, ...rows.map((row) => row.memberId)])];
}

/**
 * Every member in any of `teamIds`, each once: who a deleted or emptied team's former members were, read before the
 * change so the `access` row can still name them.
 */
export async function membersOfTeams(
  tx: WorkspaceTx,
  workspaceId: string,
  teamIds: readonly string[],
): Promise<readonly string[]> {
  if (teamIds.length === 0) return [];
  const rows = await tx
    .select({ memberId: teamMembers.memberId })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspaceId, workspaceId), inArray(teamMembers.teamId, [...teamIds])));
  return [...new Set(rows.map((row) => row.memberId))];
}
