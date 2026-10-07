import { addRecord, countMatches, editRecord, queryRecords, readRecordsById } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { writeHooks } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const recordsRouter = member.records.router({
  // Both reads are cancelled with their request: a closed tab or a superseded window stops them in Postgres.
  query: member.records.query.handler(({ context, input, signal }) =>
    queryRecords(
      context.scope,
      {
        objectId: input.objectId,
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.filter === undefined ? {} : { filter: input.filter }),
        ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
      },
      signal,
    ),
  ),
  count: member.records.count.handler(({ context, input, signal }) =>
    countMatches(
      context.scope,
      { objectId: input.objectId, ...(input.filter === undefined ? {} : { filter: input.filter }) },
      signal,
    ),
  ),
  get: member.records.get.handler(({ context, input }) => readRecordsById(context.scope, input.ids)),
  create: member.records.create.handler(async ({ context, input }) => {
    try {
      return await addRecord(
        context.scope,
        { objectId: input.objectId, id: input.id, ...(input.values === undefined ? {} : { values: input.values }) },
        writeHooks(context, { mutationId: input.mutationId }),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  setValues: member.records.setValues.handler(({ context, input }) =>
    editRecord(
      context.scope,
      { recordId: input.recordId, values: input.values },
      writeHooks(context, { mutationId: input.mutationId }),
    ),
  ),
});
