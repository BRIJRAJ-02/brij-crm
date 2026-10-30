// The inbox as the library draws it, and its address (spec 0038, AC-1169 to
// AC-1171): plain functions with no React, so they test in Node. The actor is
// named from the members ("Former member" for one no longer active).
import type { MemberSummary, NotificationKind, NotificationView } from '@crm/data';
import type { NotificationItem } from '@crm/ui';
import { isTaskParam } from '../tasks/entries.ts';
import { actorDisplay } from '../notes/entries.ts';
import { formHref } from '../forms/paths.ts';
import { recordHref } from '../records/details.ts';

/** The kind filter as the address spells it. */
export type InboxKind = 'mentions' | 'replies' | 'assignments' | 'submissions';

/** The inbox's address: the tab, the kind, unread only, and the task dialog. Defaults stay out. */
export interface InboxSearch {
  readonly status?: 'done';
  readonly kind?: InboxKind;
  readonly unread?: 1;
  readonly task?: string;
}

const KINDS: Readonly<Record<InboxKind, NotificationKind>> = {
  mentions: 'mention',
  replies: 'reply',
  assignments: 'task_assigned',
  submissions: 'form_submission',
};

/** Whether the address's kind is one the filter knows. */
const isInboxKind = (value: unknown): value is InboxKind =>
  value === 'mentions' || value === 'replies' || value === 'assignments' || value === 'submissions';

/** Reads the address: only the values it knows. */
export function inboxSearch(search: Record<string, unknown>): InboxSearch {
  return {
    ...(search.status === 'done' ? { status: 'done' as const } : {}),
    ...(isInboxKind(search.kind) ? { kind: search.kind } : {}),
    ...(search.unread === 1 || search.unread === '1' ? { unread: 1 as const } : {}),
    ...(isTaskParam(search.task) && search.task !== 'new' ? { task: search.task } : {}),
  };
}

/** The data layer's kind for the address's. */
export const notificationKind = (kind: InboxKind | undefined): NotificationKind | undefined =>
  kind === undefined ? undefined : KINDS[kind];

/** One notification as NotificationList's row. */
export function toNotificationItem(view: NotificationView, members: readonly MemberSummary[]): NotificationItem {
  return {
    id: view.id,
    kind: view.kind,
    actor: actorDisplay(members, view.actor),
    createdAt: view.createdAt,
    isRead: view.readAt !== undefined,
    isDone: view.doneAt !== undefined,
    ...(view.record === undefined ? {} : { record: view.record }),
    ...(view.noteId === undefined ? {} : { isNote: true }),
    ...(view.formName === undefined ? {} : { formName: view.formName }),
    excerpt: view.excerpt,
  };
}

/** Where pressing a notification goes: its comment's thread, its note's window, its task's dialog, or its submission. */
export type NotificationTarget =
  { readonly kind: 'href'; readonly href: string } | { readonly kind: 'task'; readonly taskId: string } | undefined;

/** The target of a notification, given the workspace's object slugs by object id. */
export function targetOf(
  slug: string,
  view: NotificationView,
  objectSlugs: ReadonlyMap<string, string>,
): NotificationTarget {
  if (view.taskId !== undefined) return { kind: 'task', taskId: view.taskId };
  if (view.submissionId !== undefined && view.formId !== undefined) {
    return { kind: 'href', href: formHref(slug, view.formId, 'submissions', view.submissionId) };
  }
  if (view.record === undefined) return undefined;
  const objectSlug = objectSlugs.get(view.record.objectId);
  if (objectSlug === undefined) return undefined;
  if (view.noteId !== undefined) {
    return { kind: 'href', href: `${recordHref(slug, objectSlug, view.record.recordId, 'notes')}?note=${view.noteId}` };
  }
  const page = recordHref(slug, objectSlug, view.record.recordId, 'comments');
  return { kind: 'href', href: view.threadId === undefined ? page : `${page}?thread=${view.threadId}` };
}
