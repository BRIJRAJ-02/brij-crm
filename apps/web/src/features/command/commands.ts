// The command menu's browser side (spec 0039): the pages, Settings pages and
// actions it lists, each with the words it also answers to, how what is typed
// matches them (AC-1077, AC-1082), the order its sections show in, and where
// each goes. Pure, so the node
// tests cover it, the address walk of AC-1104 among them. Records, views,
// notes and tasks come from the server through the data layer; nothing here
// reads data.
import type { ListView, ObjectSummary, Permission, RecordHit, ViewHit } from '@crm/data';
import type { IconName } from '@crm/ui';
import type { ThemeChoice } from '@crm/ui/theme';
import { strings as automationStrings } from '../automations/strings.ts';
import { settingsNav, visibleSettingsNav } from '../settings/nav.ts';
import { availabilityHref, calendarsHref, linksHref, roundRobinHref } from '../booking/links.ts';
import { formsHref } from '../forms/paths.ts';
import { importHref } from '../imports/paths.ts';
import { listHref } from '../lists/paths.ts';
import { recordHref } from '../records/details.ts';
import { reportsHref } from '../reports/search.ts';
import { bookingsHref, homeHref, navObjects, objectHref, tasksHref, trashHref } from '../workspace/objects.ts';
import { strings } from './strings.ts';

/** What choosing a command does: go somewhere, open an object's new record dialog, or set the theme. */
export type CommandRun =
  | { readonly kind: 'go'; readonly href: string }
  | { readonly kind: 'create'; readonly href: string }
  | { readonly kind: 'theme'; readonly choice: ThemeChoice }
  /** Opens the Invite dialog over the page the member is on. */
  | { readonly kind: 'invite' }
  /** Opens the New list dialog over the page (spec 0048, AC-4827). */
  | { readonly kind: 'new-list' }
  /** Puts the open record in a list (spec 0048, AC-4827). */
  | { readonly kind: 'add-to-list'; readonly listId: string; readonly recordId: string };

/** One page, Settings page or action the menu lists. */
export interface Command {
  /** Unique across the menu: `page:…`, `settings:…`, `create:…`, `theme:…`. */
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** Other words it answers to ("theme" finds Preferences). */
  readonly terms: readonly string[];
  readonly run: CommandRun;
  /** Its kind at the row's end, when it isn't the section's (a list's "List · Deals"). */
  readonly kind?: string;
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
export function pageCommands(
  slug: string,
  objects: readonly ObjectSummary[],
  permissions?: readonly Permission[],
  lists: readonly ListView[] = [],
): readonly Command[] {
  const plural = new Map(objects.map((object) => [object.id, object.pluralName]));
  return [
    { id: 'page:home', name: strings.home, icon: 'house', terms: strings.homeTerms, run: go(homeHref(slug)) },
    ...navObjects(objects).map((object): Command => ({
      id: `page:object:${object.id}`,
      name: object.pluralName,
      icon: object.icon,
      terms: [object.singularName],
      run: { kind: 'go', href: objectHref(slug, object) },
    })),
    // Every live list the member may read is a destination, found by name (spec 0048, AC-4827).
    ...lists
      .filter((list) => !list.isArchived)
      .map((list): Command => ({
        id: `page:list:${list.id}`,
        name: list.name,
        icon: list.icon,
        terms: [],
        run: go(listHref(slug, list)),
        kind: strings.listKind(plural.get(list.objectId) ?? ''),
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
    // Calendars and Round robin came up out of Settings into Bookings (25 October 2026), so the menu finds them
    // where it finds Availability rather than under Settings, where they no longer are.
    {
      id: 'page:calendars',
      name: strings.calendars,
      icon: 'calendar',
      terms: strings.calendarsTerms,
      run: go(calendarsHref(slug)),
    },
    // Only for someone who makes booking pages: hidden means absent, and the page itself says nothing either.
    ...(permissions?.includes('booking.manage') === true
      ? [
          {
            id: 'page:round-robin',
            name: strings.roundRobin,
            icon: 'users-round',
            terms: strings.roundRobinTerms,
            run: go(roundRobinHref(slug)),
          } satisfies Command,
        ]
      : []),
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
    {
      id: 'page:reports',
      name: strings.reports,
      icon: 'chart-bar',
      terms: strings.reportsTerms,
      run: go(reportsHref(slug)),
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
  objects: strings.objectsTerms,
  jobs: strings.jobsTerms,
  automations: automationStrings.terms,
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

/** Where the menu opened, for the actions that work on it: the object page and view on screen, and who may invite. */
export interface CommandPlace {
  /** The object whose page is open. */
  readonly object?: ObjectSummary;
  /** The view of it that is open. */
  readonly viewId?: string;
  /** The member holds `members.invite`. */
  readonly canInvite?: boolean;
  /** The member holds `lists.manage` (spec 0048, AC-4827). */
  readonly canMakeLists?: boolean;
}

/** What a view page is asked to do from the menu, as its address carries it (`?do=`). */
export type ViewRequest = 'export' | 'new-view' | 'rename';

/**
 * The actions (AC-1075, AC-1086, AC-1087): Create a <object> for each live
 * object the member may write; on an object's page, Import <plural> (where
 * they may write it), and on one of its views Export this view and Create a
 * view; Invite members for those who may; then the three themes.
 */
export function actionCommands(
  slug: string,
  objects: readonly ObjectSummary[],
  place: CommandPlace = {},
): readonly Command[] {
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
  const { object, viewId } = place;
  const here: Command[] = [];
  if (object !== undefined && object.access === 'write' && !object.isArchived) {
    here.push({
      id: `import:${object.id}`,
      name: strings.importPlural(object.pluralName),
      icon: 'upload',
      terms: strings.importTerms,
      run: go(importHref(slug, object)),
    });
  }
  if (object !== undefined && viewId !== undefined) {
    here.push(
      {
        id: 'view:export',
        name: strings.exportView,
        icon: 'download',
        terms: strings.exportTerms,
        run: go(viewRequestHref(slug, object.apiSlug, viewId, 'export')),
      },
      {
        id: 'view:new',
        name: strings.createView,
        icon: 'plus',
        terms: [strings.newWord, strings.addWord],
        run: go(viewRequestHref(slug, object.apiSlug, viewId, 'new-view')),
      },
    );
  }
  if (place.canInvite === true) {
    here.push({
      id: 'invite',
      name: strings.invite,
      icon: 'user-plus',
      terms: strings.inviteTerms,
      run: { kind: 'invite' },
    });
  }
  // Create list, for whoever may make one (spec 0048, AC-4827).
  if (place.canMakeLists === true) {
    here.push({
      id: 'list:new',
      name: strings.createList,
      icon: 'plus',
      terms: strings.createListTerms,
      run: { kind: 'new-list' },
    });
  }
  return [...creates, ...here, ...themes];
}

/**
 * The open record's Add <name> to <list>, one per list over its object the member may write (spec 0048, AC-4827);
 * none on a page that isn't a record's. The lists are the ones the member may write over that object.
 */
export function addToListCommands(record: CommandRecord | undefined, lists: readonly ListView[]): readonly Command[] {
  if (record === undefined) return [];
  return lists.map((list): Command => ({
    id: `record:list:${list.id}`,
    name: strings.addRecordToList(record.name, list.name),
    icon: list.icon,
    terms: strings.addToListTerms,
    run: { kind: 'add-to-list', listId: list.id, recordId: record.recordId },
  }));
}

/** A view asked to export itself or open Create view once it shows. */
export function viewRequestHref(slug: string, objectSlug: string, viewId: string, request: ViewRequest): string {
  return `${viewHref(slug, objectSlug, viewId)}?do=${request}`;
}

/** The record page open now, for its own actions; set by the page while the person may add notes and tasks to it. */
export interface CommandRecord {
  readonly slug: string;
  readonly objectSlug: string;
  readonly recordId: string;
  /** Its name, as the page's header shows it. */
  readonly name: string;
}

/**
 * The open record's actions, first under Actions: New note on <name>, New
 * task on <name>, Log a call on <name> and Log a meeting on <name>, each
 * opening the record's own note window, task dialog or Log activity dialog
 * (`?note=new`, `?task=new`, `?log=call`, `?log=meeting`) on its tab, as the
 * tabs' buttons do.
 */
export function recordCommands(record: CommandRecord | undefined): readonly Command[] {
  if (record === undefined) return [];
  const { slug, objectSlug, recordId, name } = record;
  return [
    {
      id: `record:note:${recordId}`,
      name: strings.newNoteOn(name),
      icon: 'notebook',
      terms: strings.noteTerms,
      run: go(`${recordHref(slug, objectSlug, recordId, 'notes')}?note=new`),
    },
    {
      id: `record:task:${recordId}`,
      name: strings.newTaskOn(name),
      icon: 'list-checks',
      terms: strings.taskTerms,
      run: go(`${recordHref(slug, objectSlug, recordId, 'tasks')}?task=new`),
    },
    {
      id: `record:call:${recordId}`,
      name: strings.logCallOn(name),
      icon: 'phone',
      terms: strings.callTerms,
      run: go(`${recordHref(slug, objectSlug, recordId, 'notes')}?log=call`),
    },
    {
      id: `record:meeting:${recordId}`,
      name: strings.logMeetingOn(name),
      icon: 'users',
      terms: strings.meetingTerms,
      run: go(`${recordHref(slug, objectSlug, recordId, 'notes')}?log=meeting`),
    },
  ];
}

/** An object's page with its new record dialog open (AC-1086): the object route carries `new` to the view it opens. */
export function createHref(slug: string, object: Pick<ObjectSummary, 'apiSlug'>): string {
  return `${objectHref(slug, object)}?new=1`;
}

/** The page a task dialog opens over from the menu: the one shown when it holds `?task=` (Tasks, the inbox, a record), else Tasks. */
export function taskDialogHref(slug: string, pathname: string, task: string): string {
  const prefix = `/w/${slug}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined;
  const holds =
    rest !== undefined &&
    (rest === 'tasks' || rest === 'inbox' || /^objects\/[^/]+\/[0-9a-f-]{36}(\/[a-z]+)?$/i.test(rest));
  return `${holds ? pathname : tasksHref(slug)}?task=${encodeURIComponent(task)}`;
}

/**
 * Create a task (the flow pass of 30 Oct 2026): a new task from anywhere, its
 * dialog over the page when the page holds one, else over Tasks. A record
 * page has its own "New task on <name>", which links the record, so none.
 */
export function createTaskCommand(slug: string, pathname: string): Command {
  return {
    id: 'create:task',
    name: strings.createTask,
    icon: 'square-check',
    terms: strings.taskTerms,
    run: go(taskDialogHref(slug, pathname, 'new')),
  };
}

/**
 * When nothing matches (the flow pass of 30 Oct 2026): Create <object> named
 * "<text>", for the object whose page is open, else People, opening its new
 * record dialog with the name filled. None when that object can't be written.
 */
export function createNamedCommand(
  slug: string,
  objects: readonly ObjectSummary[],
  here: ObjectSummary | undefined,
  text: string,
): Command | undefined {
  const name = text.trim();
  const object = here ?? objects.find((each) => each.apiSlug === 'people');
  if (name === '' || object === undefined || object.access !== 'write' || object.isArchived) return undefined;
  return {
    id: `create-named:${object.id}`,
    name: strings.createNamed(object.singularName, name),
    icon: 'plus',
    terms: [],
    run: { kind: 'create', href: `${createHref(slug, object)}&name=${encodeURIComponent(name)}` },
  };
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

/**
 * The sections of results, in kind order (decision 6): the order that breaks a tie between equally good matches.
 * Notes and tasks come last: they show only when their titles match, and then rank by them.
 */
const RESULT_SECTIONS = ['records', 'views', 'pages', 'settings', 'actions', 'notes', 'tasks'] as const;
type ResultSectionId = (typeof RESULT_SECTIONS)[number];

/** With nothing typed (AC-1075): Recent, Actions, then Go to (every page). */
const BLANK_ORDER: readonly SectionId[] = ['recent', 'actions', 'pages'];

/**
 * What the menu found for the text, before it is drawn: the server's records
 * and views (undefined while its search for this text is out, none when it
 * failed), and the pages, Settings pages and actions that match.
 */
export interface Found {
  readonly records: readonly Pick<RecordHit, 'match'>[] | undefined;
  readonly views: readonly Pick<ViewHit, 'name'>[] | undefined;
  readonly pages: readonly Command[];
  readonly settings: readonly Command[];
  readonly actions: readonly Command[];
  /** Notes and tasks by title: none while the search is out. */
  readonly notes?: readonly { readonly title: string }[];
  readonly tasks?: readonly { readonly title: string }[];
}

/**
 * The order the sections show in. With nothing typed: Recent, Actions, Go to.
 * Otherwise each section by its best row, on one scale for every kind: a name
 * starting with the text, then a word of a name starting with it, then a
 * looser match (held mid-word, or another word for it), then a close guess.
 * Kind order breaks a tie, so a record whose name starts with the text stays
 * first, while one found only mid-word ("deal" in Ideal Standard) waits behind
 * the page, Settings page or action the text names, a close guess (Northwind
 * Traders for "trash") waits behind any command that matches, and a command
 * named by the text ("dark" in Use dark theme) beats one found by another word
 * for it (Settings › Preferences). Records still being searched keep their
 * kind's place, with only their "Searching…" row; a failed search, with only
 * its Try again row, goes last.
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
    notes: best((found.notes ?? []).map((note) => onScale(nameRank(note.title, text)))),
    tasks: best((found.tasks ?? []).map((task) => onScale(nameRank(task.title, text)))),
  };
  return RESULT_SECTIONS.map((id, index) => ({ id, index }))
    .sort((a, b) => strength[a.id] - strength[b.id] || a.index - b.index)
    .map((entry) => entry.id);
}

/** Where looser matches sit on the sections' one scale: below a name, or a word of one, starting with the text. */
const LOOSE = 2;

/** How the server's match kinds (AC-1079) sit on that scale: a close guess (typo tolerance) below every other match. */
const RECORD_RANK: Readonly<Record<RecordHit['match'], number>> = {
  prefix: 0,
  word: 1,
  contains: LOOSE,
  similar: LOOSE + 1,
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
