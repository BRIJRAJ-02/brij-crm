import { createReport, deleteReport, listReports, updateReport } from '@crm/core';
import { member } from '../../orpc.ts';

// Saved reports (the reports lane, spec 0050 reserved), inside a workspace: the door has let in an active member,
// and `context.scope` is theirs. A report is a definition only, so these writes store no outbox row (like
// `views.markOpened`): another tab reads the list again when it opens the page. Who sees or changes which report
// is the service's call (the object and every field it names; its maker or `views.manage`).
export const reportsRouter = member.reports.router({
  list: member.reports.list.handler(({ context }) => listReports(context.scope)),
  create: member.reports.create.handler(({ context, input }) =>
    createReport(context.scope, { id: input.id, objectId: input.objectId, name: input.name, config: input.config }),
  ),
  update: member.reports.update.handler(({ context, input }) =>
    updateReport(context.scope, { reportId: input.reportId, name: input.name, config: input.config }),
  ),
  delete: member.reports.delete.handler(({ context, input }) =>
    deleteReport(context.scope, { reportId: input.reportId }),
  ),
});
