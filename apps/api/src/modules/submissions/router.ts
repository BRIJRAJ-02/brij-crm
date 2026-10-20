import {
  deleteSubmission,
  getSubmission,
  listSubmissions,
  markSubmissionSpam,
  releaseSubmission,
  resolveSubmission,
  retrySubmission,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// A form's submissions (spec 0023, milestone 1), inside a workspace: a member reads those whose main record they
// can see (answers to fields hidden from them left out); retrying and deleting need forms.manage. A retry queues
// the processing job in its write, so `commitWrite`'s poke wakes the worker for it.
export const submissionsRouter = member.submissions.router({
  list: member.submissions.list.handler(({ context, input }) =>
    listSubmissions(context.scope, {
      formId: input.formId,
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  get: member.submissions.get.handler(({ context, input }) =>
    getSubmission(context.scope, { submissionId: input.submissionId }),
  ),
  release: member.submissions.release.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      releaseSubmission(context.scope, context.jobs, { submissionId: input.submissionId }, hooks),
    ),
  ),
  markSpam: member.submissions.markSpam.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      markSubmissionSpam(context.scope, { submissionId: input.submissionId }, hooks),
    ),
  ),
  // Settling one the content checks held in Needs review: not spam (processed) or spam; forms.manage, in the core.
  resolve: member.submissions.resolve.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      resolveSubmission(
        context.scope,
        context.jobs,
        { submissionId: input.submissionId, resolution: input.resolution },
        hooks,
      ),
    ),
  ),
  retry: member.submissions.retry.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      retrySubmission(context.scope, context.jobs, { submissionId: input.submissionId }, hooks),
    ),
  ),
  delete: member.submissions.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteSubmission(context.scope, { submissionId: input.submissionId }, hooks),
    ),
  ),
});
