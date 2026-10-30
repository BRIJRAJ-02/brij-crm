import { exportDownloadPath } from '@crm/contracts';
import { getRecordsExport, startRecordsExport } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Records exports (spec 0040), inside a workspace: a member who can read the object (and the view) starts one,
// whose `records.export` job writes the view's records (or the ticked ones, by id) as CSV, read as them. Only the starter reads it back; the
// file downloads from `/api/exports/<id>/download`, the same route as a submissions export.
export const exportsRouter = member.exports.router({
  start: member.exports.start.handler(async ({ context, input }) => {
    const started = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startRecordsExport(
        context.scope,
        context.jobs,
        {
          id: input.id,
          objectId: input.objectId,
          ...(input.viewId === undefined ? {} : { viewId: input.viewId }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
          attributeIds: input.attributeIds,
          ...(input.recordIds === undefined ? {} : { recordIds: input.recordIds }),
          timeZone: input.timeZone,
        },
        hooks,
      ),
    );
    return { ...started, downloadPath: exportDownloadPath(input.workspace, started.id) };
  }),
  get: member.exports.get.handler(async ({ context, input }) => {
    const found = await getRecordsExport(context.scope, { exportId: input.exportId });
    return { ...found, downloadPath: exportDownloadPath(input.workspace, found.id) };
  }),
});
