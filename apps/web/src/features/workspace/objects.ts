// Which objects the workspace's navigation shows, and where each one's page
// is. Kept apart from the frame's components, so a route loader can use them
// without pulling the frame into the first load.
import type { ObjectSummary } from '@crm/data';

/** The objects the sidebar lists in this loop: People, the one object with a table so far (spec 0005). */
export function navObjects(objects: readonly ObjectSummary[]): readonly ObjectSummary[] {
  return objects.filter((object) => object.standardKey === 'people');
}

/** The page of one object in a workspace. */
export const objectHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>) =>
  `/w/${slug}/objects/${object.apiSlug}`;
