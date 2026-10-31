// A workspace's audiences (spec 0009, Live events): its active members grouped
// by data policy, each group with one channel (`workspace:<id>.<key>`). The
// relay (spec 0007) reads them with its system scope, caches them for the
// awake period, and drops them on a `members` or `access` row. Members with
// equal policies, from the stored rules and their teams (spec 0032, AC-860),
// share one; with no rules every member shares the audience `open`.
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { Audience, AudienceMember } from './events.ts';
import type { EngineScope } from './mint.ts';
import { isRole, roleAccess, type DataPolicy } from './policy.ts';
import { inWorkspace } from './run.ts';
import { workspaceRules } from './stored-rules.ts';

const { members } = schema;

/**
 * The workspace's active members grouped by `policyKey`, with each member's
 * permissions, read in one transaction. A member whose role the code doesn't
 * know is in no audience (fail closed). Only the system may ask: it is the
 * relay's read, never a member's.
 */
export async function audiences(scope: EngineScope): Promise<Audience[]> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system reads audiences (the relay, with its system scope).');
  }
  const { rows, rules } = await inWorkspace(scope, async (tx) => ({
    rows: await tx
      .select({ id: members.id, userId: members.userId, role: members.role })
      .from(members)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')))
      .orderBy(asc(members.id)),
    rules: await workspaceRules(tx),
  }));
  const groups = new Map<string, { policy: DataPolicy; members: AudienceMember[] }>();
  for (const row of rows) {
    if (!isRole(row.role)) continue;
    const given = rules.forMember(row.id);
    const access = roleAccess(
      {
        kind: 'member',
        memberId: row.id,
        ...(row.userId === null ? {} : { userId: row.userId }),
        role: row.role,
        teamIds: given.teamIds ?? [],
        ...(given.teamMemberIds === undefined ? {} : { teamMemberIds: given.teamMemberIds }),
      },
      given,
    );
    const group = groups.get(access.data.key) ?? { policy: access.data, members: [] };
    group.members.push({
      memberId: row.id,
      ...(row.userId === null ? {} : { userId: row.userId }),
      permissions: access.permissions,
    });
    groups.set(access.data.key, group);
  }
  return [...groups].map(([key, group]) => ({ key, policy: group.policy, members: group.members }));
}
