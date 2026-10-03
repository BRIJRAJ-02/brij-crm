import { listObjects } from '@crm/core';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const objectsRouter = member.objects.router({
  list: member.objects.list.handler(({ context }) => listObjects(context.scope)),
});
