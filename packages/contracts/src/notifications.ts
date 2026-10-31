// Notifications and the inbox (spec 0038): one row per recipient, naming what
// it is about by id. Every procedure acts on the caller's own notifications
// and settings only: none takes a member id. What a notification is about is
// resolved through the access door when it is read, so a notification the
// reader may no longer see is absent (AC-1166).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ActorReferenceValue, Timestamp } from './values/attribute-values.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** Notifications per page of the inbox (AC-1169). */
export const NOTIFICATION_PAGE = 50;

/** The unread count's cap: past it the badge reads "99+" (AC-1174). */
export const NOTIFICATION_COUNT_CAP = 99;

/** The longest excerpt of a comment a notification carries, in shown characters (AC-1169). */
export const NOTIFICATION_EXCERPT = 200;

/** The most notifications one mark names. */
export const NOTIFICATION_MARK_MAX = 100;

/** The longest cursor `notifications.list` takes. */
export const MAX_NOTIFICATION_CURSOR = 256;

/**
 * Why a member was notified (decision 8); `form_submission`, a form they're told about got one (spec 0023, AC-568);
 * `join_request`, someone asks to join (flow pass); `task_due`, a task assigned to them is due today (migration 0135);
 * `automation`, an automation's notify action (parity #53); `scheduling_changed`, someone else changed the member's
 * scheduling (spec 0037, AC-1264), naming only who; `webhook_off`, a webhook endpoint turned off after 3 days of
 * failed deliveries (spec 0064, AC-6423), to owners and admins.
 */
export const NotificationKind = z.enum([
  'mention',
  'reply',
  'task_assigned',
  'form_submission',
  'join_request',
  'task_due',
  'automation',
  'scheduling_changed',
  'webhook_off',
]);
/** Why a member was notified. */
export type NotificationKind = z.infer<typeof NotificationKind>;

/** The inbox's two tabs: not done, and done. */
export const NotificationStatus = z.enum(['inbox', 'done']);
/** The inbox's two tabs. */
export type NotificationStatus = z.infer<typeof NotificationStatus>;

/**
 * One notification as its recipient sees it: who, why and when, the record as
 * a display (the recipient's own read of it), and an excerpt: the comment's
 * start (mention tokens kept, at most 200 shown characters), or the task's
 * title.
 */
export const NotificationView = z.object({
  id: Uuid,
  kind: NotificationKind,
  actor: ActorReferenceValue,
  createdAt: Timestamp,
  readAt: Timestamp.optional(),
  doneAt: Timestamp.optional(),
  record: RecordRefDisplay.optional(),
  threadId: Uuid.optional(),
  commentId: Uuid.optional(),
  taskId: Uuid.optional(),
  /** A mention in a note (with its record in `record`): the note window opens on it. */
  noteId: Uuid.optional(),
  /** Someone asks to join (flow pass, 30 Oct 2026): shown to holders of `members.invite` while it is open. */
  joinRequestId: Uuid.optional(),
  /** A form's new submission (with the record it filed in `record`, when the reader may see it). */
  submissionId: Uuid.optional(),
  formId: Uuid.optional(),
  formName: z.string().optional(),
  /** A webhook endpoint turned off (spec 0064): the endpoint, which Settings › Webhooks opens on; its host is the excerpt. */
  webhookEndpointId: Uuid.optional(),
  excerpt: z.string(),
});
/** One notification as its recipient sees it. */
export type NotificationView = z.infer<typeof NotificationView>;

/** A page of the inbox, newest first (Done: newest done first). */
export const ListNotificationsInput = WorkspaceScoped.extend({
  status: NotificationStatus,
  kind: NotificationKind.optional(),
  unreadOnly: z.boolean().optional(),
  cursor: z.string().min(1).max(MAX_NOTIFICATION_CURSOR).optional(),
});
/** A page of the inbox. */
export type ListNotificationsInput = z.infer<typeof ListNotificationsInput>;

/** A page of notifications, and the cursor for the next when there are more. */
export const NotificationPage = z.object({
  items: z.array(NotificationView),
  nextCursor: z.string().optional(),
});
/** A page of notifications. */
export type NotificationPage = z.infer<typeof NotificationPage>;

/** Where a page of notifications ends: the last one's sort time (microseconds) and id. Strict. */
export const NotificationCursor = z.strictObject({
  status: NotificationStatus,
  at: z.string().max(40),
  id: Uuid,
});
/** Where a page of notifications ends. */
export type NotificationCursor = z.infer<typeof NotificationCursor>;

/** The unread count: unread and not done, counted up to `NOTIFICATION_COUNT_CAP` (`atLeast` past it). */
export const NotificationCount = z.object({
  count: z.number().int().min(0),
  atLeast: z.boolean(),
});
/** The unread count. */
export type NotificationCount = z.infer<typeof NotificationCount>;

/** Marks some of the caller's notifications read or unread, done or back in the inbox. */
export const MarkNotificationsInput = WorkspaceScoped.extend({
  ids: z
    .array(Uuid)
    .min(1)
    .max(NOTIFICATION_MARK_MAX, `Mark at most ${String(NOTIFICATION_MARK_MAX)} notifications at once.`),
  read: z.boolean().optional(),
  done: z.boolean().optional(),
  mutationId: Uuid,
});
/** Marks some of the caller's notifications. */
export type MarkNotificationsInput = z.infer<typeof MarkNotificationsInput>;

/** Marks every unread notification of a tab (and a kind) read; with `done`, every one of the inbox done. */
export const MarkAllReadInput = WorkspaceScoped.extend({
  status: NotificationStatus,
  kind: NotificationKind.optional(),
  /** Mark all done: every notification of the inbox tab (and kind) done and read. */
  done: z.literal(true).optional(),
  mutationId: Uuid,
});
/** Marks every unread notification of a tab read. */
export type MarkAllReadInput = z.infer<typeof MarkAllReadInput>;

/** How many notifications a mark changed. */
export const MarkedNotifications = z.object({ changed: z.number().int().min(0) });
/** How many notifications a mark changed. */
export type MarkedNotifications = z.infer<typeof MarkedNotifications>;

/** An IANA time zone name, as the browser reports it. */
const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { error: 'That time zone is not known.' },
  );

/** A member's email choices for one workspace (AC-1179). */
export const NotificationSettings = z.object({
  emailMentions: z.boolean(),
  emailReplies: z.boolean(),
  emailAssignments: z.boolean(),
  digest: z.boolean(),
  timeZone: z.string().optional(),
  version: z.number().int().min(0),
});
/** A member's email choices. */
export type NotificationSettings = z.infer<typeof NotificationSettings>;

/** Changes some of the caller's switches. Turning the digest on needs the browser's time zone. */
export const SetNotificationSettingsInput = WorkspaceScoped.extend({
  emailMentions: z.boolean().optional(),
  emailReplies: z.boolean().optional(),
  emailAssignments: z.boolean().optional(),
  digest: z.boolean().optional(),
  timeZone: TimeZone.optional(),
  mutationId: Uuid,
});
/** Changes some of the caller's switches. */
export type SetNotificationSettingsInput = z.infer<typeof SetNotificationSettingsInput>;

/** The notifications procedures (spec 0038): the caller's own only, behind the member door. */
export const notificationsContract = {
  list: oc.input(ListNotificationsInput).output(NotificationPage),
  count: oc.input(WorkspaceScoped).output(NotificationCount),
  mark: oc.input(MarkNotificationsInput).output(MarkedNotifications),
  markAllRead: oc.input(MarkAllReadInput).output(MarkedNotifications),
  settings: oc.input(WorkspaceScoped).output(NotificationSettings),
  setSettings: oc.input(SetNotificationSettingsInput).output(NotificationSettings),
};
