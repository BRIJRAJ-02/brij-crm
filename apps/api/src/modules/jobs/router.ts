import { cancelJob, confirmJob, getJob, listJobs, startTestJob } from '@crm/core';
import { commitWrite, wakeIfOverdue } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Background jobs (spec 0008), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. The services decide who sees and changes which job; each write goes through `commitWrite`, so its
// `jobs` event is stored with it and the worker is woken once it commits.
export const jobsRouter = member.jobs.router({
  // A read that finds a queued job more than 5 seconds past its time wakes the worker: a lost wake heals as soon
  // as someone looks (spec 0008, The wake call).
  list: member.jobs.list.handler(({ context, input }) =>
    listJobs(
      context.scope,
      context.jobs,
      {
        scope: input.scope,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      },
      wakeIfOverdue(context),
    ),
  ),
  get: member.jobs.get.handler(({ context, input }) =>
    getJob(context.scope, context.jobs, input.jobId, wakeIfOverdue(context)),
  ),
  cancel: member.jobs.cancel.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      cancelJob(context.scope, context.jobs, input.jobId, hooks),
    ),
  ),
  confirm: member.jobs.confirm.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      confirmJob(context.scope, context.jobs, input.jobId, hooks),
    ),
  ),
  // Local and previews only: in production the kind isn't registered, and this answers NOT_FOUND (AC-123).
  startTest: member.jobs.startTest.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startTestJob(
        context.scope,
        context.jobs,
        {
          id: input.id,
          items: input.items,
          batchSize: input.batchSize,
          batchMillis: input.batchMillis,
          failAtPosition: input.failAtPosition,
          refuseEvery: input.refuseEvery,
          confirm: input.confirm,
        },
        hooks,
      ),
    ),
  ),
});
