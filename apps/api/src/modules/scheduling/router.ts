import {
  copyWeek,
  createTimeOff,
  readTeamWeek,
  setDayHours,
  setUsualHours,
  deleteTimeOff,
  getLimits,
  grantDelegation,
  limitsAt,
  listDelegations,
  listTimeOff,
  revokeDelegation,
  setLimits,
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
// (`scheduling/time-off.ts`). Each write stores its audit row, one `time_off` outbox row naming nothing (so open
// tabs read the Team week, time off and Host away again) and, for someone else's, the member's notice in its transaction.
export const timeOffRouter = member.timeOff.router({
  list: member.timeOff.list.handler(({ context, input }) =>
    listTimeOff(context.scope, { now }, { memberId: input.memberId }),
  ),
  create: member.timeOff.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
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
        hooks,
      ),
    ),
  ),
  update: member.timeOff.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateTimeOff(
        context.scope,
        {
          id: input.id,
          fromDate: input.fromDate,
          toDate: input.toDate,
          reason: input.reason,
          note: input.note,
          standinMemberId: input.standinMemberId,
          updatedAt: input.updatedAt,
        },
        hooks,
      ),
    ),
  ),
  delete: member.timeOff.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteTimeOff(context.scope, { id: input.id }, hooks),
    ),
  ),
});

// The Team week (spec 0037, AC-1289 to AC-1296): the roster over everyone's default schedules. Whose rows show and who
// may change which cell is packages/core's (`availability/team-week.ts`); every write goes through the schedules' one
// write path, so its audit row, its `schedules` outbox row and the member's notice come from there.
export const availabilityRouter = member.availability.router({
  teamWeek: member.availability.teamWeek.handler(({ context, input }) =>
    readTeamWeek(context.scope, { now }, { weekStart: input.weekStart, search: input.search, cursor: input.cursor }),
  ),
  setDay: member.availability.setDay.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setDayHours(
        context.scope,
        { now },
        { memberId: input.memberId, date: input.date, hours: input.hours, updatedAt: input.updatedAt },
        hooks,
      ),
    ),
  ),
  copyWeek: member.availability.copyWeek.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      copyWeek(
        context.scope,
        { now },
        { memberIds: input.memberIds, fromWeekStart: input.fromWeekStart, toWeekStart: input.toWeekStart },
        hooks,
      ),
    ),
  ),
  setUsualHours: member.availability.setUsualHours.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setUsualHours(context.scope, { memberIds: input.memberIds, weekly: input.weekly }, hooks),
    ),
  ),
});

// Meeting limits (spec 0037, AC-1297 to AC-1299): at most N meetings a day and a week per person, across every page.
// Who may read and set whose is packages/core's (`scheduling/limits.ts`); a change stores its audit row, one
// `time_off` outbox row naming nothing (limits share time off's event) and, for someone else's, the member's notice.
export const limitsRouter = member.limits.router({
  get: member.limits.get.handler(({ context, input }) =>
    getLimits(context.scope, { now }, { memberId: input.memberId }),
  ),
  // New meeting's warning before booking someone in past a limit (booking in still goes through).
  at: member.limits.at.handler(({ context, input }) =>
    limitsAt(context.scope, { now }, { memberId: input.memberId, at: new Date(input.at) }),
  ),
  set: member.limits.set.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setLimits(
        context.scope,
        { now },
        { memberId: input.memberId, perDay: input.perDay, perWeek: input.perWeek },
        hooks,
      ),
    ),
  ),
});
