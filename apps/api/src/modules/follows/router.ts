import { addSampleData, getFollow, getSampleData, removeSampleData, setFollow, undoRemoveSampleData } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Following a record (collaboration), inside a workspace: the caller's own follow only, read from `context.scope`;
// a record they can't read answers `NOT_FOUND`. The toggle goes through `commitWrite`, and writes no outbox row.
export const followsRouter = member.follows.router({
  get: member.follows.get.handler(({ context, input }) => getFollow(context.scope, { recordId: input.recordId })),
  set: member.follows.set.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setFollow(context.scope, { recordId: input.recordId, following: input.following }, hooks),
    ),
  ),
});

// Sample data and the Sales template (owners and admins; the service checks `schema.manage` before anything else).
// Add starts a job through `commitWrite`, so the worker wakes for it; remove and its Undo move records to and from
// the trash in one write each.
export const sampleDataRouter = member.sampleData.router({
  get: member.sampleData.get.handler(({ context }) => getSampleData(context.scope)),
  add: member.sampleData.add.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addSampleData(context.scope, context.jobs, hooks),
    ),
  ),
  remove: member.sampleData.remove.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeSampleData(context.scope, { batchId: input.batchId }, hooks),
    ),
  ),
  undoRemove: member.sampleData.undoRemove.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      undoRemoveSampleData(context.scope, { batchId: input.batchId }, hooks),
    ),
  ),
});
