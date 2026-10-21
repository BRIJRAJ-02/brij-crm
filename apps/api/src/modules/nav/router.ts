import { changeNav, readNav } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// The sidebar (spec 0034), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Both procedures act on the caller's own row only; neither takes a member id. `change` goes through
// `commitWrite`, so its `nav` event is stored with it and the worker is woken once it commits.
export const navRouter = member.nav.router({
  get: member.nav.get.handler(({ context }) => readNav(context.scope)),
  change: member.nav.change.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) => changeNav(context.scope, input.op, hooks)),
  ),
});
