// Brief
// Purpose: slice one object the way you work and keep it (spec 0020).
// Main task: filter and sort the table, lay out its columns, then save it, or keep it as a view of its own.
// Leaves out: grouping inside the table, view search, charts, and sharing outside the workspace.
import {
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
import { Button, Callout, EmptyState, Popover, ViewSettings, type ViewChoice } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RecordsScreen } from '../workspace/RecordsScreen.tsx';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { CreateViewDialog } from './CreateViewDialog.tsx';
import { copyName, layoutOf, startingConfig, viewColumns, withColumn, type ShownLayout } from './layout.ts';
import { farAttributesFrom, relationTarget, runningQuery, savableQuery, savedQuery, toViewQuery } from './query.ts';
import { strings } from './strings.ts';
import { useViewDraft } from './useViewDraft.ts';
import { ViewChangedDialog } from './ViewChangedDialog.tsx';
import { memberName, ViewMenu } from './ViewMenu.tsx';
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
    if (openedId !== undefined) data.views.markOpened(slug, openedId);
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
  // A locked view the person may not change (AC-476): their filters, sorts and columns stay in this tab, unsaved.
  const isLockedForMe = view !== undefined && view.visibility === 'workspace' && view.isLocked && !canManage;
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

  // The view's columns (AC-470): a change shows at once and saves for everyone on the view, or stays in this tab on
  // a locked view. Leaving the view drops what stayed here.
  const layout = useMemo(() => viewColumns(view, object, attributes), [view, object, attributes]);
  const changeLayout = (next: ShownLayout) => {
    if (view === undefined) return;
    data.views.setLayout(slug, view.id, layoutOf(next.columns, next.pinnedCount), { isLocal: isLockedForMe });
  };
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
              attribute: toFieldAttribute(definition),
              isShown: !column.isHidden,
              ...(definition.id === object.primaryAttributeId ? { isLocked: true } : {}),
            },
          ];
    });
  }, [layout, attributes, object.primaryAttributeId]);

  // Create view, and Save as new view (the Save menu, the clash dialog, a locked view's only Save).
  const [createMode, setCreateMode] = useState<'create' | 'save-as' | undefined>(undefined);
  const openView = (next: View, message: string) => {
    toasts.toast({ tone: 'success', message });
    void navigate({
      to: '/w/$slug/objects/$object/views/$viewId',
      params: { slug, object: object.apiSlug, viewId: next.id },
    });
  };
  const duplicate = () => {
    if (view === undefined) return;
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
          openView(made, strings.duplicated(made.name));
        },
        (error: unknown) => {
          toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.actionFailed });
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
  const filtered = running?.filter !== undefined;
  // The switcher (AC-473): the default, the other shared views, then a Private section; locked ones marked.
  const choices: readonly ViewChoice[] = (list.views.length > 0 ? list.views : view === undefined ? [] : [view]).map(
    (each) => ({
      id: each.id,
      name: each.name,
      ...(each.visibility === 'workspace' && each.isLocked ? { isLocked: true } : {}),
      ...(each.visibility === 'private' ? { section: strings.privateSection } : {}),
    }),
  );

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
        views={choices}
        onCreateView={() => {
          setCreateMode('create');
        }}
        layout={layout}
        onLayoutChange={changeLayout}
        onAttributeCreated={(attributeId) => {
          // A view that lists its columns shows the new one at its end; a seeded default shows it already.
          if (view !== undefined && (view.config.columns.length > 0 || !view.config.showNewAttributes)) {
            changeLayout(withColumn(layout, attributeId));
          }
        }}
        viewActions={
          view === undefined ? undefined : (
            <>
              {view.visibility === 'workspace' && view.isLocked && (
                <Callout placement="bar">
                  {isLockedForMe
                    ? strings.lockedUnsaved(memberName(members, view.lockedBy))
                    : strings.lockedBy(memberName(members, view.lockedBy))}
                </Callout>
              )}
              <Button
                ref={settingsAnchor}
                variant="ghost"
                icon="settings"
                onPress={() => {
                  setSettingsOpen(true);
                }}
              >
                {strings.viewSettings}
              </Button>
              <ViewMenu
                slug={slug}
                object={object}
                view={view}
                list={list}
                members={members}
                memberId={access?.memberId}
                canManage={canManage}
                copyLinkReason={draft.isDraft && !draft.isLinkable ? strings.linkTooLong : undefined}
                onDuplicate={duplicate}
                onDeleted={(name) => {
                  leaving.current = true;
                  toasts.toast({ tone: 'success', message: strings.deleted(name) });
                  void navigate({
                    to: '/w/$slug/objects/$object',
                    params: { slug, object: object.apiSlug },
                    replace: true,
                  });
                }}
              />
            </>
          )
        }
        currentViewId={view?.id ?? ''}
        onViewChange={(viewId) => {
          void navigate({
            to: '/w/$slug/objects/$object/views/$viewId',
            params: { slug, object: object.apiSlug, viewId },
          });
        }}
        announce={(count) =>
          filtered
            ? strings.matching(
                count.atLeast ? `${count.count.toLocaleString()}+` : count.count.toLocaleString(),
                object.pluralName,
              )
            : undefined
        }
        toolbar={(announced) => (
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
              onSaveAsNew={() => {
                setCreateMode('save-as');
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
            {view?.kind === 'board' && (
              <Callout tone="info" placement="banner">
                {strings.boardSoon}
              </Callout>
            )}
          </>
        )}
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
        configFor={(fromThisView) =>
          startingConfig(
            fromThisView && running !== undefined ? { layout, query: savableQuery(draft.query, running) } : undefined,
            object,
            attributes,
          )
        }
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
          label={strings.columns}
          fields={fields}
          onChange={(next) => {
            const widths = new Map(layout.columns.map((column) => [column.id, column.width]));
            changeLayout({
              columns: next.map((field) => {
                const width = widths.get(field.attribute.id);
                return {
                  id: field.attribute.id,
                  isHidden: !field.isShown && field.isLocked !== true,
                  ...(width === undefined ? {} : { width }),
                };
              }),
              pinnedCount: layout.pinnedCount,
            });
          }}
        />
      </Popover>
    </>
  );
}
