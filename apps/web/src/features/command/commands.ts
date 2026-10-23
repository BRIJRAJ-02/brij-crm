// The command menu's browser side (spec 0039): the pages, Settings pages and
// actions it lists, each with the words it also answers to, how what is typed
// matches them (AC-1077, AC-1082), the order its sections show in, and where
// each goes. Pure, so the node
// tests cover it, the address walk of AC-1104 among them. Records and views
// come from the server through the data layer; nothing here reads data.
import type { ObjectSummary, Permission, RecordHit, ViewHit } from '@crm/data';
import type { IconName } from '@crm/ui';
import type { ThemeChoice } from '@crm/ui/theme';
import { settingsNav, visibleSettingsNav } from '../settings/nav.ts';
import { availabilityHref, linksHref } from '../booking/links.ts';
import { formsHref } from '../forms/paths.ts';
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
  security: strings.signInTerms,
};

/** The Settings pages this member may open (`visibleSettingsNav`), named "Settings › <page>" (AC-1082). */
export function settingsCommands(slug: string, permissions: readonly Permission[] | undefined): readonly Command[] {
  // The trash's entry opens its own page, which "Open trash" already reaches.
  return visibleSettingsNav(settingsNav(slug), permissions).flatMap((group) =>
    group.entries
      .filter((entry) => entry.id !== 'trash')
      .map((entry): Command => ({
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
    const rank = rankOf(command, text);
    return rank === undefined ? [] : [{ command, rank, index }];
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.command);
}

/** The menu's sections: Recent with nothing typed, then the results by kind (decision 6). */
export type SectionId = 'recent' | ResultSectionId;

/** The sections of results, in kind order (decision 6): the order that breaks a tie between equally good matches. */
const RESULT_SECTIONS = ['records', 'views', 'pages', 'settings', 'actions'] as const;
type ResultSectionId = (typeof RESULT_SECTIONS)[number];

/** With nothing typed (AC-1075): Recent, Actions, then Go to (every page). */
const BLANK_ORDER: readonly SectionId[] = ['recent', 'actions', 'pages'];

/**
 * What the menu found for the text, before it is drawn: the server's records
 * and views (undefined until its answer for this text is in, or when it
 * failed), and the pages, Settings pages and actions that match.
 */
export interface Found {
  readonly records: readonly Pick<RecordHit, 'match'>[] | undefined;
  readonly views: readonly Pick<ViewHit, 'name'>[] | undefined;
  readonly pages: readonly Command[];
  readonly settings: readonly Command[];
  readonly actions: readonly Command[];
}

/**
 * The order the sections show in. With nothing typed: Recent, Actions, Go to.
 * Otherwise each section by its best row, on one scale for every kind: a name
 * starting with the text, then a word of a name starting with it, then any
 * looser match (held mid-word, another word for it, or a close guess). Kind
 * order breaks a tie, so a record whose name starts with the text stays first,
 * while one found only mid-word ("deal" in Ideal Standard) or as a close guess
 * (Northwind Traders for "trash") waits behind the page, Settings page or
 * action the text names, and a command named by the text ("dark" in Use dark
 * theme) beats one found by another word for it (Settings › Preferences).
 * Records still being searched keep their kind's place, with only their
 * "Searching…" row.
 */
export function orderSections(found: Found, query: string): readonly SectionId[] {
  const text = query.trim().toLocaleLowerCase();
  if (text === '') return BLANK_ORDER;
  const ofCommands = (commands: readonly Command[]) => best(commands.map((command) => onScale(rankOf(command, text))));
  const strength: Readonly<Record<ResultSectionId, number>> = {
    records: found.records === undefined ? 0 : best(found.records.map((hit) => RECORD_RANK[hit.match])),
    views: found.views === undefined ? 0 : best(found.views.map((view) => onScale(nameRank(view.name, text)))),
    pages: ofCommands(found.pages),
    settings: ofCommands(found.settings),
    actions: ofCommands(found.actions),
  };
  return RESULT_SECTIONS.map((id, index) => ({ id, index }))
    .sort((a, b) => strength[a.id] - strength[b.id] || a.index - b.index)
    .map((entry) => entry.id);
}

/** Where looser matches sit on the sections' one scale: below a name, or a word of one, starting with the text. */
const LOOSE = 2;

/** How the server's match kinds (AC-1079) sit on that scale. */
const RECORD_RANK: Readonly<Record<RecordHit['match'], number>> = {
  prefix: 0,
  word: 1,
  contains: LOOSE,
  similar: LOOSE,
};

/** A name's or a command's rank on that scale: 0 and 1 kept, anything looser (or unmatched) as one. */
const onScale = (rank: number | undefined) => Math.min(rank ?? LOOSE, LOOSE);

/** The best (lowest) of some ranks; a section with none goes after every other. */
const best = (ranks: readonly number[]) => Math.min(Number.POSITIVE_INFINITY, ...ranks);

/** How well a name matches lower case text: 0 it starts with it, 1 a word of it does, 2 it holds it. */
function nameRank(name: string, text: string): number | undefined {
  const lower = name.toLocaleLowerCase();
  return lower.startsWith(text)
    ? 0
    : lower.split(/\s+/u).some((word) => word.startsWith(text))
      ? 1
      : lower.includes(text)
        ? 2
        : undefined;
}

/** How well a command matches lower case text: its name's rank, or 3 when another word for it starts with the text. */
function rankOf(command: Command, text: string): number | undefined {
  return (
    nameRank(command.name, text) ??
    (command.terms.some((term) => term.toLocaleLowerCase().startsWith(text)) ? 3 : undefined)
  );
}

const go = (href: string): CommandRun => ({ kind: 'go', href });
