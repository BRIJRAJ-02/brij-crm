// Whose screens read again when a team's membership changes (spec 0031, AC-825): the one place that decides which
// members an `access` outbox row names after `changeTeamMembers` (and a team's creation or deletion) commits.
//
// That is the people who joined or left, whose teams (and so whose access) changed, and the team's other members,
// because a `team` record rule shows each of them the records of everyone in the team, and a `.team` scheduling
// permission reaches team mates. Spec 0037 (AC-1274) adds the delegates holding a delegation over the team, whose
// scheduling reach runs through it, so their Roster, Bookings lists and weeks read again.
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { teamDelegates } from '../scheduling/delegations.ts';

const { teamMembers } = schema;

/**
 * The members an `access` row names after `teamId`'s membership changed by `changed`: those people, everyone who is
 * in the team now and the team's delegates (AC-1274), each once. Read inside the change's own transaction, after the
 * change.
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
  const delegates = await teamDelegates(tx, workspaceId, [teamId]);
  return [...new Set([...changed, ...rows.map((row) => row.memberId), ...delegates])];
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
