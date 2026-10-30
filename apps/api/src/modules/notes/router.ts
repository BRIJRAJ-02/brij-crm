import { deleteNote, getNote, linkNote, listNotes, restoreNote, saveNote } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Notes (spec 0019), inside a workspace: the door has let in an active member, and `context.scope` is theirs. The
// services apply the record's access (a note follows its record); each write goes through `commitWrite`, so its
// `notes` event is stored with it and the worker is woken once it commits. An oversized body is the service's 422
// `CONFIG_INVALID` on `content`: the input schema leaves the size to it.
export const notesRouter = member.notes.router({
  get: member.notes.get.handler(({ context, input }) => getNote(context.scope, { noteId: input.noteId })),
  list: member.notes.list.handler(({ context, input }) =>
    listNotes(context.scope, {
      ...(input.recordId === undefined ? {} : { recordId: input.recordId }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  ),
  save: member.notes.save.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        saveNote(
          context.scope,
          {
            id: input.id,
            recordId: input.recordId,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.kind === undefined ? {} : { kind: input.kind }),
            ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
            ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
            ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
            ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  delete: member.notes.delete.handler(async ({ context, input }) => {
    await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteNote(context.scope, { noteId: input.noteId }, hooks),
    );
    return { ok: true as const };
  }),
  restore: member.notes.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreNote(context.scope, { noteId: input.noteId }, hooks),
    ),
  ),
  // A note's links (migration 0136): the service applies the note's own record's access and each link's.
  link: member.notes.link.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        linkNote(
          context.scope,
          {
            noteId: input.noteId,
            ...(input.addRecordIds === undefined ? {} : { addRecordIds: input.addRecordIds }),
            ...(input.removeRecordIds === undefined ? {} : { removeRecordIds: input.removeRecordIds }),
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { LIMIT_REACHED: 'addRecordIds' });
    }
  }),
});
