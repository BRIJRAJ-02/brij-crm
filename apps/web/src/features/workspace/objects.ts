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

/** The upcoming bookings' address. */
export const bookingsHref = (slug: string) => `/w/${slug}/bookings`;

/** The Captures page's address; it opens on its Links tab. */
export const capturesHref = (slug: string) => `/w/${slug}/captures`;
/** Settings, Background jobs (spec 0008). */
export const jobsHref = (slug: string) => `/w/${slug}/settings/jobs`;
/** Settings, Objects (spec 0012): where a workspace with no live object opens, and the workspace menu's Settings. */
export const settingsHref = (slug: string) => `/w/${slug}/settings/objects`;
