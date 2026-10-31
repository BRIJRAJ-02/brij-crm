import {
  addRecord,
  checkDuplicates,
  dismissPair,
  listDuplicates,
  restorePair,
  aggregateGroups,
  aggregateMatches,
  bulkEditRecords,
  countMatches,
  countRecordsByObject,
  deleteRecords,
  editRecord,
  editRecords,
  getActivity,
  getStageSince,
  mergeAndRead,
  queryGroups,
  queryRecords,
  readMergePreview,
  readRecordsById,
  readTrashedRecord,
  searchRecords,
  startBulk,
  undoDelete,
} from '@crm/core';
import { apiError, withInputFields } from '../../errors.ts';
import { commitCounted, commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

/** Duplicate checks one member may make a minute (spec 0049): a check runs 300 ms after typing stops. */
const CHECKS_PER_MINUTE = 60;
/** Pages of pairs one member may read a minute: a page and a banner each read up to 2,000 records' keys. */
const LISTS_PER_MINUTE = 120;

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
          ...(input.threadCounts === true ? { threadCounts: true } : {}),
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
  // Settings › Objects' Records column: every visible object's count in one grouped read, in the same read gate.
  objectCounts: member.records.objectCounts.handler(({ context }) =>
    context.readGate.run(context.scope.workspaceId, async () => ({
      counts: await countRecordsByObject(context.scope),
    })),
  ),
  // A view's calculations (the CRM flow pass): a whole footer, up to 50 asks, as one statement through the door,
  // taking one place in the read gate.
  aggregate: member.records.aggregate.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => ({
      answers: [
        ...(
          await aggregateMatches(
            context.scope,
            {
              objectId: input.objectId,
              asks: input.asks,
              ...(input.filter === undefined ? {} : { filter: input.filter }),
              ...(input.now === undefined ? {} : { now: input.now }),
              ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
            },
            signal,
          )
        ).answers,
      ],
    })),
  ),
  // A board's column totals: every column's amounts in one statement grouped by the column's value, one place in
  // the read gate.
  aggregateGroups: member.records.aggregateGroups.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => ({
      groups: (
        await aggregateGroups(
          context.scope,
          {
            objectId: input.objectId,
            groupBy: input.groupBy,
            groupIds: input.groupIds,
            asks: input.asks,
            ...(input.filter === undefined ? {} : { filter: input.filter }),
            ...(input.now === undefined ? {} : { now: input.now }),
            ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          },
          signal,
        )
      ).groups.map((group) => ({ id: group.id, answers: [...group.answers] })),
    })),
  ),
  // The record picker's search (spec 0014): cancelled with its request, in the same read gate.
  search: member.records.search.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => ({
      results: [
        ...(await searchRecords(
          context.scope,
          {
            objectId: input.objectId,
            query: input.query,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            ...(input.forAttributeId === undefined ? {} : { forAttributeId: input.forAttributeId }),
            ...(input.forRecordId === undefined ? {} : { forRecordId: input.forRecordId }),
          },
          signal,
        )),
      ],
    })),
  ),
  // A board's first load (spec 0021): one place in the read gate for the whole call, cancelled with its request.
  groups: member.records.groups.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => {
      const answer = await queryGroups(
        context.scope,
        {
          objectId: input.objectId,
          groupBy: input.groupBy,
          groupIds: input.groupIds,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
          ...(input.attributeIds === undefined ? {} : { attributeIds: input.attributeIds }),
          ...(input.threadCounts === true ? { threadCounts: true } : {}),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.probeArchived === undefined ? {} : { probeArchived: input.probeArchived }),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        signal,
      );
      const groups = answer.groups.map((group) => ({ ...group, records: [...group.records] }));
      return answer.archivedHolding === undefined
        ? { groups }
        : { groups, archivedHolding: [...answer.archivedHolding] };
    }),
  ),
  get: member.records.get.handler(({ context, input }) =>
    readRecordsById(context.scope, input.ids, input.attributeIds, {
      ...(input.threadCounts === true ? { threadCounts: true } : {}),
    }),
  ),
  // The record page (spec 0017): a page of its timeline, and a record in the trash, which opens read only.
  activity: member.records.activity.handler(async ({ context, input }) => {
    const page = await getActivity(context.scope, {
      recordId: input.recordId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return page.nextCursor === undefined
      ? { entries: [...page.entries] }
      : { entries: [...page.entries], nextCursor: page.nextCursor };
  }),
  // A record's stage age (13 Oct reference batch 4): when it entered the stage it is in now.
  stageSince: member.records.stageSince.handler(({ context, input }) =>
    getStageSince(context.scope, { recordId: input.recordId, attributeId: input.attributeId }),
  ),
  // Likely duplicates (spec 0049): the check while a member types (60 a minute each, through the central limiter),
  // the Duplicates page's pairs, and "Not a duplicate" with its Undo.
  duplicates: {
    check: member.records.duplicates.check.handler(async ({ context, input, signal }) => {
      const memberId = context.scope.actor.id ?? context.user.id;
      const limit = await context.limiter.consumeRateLimit(
        `duplicates:check:${context.scope.workspaceId}:${memberId}`,
        {
          window: 60,
          max: CHECKS_PER_MINUTE,
        },
      );
      if (!limit.allowed) throw apiError('RATE_LIMITED', 'Too many checks in the last minute. Try again shortly.');
      const matches = await checkDuplicates(
        context.scope,
        {
          objectId: input.objectId,
          values: input.values,
          ...(input.excludeRecordId === undefined ? {} : { excludeRecordId: input.excludeRecordId }),
        },
        signal,
      );
      return { matches: [...matches] };
    }),
    list: member.records.duplicates.list.handler(async ({ context, input, signal }) => {
      const memberId = context.scope.actor.id ?? context.user.id;
      const limit = await context.limiter.consumeRateLimit(`duplicates:list:${context.scope.workspaceId}:${memberId}`, {
        window: 60,
        max: LISTS_PER_MINUTE,
      });
      if (!limit.allowed) throw apiError('RATE_LIMITED', 'Too many reads in the last minute. Try again shortly.');
      const page = await listDuplicates(
        context.scope,
        {
          objectId: input.objectId,
          ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
        signal,
      );
      return { pairs: [...page.pairs], ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
    }),
    dismiss: member.records.duplicates.dismiss.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        dismissPair(context.scope, { objectId: input.objectId, recordIds: input.recordIds }, hooks),
      ),
    ),
    restore: member.records.duplicates.restore.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        restorePair(context.scope, { objectId: input.objectId, recordIds: input.recordIds }, hooks),
      ),
    ),
  },
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
      return {
        ...result.record,
        written: result.written,
        ...(result.filedCompany === undefined ? {} : { filedCompany: result.filedCompany }),
        echoes,
      };
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
          ...(input.noFiling === true ? { noFiling: true } : {}),
        },
        hooks,
      ),
    );
    return {
      ...result.record,
      written: result.written,
      ...(result.filedCompany === undefined ? {} : { filedCompany: result.filedCompany }),
      echoes,
    };
  }),
  // One write for up to 500 records (spec 0006, AC-50): 200 with each record's outcome.
  setValuesBatch: member.records.setValuesBatch.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      editRecords(
        context.scope,
        {
          items: input.items,
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.noFiling === true ? { noFiling: true } : {}),
        },
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
        {
          objectId: input.objectId,
          recordIds: input.recordIds,
          batchId: input.batchId,
          ...(input.unlinkedOnly === true ? { unlinkedOnly: true } : {}),
        },
        hooks,
      ),
    );
    return { results: [...result], echoes };
  }),
  // Past 500 records (only a delete job makes such a batch) the undo starts a restore job (spec 0022, milestone 3).
  restoreBatch: member.records.restoreBatch.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      undoDelete(
        context.scope,
        context.jobs,
        { batchId: input.batchId, ...(input.jobId === undefined ? {} : { jobId: input.jobId }) },
        hooks,
      ),
    );
    return result.mode === 'inline'
      ? { mode: 'inline' as const, results: [...result.results], echoes }
      : { mode: 'job' as const, job: result.job, echoes };
  }),
  // A bulk change as a background job (spec 0022, milestone 3): counted, then confirmed with jobs.confirm.
  startBulk: member.records.startBulk.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      startBulk(
        context.scope,
        context.jobs,
        {
          id: input.id,
          action: input.action,
          target: input.target,
          ...(input.edit === undefined ? {} : { edit: input.edit }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        hooks,
      ),
    ),
  ),
  // Bulk edit (spec 0022, milestone 2): one attribute of up to 500 records, each computed under its lock.
  updateMany: member.records.updateMany.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      bulkEditRecords(
        context.scope,
        {
          objectId: input.objectId,
          recordIds: input.recordIds,
          edit: {
            attributeId: input.edit.attributeId,
            op: input.edit.op,
            ...(input.edit.value === undefined ? {} : { value: input.edit.value }),
          },
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        hooks,
      ),
    );
    return { results: result, echoes };
  }),
  // Merging two records (spec 0049): the dialog's read only preview, then the merge, which answers the kept record.
  mergePreview: member.records.mergePreview.handler(({ context, input }) =>
    readMergePreview(context.scope, { objectId: input.objectId, keepId: input.keepId, mergeId: input.mergeId }),
  ),
  merge: member.records.merge.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      mergeAndRead(
        context.scope,
        {
          objectId: input.objectId,
          keepId: input.keepId,
          mergeId: input.mergeId,
          picks: input.picks,
          revisions: input.revisions,
        },
        hooks,
      ),
    );
    return { record: result.record, mergedId: result.mergedId, moved: result.moved, echoes };
  }),
});
