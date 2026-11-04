// The import pages' addresses (spec 0040), kept apart from the screens so the
// view's menu and the finish toast link here without loading them.
import type { ListView, ObjectSummary } from '@crm/data';
import { listHref } from '../lists/paths.ts';
import { objectHref } from '../workspace/objects.ts';

/** The import page for an object (AC-1111). */
export const importHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>): string =>
  `/w/${slug}/objects/${object.apiSlug}/import`;

/** One import's summary (AC-1127), kept for its undo window. */
export const importSummaryHref = (slug: string, object: Pick<ObjectSummary, 'apiSlug'>, importId: string): string =>
  `/w/${slug}/objects/${object.apiSlug}/imports/${importId}`;

/** Where an import belongs: the list it went into, else its object (its summary's crumb, icon and way back). */
export interface ImportHome {
  readonly id: 'list' | 'object';
  readonly name: string;
  readonly icon: ObjectSummary['icon'];
  readonly hue: ObjectSummary['hue'];
  readonly href: string;
}

/**
 * An import's home (the foolproof pass, 5 November 2026): one started from a list ends on that list, so its rows are
 * seen landing there (Attio); any other on its object.
 */
export function importHome(
  slug: string,
  object: Pick<ObjectSummary, 'apiSlug' | 'pluralName' | 'icon' | 'hue'>,
  list: Pick<ListView, 'apiSlug' | 'name' | 'icon' | 'hue'> | undefined,
): ImportHome {
  return list === undefined
    ? {
        id: 'object',
        name: object.pluralName,
        icon: object.icon,
        hue: object.hue,
        href: objectHref(slug, object),
      }
    : { id: 'list', name: list.name, icon: list.icon, hue: list.hue, href: listHref(slug, list) };
}
