import { changeTeamMembers, createTeam, deleteTeam, listTeams, renameTeam } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every member reads the
// teams; the rules (a name of 1 to 64 characters, `teams.manage`, a team no rule names) live in packages/core
// (spec 0031, slice 8), and each change stores its audit row and its `members` and `access` rows with the write.
export const teamsRouter = member.teams.router({
  list: member.teams.list.handler(({ context }) => listTeams(context.scope)),
  create: member.teams.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createTeam(
        context.scope,
        {
          ...(input.id === undefined ? {} : { id: input.id }),
          name: input.name,
          memberIds: input.memberIds,
        },
        hooks,
        { source: sourceOf(context) },
      ),
    ),
  ),
  rename: member.teams.rename.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      renameTeam(context.scope, { teamId: input.teamId, name: input.name }, hooks, { source: sourceOf(context) }),
    ),
  ),
  delete: member.teams.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteTeam(context.scope, { teamId: input.teamId }, hooks, { source: sourceOf(context) }),
    ),
  ),
  changeMembers: member.teams.changeMembers.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      changeTeamMembers(context.scope, { teamId: input.teamId, add: input.add, remove: input.remove }, hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
});
