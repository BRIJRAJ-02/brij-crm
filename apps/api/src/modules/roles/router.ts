import { listRoles } from '@crm/core';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const rolesRouter = member.roles.router({
  // The roles every role picker offers (spec 0037, AC-1439): built in now, custom ones later.
  list: member.roles.list.handler(({ context }) => listRoles(context.scope)),
});
