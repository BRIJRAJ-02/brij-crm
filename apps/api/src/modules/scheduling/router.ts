import { grantDelegation, listDelegations, revokeDelegation } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Scheduling access (spec 0037), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Who may grant, list and remove delegations is packages/core's (`scheduling/delegations.ts`); each write
// stores its audit row and the delegate's `access` row through `commitWrite`.
export const schedulingRouter = member.scheduling.router({
  delegations: {
    list: member.scheduling.delegations.list.handler(({ context, input }) =>
      listDelegations(context.scope, input.memberId === undefined ? {} : { memberId: input.memberId }),
    ),
    grant: member.scheduling.delegations.grant.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        grantDelegation(
          context.scope,
          { delegateMemberId: input.delegateMemberId, target: input.target, level: input.level },
          hooks,
          { source: sourceOf(context) },
        ),
      ),
    ),
    revoke: member.scheduling.delegations.revoke.handler(async ({ context, input }) => {
      await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        revokeDelegation(context.scope, { id: input.id }, hooks, { source: sourceOf(context) }),
      );
    }),
  },
});
