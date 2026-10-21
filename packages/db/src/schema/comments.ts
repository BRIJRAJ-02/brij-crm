// Comments (spec 0038): threads on any record, by record id, beside the
// records engine, never per object columns. A thread is its first comment
// (`thread_id = id`) and the replies naming it. The body is plain text in
// which a mention is a `<@member-uuid>` token, so a rename never rewrites a
// comment; `mention_member_ids` holds the ids the service parsed from it. An
// edit keeps the text it replaced in `comment_versions`. A deleted comment
// stays (hidden, or a placeholder while its thread has live comments). The
// foreign key to the record has no `on delete` action: the purge deletes a
// record's comments first, in its transaction (spec 0022), and versions and
// reactions go with their comment.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { COMMENT_EMOJI } from '@crm/contracts/mentions';
import { actorColumns, auditColumns, timestamptz, workspaceId } from './common.ts';
import { records } from './records.ts';
import { actorConstraints, members } from './workspaces.ts';

const resolvedBy = actorColumns('resolved_by');
const deletedBy = actorColumns('deleted_by');

/** One comment: a thread's first comment or a reply. */
export const comments = pgTable(
  'comments',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints when the composer sends: the retry key. */
    id: uuid('id').notNull(),
    recordId: uuid('record_id').notNull(),
    /** The thread's first comment: equal to `id` on a first comment. */
    threadId: uuid('thread_id').notNull(),
    /** 1 to 10,000 characters, trimmed by the service; mentions as `<@uuid>`. */
    body: text('body').notNull(),
    /** The members the body mentions, parsed by the service: at most 50. */
    mentionMemberIds: uuid('mention_member_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** 1, then one more per edit. */
    version: integer('version').notNull().default(1),
    editedAt: timestamptz('edited_at'),
    /** A first comment only: when its thread was resolved, and by whom. */
    resolvedAt: timestamptz('resolved_at'),
    resolvedByType: resolvedBy.type,
    resolvedById: resolvedBy.id,
    resolvedByMemberId: resolvedBy.memberId,
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
    deletedByType: deletedBy.type,
    deletedById: deletedBy.id,
    deletedByMemberId: deletedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'comments_pkey', columns: [t.workspaceId, t.id] }),
    // No `on delete` action: the purge deletes a record's comments before the record (spec 0022).
    foreignKey({
      name: 'comments_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'comments_thread',
      columns: [t.workspaceId, t.threadId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    check('comments_body', sql`char_length(${t.body}) between 1 and 10000`),
    check('comments_mentions', sql`cardinality(${t.mentionMemberIds}) <= 50`),
    check('comments_version', sql`${t.version} >= 1`),
    check('comments_edited', sql`(${t.version} = 1) = (${t.editedAt} is null)`),
    // Only a thread's first comment is resolved, and who resolved it comes with when.
    check('comments_resolved', sql`${t.resolvedAt} is null or ${t.threadId} = ${t.id}`),
    check('comments_resolved_actor', sql`(${t.resolvedAt} is null) = (${t.resolvedByType} is null)`),
    check('comments_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    // The Comments tab: a record's threads by their first comment (deleted or not: its replies may live), newest first.
    index('comments_by_record')
      .on(t.workspaceId, t.recordId, t.createdAt, t.id)
      .where(sql`${t.id} = ${t.threadId}`),
    // A thread's comments in order, and the thread key's own check.
    index('comments_by_thread').on(t.workspaceId, t.threadId, t.createdAt, t.id),
    // The purge's delete of a record's comments, live or not.
    index('comments_record_all').on(t.workspaceId, t.recordId),
    ...actorConstraints('comments', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('comments', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('comments', 'resolved_by', t.workspaceId, {
      type: t.resolvedByType,
      id: t.resolvedById,
      memberId: t.resolvedByMemberId,
    }),
    ...actorConstraints('comments', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);

const versionBy = actorColumns('created_by');

/** A comment's earlier text: an edit inserts the text it replaces, under the comment's lock. */
export const commentVersions = pgTable(
  'comment_versions',
  {
    workspaceId: workspaceId(),
    commentId: uuid('comment_id').notNull(),
    /** The version this text was. */
    version: integer('version').notNull(),
    body: text('body').notNull(),
    /** When this text was written (the comment's creation, or the edit before). */
    createdAt: timestamptz('created_at').notNull(),
    createdByType: versionBy.type.notNull(),
    createdById: versionBy.id,
    createdByMemberId: versionBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'comment_versions_pkey', columns: [t.workspaceId, t.commentId, t.version] }),
    foreignKey({
      name: 'comment_versions_comment',
      columns: [t.workspaceId, t.commentId],
      foreignColumns: [comments.workspaceId, comments.id],
    }).onDelete('cascade'),
    check('comment_versions_body', sql`char_length(${t.body}) between 1 and 10000`),
    ...actorConstraints('comment_versions', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
  ],
);

/** One member's reaction to a comment. */
export const commentReactions = pgTable(
  'comment_reactions',
  {
    workspaceId: workspaceId(),
    commentId: uuid('comment_id').notNull(),
    memberId: uuid('member_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'comment_reactions_pkey', columns: [t.workspaceId, t.commentId, t.memberId, t.emoji] }),
    foreignKey({
      name: 'comment_reactions_comment',
      columns: [t.workspaceId, t.commentId],
      foreignColumns: [comments.workspaceId, comments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'comment_reactions_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('comment_reactions_emoji', sql.raw(`emoji in (${COMMENT_EMOJI.map((emoji) => `'${emoji}'`).join(', ')})`)),
  ],
);
