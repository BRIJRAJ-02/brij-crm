// Teams (spec 0031, slice 8, AC-824 to AC-827): flat groups of members that access rules (spec 0032) name. A member
// may be in any number of teams. Owners and admins (`teams.manage`) make, rename and delete teams and change who is
// in them; every member reads the list. A team a rule still names is never deleted (AC-826), so deleting one never
// takes anyone's access away.
//
// Who is in a team changes in exactly one place, `changeTeamMembers`; creating a team with people in it goes
// through it too. It stores the audit row and the outbox rows in the change's own transaction, and which members
// those rows name is `membersAffectedByTeamChange` (`reach.ts`), the one place spec 0037 extends with scheduling
// reach (AC-1274).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TEAM_CHANGE_MAX, TEAM_NAME_MAX, TEAMS_MAX, type TeamsList, type TeamView } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { checkId, isUuidV7, newId } from '../engine/ids.ts';
import { inputInvalid, postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { membersAffectedByTeamChange, membersOfTeams } from './reach.ts';

const { accessRules, members, objects, recordRules, scheduleDelegations, teamMembers, teams } = schema;

/** What every team write takes beside its input: where the request came from, for the audit row. */
export interface TeamWriteOptions {
  readonly source?: AuditSource;
}

const TEAM_NOT_FOUND = "That team doesn't exist.";
const MEMBER_NOT_HERE = "Someone you picked isn't in this workspace.";

/** A team's name, trimmed, or the refusal for one that is empty or too long. */
function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw inputInvalid('name', 'Give the team a name.');
  if (trimmed.length > TEAM_NAME_MAX) {
    throw inputInvalid('name', `Use ${String(TEAM_NAME_MAX)} characters or fewer.`);
  }
  return trimmed;
}

/** The members a change names, each once and in order; more than a change may hold is refused. */
function checkIds(ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids.map((id) => checkId(id, MEMBER_NOT_HERE)))];
  if (unique.length > TEAM_CHANGE_MAX) {
    throw inputInvalid('memberIds', `Change at most ${String(TEAM_CHANGE_MAX)} people at once.`);
  }
  return unique;
}

/** The member who wrote, as the one id every team change tells the lists about (a key or the system names none). */
const writer = (scope: EngineScope): readonly string[] =>
  scope.actor.type === 'member' && scope.actor.id !== null ? [scope.actor.id] : [];

/** The audit columns of a new row, by whoever acts. */
function created(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return {
    createdByType: by.type,
    createdById: by.id,
    createdByMemberId: by.memberId,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  };
}

/** Every team, or just `teamId`'s, with its active members in the order they joined; read in the caller's transaction. */
async function readTeams(tx: WorkspaceTx, workspaceId: string, teamId?: string): Promise<TeamView[]> {
  const rows = await tx
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), ...(teamId === undefined ? [] : [eq(teams.id, teamId)])))
    .orderBy(asc(sql`lower(${teams.name})`), asc(teams.id));
  if (rows.length === 0) return [];
  const people = await tx
    .select({ teamId: teamMembers.teamId, memberId: teamMembers.memberId })
    .from(teamMembers)
    .innerJoin(members, and(eq(members.workspaceId, teamMembers.workspaceId), eq(members.id, teamMembers.memberId)))
    .where(
      and(
        eq(teamMembers.workspaceId, workspaceId),
        eq(members.status, 'active'),
        ...(teamId === undefined ? [] : [eq(teamMembers.teamId, teamId)]),
      ),
    )
    .orderBy(asc(teamMembers.createdAt), asc(teamMembers.memberId));
  const byTeam = new Map<string, string[]>();
  for (const person of people) byTeam.set(person.teamId, [...(byTeam.get(person.teamId) ?? []), person.memberId]);
  return rows.map((row) => ({ id: row.id, name: row.name, memberIds: byTeam.get(row.id) ?? [] }));
}

/**
 * The workspace's teams by name, each with its members (spec 0031, AC-827). Any member may read it: who is in a team
 * is as open as the member list.
 */
export async function listTeams(scope: EngineScope, _input?: unknown): Promise<TeamsList> {
  return { teams: await inWorkspace(scope, (tx) => readTeams(tx, scope.workspaceId)) };
}

/** Locks the team's row and answers its name, or refuses `NOT_FOUND`. */
async function lockTeam(tx: WorkspaceTx, scope: EngineScope, teamId: string): Promise<{ readonly name: string }> {
  const [team] = await tx
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.workspaceId, scope.workspaceId), eq(teams.id, teamId)))
    .for('update');
  if (team === undefined) throw refuse('NOT_FOUND', TEAM_NOT_FOUND);
  return team;
}

/** Turns the unique name index's failure into `NAME_TAKEN` on `name`. */
async function nameGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (postgresError(error)?.code === '23505' && postgresError(error)?.constraint === 'teams_name') {
      throw refuseOn('NAME_TAKEN', 'Another team has that name. Pick another.', 'name');
    }
    throw error;
  }
}

/** The members among `ids` that are active here, or the refusal when any isn't. */
async function requireActive(tx: WorkspaceTx, workspaceId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), inArray(members.id, [...ids]), eq(members.status, 'active')));
  if (found.length !== ids.length) throw refuse('NOT_FOUND', MEMBER_NOT_HERE);
}

/**
 * The one place who is in a team changes (spec 0031, AC-824, AC-825): `add` and `remove` apply to the team locked
 * `for update`, adding a member already in (or removing one who isn't) changes nothing, and only active members of
 * the workspace may be added. When anyone really joined or left it writes one `team.changed` audit row and records
 * the `members` row (everyone's team lists read again) and the `access` row (`membersAffectedByTeamChange`), all in
 * the caller's transaction. Answers the people who joined and who left.
 */
async function applyMembers(
  context: WriteContext,
  teamId: string,
  teamName: string,
  change: { readonly add: readonly string[]; readonly remove: readonly string[] },
  source?: AuditSource,
): Promise<{ readonly joined: readonly string[]; readonly left: readonly string[] }> {
  const { tx, scope } = context;
  const removing = change.remove.filter((id) => !change.add.includes(id));
  await requireActive(tx, scope.workspaceId, change.add);
  const joined =
    change.add.length === 0
      ? []
      : (
          await tx
            .insert(teamMembers)
            .values(
              change.add.map((memberId) => ({ workspaceId: scope.workspaceId, teamId, memberId, ...created(scope) })),
            )
            .onConflictDoNothing()
            .returning({ memberId: teamMembers.memberId })
        ).map((row) => row.memberId);
  const left =
    removing.length === 0
      ? []
      : (
          await tx
            .delete(teamMembers)
            .where(
              and(
                eq(teamMembers.workspaceId, scope.workspaceId),
                eq(teamMembers.teamId, teamId),
                inArray(teamMembers.memberId, [...removing]),
              ),
            )
            .returning({ memberId: teamMembers.memberId })
        ).map((row) => row.memberId);
  if (joined.length === 0 && left.length === 0) return { joined, left };
  await writeAudit(
    tx,
    scope.workspaceId,
    scope.actor,
    {
      action: 'team.changed',
      targetType: 'team',
      targetId: teamId,
      after: { change: 'members', name: teamName, joined, left },
    },
    source,
  );
  const reached = await membersAffectedByTeamChange(tx, scope.workspaceId, teamId, [...joined, ...left]);
  context.record({ members: [...reached], access: [...reached] });
  return { joined, left };
}

/**
 * Makes a team (spec 0031, AC-824): a name of 1 to 64 characters, unique ignoring case (409 `NAME_TAKEN` on `name`),
 * at most 100 teams (409 `LIMIT_REACHED`), starting with `memberIds`. `id` is the caller's own UUID v7 when given,
 * so a retry makes one team and an Undo of a delete brings the same team back. Needs `teams.manage`.
 */
export async function createTeam(
  scope: EngineScope,
  input: { readonly id?: string; readonly name: string; readonly memberIds?: readonly string[] },
  hooks: readonly AfterWrite[] = [],
  options: TeamWriteOptions = {},
): Promise<TeamView> {
  requirePermission(scope, 'teams.manage');
  const name = checkName(input.name);
  const memberIds = checkIds(input.memberIds ?? []);
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'A team id the client chooses must be a UUID v7.');
  }
  const teamId = input.id?.toLowerCase() ?? newId();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [counted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(teams)
        .where(eq(teams.workspaceId, scope.workspaceId));
      if ((counted?.n ?? 0) >= TEAMS_MAX) {
        throw refuse('LIMIT_REACHED', `A workspace can have ${String(TEAMS_MAX)} teams. Delete one first.`);
      }
      await nameGuard(() =>
        tx.insert(teams).values({ workspaceId: scope.workspaceId, id: teamId, name, ...created(scope) }),
      );
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'team.changed', targetType: 'team', targetId: teamId, after: { change: 'created', name } },
        options.source,
      );
      await applyMembers(context, teamId, name, { add: memberIds, remove: [] }, options.source);
      // Everyone's team list reads again, even for a team with nobody in it yet.
      context.record({ members: writer(scope) });
      const [team] = await readTeams(tx, scope.workspaceId, teamId);
      if (team === undefined) throw new Error('A team just made was not found.');
      return team;
    },
    hooks,
  );
  return result;
}

/** Renames a team (spec 0031, AC-824): 409 `NAME_TAKEN` on `name` when another has it, ignoring case. Needs `teams.manage`. */
export async function renameTeam(
  scope: EngineScope,
  input: { readonly teamId: string; readonly name: string },
  hooks: readonly AfterWrite[] = [],
  options: TeamWriteOptions = {},
): Promise<TeamView> {
  requirePermission(scope, 'teams.manage');
  const teamId = checkId(input.teamId, TEAM_NOT_FOUND);
  const name = checkName(input.name);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const before = await lockTeam(tx, scope, teamId);
      if (before.name !== name) {
        await nameGuard(() =>
          tx
            .update(teams)
            .set({ name, ...touched(scope) })
            .where(and(eq(teams.workspaceId, scope.workspaceId), eq(teams.id, teamId))),
        );
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'team.changed',
            targetType: 'team',
            targetId: teamId,
            before: { name: before.name },
            after: { change: 'renamed', name },
          },
          options.source,
        );
        const reached = await membersAffectedByTeamChange(tx, scope.workspaceId, teamId, []);
        context.record({ members: [...reached, ...writer(scope)] });
      }
      const [team] = await readTeams(tx, scope.workspaceId, teamId);
      if (team === undefined) throw new Error('A team just renamed was not found.');
      return team;
    },
    hooks,
  );
  return result;
}

/** The object names a rule or a delegation that names `teamId` belongs to, for the refusal, or none. */
async function whatNames(tx: WorkspaceTx, workspaceId: string, teamId: string): Promise<readonly string[]> {
  const ruled = await tx
    .selectDistinct({ name: objects.pluralName })
    .from(accessRules)
    .innerJoin(objects, and(eq(objects.workspaceId, accessRules.workspaceId), eq(objects.id, accessRules.objectId)))
    .where(and(eq(accessRules.workspaceId, workspaceId), eq(accessRules.subjectTeamId, teamId)));
  const scoped = await tx
    .selectDistinct({ name: objects.pluralName })
    .from(recordRules)
    .innerJoin(objects, and(eq(objects.workspaceId, recordRules.workspaceId), eq(objects.id, recordRules.objectId)))
    .where(and(eq(recordRules.workspaceId, workspaceId), eq(recordRules.subjectTeamId, teamId)));
  const names = [...new Set([...ruled, ...scoped].map((row) => row.name))].sort((a, b) => a.localeCompare(b));
  const [delegation] = await tx
    .select({ id: scheduleDelegations.id })
    .from(scheduleDelegations)
    .where(and(eq(scheduleDelegations.workspaceId, workspaceId), eq(scheduleDelegations.targetTeamId, teamId)))
    .limit(1);
  return delegation === undefined ? names : [...names, 'scheduling access'];
}

/** "Deals", "Deals and People", "Deals, People and Notes". */
const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/**
 * Deletes a team with its memberships (spec 0031, AC-826). Refused 409 `IN_USE`, naming where, while an access rule
 * (or a scheduling delegation) still names the team, so a delete never takes access away. Needs `teams.manage`.
 */
export async function deleteTeam(
  scope: EngineScope,
  input: { readonly teamId: string },
  hooks: readonly AfterWrite[] = [],
  options: TeamWriteOptions = {},
): Promise<void> {
  requirePermission(scope, 'teams.manage');
  const teamId = checkId(input.teamId, TEAM_NOT_FOUND);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const team = await lockTeam(tx, scope, teamId);
      const used = await whatNames(tx, scope.workspaceId, teamId);
      if (used.length > 0) {
        throw refuse('IN_USE', `${team.name} is used by ${joinNames(used)}. Change that access first.`);
      }
      const former = await membersOfTeams(tx, scope.workspaceId, [teamId]);
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.workspaceId, scope.workspaceId), eq(teamMembers.teamId, teamId)));
      await tx.delete(teams).where(and(eq(teams.workspaceId, scope.workspaceId), eq(teams.id, teamId)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'team.changed',
          targetType: 'team',
          targetId: teamId,
          before: { name: team.name },
          after: { change: 'deleted' },
        },
        options.source,
      );
      context.record({
        members: [...former, ...writer(scope)],
        access: [...former],
      });
    },
    hooks,
  );
}

/**
 * Adds people to a team and takes others out (spec 0031, AC-824, AC-825), in one change: the answer is the team as it
 * stands. Adding someone already in, or removing someone who isn't, changes nothing. Needs `teams.manage`.
 */
export async function changeTeamMembers(
  scope: EngineScope,
  input: { readonly teamId: string; readonly add?: readonly string[]; readonly remove?: readonly string[] },
  hooks: readonly AfterWrite[] = [],
  options: TeamWriteOptions = {},
): Promise<TeamView> {
  requirePermission(scope, 'teams.manage');
  const teamId = checkId(input.teamId, TEAM_NOT_FOUND);
  const add = checkIds(input.add ?? []);
  const remove = checkIds(input.remove ?? []);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const team = await lockTeam(tx, scope, teamId);
      await applyMembers(context, teamId, team.name, { add, remove }, options.source);
      const [read] = await readTeams(tx, scope.workspaceId, teamId);
      if (read === undefined) throw new Error('A team just changed was not found.');
      return read;
    },
    hooks,
  );
  return result;
}

/**
 * A removed member leaves their teams (spec 0031, AC-814): their memberships go in the removal's own transaction, and
 * the teammates they leave read again, since a `team` record rule shows them different records now.
 */
export const teamsRemoval: RemovalEffect = {
  feature: 'teams',
  constraints: ['team_members_member'],
  run: async (context, memberId) => {
    const { tx, scope } = context;
    const mine = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(eq(teamMembers.workspaceId, scope.workspaceId), eq(teamMembers.memberId, memberId)));
    if (mine.length === 0) return;
    const mates = await membersOfTeams(
      tx,
      scope.workspaceId,
      mine.map((row) => row.teamId),
    );
    await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.workspaceId, scope.workspaceId), eq(teamMembers.memberId, memberId)));
    context.record({ members: [...mates], access: [...mates] });
  },
};
