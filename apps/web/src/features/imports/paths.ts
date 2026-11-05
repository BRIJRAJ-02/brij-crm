// The import pages' addresses (spec 0040), kept apart from the screens so the
// view's menu and the finish toast link here without loading them.
import type { ObjectSummary } from '@crm/data';

/** The import page for an object (AC-1111). */
export const importHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>): string =>
  `/w/${slug}/objects/${object.apiSlug}/import`;

/** One import's summary (AC-1127), kept for its undo window. */
export const importSummaryHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>, importId: string): string =>
  `/w/${slug}/objects/${object.apiSlug}/imports/${importId}`;
