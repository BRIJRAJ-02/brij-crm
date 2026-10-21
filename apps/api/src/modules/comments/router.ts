import {
  commentVersions,
  createComment,
  deleteComment,
  getThreads,
  listThreads,
  setThreadResolved,
  toggleReaction,
  updateComment,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Comments (spec 0038), inside a workspace: the door has let in an active member, and `context.scope` is theirs.
// A comment follows its record (decision 3): whoever may read the record reads and writes its comments, and a
// record they can't read answers `NOT_FOUND`. Each write goes through `commitWrite`, so its `comments` row, and
// the `notifications` row for anyone it notified, are stored with it and the worker is woken once it commits.
export const commentsRouter = member.comments.router({
  list: member.comments.list.handler(({ context, input }) =>
    listThreads(context.scope, {
      recordId: input.recordId,
      ...(input.resolved === undefined ? {} : { resolved: input.resolved }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  ),
  get: member.comments.get.handler(({ context, input }) => getThreads(context.scope, { threadIds: input.threadIds })),
  create: member.comments.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createComment(
          context.scope,
          {
            id: input.id,
            recordId: input.recordId,
            ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
            body: input.body,
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.comments.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateComment(context.scope, { commentId: input.commentId, body: input.body }, hooks),
    ),
  ),
  delete: member.comments.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteComment(context.scope, { commentId: input.commentId }, hooks),
    ),
  ),
  resolve: member.comments.resolve.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setThreadResolved(context.scope, { threadId: input.threadId, resolved: input.resolved }, hooks),
    ),
  ),
  react: member.comments.react.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      toggleReaction(context.scope, { commentId: input.commentId, emoji: input.emoji, on: input.on }, hooks),
    ),
  ),
  versions: member.comments.versions.handler(({ context, input }) =>
    commentVersions(context.scope, { commentId: input.commentId }),
  ),
});
