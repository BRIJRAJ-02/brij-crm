import { listAuditEvents } from '@crm/core';
import { member } from '../../orpc.ts';

// Settings › History › Workspace changes (spec 0046): the audit log, a page at a time. Inside a workspace, behind
// the member door; core checks `audit.read` (owners and admins) before it reads anything, and writes nothing.
export const auditRouter = member.audit.router({
  list: member.audit.list.handler(({ context, input }) =>
    listAuditEvents(context.scope, {
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  ),
});
