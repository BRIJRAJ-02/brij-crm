// The inbox as the library draws it (spec 0038, AC-1169 to AC-1171): plain
// functions with no React, so they test in Node. The actor is named from the
// members ("Former member" for one no longer active). The address is `search.ts`.
import type { MemberSummary, NotificationView } from '@crm/data';
import type { NotificationItem } from '@crm/ui';
import { actorDisplay } from '../notes/entries.ts';
import { recordHref } from '../records/details.ts';

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
    excerpt: view.excerpt,
  };
}

/** Where pressing a notification goes: its comment's thread, its note's window, or its task's dialog. */
export type NotificationTarget =
  { readonly kind: 'href'; readonly href: string } | { readonly kind: 'task'; readonly taskId: string } | undefined;

/** The target of a notification, given the workspace's object slugs by object id. */
export function targetOf(
  slug: string,
  view: NotificationView,
  objectSlugs: ReadonlyMap<string, string>,
): NotificationTarget {
  if (view.taskId !== undefined) return { kind: 'task', taskId: view.taskId };
  if (view.record === undefined) return undefined;
  const objectSlug = objectSlugs.get(view.record.objectId);
  if (objectSlug === undefined) return undefined;
  if (view.noteId !== undefined) {
    return { kind: 'href', href: `${recordHref(slug, objectSlug, view.record.recordId, 'notes')}?note=${view.noteId}` };
  }
  const page = recordHref(slug, objectSlug, view.record.recordId, 'comments');
  return { kind: 'href', href: view.threadId === undefined ? page : `${page}?thread=${view.threadId}` };
}
