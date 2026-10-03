import { listMembers } from '@crm/core';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const membersRouter = member.members.router({
  list: member.members.list.handler(({ context }) => listMembers(context.scope)),
});
