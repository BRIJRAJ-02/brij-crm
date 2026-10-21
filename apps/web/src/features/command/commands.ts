// The command menu's browser side (spec 0039): the pages, Settings pages and
// actions it lists, each with the words it also answers to, how what is typed
// matches them (AC-1077, AC-1082), and where each goes. Pure, so the node
// tests cover it, the address walk of AC-1104 among them. Records and views
// come from the server through the data layer; nothing here reads data.
import type { ObjectSummary, Permission } from '@crm/data';
import type { IconName } from '@crm/ui';
import type { ThemeChoice } from '@crm/ui/theme';
import { settingsNav, visibleSettingsNav } from '../settings/nav.ts';
import { availabilityHref } from '../booking/links.ts';
import { formsHref, linksHref } from '../captures/pages.ts';
import { bookingsHref, homeHref, navObjects, objectHref, tasksHref, trashHref } from '../workspace/objects.ts';
import { strings } from './strings.ts';

/** What choosing a command does: go somewhere, open an object's new record dialog, or set the theme. */
export type CommandRun =
  | { readonly kind: 'go'; readonly href: string }
  | { readonly kind: 'create'; readonly href: string }
  | { readonly kind: 'theme'; readonly choice: ThemeChoice };

/** One page, Settings page or action the menu lists. */
export interface Command {
  /** Unique across the menu: `page:…`, `settings:…`, `create:…`, `theme:…`. */
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** Other words it answers to ("theme" finds Preferences). */
  readonly terms: readonly string[];
  readonly run: CommandRun;
  /** Its shortcut, with Mac symbols. */
  readonly kbd?: string;
}

/** Where the menu opened: everything (⌘K, Quick actions), or search only (`/`, the sidebar's search). */
export type CommandMode = 'commands' | 'search';

/**
 * The pages (AC-1075): Home, each live object's page in the workspace's order,
 * then Tasks and Scheduling's pages as the sidebar has them (spec 0034:
 * Bookings, Availability, Booking pages, Forms), Trash and Settings.
 */
export function pageCommands(slug: string, objects: readonly ObjectSummary[]): readonly Command[] {
  return [
    { id: 'page:home', name: strings.home, icon: 'house', terms: strings.homeTerms, run: go(homeHref(slug)) },
    ...navObjects(objects).map((object): Command => ({
      id: `page:object:${object.id}`,
      name: object.pluralName,
      icon: object.icon,
      terms: [object.singularName],
      run: { kind: 'go', href: objectHref(slug, object) },
    })),
    {
      id: 'page:tasks',
      name: strings.myTasks,
      icon: 'square-check',
      terms: strings.tasksTerms,
      run: go(tasksHref(slug)),
    },
    {
      id: 'page:bookings',
      name: strings.bookings,
      icon: 'calendar-days',
      terms: strings.bookingsTerms,
      run: go(bookingsHref(slug)),
    },
    {
      id: 'page:availability',
      name: strings.availability,
      icon: 'clock',
      terms: strings.availabilityTerms,
      run: go(availabilityHref(slug)),
    },
    {
      id: 'page:booking-pages',
      name: strings.bookingPages,
      icon: 'link',
      terms: strings.bookingPagesTerms,
      run: go(linksHref(slug)),
    },
    {
      id: 'page:forms',
      name: strings.forms,
      icon: 'clipboard-list',
      terms: strings.formsTerms,
      run: go(formsHref(slug)),
    },
    { id: 'page:trash', name: strings.trash, icon: 'trash', terms: strings.trashTerms, run: go(trashHref(slug)) },
    {
      id: 'page:settings',
      name: strings.settings,
      icon: 'settings',
      terms: strings.settingsTerms,
      run: go(settingsNav(slug)[0]?.entries[0]?.href ?? `/w/${slug}/settings`),
      kbd: '⌘,',
    },
  ];
}

/** Each Settings page's other words (AC-1082). */
const SETTINGS_TERMS: Readonly<Record<string, readonly string[]>> = {
  preferences: strings.preferencesTerms,
  calendars: strings.calendarsTerms,
  objects: strings.objectsTerms,
  jobs: strings.jobsTerms,
};

/** The Settings pages this member may open (`visibleSettingsNav`), named "Settings › <page>" (AC-1082). */
export function settingsCommands(slug: string, permissions: readonly Permission[] | undefined): readonly Command[] {
  return visibleSettingsNav(settingsNav(slug), permissions).flatMap((group) =>
    group.entries.map((entry): Command => ({
      id: `settings:${entry.id}`,
      name: strings.settingsPage(entry.label),
      icon: entry.icon,
      terms: SETTINGS_TERMS[entry.id] ?? [],
      run: go(entry.href),
    })),
  );
}

/**
 * The actions (AC-1075, AC-1086, AC-1087): Create a <object> for each live
 * object the member may write, then the three themes.
 */
export function actionCommands(slug: string, objects: readonly ObjectSummary[]): readonly Command[] {
  const creates = navObjects(objects)
    .filter((object) => object.access === 'write')
    .map((object): Command => ({
      id: `create:${object.id}`,
      name: strings.create(object.singularName),
      icon: 'plus',
      terms: [strings.newWord, strings.addWord, object.pluralName],
      run: { kind: 'create', href: createHref(slug, object) },
    }));
  const themes = (['light', 'dark', 'system'] as const).map((choice): Command => ({
    id: `theme:${choice}`,
    name: strings.useTheme[choice],
    icon: choice === 'light' ? 'sun' : choice === 'dark' ? 'moon' : 'monitor',
    terms: strings.themeTerms,
    run: { kind: 'theme', choice },
  }));
  return [...creates, ...themes];
}

/** An object's page with its new record dialog open (AC-1086): the object route carries `new` to the view it opens. */
export function createHref(slug: string, object: Pick<ObjectSummary, 'apiSlug'>): string {
  return `${objectHref(slug, object)}?new=1`;
}

/** A view of an object. */
export function viewHref(slug: string, objectSlug: string, viewId: string): string {
  return `/w/${slug}/objects/${objectSlug}/views/${viewId}`;
}

/**
 * The commands that match what is typed, best first (AC-1077, AC-1082): a
 * name starting with it, then a word of the name starting with it, then a
 * name containing it, then another word for it; each kept in its list's
 * order. Blank matches every one, in order.
 */
export function matchCommands(commands: readonly Command[], query: string): readonly Command[] {
  const text = query.trim().toLocaleLowerCase();
  if (text === '') return commands;
  const ranked = commands.flatMap((command, index) => {
    const name = command.name.toLocaleLowerCase();
    const rank = name.startsWith(text)
      ? 0
      : name.split(/\s+/u).some((word) => word.startsWith(text))
        ? 1
        : name.includes(text)
          ? 2
          : command.terms.some((term) => term.toLocaleLowerCase().startsWith(text))
            ? 3
            : undefined;
    return rank === undefined ? [] : [{ command, rank, index }];
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.command);
}

const go = (href: string): CommandRun => ({ kind: 'go', href });
