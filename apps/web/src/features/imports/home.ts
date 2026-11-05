// Where an import's summary belongs (the foolproof pass, 5 November 2026): kept apart from `paths.ts`, which the
// finish toast loads with the first page, so the list addresses it needs stay with the summary's own chunk.
import type { ListView, ObjectSummary } from '@crm/data';
import { listHref } from '../lists/paths.ts';
import { objectHref } from '../workspace/objects.ts';

/** Where an import belongs: the list it went into, else its object (its summary's crumb, icon and way back). */
export interface ImportHome {
  readonly id: 'list' | 'object';
  readonly name: string;
  readonly icon: ObjectSummary['icon'];
  readonly hue: ObjectSummary['hue'];
  readonly href: string;
}

/**
 * An import's home: one started from a list ends on that list, so its rows are seen landing there (Attio); any
 * other on its object.
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
