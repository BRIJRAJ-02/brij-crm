import { getMyAccess } from '@crm/core';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const accessRouter = member.access.router({
  // The caller's own role and permissions, from the scope the door sealed (spec 0009, AC-136).
  mine: member.access.mine.handler(({ context }) => getMyAccess(context.scope)),
});
