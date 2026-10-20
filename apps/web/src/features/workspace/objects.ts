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

/** The workspace's trash (spec 0022). */
export const trashHref = (slug: string) => `/w/${slug}/trash`;

/** My tasks' address (spec 0019). */
export const tasksHref = (slug: string) => `/w/${slug}/tasks`;

/** Bookings' address: its first tab, Calendar, named outright so the sidebar's link preloads that page itself. */
export const bookingsHref = (slug: string) => `/w/${slug}/bookings/calendar`;

/** The Captures page's address: its first tab, Links, named outright so the sidebar's link preloads that page itself. */
export const capturesHref = (slug: string) => `/w/${slug}/captures/links`;
/** Settings, Background jobs (spec 0008). */
export const jobsHref = (slug: string) => `/w/${slug}/settings/jobs`;
/** Settings, Objects (spec 0012): where a workspace with no live object opens. */
export const settingsHref = (slug: string) => `/w/${slug}/settings/objects`;
/** Where Settings opens (spec 0026, AC-686): Account › Preferences. The sidebar's Settings, the workspace menu's and ⌘, go here. */
export const settingsHomeHref = (slug: string) => `/w/${slug}/settings/account/preferences`;
