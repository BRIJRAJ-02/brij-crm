import { addRecord, countMatches, editRecord, editRecords, queryRecords, readRecordsById } from '@crm/core';
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
  // Every write answers `echoes` (spec 0006): how many change events carry its mutation id, so its tab skips them.
  create: member.records.create.handler(async ({ context, input }) => {
    try {
      const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
        addRecord(
          context.scope,
          { objectId: input.objectId, id: input.id, ...(input.values === undefined ? {} : { values: input.values }) },
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
      editRecord(context.scope, { recordId: input.recordId, values: input.values }, hooks),
    );
    return { ...result.record, written: result.written, echoes };
  }),
  // One write for up to 500 records (spec 0006, AC-50): 200 with each record's outcome.
  setValuesBatch: member.records.setValuesBatch.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      editRecords(context.scope, { items: input.items }, hooks),
    );
    return { results: result, echoes };
  }),
});
