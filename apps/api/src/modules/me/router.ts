import { getMe } from '@crm/core';
import { authed } from '../../orpc.ts';

// Bootstrap: a session, no workspace yet.
export const meRouter = authed.me.router({
  get: authed.me.get.handler(({ context }) => getMe({ identity: context.identity }, context.user)),
});
