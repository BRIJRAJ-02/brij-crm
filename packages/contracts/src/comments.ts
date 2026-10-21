// Comments (spec 0038): threads on any record, by record id. A thread is its
// first comment and the replies naming it; the text is plain, with mentions as
// `<@member-uuid>` tokens (`@crm/contracts/mentions`). Read and written through
// `comments.*`, behind the member door; whoever may read the record may
// comment on it (decision 3).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { COMMENT_EMOJI, COMMENT_MAX, THREAD_GET_MAX } from './mentions.ts';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { WorkspaceScoped } from './workspaces.ts';

export {
  bodySegments,
  COMMENT_EMOJI,
  COMMENT_MAX,
  COMMENT_MENTIONS_MAX,
  excerptOf,
  isCommentEmoji,
  joinSegments,
  mentionedIds,
  mentionToken,
  THREAD_COMMENTS_MAX,
  THREAD_GET_MAX,
  THREAD_PAGE,
  type BodySegment,
  type CommentEmoji,
} from './mentions.ts';

/** The longest cursor `comments.list` takes. */
export const MAX_COMMENT_CURSOR = 256;

/** A comment's text: trimmed at its ends, then 1 to 10,000 characters. */
export const CommentBody = z
  .string()
  .trim()
  .min(1, "A comment can't be empty.")
  .max(COMMENT_MAX, `A comment holds at most ${COMMENT_MAX.toLocaleString('en')} characters.`);
/** A comment's text. */
export type CommentBody = z.infer<typeof CommentBody>;

/** One of the six reactions. */
export const CommentEmojiValue = z.enum(COMMENT_EMOJI, { error: 'Pick one of the six reactions.' });

/** A reaction on a comment as one reader sees it: how many, whether one is theirs, and the first 10 who reacted. */
export const ReactionSummary = z.object({
  emoji: CommentEmojiValue,
  count: z.number().int().min(1),
  mine: z.boolean(),
  memberIds: z.array(z.uuid()).max(10),
});
/** A reaction on a comment. */
export type ReactionSummary = z.infer<typeof ReactionSummary>;

/**
 * One comment as a reader sees it. A deleted comment in a thread with other
 * live comments comes back as a placeholder: `isDeleted`, with no body, author
 * or reactions (AC-1156).
 */
export const CommentView = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  isDeleted: z.boolean(),
  /** The text with mention tokens; empty on a placeholder. */
  body: z.string(),
  /** Absent on a placeholder. */
  createdBy: ActorReferenceValue.optional(),
  createdAt: Timestamp,
  /** Set once it was edited; the earlier versions come from `comments.versions`. */
  editedAt: Timestamp.optional(),
  version: z.number().int().min(1),
  reactions: z.array(ReactionSummary),
  /** The reader wrote it (only an author edits). */
  canEdit: z.boolean(),
  /** The reader wrote it, or holds `comments.manage`. */
  canDelete: z.boolean(),
});
/** One comment as a reader sees it. */
export type CommentView = z.infer<typeof CommentView>;

/**
 * A thread: its first comment, then its newest replies (at most 20, all of
 * them when read `whole`), oldest first, with its resolved state.
 */
export const ThreadView = z.object({
  id: z.uuid(),
  recordId: z.uuid(),
  resolvedAt: Timestamp.optional(),
  resolvedBy: ActorReferenceValue.optional(),
  /** Replies before the newest 20 that this read left out; `comments.get` with `whole` brings them. */
  earlierCount: z.number().int().min(0),
  comments: z.array(CommentView).min(1),
});
/** A thread. */
export type ThreadView = z.infer<typeof ThreadView>;

/**
 * A page of a record's threads, newest first by their first comment (a screen
 * shows them oldest first). `counts` on the first page: open and resolved
 * threads.
 */
export const ThreadPage = z.object({
  threads: z.array(ThreadView),
  nextCursor: z.string().optional(),
  counts: z.object({ open: z.number().int().min(0), resolved: z.number().int().min(0) }).optional(),
});
/** A page of a record's threads. */
export type ThreadPage = z.infer<typeof ThreadPage>;

/** A page of a record's threads: open ones, or resolved ones (the tab's disclosure). */
export const ListCommentsInput = WorkspaceScoped.extend({
  recordId: z.uuid(),
  resolved: z.boolean().optional(),
  cursor: z.string().min(1).max(MAX_COMMENT_CURSOR).optional(),
});
/** A page of a record's threads. */
export type ListCommentsInput = z.infer<typeof ListCommentsInput>;

/** Threads by id: what a `comments` event's ids are read back through. Missing and hidden ones are left out. */
export const GetThreadsInput = WorkspaceScoped.extend({
  threadIds: z
    .array(z.uuid())
    .min(1)
    .max(THREAD_GET_MAX, `Read at most ${String(THREAD_GET_MAX)} threads at once.`),
  /** Every reply of the one thread asked for, not only the newest 20. */
  whole: z.boolean().optional(),
});
/** Threads by id. */
export type GetThreadsInput = z.infer<typeof GetThreadsInput>;

/** A new comment: a thread's first (no `threadId`) or a reply. `id` is a UUID v7 the browser minted, the retry key. */
export const CreateCommentInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The comment id must be a UUID v7.' }),
  recordId: z.uuid(),
  threadId: z.uuid().optional(),
  body: CommentBody,
  mutationId: z.uuid(),
});
/** A new comment. */
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

/** A comment's new text: its author only. */
export const UpdateCommentInput = WorkspaceScoped.extend({
  commentId: z.uuid(),
  body: CommentBody,
  mutationId: z.uuid(),
});
/** A comment's new text. */
export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>;

/** Deletes a comment: its author, or a holder of `comments.manage`. */
export const DeleteCommentInput = WorkspaceScoped.extend({
  commentId: z.uuid(),
  mutationId: z.uuid(),
});
/** Deletes a comment. */
export type DeleteCommentInput = z.infer<typeof DeleteCommentInput>;

/** Resolves or reopens a thread. */
export const ResolveThreadInput = WorkspaceScoped.extend({
  threadId: z.uuid(),
  resolved: z.boolean(),
  mutationId: z.uuid(),
});
/** Resolves or reopens a thread. */
export type ResolveThreadInput = z.infer<typeof ResolveThreadInput>;

/** Adds (`on`) or takes back the reader's reaction. */
export const ReactInput = WorkspaceScoped.extend({
  commentId: z.uuid(),
  emoji: CommentEmojiValue,
  on: z.boolean(),
  mutationId: z.uuid(),
});
/** Adds or takes back a reaction. */
export type ReactInput = z.infer<typeof ReactInput>;

/** A comment's earlier texts. */
export const CommentVersionsInput = WorkspaceScoped.extend({ commentId: z.uuid() });
/** A comment's earlier texts. */
export type CommentVersionsInput = z.infer<typeof CommentVersionsInput>;

/** One earlier text of a comment, and when it was written. */
export const CommentVersion = z.object({
  version: z.number().int().min(1),
  body: z.string(),
  at: Timestamp,
});
/** One earlier text of a comment. */
export type CommentVersion = z.infer<typeof CommentVersion>;

/** What deleting a comment answers: its thread, which a screen then reads again (or drops). */
export const DeletedComment = z.object({ threadId: z.uuid() });
/** What deleting a comment answers. */
export type DeletedComment = z.infer<typeof DeletedComment>;

/**
 * Where a page of threads ends, inside the opaque cursor (base64url JSON): the
 * last first comment's creation time (microseconds) and id. Strict.
 */
export const ThreadCursor = z.strictObject({
  resolved: z.boolean(),
  createdAt: z.string().max(40),
  id: z.uuid(),
});
/** Where a page of threads ends. */
export type ThreadCursor = z.infer<typeof ThreadCursor>;

/** The comments procedures (spec 0038). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const commentsContract = {
  list: oc.input(ListCommentsInput).output(ThreadPage),
  get: oc.input(GetThreadsInput).output(z.array(ThreadView)),
  create: oc.input(CreateCommentInput).output(ThreadView),
  update: oc.input(UpdateCommentInput).output(ThreadView),
  delete: oc.input(DeleteCommentInput).output(DeletedComment),
  resolve: oc.input(ResolveThreadInput).output(ThreadView),
  react: oc.input(ReactInput).output(ThreadView),
  versions: oc.input(CommentVersionsInput).output(z.array(CommentVersion)),
};
