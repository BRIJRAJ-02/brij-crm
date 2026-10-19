// Brief
// Purpose: slice one object the way you work and keep it (spec 0020).
// Main task: filter and sort the table, then save it for everyone who sees the view.
// Leaves out: grouping inside the table, view search, charts, and (until milestone 2) more views and their columns.
import {
  isDataError,
  isSortable,
  toActorDisplays,
  type AttributeDefinition,
  type DraftQuery,
  type MemberSummary,
  type ObjectSummary,
  type RecordsView,
  type ViewQuery,
  type SavedViewSource,
  type ViewsListSource,
} from '@crm/data';
import { useSavedView, useViewsList } from '@crm/data/react';
import { Button, Callout, EmptyState, SegmentedControl } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BoardScreen } from '../board/BoardScreen.tsx';
import { planBoard } from '../board/plan.ts';
import { strings as boardStrings } from '../board/strings.ts';
import { RecordsScreen } from '../workspace/RecordsScreen.tsx';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { farAttributesFrom, relationTarget, runningQuery, savableQuery, savedQuery, toViewQuery } from './query.ts';
import { strings } from './strings.ts';
import { useViewDraft } from './useViewDraft.ts';
import { ViewChangedDialog } from './ViewChangedDialog.tsx';
import { ViewToolbar } from './ViewToolbar.tsx';

/** What the route opened with: the link's draft, read and checked, and what became of it. */
export interface OpenedDraft {
  readonly query: DraftQuery | undefined;
  /** The link's draft couldn't be read (AC-467's toast). */
  readonly unreadable: boolean;
  /** The link's draft named fields this person can't use (AC-467's Callout). */
  readonly dropped: boolean;
}

/** Props for the view screen: what the view route loaded through the data layer. */
export interface ViewScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly view: SavedViewSource;
  readonly views: ViewsListSource;
  /** The records the loader warmed, and the question they answer. */
  readonly records: RecordsView;
  readonly recordsQuery: ViewQuery;
  readonly opened: OpenedDraft;
  /** The `draft` search param now, and how to write it. */
  readonly param: string | undefined;
  readonly writeParam: (param: string | undefined, replace: boolean) => void;
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

/** The longest a tab waits before following someone else's save (spec 0020, AC-468's 1 second at p95). */
const FOLLOW_SPREAD_MS = 600;

/** One view of an object: the bars, the Toolbar with its draft, and the table running the view. */
export function ViewScreen(props: ViewScreenProps) {
  const { slug, object, attributes, members, records, opened, param, writeParam } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const body = useSavedView(props.view);
  const list = useViewsList(props.views);
  const view = body.view;
  // The view went away while open (deleted, or no longer shared): the object's address picks another.
  useEffect(() => {
    if (body.status !== 'not-found') return;
    void navigate({ to: '/w/$slug/objects/$object', params: { slug, object: object.apiSlug }, replace: true });
  }, [body.status, navigate, slug, object.apiSlug]);

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
  const draft = useViewDraft({
    saved,
    savedVersion: followed.version,
    param,
    opened: opened.query,
    write: writeParam,
    onUnreadable: () => {
      toasts.toast({ tone: 'info', message: strings.draftUnreadable });
      writeParam(undefined, true);
    },
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
        attributes,
        farAttributesFrom(attributes, (id) => far.get(id)),
      ),
    [draft.query, attributes, far],
  );
  // While a through filter's far attributes load, the table keeps what it ran last (the bar says it is working).
  const [lastReady, setLastReady] = useState(effective.status === 'ready' ? effective : undefined);
  if (effective.status === 'ready' && effective !== lastReady) setLastReady(effective);
  const running = effective.status === 'ready' ? effective : lastReady;
  const query = useMemo(() => (running === undefined ? { sorts: [] } : toViewQuery(running)), [running]);

  // Someone else saved this view's filters (AC-468): a tab with no draft follows, and says who.
  const seenVersion = useRef(view?.queryVersion);
  useEffect(() => {
    if (view === undefined) return;
    const before = seenVersion.current;
    seenVersion.current = view.queryVersion;
    if (before === undefined || view.queryVersion <= before || draft.isDraft) return;
    if (view.querySavedBy === undefined || view.querySavedBy === access?.memberId) return;
    const name = members.find((member) => member.id === view.querySavedBy)?.name ?? strings.removedMember;
    toasts.toast({ tone: 'info', message: strings.changedBy(name) });
    // Only a new query version announces anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.queryVersion]);

  // Asks the Toolbar to focus its Filter button when the focused control went away with its change.
  const [focusRequest, setFocusRequest] = useState<object | undefined>(undefined);
  const discard = () => {
    draft.discard();
    setShowDropped(false);
    setFocusRequest({});
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
          toasts.toast({ tone: 'success', message: strings.saved(next.name) });
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

  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  const me = memberDisplays.find((member) => member.id === access?.memberId);
  const sortable = useMemo(
    () => attributes.filter((attribute) => !attribute.isArchived && isSortable(attribute)),
    [attributes],
  );
  const [filterOn, setFilterOn] = useState<{ readonly attributeId: string } | undefined>(undefined);
  const canSave = view !== undefined && (!view.isLocked || canManage);
  const filtered = running?.filter !== undefined;
  const choices = list.views.length > 0 ? list.views : view === undefined ? [] : [view];

  // Table or Board (spec 0021, AC-492): the view's kind, or the one picked on this visit. Saving the kind for
  // everyone arrives with the views' layout save (spec 0020 milestone 2, `views.setLayout`); until then the
  // switch changes this visit only, as it does on a locked view for a member without views.manage.
  const [pickedKind, setPickedKind] = useState<'table' | 'board' | undefined>(undefined);
  const kind = pickedKind ?? view?.kind ?? 'table';
  const layoutSwitch = (
    <SegmentedControl
      label={boardStrings.layout}
      segments={[
        { value: 'table', label: boardStrings.table },
        { value: 'board', label: boardStrings.board },
      ]}
      value={kind}
      onChange={(next) => {
        setPickedKind(next === 'board' ? 'board' : 'table');
      }}
    />
  );
  const storedBoard = view?.config.board;
  const boardOutcome = useMemo(
    () => (kind === 'board' ? planBoard(attributes, storedBoard) : undefined),
    [kind, attributes, storedBoard],
  );
  const viewChoices = choices.map((each) => ({ id: each.id, name: each.name }));
  const openView = (viewId: string) => {
    void navigate({
      to: '/w/$slug/objects/$object/views/$viewId',
      params: { slug, object: object.apiSlug, viewId },
    });
  };
  const toolbarFor = (announced: string | undefined): ReactNode => (
    <>
      <ViewToolbar
        query={draft.query}
        filter={running?.filter}
        attributes={attributes}
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
        {...(filterOn === undefined ? {} : { filterOn })}
        {...(focusRequest === undefined ? {} : { focusRequest })}
        {...(announced === undefined ? {} : { status: announced })}
      />
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
  const clashDialog = (
    <ViewChangedDialog
      sentence={clash}
      isReplacing={isSaving}
      onReplace={() => {
        save(true);
      }}
      onCancel={() => {
        setClash(undefined);
      }}
    />
  );

  if (boardOutcome !== undefined) {
    return (
      <>
        <BoardScreen
          slug={slug}
          object={object}
          attributes={attributes}
          members={members}
          outcome={boardOutcome}
          query={query}
          views={viewChoices}
          currentViewId={view?.id ?? ''}
          onViewChange={openView}
          layoutSwitch={layoutSwitch}
          toolbar={toolbarFor(undefined)}
        />
        {clashDialog}
      </>
    );
  }

  return (
    <>
      <RecordsScreen
        slug={slug}
        object={object}
        attributes={attributes}
        members={members}
        view={records}
        viewQuery={props.recordsQuery}
        query={query}
        onSort={(rule) => {
          draft.set(
            { ...(draft.query.filter === undefined ? {} : { filter: draft.query.filter }), sorts: [rule] },
            'push',
          );
        }}
        onFilter={(attributeId) => {
          // A relationship's filter needs record search, which arrives with relationships (spec 0014).
          if (attributes.find((attribute) => attribute.id === attributeId)?.type === 'record_reference') {
            toasts.toast({ tone: 'info', message: strings.referenceFilterSoon });
            return;
          }
          setFilterOn({ attributeId });
        }}
        views={viewChoices}
        currentViewId={view?.id ?? ''}
        onViewChange={openView}
        viewBarEnd={layoutSwitch}
        announce={(count) =>
          filtered
            ? strings.matching(
                count.atLeast ? `${count.count.toLocaleString()}+` : count.count.toLocaleString(),
                object.pluralName,
              )
            : undefined
        }
        toolbar={toolbarFor}
        {...(filtered
          ? {
              filteredEmpty: (
                <EmptyState
                  icon="list-filter"
                  title={strings.noMatchesTitle(object.pluralName)}
                  actions={
                    draft.isDraft ? (
                      <Button onPress={discard}>{strings.discard}</Button>
                    ) : (
                      <Button
                        onPress={() => {
                          setFilterOn({ attributeId: '' });
                        }}
                      >
                        {strings.editFilters}
                      </Button>
                    )
                  }
                >
                  {strings.noMatchesText}
                </EmptyState>
              ),
            }
          : {})}
      />
      {clashDialog}
    </>
  );
}
