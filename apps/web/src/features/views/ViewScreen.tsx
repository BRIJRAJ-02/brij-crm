// Brief
// Purpose: slice one object the way you work and keep it (spec 0020).
// Main task: filter and sort the table, lay out its columns, then save it, or keep it as a view of its own.
// Leaves out: saving a search, charts, and sharing outside the workspace.
import {
  BOARD_MAX_CARD_FIELDS,
  FILTER_EDIT_MS,
  boardDefaults,
  groupableAttributes,
  isDataError,
  isSortable,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type DraftQuery,
  type MemberSummary,
  type ObjectSummary,
  type RecordsView,
  type ViewQuery,
  type SavedViewSource,
  type ViewsListSource,
  type View,
} from '@crm/data';
import { useSavedView, useViewsList } from '@crm/data/react';
import {
  Button,
  Callout,
  EmptyState,
  focusLater,
  Popover,
  Select,
  sharedStrings,
  ToolbarSearch,
  type ViewChoice,
  type ViewField,
  type ViewLayoutSwitch,
  ViewSettings,
  type ViewSettingsTrigger,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BoardScreen } from '../board/BoardScreen.tsx';
import { planBoard } from '../board/plan.ts';
import { strings as boardStrings } from '../board/strings.ts';
import type { ViewRequest } from '../command/commands.ts';
import type { PeekControl } from '../records/params.ts';
import { RecordsScreen } from '../workspace/RecordsScreen.tsx';
import { strings as tableStrings } from '../workspace/strings.ts';
import { objectPendingPage } from '../workspace/ObjectScreen.tsx';
import { useCan, useMyAccess, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { CreateViewDialog } from './CreateViewDialog.tsx';
import { boardLayout, copyName, layoutOf, startingConfig, switchPatch, withColumn, type BoardPatch } from './edits.ts';
import { viewColumns, viewReadIds, type ShownLayout } from './layout.ts';
import {
  farAttributesFrom,
  relationTarget,
  runningQuery,
  savableQuery,
  savedQuery,
  toViewQuery,
  withDefaultOrderAsNone,
} from './query.ts';
import { withHeaderSort, withSearch } from './screen-query.ts';
import { runExport } from '../imports/export-run.ts';
import { TransferMenu } from './TransferMenu.tsx';
import { strings } from './strings.ts';
import { useViewDraft } from './useViewDraft.ts';
import { ViewChangedDialog } from './ViewChangedDialog.tsx';
import { memberName, useViewMenu } from './ViewMenu.tsx';
import { ViewToolbar } from './ViewToolbar.tsx';

/**
 * What the route opened with: the link's draft, or the one this tab kept for the view, read and checked the same
 * way, and what became of it.
 */
export interface OpenedDraft {
  readonly query: DraftQuery | undefined;
  /** The draft couldn't be read (AC-467's toast). */
  readonly unreadable: boolean;
  /** The draft named fields this person can't use, or archived since (AC-467's Callout). */
  readonly dropped: boolean;
}

/** Props for the view screen: what the view route loaded through the data layer. */
export interface ViewScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  /**
   * The object's archived attributes the reader may see. Only the query is run over them, so a condition or sort on
   * one reads as archived, which the view then names (AC-480), rather than as unknown.
   */
  readonly archivedAttributes?: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly view: SavedViewSource;
  readonly views: ViewsListSource;
  /** The records the loader warmed (none for a board view: its columns load their own), and their question. */
  readonly records: RecordsView | undefined;
  readonly recordsQuery: ViewQuery;
  readonly opened: OpenedDraft;
  /** The `draft` search param now, and how to write it. */
  readonly param: string | undefined;
  readonly writeParam: (param: string | undefined, replace: boolean) => void;
  /** The command menu's Create a <object> (spec 0039, AC-1086): open the new record dialog once the table shows. */
  readonly isCreateRequested?: boolean;
  /** The name that dialog starts with (the command menu's Create <object> named …). */
  readonly createName?: string;
  /** The request was taken (the dialog opened, or this view can't): drop it from the address. */
  readonly onCreateRequestTaken?: () => void;
  /** The command menu's Export this view or Create a view, run once the view shows. */
  readonly request?: ViewRequest;
  /** That request was run: drop it from the address. */
  readonly onRequestTaken?: () => void;
  /** The record panel over the table or board (`?record=`, spec 0017 AC-384). */
  readonly peek?: PeekControl;
}

/** The attributes of the objects a through filter leads to, read through the data layer as they are asked for. */
function useFarAttributes(slug: string, objectIds: readonly string[]) {
  const { data } = useRouteContext({ from: '__root__' });
  const [loaded, setLoaded] = useState<ReadonlyMap<string, readonly AttributeDefinition[]>>(new Map());
  const wanted = objectIds.filter((id) => !loaded.has(id)).join(',');
  useEffect(() => {
    if (wanted === '') return;
    let isCurrent = true;
    for (const objectId of wanted.split(',')) {
      void data.attributes.list(slug, objectId).then(
        (list) => {
          if (isCurrent) setLoaded((held) => new Map(held).set(objectId, list));
        },
        // The far object can't be read: its conditions drop out as unavailable.
        () => {
          if (isCurrent) setLoaded((held) => new Map(held).set(objectId, []));
        },
      );
    }
    return () => {
      isCurrent = false;
    };
  }, [data, slug, wanted]);
  return loaded;
}

/** The primary attribute types a view's search narrows by "contains" (each offers it in the filter builder). */
const SEARCHABLE_TYPES: ReadonlySet<string> = new Set(['text', 'personal_name', 'email', 'domain', 'url', 'phone']);

/** How long a follow toast that said the selection was cleared covers the clearing itself, in ms. */
const CLEARED_TOLD_MS = 10_000;

/** How long an Undo toast stays (a discarded draft, a shared view's columns), in ms. */
const UNDO_MS = 8_000;

/** How long a deleted view's Undo stays, in ms (its config is kept this long, in the toast's action). */
const DELETE_UNDO_MS = 10_000;

/** How long switching a board to Table waits for the first rows before showing the table loading in place. */
const TABLE_GRACE_MS = 300;

/** The longest a tab waits before following someone else's save (spec 0020, AC-468's 1 second at p95). */
const FOLLOW_SPREAD_MS = 600;

/** One view of an object: the bars, the Toolbar with its draft, and the table running the view. */
export function ViewScreen(props: ViewScreenProps) {
  const { slug, object, attributes, members, records, opened, param, writeParam } = props;
  // What the query runs over: the live attributes and the archived ones the reader may see (AC-480).
  const archived = props.archivedAttributes;
  const queried = useMemo(
    () => (archived === undefined ? attributes : [...attributes, ...archived]),
    [attributes, archived],
  );
  // The object's key, so a url field (here and in the filter's value editor) checks a company's handle as its page.
  const objectKey = object.standardKey ?? object.apiSlug;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const body = useSavedView(props.view);
  const list = useViewsList(props.views);
  const view = body.view;
  // The name shown last, for the notice when the view goes away.
  const shownName = useRef(view?.name);
  const currentName = view?.name;
  useEffect(() => {
    if (currentName !== undefined) shownName.current = currentName;
  }, [currentName]);
  // This tab deleted it, and is already on its way to the default view.
  const leaving = useRef(false);
  // The view went away while open (deleted, or no longer shared, AC-474): the default view, with a notice saying so.
  useEffect(() => {
    if (body.status !== 'not-found' || leaving.current) return;
    const fallback = list.views.find((each) => each.id === list.defaultViewId && each.id !== view?.id);
    toasts.toast({
      tone: 'info',
      message: strings.deletedBy(shownName.current ?? strings.thisView, fallback?.name ?? object.pluralName),
    });
    void navigate({ to: '/w/$slug/objects/$object', params: { slug, object: object.apiSlug }, replace: true });
    // Only the view going away moves the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.status]);
  // The view is the person's last opened one for its object (AC-478), at most once per 10 seconds.
  const openedId = view?.id;
  useEffect(() => {
    if (openedId === undefined) return;
    data.views.markOpened(slug, openedId);
    // And the person's recent items in the command menu (spec 0039, AC-1088): fire and forget, throttled there.
    data.search.visit(slug, 'view', openedId);
  }, [data, slug, openedId]);

  const latestSaved = useMemo(() => (view === undefined ? { sorts: [] } : savedQuery(view)), [view]);
  const access = useMyAccess();
  // Someone else's save reaches every tab on the view at once: each follows after a random moment up to
  // FOLLOW_SPREAD_MS, so they don't all ask for the new rows in the same instant (the workspace's read slots).
  // This tab's own save, and the first read, apply at once.
  // The query and its version move together, so a draft begun while following starts on the version it shows.
  const latestVersion = view?.queryVersion ?? 1;
  const [followed, setFollowed] = useState({ query: latestSaved, version: latestVersion });
  const saved = followed.query;
  useEffect(() => {
    if (followed.version === latestVersion && data.views.isSameQuery(latestSaved, followed.query)) return;
    const next = { query: latestSaved, version: latestVersion };
    if (view?.querySavedBy === access?.memberId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFollowed(next);
      return;
    }
    const timer = setTimeout(
      () => {
        setFollowed(next);
      },
      Math.round(Math.random() * FOLLOW_SPREAD_MS),
    );
    return () => {
      clearTimeout(timer);
    };
    // The saved query moving is what this follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestSaved]);
  const canManage = useCan('views.manage');
  // Add attribute, under View settings' columns (spec 0012: owners and admins, schema.manage).
  const canChangeSchema = useCan('schema.manage');
  // A locked view the person may not change (AC-476): their filters, sorts and columns stay in this tab, unsaved.
  const isLockedForMe = view !== undefined && view.visibility === 'workspace' && view.isLocked && !canManage;
  const draft = useViewDraft({
    slug,
    viewId: view?.id,
    saved,
    savedVersion: followed.version,
    param,
    opened: opened.query,
    write: writeParam,
    onUnreadable: () => {
      toasts.toast({ tone: 'info', message: strings.draftUnreadable });
      writeParam(undefined, true);
    },
    normalize: (query) => withDefaultOrderAsNone(query, attributes),
  });
  // A link's draft that couldn't be read: say so once (StrictMode runs this twice in development), and show the
  // saved view.
  const toldUnreadable = useRef(false);
  useEffect(() => {
    if (!opened.unreadable || toldUnreadable.current) return;
    toldUnreadable.current = true;
    toasts.toast({ tone: 'info', message: strings.draftUnreadable });
    writeParam(undefined, true);
    // Once, for the link the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showDropped, setShowDropped] = useState(opened.dropped);

  // What runs: the far objects a through filter leads to are read first.
  const farIds = useMemo(
    () => [...new Set(attributes.flatMap((attribute) => relationTarget(attribute) ?? []))],
    [attributes],
  );
  const far = useFarAttributes(slug, farIds);
  const effective = useMemo(
    () =>
      runningQuery(
        draft.query,
        queried,
        farAttributesFrom(attributes, (id) => far.get(id)),
      ),
    [draft.query, queried, attributes, far],
  );
  // While a through filter's far attributes load, the table keeps what it ran last (the bar says it is working).
  const [lastReady, setLastReady] = useState(effective.status === 'ready' ? effective : undefined);
  if (effective.status === 'ready' && effective !== lastReady) setLastReady(effective);
  const running = effective.status === 'ready' ? effective : lastReady;
  // The view's search (CRM flow pass): what is typed narrows the rows by the primary attribute, after a pause in
  // typing, as one more condition on the query that runs. It is never part of the draft, so Save never keeps it,
  // and another view starts without it.
  const primary = attributes.find((attribute) => attribute.id === object.primaryAttributeId);
  const searchOn = primary !== undefined && SEARCHABLE_TYPES.has(primary.type) ? primary.id : undefined;
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState('');
  const [searchFor, setSearchFor] = useState(view?.id);
  if (searchFor !== view?.id) {
    setSearchFor(view?.id);
    setTyped('');
    setSearched('');
  }
  // Cleared at once; typed text waits for a pause, as a filter's operand does.
  const typeSearch = (text: string) => {
    setTyped(text);
    if (text.trim() === '') setSearched('');
  };
  useEffect(() => {
    if (typed.trim() === '') return;
    const timer = setTimeout(() => {
      setSearched(typed.trim());
    }, FILTER_EDIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const isSearching = searchOn !== undefined && searched !== '';
  // Nothing ran yet (the far attributes still loading as the page opens): the loader's question, which kept the
  // through conditions unchecked, never an unfiltered table (late trap #45).
  const query = useMemo(
    () =>
      withSearch(
        running === undefined ? props.recordsQuery : toViewQuery(running),
        searchOn,
        searchOn === undefined ? '' : searched,
      ),
    [running, props.recordsQuery, searchOn, searched],
  );
  // The archived fields this person can see that the view's filter or sorts use, by title (AC-480). A draft is
  // built from the query that runs, so its first filter edit already leaves them out; the saved view's are named
  // too while a draft is open, so the warning stays up until the save it warns about. A through filter's archived
  // attribute is on the far object, so its title is looked up there as well.
  const archivedTitles = useMemo(() => {
    const savedRun = draft.isDraft
      ? runningQuery(
          saved,
          queried,
          farAttributesFrom(attributes, (id) => far.get(id)),
        )
      : undefined;
    const ids = new Set([...(running?.skipped ?? []), ...(savedRun?.status === 'ready' ? savedRun.skipped : [])]);
    const known = [...queried, ...[...far.values()].flat()];
    return [...ids].flatMap((id) => {
      const title = known.find((attribute) => attribute.id === id)?.title;
      return title === undefined ? [] : [title];
    });
  }, [running, saved, draft.isDraft, queried, attributes, far]);

  // Whether the table holds ticked rows: a new query clears them, and the toast below says so (spec 0022, AC-522).
  const isTicked = useRef(false);
  const tickedChanged = useCallback((ticked: boolean) => {
    isTicked.current = ticked;
  }, []);
  // Someone else saved this view's filters (AC-468): a tab with no draft follows, and says who, and that the
  // rows it had ticked were cleared with the old filters (owner decision 5).
  const seenVersion = useRef(view?.queryVersion);
  // When a follow toast last said the selection was cleared: the table's own "Selection cleared" then stays quiet.
  const toldCleared = useRef(0);
  useEffect(() => {
    if (view === undefined) return;
    const before = seenVersion.current;
    seenVersion.current = view.queryVersion;
    if (before === undefined || view.queryVersion <= before || draft.isDraft) return;
    if (view.querySavedBy === undefined || view.querySavedBy === access?.memberId) return;
    const name = members.find((member) => member.id === view.querySavedBy)?.name ?? strings.removedMember;
    if (isTicked.current) toldCleared.current = Date.now();
    toasts.toast({
      tone: 'info',
      message: isTicked.current ? strings.changedByCleared(name) : strings.changedBy(name),
    });
    // Only a new query version announces anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.queryVersion]);

  // Asks the Toolbar to focus its Filter button when the focused control went away with its change.
  const [focusRequest, setFocusRequest] = useState<object | undefined>(undefined);
  // Discard acts at once, with Undo bringing the draft back (owner, 30 October 2026: Undo over a confirm).
  const discard = () => {
    const kept = draft.query;
    draft.discard();
    setShowDropped(false);
    setFocusRequest({});
    toasts.toast(
      {
        tone: 'info',
        message: strings.discarded,
        action: {
          label: strings.undo,
          onAction: () => {
            draft.set(kept, 'push');
          },
        },
      },
      { timeout: UNDO_MS },
    );
  };
  const [isSaving, setSaving] = useState(false);
  const [clash, setClash] = useState<string | undefined>(undefined);
  const save = (force: boolean) => {
    if (view === undefined || running === undefined || isSaving) return;
    setSaving(true);
    const toSave = savableQuery(draft.query, running);
    data.views
      .saveQuery(slug, view.id, {
        ...(toSave.filter === undefined ? {} : { filter: toSave.filter }),
        sorts: toSave.sorts,
        baseQueryVersion: draft.baseQueryVersion,
        ...(force ? { force: true } : {}),
      })
      .then(
        (next) => {
          setSaving(false);
          setClash(undefined);
          seenVersion.current = next.queryVersion;
          setFollowed({ query: savedQuery(next), version: next.queryVersion });
          draft.settle();
          setShowDropped(false);
          setFocusRequest({});
        },
        (error: unknown) => {
          setSaving(false);
          if (isDataError(error) && error.code === 'VIEW_CHANGED') {
            setClash(error.message);
            return;
          }
          setClash(undefined);
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.saveFailed });
        },
      );
  };

  // The view's columns (AC-470): a change shows at once and saves for everyone on the view, or stays in this tab on
  // a locked view. Leaving the view drops what stayed here.
  const layout = useMemo(() => viewColumns(view, object, attributes), [view, object, attributes]);
  // A shared view's columns change for everyone at once, while filters and sorts wait for Save: the toast says so,
  // with Undo putting back the columns as they were (one toast at a time, the latest change's).
  const layoutToast = useRef<string | undefined>(undefined);
  const changeLayout = (next: ShownLayout, isAnnounced = true) => {
    if (view === undefined) return;
    const before = layout;
    // A layout kept in this tab replaces the one before it, so it carries the kind and board shown now.
    data.views.setLayout(
      slug,
      view.id,
      { ...boardLayout(view, {}, isLockedForMe), ...layoutOf(next.columns, next.pinnedCount) },
      { isLocal: isLockedForMe },
    );
    if (!isAnnounced || view.visibility !== 'workspace' || isLockedForMe) return;
    if (layoutToast.current !== undefined) toasts.dismiss(layoutToast.current);
    layoutToast.current = toasts.toast(
      {
        tone: 'info',
        message: strings.layoutForEveryone(view.name),
        action: {
          label: strings.undo,
          onAction: () => {
            changeLayout(before, false);
          },
        },
      },
      { timeout: UNDO_MS },
    );
  };
  // The kind and the board settings (spec 0021, AC-492, AC-497), saved as any layout change is: for everyone at
  // once, or in this tab only on a locked view the person may not change. The columns go as they are.
  const changeBoardLayout = (patch: BoardPatch) => {
    if (view === undefined) return;
    data.views.setLayout(slug, view.id, boardLayout(view, patch, isLockedForMe), { isLocal: isLockedForMe });
  };
  // A table's grouping (13 Oct reference batch 4), saved with the view as any layout change is; `null` is one list.
  const changeGroupBy = (groupBy: string | null) => {
    if (view === undefined) return;
    data.views.setLayout(
      slug,
      view.id,
      { ...boardLayout(view, {}, isLockedForMe), groupBy },
      { isLocal: isLockedForMe },
    );
  };
  const groupChoices = useMemo(
    () => [
      { id: 'none', label: strings.noGrouping },
      ...groupableAttributes(attributes).map((attribute) => ({
        id: attribute.id,
        label: attribute.title,
      })),
    ],
    [attributes],
  );
  // A board's Show total of: none, or one of the object's live currency fields.
  const totalChoices = useMemo(
    () => [
      { id: 'none', label: strings.noTotal },
      ...attributes
        .filter((attribute) => attribute.type === 'currency' && !attribute.isArchived)
        .map((attribute) => ({ id: attribute.id, label: attribute.title })),
    ],
    [attributes],
  );
  const viewId = view?.id;
  useEffect(
    () => () => {
      if (viewId !== undefined) data.views.dropLocalLayout(slug, viewId);
    },
    [data, slug, viewId],
  );
  const settingsAnchor = useRef<HTMLButtonElement>(null);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const fields = useMemo(() => {
    const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
    return layout.columns.flatMap((column) => {
      const definition = byId.get(column.id);
      return definition === undefined
        ? []
        : [
            {
              attribute: toFieldAttribute(definition, undefined, objectKey),
              isShown: !column.isHidden,
              ...(definition.id === object.primaryAttributeId ? { isLocked: true } : {}),
            },
          ];
    });
  }, [layout, attributes, object.primaryAttributeId, objectKey]);

  // Create view, and Save as new view (the Save menu, the clash dialog, a locked view's only Save).
  const [createMode, setCreateMode] = useState<'create' | 'save-as' | undefined>(undefined);
  const openView = (next: View, message: string) => {
    toasts.toast({ tone: 'success', message });
    void navigate({
      to: '/w/$slug/objects/$object/views/$viewId',
      params: { slug, object: object.apiSlug, viewId: next.id },
    });
  };
  // Export CSV (spec 0040, AC-1130, AC-1131): the view as it stands, its unsaved filter and sorts included, its visible
  // columns in order; one toast shows it working, then turns into Download (or Try again).
  const exporting = useRef(false);
  // `withHidden` (Export all columns) writes the layout's hidden columns too, in the layout's order.
  const exportView = (withHidden = false) => {
    // One export per press: a second press while the first is on its way starts nothing.
    if (exporting.current) return;
    exporting.current = true;
    void runExport(
      {
        data,
        toasts,
        download: (path) => {
          window.location.assign(path);
        },
      },
      slug,
      view?.name ?? object.pluralName,
      {
        objectId: object.id,
        ...(view === undefined ? {} : { viewId: view.id }),
        ...(query.filter === undefined ? {} : { filter: query.filter }),
        sorts: query.sorts,
        attributeIds: layout.columns.filter((column) => withHidden || !column.isHidden).map((column) => column.id),
      },
    ).finally(() => {
      exporting.current = false;
    });
  };
  const [isDuplicating, setDuplicating] = useState(false);
  const duplicate = () => {
    // One copy per press: a second press while the first is on its way adds nothing.
    if (view === undefined || isDuplicating) return;
    setDuplicating(true);
    const taken = list.views.filter((each) => each.visibility === 'private').map((each) => each.name);
    const name = copyName(view.name, taken);
    data.views
      .create(slug, {
        id: data.views.newId(),
        objectId: object.id,
        name,
        kind: view.kind,
        visibility: 'private',
        config: view.config,
      })
      .then(
        (made) => {
          setDuplicating(false);
          // The copy opens with Rename, its name selected: one step to name it, no "copy" kept by accident.
          void navigate({
            to: '/w/$slug/objects/$object/views/$viewId',
            params: { slug, object: object.apiSlug, viewId: made.id },
            search: { do: 'rename' },
          });
        },
        (error: unknown) => {
          setDuplicating(false);
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : sharedStrings.couldntDoThat });
        },
      );
  };

  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  const me = memberDisplays.find((member) => member.id === access?.memberId);
  const sortable = useMemo(
    () => attributes.filter((attribute) => !attribute.isArchived && isSortable(attribute)),
    [attributes],
  );
  const [filterOn, setFilterOn] = useState<{ readonly attributeId: string } | undefined>(undefined);
  const canSave = view !== undefined && !isLockedForMe;
  const filtered = running?.filter !== undefined || isSearching;
  // Table or Board (spec 0021, AC-492): the view's kind, switched for everyone on it through `views.setLayout`
  // (on a locked view the person may not change, for this tab only). The first switch to Board fills the
  // defaults; with nothing to group by it saves the kind alone. Back to Table keeps the board settings.
  const kind = view?.kind ?? 'table';
  const layoutSwitch: ViewLayoutSwitch = {
    label: boardStrings.layout,
    segments: [
      { value: 'table', label: boardStrings.table, icon: 'table' },
      { value: 'board', label: boardStrings.board, icon: 'kanban' },
    ],
    value: kind,
    onChange: (picked) => {
      const patch =
        view === undefined ? undefined : switchPatch(view, picked === 'board' ? 'board' : 'table', attributes);
      if (patch !== undefined) changeBoardLayout(patch);
    },
  };
  const storedBoard = view?.config.board;
  // Planned over the archived attributes too, so a grouping field archived since says so rather than the board
  // quietly grouping by the next field and saving that over it (late trap #14).
  const boardOutcome = useMemo(
    () => (kind === 'board' ? planBoard(queried, storedBoard, members) : undefined),
    [kind, queried, storedBoard, members],
  );
  // A board view showing defaults it never stored (saved with nothing to group by): the first time it can group,
  // the defaults are saved like any layout change, once per visit (AC-492). Never over a grouping the view does
  // store but this reader can't use (`isStandIn`, late trap #29): opening it would have replaced everyone's grouping
  // with the reader's stand in.
  const filledFor = useRef<string | undefined>(undefined);
  const toFill =
    boardOutcome?.kind === 'board' && !boardOutcome.isStored && !boardOutcome.isStandIn
      ? boardOutcome.settings
      : undefined;
  useEffect(() => {
    if (toFill === undefined || view === undefined || filledFor.current === view.id) return;
    filledFor.current = view.id;
    changeBoardLayout({ board: toFill });
    // Only defaults appearing fill them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toFill]);
  // A view opened as a board warmed no table (the route skips it): switching to Table opens its records here.
  const [lateTable, setLateTable] = useState<{ readonly records: RecordsView; readonly query: ViewQuery }>();
  const needsTable = kind === 'table' && records === undefined && lateTable === undefined;
  useEffect(() => {
    if (!needsTable) return;
    let isCurrent = true;
    const asked = query;
    data.records.open(slug, object.id, asked, viewReadIds(layout, object, attributes), TABLE_GRACE_MS).then(
      (opened) => {
        if (isCurrent) setLateTable({ records: opened, query: asked });
      },
      () => {
        if (isCurrent) toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
      },
    );
    return () => {
      isCurrent = false;
    };
    // Opened once, for the question asked when the table first shows; the table follows later changes itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTable]);
  const table = records === undefined ? lateTable : { records, query: props.recordsQuery };
  // Create view's Board starts from these (AC-472, AC-492).
  const newBoard = useMemo(() => boardDefaults(attributes), [attributes]);
  const showEmptyColumns = (show: boolean) => {
    if (boardOutcome?.kind !== 'board') return;
    changeBoardLayout({ board: { ...boardOutcome.settings, showEmptyColumns: show } });
  };
  // A board's View settings (spec 0021): the card's fields, the name first and always shown, then the shown ones
  // in the card's order, then the rest. A card holds at most six.
  const boardPlan = boardOutcome?.kind === 'board' ? boardOutcome : undefined;
  const cardFields = useMemo((): readonly ViewField[] => {
    if (boardPlan === undefined) return [];
    const shown = new Set(boardPlan.cardFields.map((field) => field.id));
    const primary = attributes.filter((each) => each.isPrimary && !each.isArchived);
    const rest = attributes.filter(
      (each) => !each.isArchived && !each.isPrimary && each.id !== boardPlan.groupBy.id && !shown.has(each.id),
    );
    return [
      ...primary.map((each) => ({
        attribute: toFieldAttribute(each, undefined, objectKey),
        isShown: true,
        isLocked: true,
      })),
      ...boardPlan.cardFields.map((each) => ({
        attribute: toFieldAttribute(each, undefined, objectKey),
        isShown: true,
      })),
      ...rest.map((each) => ({ attribute: toFieldAttribute(each, undefined, objectKey), isShown: false })),
    ];
  }, [boardPlan, attributes, objectKey]);
  const changeCardFields = (next: readonly ViewField[]) => {
    if (boardPlan === undefined) return;
    const ids = next.flatMap((field) => (field.isShown && field.isLocked !== true ? [field.attribute.id] : []));
    if (ids.length > BOARD_MAX_CARD_FIELDS) {
      toasts.toast({ tone: 'info', message: strings.cardFieldsFull(BOARD_MAX_CARD_FIELDS) });
      return;
    }
    changeBoardLayout({ board: { ...boardPlan.settings, cardFields: ids } });
  };
  const switchView = (viewId: string) => {
    // The view already open: nothing changes. Another view keeps this one's draft for when it opens again.
    if (viewId === view?.id) return;
    void navigate({
      to: '/w/$slug/objects/$object/views/$viewId',
      params: { slug, object: object.apiSlug, viewId },
    });
  };
  const createView = () => {
    setCreateMode('create');
  };
  // The view's own actions (Rename, Duplicate, Delete…): under "This view" in the switcher's menu, with their dialogs.
  const viewMenu = useViewMenu({
    slug,
    object,
    view,
    list,
    members,
    memberId: access?.memberId,
    canManage,
    copyLinkReason: draft.isDraft && !draft.isLinkable ? strings.linkTooLong : undefined,
    onDuplicate: duplicate,
    onDeleting: (isDeleting) => {
      // This tab's own delete: the view going away is no news here.
      leaving.current = isDeleting;
    },
    onDeleted: (gone) => {
      // Undo makes it again from what it was, under the same id when the server takes it (a delete is hard, so the
      // id is free again), else a new one; its place, lock and default don't come back. Known limit: `gone.config` is
      // this person's copy, which leaves out the columns a field rule hides from them, so a view restored by someone
      // who can't see every field comes back without those columns (the server keeps no deleted view to restore).
      const restore = (id: string) =>
        data.views.create(slug, {
          id,
          objectId: gone.objectId,
          name: gone.name,
          kind: gone.kind,
          visibility: gone.visibility,
          config: gone.config,
        });
      toasts.toast(
        {
          tone: 'success',
          message: strings.deleted(gone.name),
          action: {
            label: strings.undo,
            onAction: () => {
              restore(gone.id)
                .catch((error: unknown) => {
                  if (isDataError(error) && error.code === 'ID_TAKEN') return restore(data.views.newId());
                  throw error;
                })
                .then(
                  (made) => {
                    openView(made, strings.restored(made.name));
                  },
                  (error: unknown) => {
                    toasts.toast({
                      tone: 'danger',
                      message: isDataError(error) ? error.message : sharedStrings.couldntDoThat,
                    });
                  },
                );
            },
          },
        },
        { timeout: DELETE_UNDO_MS },
      );
      void navigate({
        to: '/w/$slug/objects/$object',
        params: { slug, object: object.apiSlug },
        replace: true,
      });
    },
  });
  // The command menu's Export this view and Create a view (`?do=`): run once, then dropped from the address. Read
  // through refs, so a new callback each render never runs one twice.
  const latest = useRef({ exportView, taken: props.onRequestTaken, rename: (): void => undefined });
  useEffect(() => {
    latest.current = { exportView, taken: props.onRequestTaken, rename: viewMenu.rename };
  });
  const { request } = props;
  // Create a view opens its dialog in render, as the create request does; the export runs after, once.
  const [seenRequest, setSeenRequest] = useState<ViewRequest | undefined>(undefined);
  if (request !== seenRequest) {
    setSeenRequest(request);
    if (request === 'new-view') setCreateMode('create');
  }
  useEffect(() => {
    if (request === undefined) return;
    if (request === 'export') latest.current.exportView();
    if (request === 'rename') latest.current.rename();
    latest.current.taken?.();
  }, [request]);
  // The switcher (AC-473): the default, the other shared views, then a Private section; locked ones marked.
  const choices: readonly ViewChoice[] = (list.views.length > 0 ? list.views : view === undefined ? [] : [view]).map(
    (each) => ({
      id: each.id,
      name: each.name,
      ...(each.visibility === 'workspace' && each.isLocked ? { isLocked: true } : {}),
      ...(each.visibility === 'private' ? { section: strings.privateSection } : {}),
      ...(viewMenu.isMovable(each.id) ? { isMovable: true } : {}),
    }),
  );
  // A table's "Add attribute" from View settings: asked of the table, which owns the attribute dialog.
  const [addRequest, setAddRequest] = useState<object | undefined>(undefined);
  // The view bar's end before View settings: the lock line. View settings is the bar's one button, then Table or
  // Board (the owner, 21 and 22 October 2026: the view's actions live in the switcher's menu, as in Attio, and
  // Add attribute under View settings).
  const viewActions: ReactNode =
    view === undefined ? undefined : (
      <>
        {view.visibility === 'workspace' && view.isLocked && (
          <Callout placement="bar" {...(isLockedForMe ? { isAnnounced: true } : {})}>
            {isLockedForMe
              ? strings.lockedUnsaved(memberName(members, view.lockedBy))
              : strings.lockedBy(memberName(members, view.lockedBy))}
          </Callout>
        )}
        <TransferMenu
          slug={slug}
          object={object}
          shownColumns={layout.columns.filter((column) => !column.isHidden).length}
          allColumns={layout.columns.length}
          {...(table === undefined ? {} : { records: table.records })}
          onExport={exportView}
        />
      </>
    );
  const viewSettings: ViewSettingsTrigger | undefined =
    view === undefined
      ? undefined
      : {
          ref: settingsAnchor,
          isOpen: isSettingsOpen,
          onPress: () => {
            setSettingsOpen(true);
          },
        };
  const toolbarFor = (announced: string | undefined): ReactNode => (
    <>
      <ViewToolbar
        query={draft.query}
        filter={running?.filter}
        attributes={attributes}
        objectKey={objectKey}
        sortable={sortable}
        members={memberDisplays}
        me={me}
        isDraft={draft.isDraft}
        canSave={canSave}
        isSaving={isSaving}
        onChange={draft.set}
        onDiscard={discard}
        onSave={() => {
          save(false);
        }}
        onSaveAsNew={() => {
          setCreateMode('save-as');
        }}
        {...(filterOn === undefined ? {} : { filterOn })}
        {...(focusRequest === undefined ? {} : { focusRequest })}
        {...(announced === undefined ? {} : { status: announced })}
        {...(searchOn === undefined
          ? {}
          : {
              search: (
                <ToolbarSearch label={strings.searchView(object.pluralName)} value={typed} onChange={typeSearch} />
              ),
            })}
      />
      {archivedTitles.length > 0 && (
        // Spec 0020, AC-480: archived fields the view filters or sorts on are left out when it runs, so it shows
        // more than it was saved to. Nothing said so, and the view simply looked wrong.
        <Callout tone="info" placement="banner">
          {strings.archivedInView(archivedTitles)}
        </Callout>
      )}
      {showDropped && draft.isDraft && (
        <Callout
          tone="warning"
          placement="banner"
          isAnnounced
          actions={
            <Button
              variant="ghost"
              onPress={() => {
                setShowDropped(false);
              }}
            >
              {strings.dismiss}
            </Button>
          }
        >
          {strings.draftDropped}
        </Callout>
      )}
    </>
  );
  // The clash dialog, Create view (and Save as new view), and the table's View settings: one set for both layouts.
  const dialogs = (
    <>
      {viewMenu.dialogs}
      <ViewChangedDialog
        sentence={clash}
        isReplacing={isSaving}
        onReplace={() => {
          save(true);
        }}
        onSaveAsNew={() => {
          setClash(undefined);
          setCreateMode('save-as');
        }}
        onCancel={() => {
          setClash(undefined);
        }}
      />
      <CreateViewDialog
        mode={createMode}
        onClose={() => {
          setCreateMode(undefined);
        }}
        objectId={object.id}
        newId={data.views.newId}
        canStartFromView={view !== undefined}
        currentKind={kind}
        boardDefaults={newBoard}
        configFor={(fromThisView) => {
          const config = startingConfig(
            fromThisView && running !== undefined ? { layout, query: savableQuery(draft.query, running) } : undefined,
            object,
            attributes,
          );
          // From this view: its board settings come too, so a board saved as new shows the same board.
          const board = fromThisView ? view?.config.board : undefined;
          return board === undefined ? config : { ...config, board };
        }}
        onCreate={(input) => data.views.create(slug, input)}
        onCreated={(made) => {
          setCreateMode(undefined);
          openView(made, strings.created(made.name));
        }}
      />
      <Popover
        triggerRef={settingsAnchor}
        isOpen={isSettingsOpen}
        onOpenChange={setSettingsOpen}
        label={strings.viewSettings}
      >
        <ViewSettings
          {...(boardPlan === undefined
            ? { label: strings.columns, fields }
            : { label: strings.cardFields, fields: cardFields, maxShown: BOARD_MAX_CARD_FIELDS })}
          {...(boardPlan !== undefined && totalChoices.length > 1
            ? {
                // A board's column total (the CRM flow pass): the sum of one currency field in each column header.
                header: (
                  <Select
                    savesOnPick
                    label={strings.showTotalOf}
                    size="sm"
                    items={totalChoices}
                    value={boardPlan.total?.id ?? 'none'}
                    onChange={(id) => {
                      const { totalAttributeId: _old, ...rest } = boardPlan.settings;
                      changeBoardLayout({
                        board: id === null || id === 'none' ? rest : { ...rest, totalAttributeId: id },
                      });
                    }}
                  />
                ),
              }
            : {})}
          {...(boardPlan === undefined && groupChoices.length > 1
            ? {
                header: (
                  <Select
                    savesOnPick
                    label={strings.groupBy}
                    size="sm"
                    items={groupChoices}
                    value={
                      groupChoices.some((choice) => choice.id === view?.config.groupBy)
                        ? (view?.config.groupBy ?? 'none')
                        : 'none'
                    }
                    onChange={(id) => {
                      changeGroupBy(id === null || id === 'none' ? null : id);
                    }}
                  />
                ),
              }
            : {})}
          onChange={(next) => {
            if (boardPlan !== undefined) {
              changeCardFields(next);
              return;
            }
            const kept = new Map(layout.columns.map((column) => [column.id, column]));
            changeLayout({
              columns: next.map((field) => {
                const { width, calc } = kept.get(field.attribute.id) ?? {};
                return {
                  id: field.attribute.id,
                  isHidden: !field.isShown && field.isLocked !== true,
                  ...(width === undefined ? {} : { width }),
                  ...(calc === undefined ? {} : { calc }),
                };
              }),
              pinnedCount: layout.pinnedCount,
            });
          }}
          // A new attribute is one more column, or card field: Add attribute sits under them, for whoever may change
          // the schema.
          {...(canChangeSchema
            ? {
                footer: (
                  <Button
                    variant="ghost"
                    icon="plus"
                    onPress={() => {
                      setSettingsOpen(false);
                      setAddRequest({});
                    }}
                  >
                    {strings.addAttribute}
                  </Button>
                ),
              }
            : {})}
        />
      </Popover>
    </>
  );

  if (boardOutcome !== undefined) {
    return (
      <>
        <BoardScreen
          {...(props.isCreateRequested === true ? { isCreateRequested: true } : {})}
          {...(props.onCreateRequestTaken === undefined ? {} : { onCreateRequestTaken: props.onCreateRequestTaken })}
          slug={slug}
          object={object}
          attributes={attributes}
          members={members}
          {...(props.peek === undefined ? {} : { peek: props.peek })}
          outcome={boardOutcome}
          query={query}
          views={choices}
          currentViewId={view?.id ?? ''}
          onViewChange={switchView}
          onCreateView={createView}
          viewActions={viewActions}
          {...(boardPlan === undefined || viewSettings === undefined ? {} : { viewSettings })}
          // View settings' Add attribute goes to the board, which owns its attribute dialog.
          {...(addRequest === undefined ? {} : { addAttributeRequest: addRequest })}
          onAddAttributeClosed={() => {
            focusLater(() => settingsAnchor.current);
            setAddRequest(undefined);
          }}
          viewMenu={viewMenu}
          layoutSwitch={layoutSwitch}
          toolbar={toolbarFor}
          onShowEmptyColumnsChange={showEmptyColumns}
        />
        {dialogs}
      </>
    );
  }

  if (table === undefined) {
    return <WorkspacePage currentObject={object.apiSlug} page={objectPendingPage()} />;
  }

  return (
    <>
      <RecordsScreen
        slug={slug}
        {...(props.isCreateRequested === true ? { isCreateRequested: true } : {})}
        {...(props.createName === undefined ? {} : { createName: props.createName })}
        {...(props.onCreateRequestTaken === undefined ? {} : { onCreateRequestTaken: props.onCreateRequestTaken })}
        object={object}
        attributes={attributes}
        members={members}
        {...(props.peek === undefined ? {} : { peek: props.peek })}
        view={table.records}
        viewQuery={table.query}
        {...(view?.config.groupBy === undefined ? {} : { groupBy: view.config.groupBy })}
        query={query}
        onSort={(rule) => {
          // That column's sort goes first; the others stay after it (a header never wipes the sorts built).
          draft.set(
            {
              ...(draft.query.filter === undefined ? {} : { filter: draft.query.filter }),
              sorts: withHeaderSort(draft.query.sorts, rule, attributes),
            },
            'push',
          );
        }}
        onFilter={(attributeId) => {
          // A relationship starts on is empty: its builder offers only the empty checks (ViewToolbar).
          setFilterOn({ attributeId });
        }}
        views={choices}
        onCreateView={createView}
        layout={layout}
        onLayoutChange={changeLayout}
        onAttributeCreated={(attributeId) => {
          // A view that lists its columns shows the new one at its end; a seeded default shows it already.
          if (view !== undefined && (view.config.columns.length > 0 || !view.config.showNewAttributes)) {
            changeLayout(withColumn(layout, attributeId), false);
          }
        }}
        viewActions={viewActions}
        {...(viewSettings === undefined ? {} : { viewSettings })}
        viewMenu={viewMenu}
        {...(addRequest === undefined ? {} : { addAttributeRequest: addRequest })}
        onAddAttributeClosed={(isMade) => {
          // Its dialog opened from View settings, which closed: a cancel goes back to View settings (a new
          // attribute's column takes focus itself).
          if (!isMade) focusLater(() => settingsAnchor.current);
          setAddRequest(undefined);
        }}
        currentViewId={view?.id ?? ''}
        onViewChange={switchView}
        layoutSwitch={layoutSwitch}
        announce={(count) =>
          filtered
            ? strings.matching(
                count.atLeast ? `${count.count.toLocaleString()}+` : count.count.toLocaleString(),
                object.pluralName,
              )
            : undefined
        }
        toolbar={toolbarFor}
        onTickedChange={tickedChanged}
        onTicksCleared={() => {
          // Someone else's saved filter already said the selection went with it.
          if (Date.now() - toldCleared.current < CLEARED_TOLD_MS) return;
          toasts.toast({ tone: 'info', message: tableStrings.selectionCleared });
        }}
        {...(isSearching
          ? {
              filteredEmpty: (
                <EmptyState
                  icon="search"
                  title={strings.noSearchMatchesTitle(object.pluralName, searched)}
                  actions={
                    <Button
                      onPress={() => {
                        typeSearch('');
                      }}
                    >
                      {strings.clearSearch}
                    </Button>
                  }
                />
              ),
            }
          : filtered
            ? {
                filteredEmpty: (
                  <EmptyState
                    icon="list-filter"
                    title={strings.noMatchesTitle(object.pluralName)}
                    actions={
                      // One way out: the filters themselves (the Toolbar's Discard stays for a draft).
                      <Button
                        onPress={() => {
                          setFilterOn({ attributeId: '' });
                        }}
                      >
                        {strings.editFilters}
                      </Button>
                    }
                  />
                ),
              }
            : {})}
      />
      {dialogs}
    </>
  );
}
