// The inbox as the library draws it (spec 0038, AC-1169 to AC-1171): plain
// functions with no React, so they test in Node. The actor is named from the
// members ("Former member" for one no longer active). Its address is
// `search.ts`, apart, so the route's first load never carries these.
import type { MemberSummary, NotificationView } from '@crm/data';
import type { NotificationItem } from '@crm/ui';
import { actorDisplay } from '../notes/entries.ts';
import { formHref } from '../forms/paths.ts';
import { recordHref } from '../records/details.ts';
import { membersSettingsHref } from '../settings/nav.ts';
import { strings } from './strings.ts';

/** One notification as NotificationList's row. */
export function toNotificationItem(view: NotificationView, members: readonly MemberSummary[]): NotificationItem {
  // Someone asks to join: the row is about them, so they are its face and its sentence ("Cy Young asks to join").
  if (view.joinRequestId !== undefined) {
    return {
      id: view.id,
      kind: view.kind,
      actor: { type: 'system', id: null, name: view.excerpt },
      createdAt: view.createdAt,
      isRead: view.readAt !== undefined,
      isDone: view.doneAt !== undefined,
      excerpt: '',
    };
  }
  return {
    id: view.id,
    kind: view.kind,
    // A form's new submission is the form's doing, drawn under its mark.
    actor:
      view.kind === 'form_submission'
        ? { type: 'form', id: view.formId ?? null, name: view.formName ?? strings.someForm }
        : actorDisplay(members, view.actor),
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
  // Members opens on Joining while someone waits, where Approve and Decline are.
  if (view.joinRequestId !== undefined) return { kind: 'href', href: membersSettingsHref(slug) };
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
