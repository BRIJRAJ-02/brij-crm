// Teams (spec 0031, slice 8, AC-824 to AC-827): flat groups of members that access rules (spec 0032) name. A member
// may be in any number of teams; owners and admins (`teams.manage`) make, rename and delete teams and change who is
// in them; every member reads the list. Deleting a team a rule still names is refused, so a delete never takes
// access away.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { TEAM_CHANGE_MAX, TEAM_NAME_MAX } from './team-limits.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

export { TEAM_CHANGE_MAX, TEAM_NAME_MAX, TEAMS_MAX } from './team-limits.ts';

/** A team's name: 1 to 64 characters once trimmed. */
export const TeamName = z
  .string()
  .trim()
  .min(1, 'Give the team a name.')
  .max(TEAM_NAME_MAX, `Use ${String(TEAM_NAME_MAX)} characters or fewer.`);
/** A team's name. */
export type TeamName = z.infer<typeof TeamName>;

/** One team and who is in it, as Settings › Teams lists it. */
export const TeamView = z.object({
  id: Uuid,
  name: z.string(),
  /** The active members in it, in the order they were added. */
  memberIds: z.array(Uuid),
});
/** One team and who is in it. */
export type TeamView = z.infer<typeof TeamView>;

/** The workspace's teams, by name. */
export const TeamsList = z.object({ teams: z.array(TeamView) });
/** The workspace's teams. */
export type TeamsList = z.infer<typeof TeamsList>;

/**
 * Making a team. `id` is the client's own (a UUID v7), so a retry makes one team and an Undo of a delete brings the
 * same team back; `memberIds` start it with people.
 */
export const CreateTeamInput = WorkspaceScoped.extend({
  id: Uuid.optional(),
  name: TeamName,
  memberIds: z.array(Uuid).max(TEAM_CHANGE_MAX).default([]),
  mutationId: Uuid,
});
/** Making a team. */
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;

/** Renaming a team. */
export const RenameTeamInput = WorkspaceScoped.extend({ teamId: Uuid, name: TeamName, mutationId: Uuid });
/** Renaming a team. */
export type RenameTeamInput = z.infer<typeof RenameTeamInput>;

/** Deleting a team. */
export const DeleteTeamInput = WorkspaceScoped.extend({ teamId: Uuid, mutationId: Uuid });
/** Deleting a team. */
export type DeleteTeamInput = z.infer<typeof DeleteTeamInput>;

/** Adding people to a team and taking others out, in one change. */
export const ChangeTeamMembersInput = WorkspaceScoped.extend({
  teamId: Uuid,
  add: z.array(Uuid).max(TEAM_CHANGE_MAX).default([]),
  remove: z.array(Uuid).max(TEAM_CHANGE_MAX).default([]),
  mutationId: Uuid,
});
/** Adding people to a team and taking others out. */
export type ChangeTeamMembersInput = z.infer<typeof ChangeTeamMembersInput>;

/** The teams namespace. `list` is any member's; the rest need `teams.manage`. */
export const teamsContract = {
  list: oc.input(WorkspaceScoped).output(TeamsList),
  create: oc.input(CreateTeamInput).output(TeamView),
  rename: oc.input(RenameTeamInput).output(TeamView),
  /** Refused 409 `IN_USE` while an access rule names the team. */
  delete: oc.input(DeleteTeamInput).output(z.void()),
  changeMembers: oc.input(ChangeTeamMembersInput).output(TeamView),
};
