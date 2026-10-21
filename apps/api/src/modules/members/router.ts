import {
  leaveWorkspace,
  listMembers,
  removeMember,
  setMemberRole,
  transferOwnership,
  type RemovedMember,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. The owner rules live
// in packages/core (spec 0009, AC-137); these handlers only call them, then tidy the directory.

/**
 * Once a removal committed, the directory forgets the person is in the
 * workspace (spec 0031, AC-812), so their switcher stops listing it and a
 * later invitation writes their directory row afresh. Best effort: the door
 * already refuses them, so a failure only leaves a stale entry that opens
 * "not found"; it is logged.
 */
async function forget(
  context: Pick<RequestContext, 'directory' | 'requestId'>,
  workspaceId: string,
  removed: RemovedMember,
): Promise<void> {
  if (removed.userId === undefined) return;
  try {
    await context.directory.dropMembership(removed.userId, workspaceId, removed.memberId);
  } catch (error) {
    log.warn('Directory membership not dropped', { requestId: context.requestId, ...errorFields(error) });
  }
}

export const membersRouter = member.members.router({
  list: member.members.list.handler(({ context, input }) =>
    listMembers(context.scope, {
      ...(input.search === undefined ? {} : { search: input.search }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  setRole: member.members.setRole.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setMemberRole(context.scope, { memberId: input.memberId, role: input.role }, hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
  remove: member.members.remove.handler(async ({ context, input }) => {
    const removed = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeMember(context.scope, { memberId: input.memberId }, hooks, { source: sourceOf(context) }),
    );
    await forget(context, context.scope.workspaceId, removed);
  }),
  leave: member.members.leave.handler(async ({ context, input }) => {
    const removed = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      leaveWorkspace(context.scope, hooks, { source: sourceOf(context) }),
    );
    await forget(context, context.scope.workspaceId, removed);
  }),
  transferOwnership: member.members.transferOwnership.handler(async ({ context, input }) => {
    await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      transferOwnership(context.scope, { memberId: input.memberId }, hooks, { source: sourceOf(context) }),
    );
  }),
});
