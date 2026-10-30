// Brief
// Purpose: the command menu (spec 0039): go anywhere, find any record or view, and run an action, from the keyboard.
// Main task: type to search records, views, notes, tasks, pages and actions at once, in sections; Enter opens or runs.
// Leaves out: comments and the text inside notes (#33), match highlighting, and anything that ends something.
import type {
  DataLayer,
  GlobalSearch,
  GlobalSearchState,
  NoteHit,
  ObjectSummary,
  RecentItem,
  RecordHit,
  TaskHit,
  ViewHit,
} from '@crm/data';
import { Avatar, CommandPalette, type PaletteItem, type PaletteSection } from '@crm/ui';
import type { ThemeChoice } from '@crm/ui/theme';
import { useLocation, useMatch, useNavigate, useParams, useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { noteHref } from '../notes/entries.ts';
import { recordHref } from '../records/details.ts';
import { InviteTeamDialog } from '../settings/InviteTeamDialog.tsx';
import {
  actionCommands,
  createNamedCommand,
  createTaskCommand,
  matchCommands,
  orderSections,
  pageCommands,
  recordCommands,
  settingsCommands,
  taskDialogHref,
  viewHref,
  type Command,
  type CommandMode,
  type CommandRecord,
  type SectionId,
} from './commands.ts';
import { strings } from './strings.ts';

/** How many recent items show with nothing typed (AC-1075). */
const RECENT_SHOWN = 6;

/** Props for CommandMenu. */
export interface CommandMenuProps {
  readonly slug: string;
  readonly mode: CommandMode;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The record page open now: its New note and New task lead Actions. */
  readonly record?: CommandRecord;
}

/**
 * The menu for one opening: its own search (disposed when it goes), the
 * member's recent items read fresh, and the pages, Settings pages and actions
 * matched here as they type. Records and views come from the server through
 * `data.search`, and nothing enters the record store (AC-1100).
 */
export function CommandMenu({ slug, mode, isOpen, onOpenChange, record }: CommandMenuProps) {
  const { data, theme, toasts } = useRouteContext({ from: '__root__' });
  const loaded = useMatch({ from: '/w/$slug', shouldThrow: false, select: (match) => match.loaderData });
  const objects = useMemo(() => loaded?.objects ?? [], [loaded?.objects]);
  const permissions = loaded?.access?.permissions;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { search, hasFailed, reopen } = useMenuSearch(data, slug, isOpen, query);
  const recents = useRecents(data, slug);
  const themeChoice = useSyncExternalStore(
    (listener) => theme.subscribe(listener),
    () => theme.get(),
  );

  const byObject = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const pages = useMemo(() => pageCommands(slug, objects, permissions), [slug, objects, permissions]);
  const settings = useMemo(() => settingsCommands(slug, permissions), [slug, permissions]);
  // The page the menu opened over: its object and view get their own actions (Import, Export this view).
  const params: { readonly object?: string; readonly viewId?: string } = useParams({ strict: false });
  const here = objects.find((object) => object.apiSlug === params.object);
  const canInvite = permissions?.includes('members.invite') === true;
  const viewId = params.viewId;
  const pathname = useLocation({ select: (location) => location.pathname });
  const actions = useMemo(
    () =>
      mode === 'commands'
        ? [
            ...recordCommands(record),
            // A record page's own New task links the record; elsewhere one Create a task.
            ...(record === undefined ? [createTaskCommand(slug, pathname)] : []),
            ...actionCommands(slug, objects, {
              ...(here === undefined ? {} : { object: here }),
              ...(viewId === undefined ? {} : { viewId }),
              canInvite,
            }),
          ]
        : [],
    [mode, slug, objects, here, viewId, canInvite, record, pathname],
  );
  // Invite members opens the one Invite dialog over the page, as Home's setup step does.
  const [isInviting, setInviting] = useState(false);
  const text = query.trim();
  // Nothing matched: one row makes it, named as typed (the page's object, else People).
  const createNamed = useMemo(() => createNamedCommand(slug, objects, here, text), [slug, objects, here, text]);
  const commands = useMemo(
    () =>
      new Map(
        [...pages, ...settings, ...actions, ...(createNamed === undefined ? [] : [createNamed])].map((command) => [
          command.id,
          command,
        ]),
      ),
    [pages, settings, actions, createNamed],
  );

  const found = useSearchState(search);
  const sections = useMemo((): readonly PaletteSection[] => {
    const row = (command: Command) => commandRow(command, themeChoice);
    // The server's answer counts only once it is in for what is typed now. Until then Records holds only its
    // "Searching…" row (AC-1083), so no row found for the text before can take the highlight or an Enter.
    const isCurrent = found !== undefined && found.query === text;
    const isIn = isCurrent && found.status === 'ready';
    const status =
      text === ''
        ? undefined
        : hasFailed || (isCurrent && found.status === 'error')
          ? 'failed'
          : isIn
            ? undefined
            : 'searching';
    // A failed search has none, so its Try again row waits behind every command that matches.
    const matched = {
      records: isIn ? found.records : status === 'failed' ? [] : undefined,
      views: isIn ? found.views : status === 'failed' ? [] : undefined,
      pages: matchCommands(pages, text),
      settings: matchCommands(settings, text),
      actions: matchCommands(actions, text),
      notes: isIn ? found.notes : [],
      tasks: isIn ? found.tasks : [],
    };
    const isNothing =
      isIn &&
      [
        matched.records,
        matched.views,
        matched.pages,
        matched.settings,
        matched.actions,
        matched.notes,
        matched.tasks,
      ].every((each) => each === undefined || each.length === 0);
    // Nothing anywhere: no dead end, one row that makes it.
    if (isNothing && createNamed !== undefined) {
      return [{ id: 'actions', label: strings.actions, items: [row(createNamed)] }];
    }
    const byId: Readonly<Record<SectionId, PaletteSection>> = {
      recent: {
        id: 'recent',
        label: strings.recent,
        items: recents.slice(0, RECENT_SHOWN).map((item) => recentRow(item, byObject)),
      },
      records: {
        id: 'records',
        label: strings.records,
        items: (matched.records ?? []).map((hit) => recordRow(hit, byObject)),
        ...(status === undefined ? {} : { status }),
      },
      views: { id: 'views', label: strings.views, items: (matched.views ?? []).map((view) => viewRow(view, byObject)) },
      pages: { id: 'pages', label: text === '' ? strings.goTo : strings.pages, items: matched.pages.map(row) },
      settings: { id: 'settings', label: strings.settingsSection, items: matched.settings.map(row) },
      actions: { id: 'actions', label: strings.actions, items: matched.actions.map(row) },
      notes: { id: 'notes', label: strings.notes, items: matched.notes.map((note) => noteRow(note)) },
      tasks: { id: 'tasks', label: strings.tasks, items: matched.tasks.map((task) => taskRow(task)) },
    };
    return orderSections(matched, text).map((id) => byId[id]);
  }, [text, found, hasFailed, recents, actions, pages, settings, byObject, themeChoice, createNamed]);

  const choose = (item: PaletteItem) => {
    const close = () => {
      onOpenChange(false);
    };
    const command = commands.get(item.id);
    if (command !== undefined) {
      close();
      if (command.run.kind === 'theme') {
        runTheme(command.run.choice);
        return;
      }
      if (command.run.kind === 'invite') {
        setInviting(true);
        return;
      }
      void navigate({ href: command.run.href });
      return;
    }
    const href = hrefOf(item.id, slug, byObject, found, recents, pathname);
    close();
    if (href !== undefined) void navigate({ href });
  };
  const runTheme = (choice: ThemeChoice) => {
    // The same saved choice as Settings › Preferences (AC-1087).
    theme.set(choice);
    toasts.toast({ tone: 'success', message: strings.themeOn[choice] });
  };

  return (
    <>
      <CommandPalette
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title={mode === 'search' ? strings.search : strings.commandMenu}
        searchLabel={mode === 'search' ? strings.searchOnlyLabel : strings.searchLabel}
        placeholder={mode === 'search' ? strings.searchPlaceholder : strings.placeholder}
        sections={sections}
        onSearch={(next) => {
          setQuery(next);
          search?.ask(next);
        }}
        onRetry={() => {
          if (search === undefined) reopen();
          else search.retry();
        }}
        onAction={choose}
      />
      <InviteTeamDialog
        data={data}
        slug={slug}
        isOpen={isInviting}
        onClose={() => {
          setInviting(false);
        }}
      />
    </>
  );
}

/** This opening's search: its code loads with `import()` on first use, and it is disposed when the menu closes. */
interface MenuSearch {
  readonly search: GlobalSearch | undefined;
  /** The search's code didn't load: Records says the search failed, and Try again loads it again. */
  readonly hasFailed: boolean;
  readonly reopen: () => void;
}

function useMenuSearch(data: DataLayer, slug: string, isOpen: boolean, query: string): MenuSearch {
  const [search, setSearch] = useState<GlobalSearch | undefined>(undefined);
  const [hasFailed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // What is typed while the code loads, asked as soon as the search arrives, so no key is lost.
  const typed = useRef(query);
  useEffect(() => {
    typed.current = query;
  }, [query]);
  useEffect(() => {
    if (!isOpen) return;
    let held: GlobalSearch | undefined;
    let isGone = false;
    data.search.open(slug).then(
      (made) => {
        if (isGone) {
          made.dispose();
          return;
        }
        held = made;
        made.ask(typed.current);
        setFailed(false);
        setSearch(made);
      },
      () => {
        if (!isGone) setFailed(true);
      },
    );
    return () => {
      isGone = true;
      held?.dispose();
      setSearch(undefined);
    };
  }, [data, slug, isOpen, attempt]);
  const reopen = useCallback(() => {
    setFailed(false);
    setAttempt((count) => count + 1);
  }, []);
  return { search, hasFailed, reopen };
}

const noSubscribe = () => () => undefined;

/** The search's state (where it stands, and the records and views found), once its code is in. */
function useSearchState(search: GlobalSearch | undefined): GlobalSearchState | undefined {
  return useSyncExternalStore(search === undefined ? noSubscribe : search.subscribe, () => search?.getSnapshot());
}

/** The member's recent records and views, read fresh each opening (they must reflect access now); none on a failure. */
function useRecents(data: DataLayer, slug: string): readonly RecentItem[] {
  const [items, setItems] = useState<readonly RecentItem[]>([]);
  useEffect(() => {
    let isGone = false;
    data.search.recents(slug).then(
      (read) => {
        if (!isGone) setItems(read);
      },
      () => undefined,
    );
    return () => {
      isGone = true;
    };
  }, [data, slug]);
  return items;
}

/** A command as a row; the themes are one choice, read as radio items, the one in use checked (AC-1087, Q47). */
function commandRow(command: Command, themeChoice: ThemeChoice): PaletteItem {
  return {
    id: command.id,
    name: command.name,
    icon: command.icon,
    ...(command.kbd === undefined ? {} : { kbd: command.kbd }),
    ...(command.run.kind === 'theme' ? { choice: strings.theme, isChecked: command.run.choice === themeChoice } : {}),
  };
}

/** A record as a row (AC-1080): its tile or avatar, its name, its first email or domain, and its object's name. */
function recordRow(hit: RecordHit, objects: ReadonlyMap<string, ObjectSummary>, prefix = 'record'): PaletteItem {
  const { ref } = hit;
  const object = objects.get(ref.objectId);
  return {
    id: `${prefix}:${ref.recordId}`,
    name: ref.name,
    leading: (
      <Avatar
        name={ref.name}
        id={ref.recordId}
        shape={ref.kind === 'person' ? 'circle' : 'square'}
        size="xs"
        isDecorative
        {...(ref.hue === undefined ? {} : { hue: ref.hue })}
      />
    ),
    ...(hit.detail === undefined ? {} : { description: hit.detail }),
    ...(object === undefined ? {} : { kind: object.singularName }),
  };
}

/** A view as a row (AC-1081): its kind's icon, its name, and its object's plural name. */
function viewRow(view: ViewHit, objects: ReadonlyMap<string, ObjectSummary>, prefix = 'view'): PaletteItem {
  const object = objects.get(view.objectId);
  return {
    id: `${prefix}:${view.id}`,
    name: view.name,
    icon: view.kind === 'board' ? 'kanban' : 'list-checks',
    ...(object === undefined ? {} : { kind: object.pluralName }),
  };
}

/** A note as a row: its title ("Untitled note" without one), and its record's name as the quiet line. */
function noteRow(note: NoteHit): PaletteItem {
  return {
    id: `note:${note.id}`,
    name: note.title.trim() === '' ? strings.untitledNote : note.title,
    icon: 'notebook',
    description: note.record.name,
    kind: strings.note,
  };
}

/** A task as a row: its title, with a ticked box once done. */
function taskRow(task: TaskHit): PaletteItem {
  return {
    id: `task:${task.id}`,
    name: task.title,
    icon: task.isDone ? 'circle-check' : 'square-check',
    kind: strings.task,
  };
}

/** A recent item as a row (AC-1076). */
function recentRow(item: RecentItem, objects: ReadonlyMap<string, ObjectSummary>): PaletteItem {
  return item.kind === 'record'
    ? recordRow({ ref: item.ref, match: 'prefix' }, objects, 'recent-record')
    : viewRow(item.view, objects, 'recent-view');
}

/**
 * Where a found row goes (AC-1085): a record its page, a view its object's page on that view, a note its window
 * over its record, a task its dialog over the page (or Tasks).
 */
function hrefOf(
  id: string,
  slug: string,
  objects: ReadonlyMap<string, ObjectSummary>,
  found: GlobalSearchState | undefined,
  recents: readonly RecentItem[],
  pathname: string,
): string | undefined {
  const records: readonly RecordHit[] = found?.records ?? [];
  const views: readonly ViewHit[] = found?.views ?? [];
  const [kind, target] = splitId(id);
  if (kind === 'note') {
    const note = found?.notes.find((each) => each.id === target);
    const object = note === undefined ? undefined : objects.get(note.record.objectId);
    return note === undefined || object === undefined
      ? undefined
      : noteHref(slug, object.apiSlug, note.record.recordId, note.id);
  }
  if (kind === 'task') return taskDialogHref(slug, pathname, target);
  if (kind === 'record' || kind === 'recent-record') {
    const ref =
      records.find((hit) => hit.ref.recordId === target)?.ref ??
      recents.flatMap((item) => (item.kind === 'record' && item.ref.recordId === target ? [item.ref] : []))[0];
    const object = ref === undefined ? undefined : objects.get(ref.objectId);
    return ref === undefined || object === undefined ? undefined : recordHref(slug, object.apiSlug, ref.recordId);
  }
  if (kind === 'view' || kind === 'recent-view') {
    const view =
      views.find((each) => each.id === target) ??
      recents.flatMap((item) => (item.kind === 'view' && item.view.id === target ? [item.view] : []))[0];
    const object = view === undefined ? undefined : objects.get(view.objectId);
    return view === undefined || object === undefined ? undefined : viewHref(slug, object.apiSlug, view.id);
  }
  return undefined;
}

/** A row id's kind and target: `record:<id>` is `['record', '<id>']`. */
function splitId(id: string): readonly [string, string] {
  const at = id.lastIndexOf(':');
  return [id.slice(0, at), id.slice(at + 1)];
}
