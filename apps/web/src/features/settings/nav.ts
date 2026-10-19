// Where settings pages are, and which ones exist (spec 0012). Plain functions
// with no React or library imports, so the routes' loaders (in the first load)
// can use them without pulling a screen in.
import type { ObjectSummary } from '@crm/data';
import { bookingPagesHref } from '../booking/links.ts';
import { strings as booking } from '../booking/strings.ts';
import { jobsHref } from '../workspace/objects.ts';
import { strings as jobs } from './jobs-strings.ts';
import { strings } from './strings.ts';

/** An object's settings tabs, in order. */
export const OBJECT_TABS = ['attributes', 'configuration'] as const;
/** One of an object's settings tabs. */
export type ObjectTab = (typeof OBJECT_TABS)[number];

/** True when `tab` names one of an object's settings tabs. */
export const isObjectTab = (tab: string): tab is ObjectTab => (OBJECT_TABS as readonly string[]).includes(tab);

/** Settings, Objects. */
export const objectsSettingsHref = (slug: string) => `/w/${slug}/settings/objects`;

/** One object's settings tab (its Attributes tab by default), by the object's API name, so links survive renames. */
export const objectSettingsHref = (
  slug: string,
  object: Pick<ObjectSummary, 'apiSlug'>,
  tab: ObjectTab = 'attributes',
) => `/w/${slug}/settings/objects/${object.apiSlug}/${tab}`;

/** The settings pages, as the navigation names them: Objects (spec 0012), Background jobs (spec 0008) and Booking pages (spec 0025). */
export type SettingsPageId = 'objects' | 'jobs' | 'booking-pages';

/** The settings navigation: Objects and Background jobs; #23 and later features add theirs. */
export function settingsNav(slug: string) {
  return [
    { id: 'objects', label: strings.objects, href: objectsSettingsHref(slug), icon: 'box' as const },
    { id: 'jobs', label: jobs.title, href: jobsHref(slug), icon: 'list-checks' as const },
    { id: 'booking-pages', label: booking.title, href: bookingPagesHref(slug), icon: 'calendar-clock' as const },
  ];
}

/** The workspace's objects in its order, live ones and archived ones apart (settings lists them in two sections). */
export function byPosition(objects: readonly ObjectSummary[]): {
  readonly live: readonly ObjectSummary[];
  readonly archived: readonly ObjectSummary[];
  readonly all: readonly ObjectSummary[];
} {
  const all = [...objects].sort((a, b) => a.position - b.position);
  return { all, live: all.filter((object) => !object.isArchived), archived: all.filter((object) => object.isArchived) };
}
