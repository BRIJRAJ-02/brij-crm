import { getMe, setLastWorkspace } from '@crm/core';
import { authed, memberDoor } from '../../orpc.ts';

// Bootstrap: a session, no workspace yet. `setLastWorkspace` passes the door in packages/core before it writes,
// opened as the member base opens it (`memberDoor`), with the same rules.
export const meRouter = authed.me.router({
  get: authed.me.get.handler(({ context }) => getMe({ identity: context.identity }, context.user)),
  setLastWorkspace: authed.me.setLastWorkspace.handler(({ context, input }) =>
    setLastWorkspace(memberDoor(context), context.user, input.workspace),
  ),
});
