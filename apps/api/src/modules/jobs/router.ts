import { cancelJob, confirmJob, getJob, listJobs, startTestJob } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Background jobs (spec 0008), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. The services decide who sees and changes which job; each write goes through `commitWrite`, so its
// `jobs` event is stored with it and the worker is woken once it commits.
export const jobsRouter = member.jobs.router({
  list: member.jobs.list.handler(({ context, input }) =>
    listJobs(context.scope, context.jobs, {
      scope: input.scope,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  get: member.jobs.get.handler(({ context, input }) => getJob(context.scope, context.jobs, input.jobId)),
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
        },
        hooks,
      ),
    ),
  ),
});
