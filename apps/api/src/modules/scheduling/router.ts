import {
  createTimeOff,
  deleteTimeOff,
  grantDelegation,
  listDelegations,
  listTimeOff,
  revokeDelegation,
  updateTimeOff,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Scheduling access (spec 0037), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. Who may grant, list and remove delegations is packages/core's (`scheduling/delegations.ts`); each write
// stores its audit row and the delegate's `access` row through `commitWrite`.
export const schedulingRouter = member.scheduling.router({
  delegations: {
    list: member.scheduling.delegations.list.handler(({ context, input }) =>
      listDelegations(context.scope, {
        ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
        ...(input.everyone === undefined ? {} : { everyone: input.everyone }),
      }),
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

const now = () => new Date();

// Time off (spec 0037, AC-1281 to AC-1288): whole days away. Who may add, change and remove whose is packages/core's
// (`scheduling/time-off.ts`); like blocks, it is a setting with no outbox row, and the member's screens read again
// on focus. Each write stores its audit row and, for someone else's, the member's notice in its transaction.
export const timeOffRouter = member.timeOff.router({
  list: member.timeOff.list.handler(({ context, input }) =>
    listTimeOff(context.scope, { now }, { memberId: input.memberId }),
  ),
  create: member.timeOff.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      createTimeOff(
        context.scope,
        { now },
        {
          id: input.id,
          memberId: input.memberId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          reason: input.reason,
          note: input.note,
          standinMemberId: input.standinMemberId,
        },
      ),
    ),
  ),
  update: member.timeOff.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateTimeOff(context.scope, {
        id: input.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        note: input.note,
        standinMemberId: input.standinMemberId,
        updatedAt: input.updatedAt,
      }),
    ),
  ),
  delete: member.timeOff.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => deleteTimeOff(context.scope, { id: input.id })),
  ),
});
