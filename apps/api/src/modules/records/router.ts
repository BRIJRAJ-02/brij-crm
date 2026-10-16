import {
  addRecord,
  countMatches,
  deleteRecords,
  editRecord,
  editRecords,
  getActivity,
  queryRecords,
  readRecordsById,
  readTrashedRecord,
  restoreBatch,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitCounted } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const recordsRouter = member.records.router({
  // Both reads are cancelled with their request: a closed tab or a superseded window stops them in Postgres.
  // And they share the workspace's places in the read gate: a seventh at once answers 429.
  query: member.records.query.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, () =>
      queryRecords(
        context.scope,
        {
          objectId: input.objectId,
          ...(input.position === undefined ? {} : { position: input.position }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
          ...(input.attributeIds === undefined ? {} : { attributeIds: input.attributeIds }),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        signal,
      ),
    ),
  ),
  count: member.records.count.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, () =>
      countMatches(
        context.scope,
        {
          objectId: input.objectId,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        signal,
      ),
    ),
  ),
  get: member.records.get.handler(({ context, input }) =>
    readRecordsById(context.scope, input.ids, input.attributeIds),
  ),
  // The record page (spec 0017): a page of its timeline, and a record in the trash, which opens read only.
  activity: member.records.activity.handler(async ({ context, input }) => {
    const page = await getActivity(context.scope, {
      recordId: input.recordId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return page.nextCursor === undefined
      ? { entries: [...page.entries] }
      : { entries: [...page.entries], nextCursor: page.nextCursor };
  }),
  getTrashed: member.records.getTrashed.handler(({ context, input }) =>
    readTrashedRecord(context.scope, input.recordId),
  ),
  // Every write answers `echoes` (spec 0006): how many change events carry its mutation id, so its tab skips them.
  create: member.records.create.handler(async ({ context, input }) => {
    try {
      const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
        addRecord(
          context.scope,
          {
            objectId: input.objectId,
            id: input.id,
            ...(input.values === undefined ? {} : { values: input.values }),
            ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          },
          hooks,
        ),
      );
      return { ...result.record, written: result.written, echoes };
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  setValues: member.records.setValues.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      editRecord(
        context.scope,
        {
          recordId: input.recordId,
          values: input.values,
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        hooks,
      ),
    );
    return { ...result.record, written: result.written, echoes };
  }),
  // One write for up to 500 records (spec 0006, AC-50): 200 with each record's outcome.
  setValuesBatch: member.records.setValuesBatch.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      editRecords(
        context.scope,
        { items: input.items, ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }) },
        hooks,
      ),
    );
    return { results: result, echoes };
  }),
  // Bulk actions (spec 0022): up to 500 records to the trash in one write, and undoing a delete by its batch.
  deleteMany: member.records.deleteMany.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      deleteRecords(
        context.scope,
        { objectId: input.objectId, recordIds: input.recordIds, batchId: input.batchId },
        hooks,
      ),
    );
    return { results: [...result], echoes };
  }),
  restoreBatch: member.records.restoreBatch.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      restoreBatch(context.scope, { batchId: input.batchId }, hooks),
    );
    return { mode: 'inline' as const, results: [...result], echoes };
  }),
});
