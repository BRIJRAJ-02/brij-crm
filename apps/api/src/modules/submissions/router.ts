import {
  addToCrm,
  deleteSubmission,
  getExport,
  startSubmissionsExport,
  getSubmission,
  listSubmissions,
  markSubmissionSpam,
  releaseSubmission,
  resolveSubmission,
  retrySubmission,
} from '@crm/core';
import { exportDownloadPath } from '@crm/contracts';
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
  // Add to CRM (spec 0023 follow-up): the member's `forms.file` job over the submissions that qualify.
  addToCrm: member.submissions.addToCrm.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addToCrm(context.scope, context.jobs, { formId: input.formId, submissionIds: input.submissionIds }, hooks),
    ),
  ),
  // Export as CSV: the export's row and its `forms.export` job; the file downloads from its path once done.
  export: member.submissions.export.handler(async ({ context, input }) => {
    const started = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startSubmissionsExport(context.scope, context.jobs, { id: input.id, formId: input.formId, select: input.select }, hooks),
    );
    return { ...started, downloadPath: exportDownloadPath(input.workspace, started.id) };
  }),
  getExport: member.submissions.getExport.handler(async ({ context, input }) => {
    const found = await getExport(context.scope, { exportId: input.exportId });
    return { ...found, downloadPath: exportDownloadPath(input.workspace, found.id) };
  }),
});
