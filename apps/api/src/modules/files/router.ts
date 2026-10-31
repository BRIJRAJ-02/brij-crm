import { deleteAttachment, listAttachments, restoreAttachment } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// A record's Files tab (#32), inside a workspace: the door has let in an active member, and `context.scope` is theirs.
// Access follows the record: whoever may read it lists its files; whoever may change it deletes and restores them,
// each through `commitWrite`, so its `files` outbox row is stored with it. The bytes go up through
// `POST /api/records/:recordId/files` and down through `GET /api/files/:fileId` (`forms/uploads.ts`).
export const filesRouter = member.files.router({
  list: member.files.list.handler(({ context, input }) => listAttachments(context.scope, { recordId: input.recordId })),
  delete: member.files.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteAttachment(context.scope, { fileId: input.fileId }, hooks),
    ),
  ),
  restore: member.files.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreAttachment(context.scope, { fileId: input.fileId }, hooks),
    ),
  ),
});
