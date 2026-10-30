// The inbox's address (spec 0038, AC-1170): the tab, the kind, unread only and the task dialog, read by the route
// itself, so it stays apart from the rows' code (`entries.ts`), which loads with the screen.
import type { NotificationKind } from '@crm/data';
import { isTaskParam } from '../records/params.ts';

/** The kind filter as the address spells it. */
export type InboxKind = 'mentions' | 'replies' | 'assignments' | 'due' | 'submissions';

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
  due: 'task_due',
  submissions: 'form_submission',
};

/** Whether the address's kind is one the filter knows. */
const isInboxKind = (value: unknown): value is InboxKind =>
  value === 'mentions' || value === 'replies' || value === 'assignments' || value === 'due' || value === 'submissions';

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
