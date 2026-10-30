// Notifications and their settings (spec 0038). A notification is one row per
// recipient, written in the transaction of what caused it (a comment, a task
// assignment), naming that thing by id and never copying its text. Who may see
// it is decided when it is read, through the access door, so a change of rules
// or the trash needs no rewrite here. A record's notifications go before the
// record when it is purged (the foreign key has no `on delete` action); a
// comment's and a task's go with them. `notification_settings` holds a
// member's email choices for a workspace; no row means the defaults.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, timestamptz, workspaceId } from './common.ts';
import { automations } from './automations.ts';
import { comments } from './comments.ts';
import { formSubmissions } from './forms.ts';
import { notes } from './notes.ts';
import { records } from './records.ts';
import { tasks } from './tasks.ts';
import { joinRequests } from './team.ts';
import { actorConstraints, members } from './workspaces.ts';

/** Why a member was notified (spec 0038, decision 8). */
export const notificationKind = pgEnum('notification_kind', [
  'mention',
  'reply',
  'task_assigned',
  'form_submission',
  'join_request',
  'automation',
]);

const actor = actorColumns('actor');

/** One notification for one member. */
export const notifications = pgTable(
  'notifications',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    /** The recipient. */
    memberId: uuid('member_id').notNull(),
    kind: notificationKind('kind').notNull(),
    actorType: actor.type.notNull(),
    actorId: actor.id,
    actorMemberId: actor.memberId,
    /** The record it is about (a comment's), if any. */
    recordId: uuid('record_id'),
    threadId: uuid('thread_id'),
    commentId: uuid('comment_id'),
    taskId: uuid('task_id'),
    /** A mention in a note (spec 0038 with spec 0019): the note, and its record in `recordId`. */
    noteId: uuid('note_id'),
    /** A form's new submission (spec 0023, AC-568): the submission, never its answers. */
    submissionId: uuid('submission_id'),
    /** A request to join (migration 0131): told to each holder of `members.invite`. */
    joinRequestId: uuid('join_request_id'),
    /** An automation's notice (migration 0142): the automation, its run (one notice per member per run), and the task for a task due one. */
    automationId: uuid('automation_id'),
    automationRunId: uuid('automation_run_id'),
    dueTaskId: uuid('due_task_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    readAt: timestamptz('read_at'),
    doneAt: timestamptz('done_at'),
    /** When an email named it (spec 0038, AC-1176): never emailed twice. */
    emailedAt: timestamptz('emailed_at'),
  },
  (t) => [
    primaryKey({ name: 'notifications_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'notifications_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    // No `on delete` action: the purge deletes a record's notifications before the record (spec 0022).
    foreignKey({
      name: 'notifications_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'notifications_comment',
      columns: [t.workspaceId, t.commentId],
      foreignColumns: [comments.workspaceId, comments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notifications_task',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notifications_note',
      columns: [t.workspaceId, t.noteId],
      foreignColumns: [notes.workspaceId, notes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notifications_submission',
      columns: [t.workspaceId, t.submissionId],
      foreignColumns: [formSubmissions.workspaceId, formSubmissions.id],
    }).onDelete('cascade'),
    // A comment notification names its comment, thread and record; a task one its task; a note mention its note
    // and record; a submission one its submission (and its record, once filed); a join request its request
    // alone; an automation's its automation and run (and its record or its due task). Kinds compare as text
    // (0130, 0131, 0142): each value was added in its own migration's transaction.
    check(
      'notifications_subject',
      sql`(${t.kind}::text = 'task_assigned' and ${t.taskId} is not null and ${t.commentId} is null
          and ${t.noteId} is null and ${t.submissionId} is null and ${t.joinRequestId} is null
          and ${t.automationId} is null)
        or (${t.kind}::text in ('mention', 'reply') and ${t.commentId} is not null and ${t.threadId} is not null
          and ${t.recordId} is not null and ${t.taskId} is null and ${t.noteId} is null and ${t.submissionId} is null
          and ${t.joinRequestId} is null and ${t.automationId} is null)
        or (${t.kind}::text = 'mention' and ${t.noteId} is not null and ${t.recordId} is not null
          and ${t.commentId} is null and ${t.threadId} is null and ${t.taskId} is null and ${t.submissionId} is null
          and ${t.joinRequestId} is null and ${t.automationId} is null)
        or (${t.kind}::text = 'form_submission' and ${t.submissionId} is not null and ${t.commentId} is null
          and ${t.threadId} is null and ${t.taskId} is null and ${t.noteId} is null and ${t.joinRequestId} is null
          and ${t.automationId} is null)
        or (${t.kind}::text = 'join_request' and ${t.joinRequestId} is not null and ${t.recordId} is null
          and ${t.threadId} is null and ${t.commentId} is null and ${t.taskId} is null and ${t.noteId} is null
          and ${t.submissionId} is null and ${t.automationId} is null)
        or (${t.kind}::text = 'automation' and ${t.automationId} is not null and ${t.automationRunId} is not null
          and ${t.threadId} is null and ${t.commentId} is null and ${t.taskId} is null and ${t.noteId} is null
          and ${t.submissionId} is null and ${t.joinRequestId} is null)`,
    ),
    foreignKey({
      name: 'notifications_automation',
      columns: [t.workspaceId, t.automationId],
      foreignColumns: [automations.workspaceId, automations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notifications_due_task',
      columns: [t.workspaceId, t.dueTaskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete('cascade'),
    uniqueIndex('notifications_one_per_automation_run')
      .on(t.workspaceId, t.memberId, t.automationRunId)
      .where(sql`${t.automationRunId} is not null`),
    // The cascades from an automation's delete and a due task's.
    index('notifications_by_automation')
      .on(t.workspaceId, t.automationId)
      .where(sql`${t.automationId} is not null`),
    index('notifications_by_due_task')
      .on(t.workspaceId, t.dueTaskId)
      .where(sql`${t.dueTaskId} is not null`),
    // One per recipient per comment, and per task assignment.
    uniqueIndex('notifications_one_per_comment')
      .on(t.workspaceId, t.memberId, t.commentId)
      .where(sql`${t.commentId} is not null`),
    uniqueIndex('notifications_one_per_task')
      .on(t.workspaceId, t.memberId, t.taskId)
      .where(sql`${t.taskId} is not null`),
    foreignKey({
      name: 'notifications_join_request',
      columns: [t.workspaceId, t.joinRequestId],
      foreignColumns: [joinRequests.workspaceId, joinRequests.id],
    }).onDelete('cascade'),
    uniqueIndex('notifications_one_per_join_request')
      .on(t.workspaceId, t.memberId, t.joinRequestId)
      .where(sql`${t.joinRequestId} is not null`),
    // The cascade from a join request's delete.
    index('notifications_by_join_request')
      .on(t.workspaceId, t.joinRequestId)
      .where(sql`${t.joinRequestId} is not null`),
    uniqueIndex('notifications_one_per_note')
      .on(t.workspaceId, t.memberId, t.noteId)
      .where(sql`${t.noteId} is not null`),
    uniqueIndex('notifications_one_per_submission')
      .on(t.workspaceId, t.memberId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    // The inbox and Done tabs, newest first.
    index('notifications_inbox')
      .on(t.workspaceId, t.memberId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.doneAt} is null`),
    index('notifications_done')
      .on(t.workspaceId, t.memberId, t.doneAt.desc(), t.id.desc())
      .where(sql`${t.doneAt} is not null`),
    // The count, and the email task's pick.
    index('notifications_unread')
      .on(t.workspaceId, t.memberId, t.createdAt.desc())
      .where(sql`${t.readAt} is null and ${t.doneAt} is null`),
    // A submission's delete takes its notifications with it.
    index('notifications_by_submission')
      .on(t.workspaceId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    // The purge's delete of a record's notifications.
    index('notifications_by_record')
      .on(t.workspaceId, t.recordId)
      .where(sql`${t.recordId} is not null`),
    ...actorConstraints('notifications', 'actor', t.workspaceId, {
      type: t.actorType,
      id: t.actorId,
      memberId: t.actorMemberId,
    }),
  ],
);

/** A member's notification choices for one workspace (spec 0038, AC-1179). No row: the defaults. */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    workspaceId: workspaceId(),
    memberId: uuid('member_id').notNull(),
    emailMentions: boolean('email_mentions').notNull().default(true),
    emailReplies: boolean('email_replies').notNull().default(false),
    emailAssignments: boolean('email_assignments').notNull().default(true),
    digest: boolean('digest').notNull().default(false),
    /** The browser's IANA time zone when the digest was turned on: the digest goes at 08:00 there. */
    timeZone: text('time_zone'),
    /** The member's local date of the last digest, so a day gets one. */
    digestSentOn: date('digest_sent_on'),
    version: integer('version').notNull().default(1),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'notification_settings_pkey', columns: [t.workspaceId, t.memberId] }),
    foreignKey({
      name: 'notification_settings_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('notification_settings_digest', sql`not ${t.digest} or ${t.timeZone} is not null`),
    check('notification_settings_zone', sql`${t.timeZone} is null or char_length(${t.timeZone}) between 1 and 64`),
  ],
);
