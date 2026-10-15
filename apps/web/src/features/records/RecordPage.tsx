// Brief
// Purpose: everything about one record in one place: its details, and what happened to it.
// Main task: read and edit its details in place, and see who changed what and when, live.
// Leaves out: deleting and restoring it (#22), presence (#26), related records (milestone 3), notes (#19 milestone 3), comments (#29).
import type {
  ActivityFeed as ActivityFeedSource,
  AttributeDefinition,
  MemberSummary,
  ObjectSummary,
  RecordState,
  RecordSubscription,
  RecordView,
  TaskList,
  TrashedState,
} from '@crm/data';
import { useActivityStatus, useLiveStatus, useRecord, useTaskTotal, useTrashed } from '@crm/data/react';
import { ActivityFeed, Button, Callout, EmptyState, Link, RecordHeader, RecordLayout, TopBar } from '@crm/ui';
import { useNavigate, useParams, useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo, useRef, type ReactNode } from 'react';
import { tabCount } from '../tasks/entries.ts';
import { OpenTasksCard } from '../tasks/OpenTasksCard.tsx';
import { strings as taskStrings } from '../tasks/strings.ts';
import { TaskDialog } from '../tasks/TaskDialog.tsx';
import { TasksTab } from '../tasks/TasksTab.tsx';
import { objectHref } from '../workspace/objects.ts';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { isRecordTab, recordHref, recordName, type RecordTab } from './details.ts';
import { OverviewTab } from './OverviewTab.tsx';
import { RecordDetails } from './RecordDetails.tsx';
import { strings } from './strings.ts';
import { recordLinks } from './timeline.ts';

/** Props for the record page: what its route loaded through the data layer. */
export interface RecordPageProps {
  readonly slug: string;
  readonly tab: RecordTab;
  readonly object: ObjectSummary;
  /** The workspace's objects, so the records the timeline names link to their pages. */
  readonly objects: readonly ObjectSummary[];
  /** The attributes Details lists. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly recordId: string;
  /** The record, subscribed; undefined when the address names no record at all. */
  readonly record: RecordSubscription | undefined;
  readonly feed: ActivityFeedSource | undefined;
  readonly recent: ActivityFeedSource | undefined;
  /** The record's open tasks (spec 0019): the Tasks tab, its count, and Overview's block. */
  readonly open: TaskList | undefined;
  /** The person's member id: a new task is theirs. */
  readonly meId: string | undefined;
  /** `?task=`: the task dialog's task, or `new`. */
  readonly task?: string;
}

/** The page's tabs, in order. */
const TABS = [
  { id: 'overview', label: strings.overview, icon: 'layout-dashboard' as const },
  { id: 'activity', label: strings.activity, icon: 'activity' as const },
  { id: 'tasks', label: taskStrings.tasks, icon: 'list-checks' as const },
];

/** A feed with nothing in it yet, for the loading page before the record's timeline exists. */
const NO_ENTRIES = { count: 0, getItem: () => undefined, getKey: () => '' };

/** The top bar: the object's tile, and the crumbs "<Plural> › <title>" with the title as the page's h1. */
function recordTopBar(slug: string, object: ObjectSummary, title: string, end?: ReactNode, isLoading = false) {
  return (
    <TopBar
      title={title}
      icon={object.icon}
      hue={object.hue}
      crumbs={[{ id: object.id, label: object.pluralName, href: objectHref(slug, object) }]}
      isLoading={isLoading}
    >
      {end}
    </TopBar>
  );
}

/** The top bar naming the object alone, for a page with no record to name. */
const objectTopBar = (object: ObjectSummary) => (
  <TopBar title={object.pluralName} icon={object.icon} hue={object.hue} />
);

/** A record that doesn't exist and one the person may not see: one state, one string (AC-376). */
function unavailablePage(slug: string, object: ObjectSummary) {
  return {
    topBar: objectTopBar(object),
    body: (
      <EmptyState
        icon="search"
        title={strings.recordUnavailable}
        actions={<Link href={objectHref(slug, object)}>{strings.backTo(object.pluralName)}</Link>}
      >
        {strings.recordUnavailableText}
      </EmptyState>
    ),
  };
}

/** The record page while its route loads: the bars and the layout holding their places, on the tab asked for. */
export function RecordPendingPage() {
  const { tab = '' } = useParams({ strict: false });
  const shown = isRecordTab(tab) ? tab : 'overview';
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={strings.loading} isLoading />,
        body: (
          <LoadingLayout tab={shown}>
            <ActivityFeed label={strings.activity} entries={NO_ENTRIES} status="loading" />
          </LoadingLayout>
        ),
      }}
    />
  );
}

/** The layout with the header and details as skeletons, and the tab's own loading state as its panel. */
function LoadingLayout({
  tab,
  onTabChange,
  children,
}: {
  readonly tab: RecordTab;
  readonly onTabChange?: (id: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <RecordLayout
      header={<RecordHeader objectName="" isLoading />}
      tabs={TABS}
      tabsLabel={strings.tabs}
      selectedTab={tab}
      onTabChange={onTabChange ?? (() => undefined)}
      sidebarLabel={strings.details}
      sidebar={<RecordDetails attributes={[]} members={[]} record={undefined} />}
      isLoading
    >
      {children}
    </RecordLayout>
  );
}

/** The record page, or its unavailable state for an address that names no record. */
export function RecordPage(props: RecordPageProps) {
  const { record, feed, recent, open } = props;
  if (record === undefined || feed === undefined || recent === undefined || open === undefined) {
    return <WorkspacePage currentObject={props.object.apiSlug} page={unavailablePage(props.slug, props.object)} />;
  }
  return <SubscribedRecordPage {...props} record={record} feed={feed} recent={recent} open={open} />;
}

/** The trash lookup's state once the record's first read found it missing; undefined otherwise. */
function TrashedCheck({
  slug,
  recordId,
  children,
}: {
  readonly slug: string;
  readonly recordId: string;
  readonly children: (trashed: TrashedState) => ReactNode;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const trashed = useTrashed(data.records.trashed(slug, recordId));
  return children(trashed);
}

/** The page for a record id: every state of AC-376 from the record's subscription, its timeline and the trash. */
function SubscribedRecordPage(
  props: RecordPageProps & {
    readonly record: RecordSubscription;
    readonly feed: ActivityFeedSource;
    readonly recent: ActivityFeedSource;
    readonly open: TaskList;
  },
) {
  const state = useRecord(props.record);
  // Only where the timeline stands: its entries draw in their own tab, so the page doesn't render with each one.
  const timelineStatus = useActivityStatus(props.feed);
  if (state.status === 'deleted' && !state.isLost) {
    return (
      <TrashedCheck slug={props.slug} recordId={props.recordId}>
        {(trashed) => <RecordScreen {...props} state={state} timelineStatus={timelineStatus} trashed={trashed} />}
      </TrashedCheck>
    );
  }
  return <RecordScreen {...props} state={state} timelineStatus={timelineStatus} />;
}

/** The page itself, in whichever state the record, its timeline and the trash put it. */
function RecordScreen({
  slug,
  tab,
  object,
  objects,
  attributes,
  members,
  recordId,
  record,
  feed,
  recent,
  open,
  meId,
  task,
  state,
  timelineStatus,
  trashed,
}: RecordPageProps & {
  readonly record: RecordSubscription;
  readonly feed: ActivityFeedSource;
  readonly recent: ActivityFeedSource;
  readonly open: TaskList;
  readonly state: RecordState;
  readonly timelineStatus: ReturnType<typeof useActivityStatus>;
  readonly trashed?: TrashedState;
}) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const live = useLiveStatus(data.live);
  const unnamed = strings.unnamed(object.singularName);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const router = useRouter();
  const openTotal = useTaskTotal(open);
  // Whether the task dialog was opened from this page, so closing it steps Back rather than adding a step.
  const openedHere = useRef(false);
  const openTask = (taskId: string) => {
    openedHere.current = true;
    // Opening pushes its param, so Back closes it.
    void navigate({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug, object: object.apiSlug, recordId, tab },
      search: { task: taskId },
    });
  };
  const closeTask = () => {
    if (openedHere.current) {
      openedHere.current = false;
      router.history.back();
      return;
    }
    void navigate({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug, object: object.apiSlug, recordId, tab },
      search: {},
      replace: true,
    });
  };
  const taskHref = (taskId: string) => `${recordHref(slug, object.apiSlug, recordId, tab)}?task=${taskId}`;
  const chipHref = (display: { readonly objectId: string; readonly recordId: string }) =>
    link(display.objectId, display.recordId);
  const tabs = TABS.map((each) => (each.id === 'tasks' ? { ...each, ...tabCount(openTotal) } : each));

  const openTab = (next: string) => {
    if (next === tab) return;
    // Switching tabs replaces the address, so Back leaves the record rather than stepping through its tabs.
    void navigate({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug, object: object.apiSlug, recordId, tab: next },
      replace: true,
    });
  };
  // The page's own record as a task links it: its chip in the lists, and a new task's first link.
  const pageRecord = (() => {
    const shownRecord = state.status === 'ready' || state.status === 'deleted' ? state.record : undefined;
    return shownRecord === undefined
      ? undefined
      : { ...shownRecord.display, name: recordName(shownRecord, object, strings.unnamed(object.singularName)) };
  })();
  const canAddTasks = object.access === 'write' && trashed?.status !== 'trashed' && state.status === 'ready';
  let tabContent: ReactNode;
  if (tab === 'activity') {
    tabContent = <ActivityTab feed={feed} link={link} taskHref={taskHref} />;
  } else if (tab === 'tasks' && pageRecord !== undefined) {
    tabContent = (
      <TasksTab
        slug={slug}
        record={pageRecord}
        open={open}
        members={members}
        meId={meId}
        canAdd={canAddTasks}
        recordHref={chipHref}
        onOpenTask={openTask}
      />
    );
  } else if (tab === 'tasks') {
    tabContent = <ActivityFeed label={taskStrings.tasks} entries={NO_ENTRIES} status="loading" />;
  } else {
    tabContent = (
      <>
        {pageRecord !== undefined && (
          <OpenTasksCard
            slug={slug}
            record={pageRecord}
            open={open}
            members={members}
            canAdd={canAddTasks}
            recordHref={chipHref}
            onOpenTask={openTask}
            onViewAll={() => {
              openTab('tasks');
            }}
          />
        )}
        <OverviewTab
          recent={recent}
          link={link}
          taskHref={taskHref}
          onViewAll={() => {
            openTab('activity');
          }}
        />
      </>
    );
  }
  const dialog =
    task === undefined ? undefined : (
      <TaskDialog
        slug={slug}
        task={task}
        {...(pageRecord === undefined || !canAddTasks ? {} : { pageRecord })}
        startObjectId={object.id}
        objects={objects}
        members={members}
        meId={meId}
        onClose={closeTask}
      />
    );

  // Missing or hidden (one state), whether the trash lookup or the timeline said so first.
  const isUnavailable =
    trashed?.status === 'unavailable' || (state.status === 'loading' && timelineStatus === 'unavailable');
  if (isUnavailable) return <WorkspacePage currentObject={object.apiSlug} page={unavailablePage(slug, object)} />;

  if (state.status === 'error' || trashed?.status === 'failed') {
    const failure = state.status === 'error' ? state.error : trashed?.status === 'failed' ? trashed.error : undefined;
    const retry = () => {
      if (state.status === 'error') record.retry();
      else data.records.trashed(slug, recordId).retry();
    };
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar: objectTopBar(object),
          body: (
            <EmptyState tone="error" title={strings.loadFailed} onRetry={retry}>
              {failure?.message ?? strings.loadFailedText}
            </EmptyState>
          ),
        }}
      />
    );
  }

  const isTrashed = trashed?.status === 'trashed';
  const shown: RecordView | undefined = isTrashed
    ? trashed.record
    : state.status === 'deleted' && !state.isLost
      ? undefined
      : state.record;
  // In the same top bar as the loaded page, so focus on its title stays when the record arrives.
  const paused =
    live === 'paused' ? (
      <Callout placement="bar" isAnnounced>
        {workspaceStrings.livePaused}
      </Callout>
    ) : undefined;
  if (shown === undefined) {
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar: recordTopBar(slug, object, strings.loading, undefined, true),
          body: (
            <LoadingLayout tab={tab} onTabChange={openTab}>
              {tabContent}
            </LoadingLayout>
          ),
        }}
      />
    );
  }

  const isLost = state.status === 'deleted' && state.isLost;
  const canEdit = !isTrashed && !isLost && object.access === 'write';
  const name = recordName(shown, object, unnamed);
  const display = { ...shown.display, name };

  const copyLink = () => {
    const href = new URL(recordHref(slug, object.apiSlug, recordId, tab), window.location.origin).href;
    navigator.clipboard.writeText(href).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };

  let notice: ReactNode;
  if (isTrashed) {
    notice = (
      <Callout tone="danger" placement="banner">
        {strings.wasDeleted(object.singularName)}
      </Callout>
    );
  } else if (isLost) {
    notice = (
      <Callout tone="danger" placement="banner">
        {strings.noLongerAvailable(object.singularName)}
      </Callout>
    );
  }

  return (
    <>
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar: recordTopBar(slug, object, name, paused),
          body: (
            <RecordLayout
              header={
                <RecordHeader record={display} objectName={object.singularName}>
                  <Button variant="ghost" icon="link" onPress={copyLink}>
                    {strings.copyLink}
                  </Button>
                </RecordHeader>
              }
              tabs={tabs}
              tabsLabel={strings.tabs}
              selectedTab={tab}
              onTabChange={openTab}
              sidebarLabel={strings.details}
              {...(notice === undefined ? {} : { notice })}
              sidebar={
                <RecordDetails
                  attributes={attributes}
                  members={members}
                  record={shown}
                  cellErrors={state.cellErrors}
                  referenceDisplays={state.referenceDisplays}
                  {...(canEdit
                    ? {
                        onCommit: (attributeId: string, value: unknown) => {
                          data.records.setValue(slug, { rowId: recordId, columnId: attributeId, value });
                        },
                      }
                    : {})}
                />
              }
            >
              {tabContent}
            </RecordLayout>
          ),
        }}
      />
      {dialog}
    </>
  );
}
