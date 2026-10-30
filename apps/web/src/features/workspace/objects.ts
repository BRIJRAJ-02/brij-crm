// Which objects the workspace's navigation shows, and where each one's page
// is. Kept apart from the frame's components, so a route loader can use them
// without pulling the frame into the first load.
import type { ObjectSummary } from '@crm/data';

/**
 * The objects the sidebar lists: every live object, standard and custom, in
 * the workspace's order (spec 0012, AC-225). The data layer already leaves
 * out archived ones and the ones the person can't see.
 */
export function navObjects(objects: readonly ObjectSummary[]): readonly ObjectSummary[] {
  return [...objects].filter((object) => !object.isArchived).sort((a, b) => a.position - b.position);
}

/** The page of one object in a workspace. */
export const objectHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>) =>
  `/w/${slug}/objects/${object.apiSlug}`;

/** One saved view of an object (spec 0020): a favourite view's address in the sidebar (spec 0034). */
export const viewHref = (slug: string, objectSlug: string, viewId: string) =>
  `/w/${slug}/objects/${objectSlug}/views/${viewId}`;

/** The workspace's trash (spec 0022): Settings › Workspace › Trash since 23 October 2026 (A120). */
export const trashHref = (slug: string) => `/w/${slug}/settings/trash`;

/** My tasks' address (spec 0019). */
export const tasksHref = (slug: string) => `/w/${slug}/tasks`;
/** The workspace's Notes page: every note the person may see, last edited first. */
export const notesHref = (slug: string) => `/w/${slug}/notes`;
/** The member's inbox: mentions, assignments and replies (spec 0038). */
export const inboxHref = (slug: string) => `/w/${slug}/inbox`;

/** The member's own link page and its editor (spec 0051), a page of its own since 25 October 2026. */
export const linkPageHref = (slug: string) => `/w/${slug}/link-page`;

/** Home's address: where a workspace opens (owner, 21 October 2026). */
export const homeHref = (slug: string) => `/w/${slug}/home`;

/** Bookings' address: its first tab, Calendar, named outright so the sidebar's link preloads that page itself. */
/** The Captures page's address: its first tab, Booking pages, named outright so the sidebar's link preloads that page itself. */
export const capturesHref = (slug: string) => `/w/${slug}/captures/links`;

export const bookingsHref = (slug: string) => `/w/${slug}/bookings/calendar`;

/** The Roster (spec 0037, the Team week): Bookings › Availability's Team view, named outright so the sidebar preloads it. */
export const rosterHref = (slug: string) => `/w/${slug}/bookings/availability?view=team`;

/** Settings, Background jobs (spec 0008). */
export const jobsHref = (slug: string) => `/w/${slug}/settings/jobs`;
/** Settings, Objects (spec 0012): where a workspace with no live object opens. */
export const settingsHref = (slug: string) => `/w/${slug}/settings/objects`;
/** Where Settings opens (spec 0026, AC-686): Account › Preferences. The sidebar's Settings, the workspace menu's and ⌘, go here. */
export const settingsHomeHref = (slug: string) => `/w/${slug}/settings/account/preferences`;

/** A workspace's home (spec 0031, AC-801): the workspace menu's switcher opens it. */
export const workspaceHref = (slug: string) => `/w/${slug}`;

/** Creating another workspace from the workspace menu (spec 0031, AC-801): the welcome page, kept open. */
export const newWorkspaceHref = '/welcome?another=1';
