import {
  createImport,
  getImport,
  listImportRefusals,
  stageImportRows,
  startImport,
  undoImport,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Imports (spec 0040), inside a workspace: a member with write on the object creates one, stages the rows the
// browser read in chunks, and starts its `records.import` job, which writes each row through the engine as them.
// Only the starter stages and starts; the starter or a holder of jobs.manage reads it back and undoes it. Every
// write goes through `commitWrite`, so a job started in it wakes the worker.
export const importsRouter = member.imports.router({
  create: member.imports.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createImport(
        context.scope,
        {
          id: input.id,
          objectId: input.objectId,
          fileName: input.fileName,
          rowCount: input.rowCount,
          errorRows: input.errorRows,
          settings: input.settings,
        },
        hooks,
      ),
    ),
  ),
  stage: member.imports.stage.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      stageImportRows(context.scope, { importId: input.importId, rows: input.rows }, hooks),
    ),
  ),
  start: member.imports.start.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startImport(context.scope, context.jobs, input.importId, hooks),
    ),
  ),
  get: member.imports.get.handler(({ context, input }) => getImport(context.scope, input.importId)),
  rows: member.imports.rows.handler(({ context, input }) =>
    listImportRefusals(context.scope, {
      importId: input.importId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  undo: member.imports.undo.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      undoImport(context.scope, context.jobs, input.importId, hooks),
    ),
  ),
});
