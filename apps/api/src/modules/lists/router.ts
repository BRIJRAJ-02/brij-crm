import {
  addListEntries,
  addListEntry,
  archiveList,
  countEntries,
  createList,
  editEntry,
  entriesForRecord,
  entryMembership,
  listLists,
  queryEntries,
  queryGroups,
  readEntryPage,
  removeEntries,
  restoreEntries,
  restoreList,
  updateList,
  type EntryOutcome,
  type WrittenEntry,
} from '@crm/core';
import { commitCounted, commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Lists and their entries (spec 0048), inside a workspace: the door has let in an active member, and
// `context.scope` is theirs. A list follows its object (decision 2); the services check it. Reads share the records
// reads' gate (a seventh at once answers 429) and are cancelled with their request.
export const listsRouter = member.lists.router({
  list: member.lists.list.handler(({ context, input }) =>
    listLists(context.scope, { includeArchived: input.includeArchived === true }),
  ),
  create: member.lists.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createList(
        context.scope,
        {
          id: input.id,
          objectId: input.objectId,
          name: input.name,
          icon: input.icon,
          hue: input.hue,
          template: input.template,
          allowsDuplicates: input.allowsDuplicates,
        },
        hooks,
      ),
    ),
  ),
  update: member.lists.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateList(
        context.scope,
        {
          listId: input.listId,
          name: input.name,
          icon: input.icon,
          hue: input.hue,
          allowsDuplicates: input.allowsDuplicates,
        },
        hooks,
      ),
    ),
  ),
  archive: member.lists.archive.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveList(context.scope, { listId: input.listId }, hooks),
    ),
  ),
  restore: member.lists.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreList(context.scope, { listId: input.listId }, hooks),
    ),
  ),
});

/** A written entry as the contract answers it: the entry, its record, its versions and echoes. */
const writtenView = (written: WrittenEntry, echoes: number) => ({
  ...written.entry,
  ...(written.record === undefined ? {} : { record: written.record }),
  written: written.written,
  echoes,
});

/** A batch's outcomes as the contract answers them. */
const outcomesView = (outcomes: readonly EntryOutcome[], echoes: number) => ({
  results: outcomes.map((outcome) => ({
    entryId: outcome.entryId,
    ...(outcome.refusal === undefined
      ? {}
      : { refusal: { code: outcome.refusal.code, message: outcome.refusal.message } }),
  })),
  echoes,
});

export const entriesRouter = member.entries.router({
  query: member.entries.query.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => {
      const page = await queryEntries(
        context.scope,
        {
          listId: input.listId,
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
      );
      const answer = { entries: [...page.entries], records: [...page.records] };
      return page.nextCursor === undefined ? answer : { ...answer, nextCursor: page.nextCursor };
    }),
  ),
  count: member.entries.count.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, () =>
      countEntries(
        context.scope,
        {
          listId: input.listId,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        signal,
      ),
    ),
  ),
  // A list board's first load (AC-4820): one place in the read gate for the whole call.
  groups: member.entries.groups.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, async () => {
      const answer = await queryGroups(
        context.scope,
        {
          listId: input.listId,
          groupBy: input.groupBy,
          groupIds: input.groupIds,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
          ...(input.sorts === undefined ? {} : { sorts: input.sorts }),
          ...(input.attributeIds === undefined ? {} : { attributeIds: input.attributeIds }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        signal,
      );
      return {
        groups: answer.groups.map((group) => ({
          id: group.id,
          entries: [...(group.entries ?? [])],
          records: [...group.records],
          ...(group.nextCursor === undefined ? {} : { nextCursor: group.nextCursor }),
          count: group.count,
          atLeast: group.atLeast,
        })),
      };
    }),
  ),
  get: member.entries.get.handler(async ({ context, input }) => {
    const page = await readEntryPage(context.scope, input.ids, input.attributeIds);
    return { entries: [...page.entries], records: [...page.records] };
  }),
  membership: member.entries.membership.handler(async ({ context, input }) => ({
    recordIds: [...(await entryMembership(context.scope, { listId: input.listId, recordIds: input.recordIds }))],
  })),
  // Every write answers `echoes` (spec 0006): how many change events carry its mutation id.
  add: member.entries.add.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      addListEntry(
        context.scope,
        {
          id: input.id,
          listId: input.listId,
          recordId: input.recordId,
          values: input.values,
          timeZone: input.timeZone,
        },
        hooks,
      ),
    );
    return writtenView(result, echoes);
  }),
  // Up to 500 records into one list, each on its own (AC-4825): who went in, who was already in, who was refused.
  addMany: member.entries.addMany.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      addListEntries(
        context.scope,
        { listId: input.listId, recordIds: input.recordIds, ids: input.ids, timeZone: input.timeZone },
        hooks,
      ),
    );
    return { added: [...result.added], alreadyIn: [...result.alreadyIn], refused: [...result.refused], echoes };
  }),
  // A record page's Lists section (AC-4822): readable lists only, no gap or count for the others.
  forRecord: member.entries.forRecord.handler(async ({ context, input }) => ({
    entries: [...(await entriesForRecord(context.scope, { recordId: input.recordId }))],
  })),
  setValues: member.entries.setValues.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      editEntry(context.scope, { entryId: input.entryId, values: input.values }, hooks),
    );
    return writtenView(result, echoes);
  }),
  remove: member.entries.remove.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      removeEntries(context.scope, { entryIds: input.entryIds }, hooks),
    );
    return outcomesView(result, echoes);
  }),
  restore: member.entries.restore.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      restoreEntries(context.scope, { entryIds: input.entryIds }, hooks),
    );
    return outcomesView(result, echoes);
  }),
});
