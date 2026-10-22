// Brief
// Purpose: everything about one record in one place: its details, and what happened to it.
// Main task: read and edit its details in place, and see who changed what and when, live.
// Leaves out: deleting and restoring it (#22), presence (#26), related records (milestone 3).
import type {
  ActivityFeed as ActivityFeedSource,
  AttributeDefinition,
  MemberSummary,
  NoteList as NoteListSource,
  ObjectSummary,
  RecordComments,
  RecordState,
  RecordSubscription,
  RecordView,
  TaskList as TaskListSource,
  TrashedState,
} from '@crm/data';
import { toFieldAttribute } from '@crm/data';
import {
  useActivityStatus,
  useLatestActivityAt,
  useRecordFacts,
  useCommentCount,
  useLiveStatus,
  useNoteTotal,
  useRecord,
  useTaskTotal,
  useTrashed,
} from '@crm/data/react';
import {
  ActivityFeed,
  Button,
  Callout,
  Card,
  EmptyState,
  Link,
  RecordHeader,
  NoteList,
  RecordLayout,
  TaskList,
  TopBar,
  AttributeDisplay,
  type RecordStat,
} from '@crm/ui';
import { useNavigate, useParams, useRouteContext, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CommentsTab, LoadingThreads } from '../comments/CommentsTab.tsx';
import { strings as commentStrings } from '../comments/strings.ts';
import { NotesTab } from '../notes/NotesTab.tsx';
import { strings as noteStrings } from '../notes/strings.ts';
import { NoteWindow } from '../notes/NoteWindow.tsx';
import { tabCount } from '../tasks/entries.ts';
import { OpenTasksCard } from '../tasks/OpenTasksCard.tsx';
import { strings as taskStrings } from '../tasks/strings.ts';
import { TaskDialog } from '../tasks/TaskDialog.tsx';
import { TasksTab } from '../tasks/TasksTab.tsx';
import { FavouriteButton } from '../workspace/FavouriteButton.tsx';
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
  readonly open: TaskListSource | undefined;
  /** The person's member id: a new task is theirs. */
  readonly meId: string | undefined;
  /** `?task=`: the task dialog's task, or `new`. */
  readonly task?: string;
  /** The record's notes (spec 0019): the Notes tab and its count. */
  readonly notes: NoteListSource | undefined;
  /** `?note=`: the note window's note, or `new`. */
  readonly note?: string;
  /** The record's comment threads (spec 0038): the Comments tab and its count. */
  readonly comments: RecordComments | undefined;
  /** `?thread=`: the thread a link to a comment names (AC-1161). */
  readonly thread?: string;
}

/** The page's tabs, in order. */
const TABS = [
  { id: 'overview', label: strings.overview, icon: 'layout-dashboard' as const },
  { id: 'activity', label: strings.activity, icon: 'activity' as const },
  { id: 'notes', label: noteStrings.notes, icon: 'notebook' as const },
  { id: 'tasks', label: taskStrings.tasks, icon: 'list-checks' as const },
  { id: 'comments', label: commentStrings.comments, icon: 'message-square' as const },
];

/** A task list with nothing in it yet, for the Tasks tab before the record arrives. */
const NO_TASKS = { count: 0, getItem: () => undefined, getKey: (task: { readonly id: string }) => task.id };

/** A feed with nothing in it yet, for the loading page before the record's timeline exists. */
const NO_ENTRIES = { count: 0, getItem: () => undefined, getKey: () => '' };

/** No notes yet, while the route loads. */
const NO_NOTES = { count: 0, getItem: () => undefined, getKey: (note: { readonly id: string }) => note.id };

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
  const { tab = '', object } = useParams({ strict: false });
  const shown = isRecordTab(tab) ? tab : 'overview';
  return (
    <WorkspacePage
      {...(object === undefined ? {} : { currentObject: object })}
      page={{
        topBar: <TopBar title={strings.loading} isLoading />,
        body: (
          <LoadingLayout tab={shown}>
            <PendingTab tab={shown} />
          </LoadingLayout>
        ),
      }}
    />
  );
}

/** A tab while the route loads, in that tab's own shape: Overview's two cards, the feed, the notes, the task list. */
function PendingTab({ tab }: { readonly tab: RecordTab }) {
  if (tab === 'activity') return <ActivityFeed label={strings.activity} entries={NO_ENTRIES} status="loading" />;
  const tasks = <TaskList label={taskStrings.openTasks} tasks={NO_TASKS} status="loading" onToggle={() => undefined} />;
  if (tab === 'tasks') return tasks;
  if (tab === 'comments') return <LoadingThreads />;
  if (tab === 'notes') {
    return (
      <NoteList
        label={noteStrings.listLabel}
        notes={NO_NOTES}
        status="loading"
        onAction={() => undefined}
        toolbar={
          <Button variant="primary" isDisabled>
            {noteStrings.newNote}
          </Button>
        }
      />
    );
  }
  return (
    <>
      <Card
        title={taskStrings.openTasks}
        isBusy
        actions={
          <Button variant="ghost" isDisabled>
            {taskStrings.viewAllTasks}
          </Button>
        }
      >
        {tasks}
      </Card>
      <Card
        title={strings.recentActivity}
        isBusy
        actions={
          <Button variant="ghost" isDisabled>
            {strings.viewAll}
          </Button>
        }
      >
        <ActivityFeed label={strings.recentActivity} entries={NO_ENTRIES} status="loading" />
      </Card>
    </>
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
      // The loaded header always has its stat strip (the next meeting at least): its row is kept while loading.
      header={
        <RecordHeader
          objectName=""
          isLoading
          stats={[{ id: 'meeting', label: strings.nextMeeting, icon: 'calendar', isLoading: true }]}
        />
      }
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
  const { record, feed, recent, open, notes, comments } = props;
  if (
    record === undefined ||
    feed === undefined ||
    recent === undefined ||
    open === undefined ||
    notes === undefined ||
    comments === undefined
  ) {
    return <WorkspacePage currentObject={props.object.apiSlug} page={unavailablePage(props.slug, props.object)} />;
  }
  return (
    <SubscribedRecordPage
      {...props}
      record={record}
      feed={feed}
      recent={recent}
      open={open}
      notes={notes}
      comments={comments}
    />
  );
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
    readonly open: TaskListSource;
    readonly notes: NoteListSource;
    readonly comments: RecordComments;
  },
) {
  const state = useRecord(props.record);
  // Shown: the person's recent items in the command menu keep it (spec 0039, AC-1088); fire and forget, throttled there.
  const { data } = useRouteContext({ from: '__root__' });
  const isShown = state.status === 'ready';
  const { slug, recordId } = props;
  useEffect(() => {
    if (isShown) data.search.visit(slug, 'record', recordId);
  }, [data, slug, recordId, isShown]);
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
  notes,
  comments,
  meId,
  task,
  note,
  thread,
  state,
  timelineStatus,
  trashed,
}: RecordPageProps & {
  readonly record: RecordSubscription;
  readonly feed: ActivityFeedSource;
  readonly recent: ActivityFeedSource;
  readonly open: TaskListSource;
  readonly notes: NoteListSource;
  readonly comments: RecordComments;
  readonly state: RecordState;
  readonly timelineStatus: ReturnType<typeof useActivityStatus>;
  readonly trashed?: TrashedState;
}) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const live = useLiveStatus(data.live);
  const unnamed = strings.unnamed(object.singularName);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  // Add as person on a meeting (spec 0024, AC-609): one function while the page stays, so timeline entries keep
  // their memo. The data layer says why in a toast when it is refused; the meetings event updates the timeline.
  const addPerson = useCallback(
    async (meetingId: string, attendee: { readonly email: string; readonly name?: string }) => {
      const added = await data.calendar.addAttendee(slug, { recordId, meetingId, email: attendee.email });
      if (added !== undefined) {
        toasts.toast({ tone: 'success', message: strings.addedPerson(attendee.name ?? attendee.email) });
      }
    },
    [data, slug, recordId, toasts],
  );
  const router = useRouter();
  const openTotal = useTaskTotal(open);
  const notesTotal = useNoteTotal(notes);
  const commentCount = useCommentCount(comments);
  const latestAt = useLatestActivityAt(recent);
  const recentStatus = useActivityStatus(recent);
  // The stat strip says what the tabs don't (owner's call, 22 Oct): the last activity, the next meeting, and on a
  // record with a stage (a deal) its value and how long it has been in that stage. The tabs keep their own counts.
  const stageAttribute = useMemo(
    () =>
      attributes
        .filter((each) => each.type === 'status' && !each.isArchived)
        .sort((a, b) => a.position - b.position)[0],
    [attributes],
  );
  const valueAttribute = useMemo(
    () => attributes.find((each) => each.apiSlug === 'value' && each.type === 'currency' && !each.isArchived),
    [attributes],
  );
  // A stage change reads the facts afresh: the age restarts.
  const stageNow = stageAttribute === undefined ? undefined : state.record?.values[stageAttribute.id];
  const stageKey = typeof stageNow === 'string' ? stageNow : undefined;
  const facts = useMemo(
    () => data.records.facts(slug, recordId, stageAttribute?.id, stageKey),
    [data, slug, recordId, stageAttribute?.id, stageKey],
  );
  const factState = useRecordFacts(facts);
  // Whether the task dialog was opened from this page, so closing it steps Back rather than adding a step.
  const openedHere = useRef(false);
  // A `?task=` that arrived while the page was open (a timeline entry's link, or `openTask`) was pushed: closing
  // steps Back. One the page opened with (a link from elsewhere) is replaced.
  const taskBefore = useRef(task);
  useEffect(() => {
    if (taskBefore.current === undefined && task !== undefined) openedHere.current = true;
    taskBefore.current = task;
  }, [task]);
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
  // Kept while the page's address stays, so the timeline's links and the task rows don't draw again with each render.
  const taskHref = useCallback(
    (itemId: string, kind: 'task' | 'note' = 'task') =>
      `${recordHref(slug, object.apiSlug, recordId, tab)}?${kind}=${itemId}`,
    [slug, object.apiSlug, recordId, tab],
  );
  // The note window (spec 0019), opened and closed as the task dialog is: pushed, so Back closes it.
  const noteOpenedHere = useRef(false);
  const openNote = (noteId: string) => {
    noteOpenedHere.current = true;
    void navigate({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug, object: object.apiSlug, recordId, tab },
      search: { note: noteId },
    });
  };
  const closeNote = () => {
    if (noteOpenedHere.current) {
      noteOpenedHere.current = false;
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
  // A new note's first save stored it: the address names it in place of `new`.
  const noteStored = useCallback(
    (noteId: string) => {
      void navigate({
        to: '/w/$slug/objects/$object/$recordId/$tab',
        params: { slug, object: object.apiSlug, recordId, tab },
        search: { note: noteId },
        replace: true,
      });
    },
    [navigate, slug, object.apiSlug, recordId, tab],
  );
  // The failed save's toast ("Open note") opens the window on that note again, from wherever the person is.
  useEffect(() => {
    void data.notes.setOpener((workspace, noteObjectId, noteRecordId, noteId) => {
      // The note's own object, which may not be the one whose page is open now.
      const objectSlug = objects.find((each) => each.id === noteObjectId)?.apiSlug;
      if (objectSlug === undefined) return;
      void navigate({ href: `${recordHref(workspace, objectSlug, noteRecordId, 'notes')}?note=${noteId}` });
    });
  }, [data, navigate, objects]);
  const chipHref = useCallback(
    (display: { readonly objectId: string; readonly recordId: string }) => link(display.objectId, display.recordId),
    [link],
  );
  const tabs = TABS.map((each) =>
    each.id === 'tasks'
      ? { ...each, ...tabCount(openTotal) }
      : each.id === 'notes'
        ? { ...each, ...tabCount(notesTotal) }
        : each.id === 'comments'
          ? { ...each, ...tabCount(commentCount === undefined ? undefined : { count: commentCount, atLeast: false }) }
          : each,
  );

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
    tabContent = <ActivityTab feed={feed} link={link} taskHref={taskHref} onAddPerson={addPerson} />;
  } else if (tab === 'comments') {
    tabContent = (
      <CommentsTab
        slug={slug}
        recordId={recordId}
        comments={comments}
        members={members}
        meId={meId}
        isReadOnly={trashed?.status === 'trashed' || (state.status === 'deleted' && state.isLost)}
        {...(thread === undefined ? {} : { thread })}
      />
    );
  } else if (tab === 'notes') {
    tabContent = <NotesTab list={notes} members={members} canAdd={canAddTasks} onOpenNote={openNote} />;
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
    tabContent = (
      <TaskList label={taskStrings.openTasks} tasks={NO_TASKS} status="loading" onToggle={() => undefined} />
    );
  } else {
    tabContent = (
      <>
        {/* From the start, loading in place, so Recent activity never jumps down when the record arrives. */}
        <OpenTasksCard
          slug={slug}
          recordId={recordId}
          open={open}
          members={members}
          canAdd={canAddTasks}
          recordHref={chipHref}
          onOpenTask={openTask}
          onViewAll={() => {
            openTab('tasks');
          }}
        />
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
        {...(tab === 'tasks' ? { listLabel: taskStrings.openTasks } : {})}
      />
    );

  const pageHref = pageRecord === undefined ? undefined : chipHref(pageRecord);
  const noteWindow =
    note === undefined || pageRecord === undefined ? undefined : (
      <NoteWindow
        slug={slug}
        note={note}
        record={pageRecord}
        {...(pageHref === undefined ? {} : { recordHref: pageHref })}
        members={members}
        canChange={canAddTasks}
        onStored={noteStored}
        onClose={closeNote}
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
  const isFactsLoading = factState.status === 'loading';
  const stageOption =
    stageAttribute === undefined
      ? undefined
      : stageAttribute.options?.find((option) => option.id === shown.values[stageAttribute.id]);
  const stats: readonly RecordStat[] = [
    ...(valueAttribute === undefined
      ? []
      : [
          {
            id: 'value',
            label: valueAttribute.title,
            icon: 'banknote' as const,
            ...(shown.values[valueAttribute.id] === undefined || shown.values[valueAttribute.id] === null
              ? {}
              : {
                  value: (
                    <AttributeDisplay
                      attribute={toFieldAttribute(valueAttribute)}
                      value={shown.values[valueAttribute.id] as never}
                      surface="panel"
                    />
                  ),
                }),
          },
        ]),
    ...(stageAttribute === undefined || stageOption === undefined
      ? []
      : [
          {
            id: 'stage',
            label: strings.enteredStage(stageOption.label),
            icon: 'circle-dot' as const,
            isLoading: isFactsLoading,
            ...(factState.stageSince === undefined ? {} : { time: factState.stageSince }),
          },
        ]),
    {
      id: 'meeting',
      label: strings.nextMeeting,
      icon: 'calendar' as const,
      isLoading: isFactsLoading,
      ...(factState.nextMeeting === undefined ? {} : { time: factState.nextMeeting.startsAt }),
    },
    {
      id: 'activity',
      label: strings.lastActivity,
      icon: 'activity' as const,
      ...(recentStatus === 'loading' ? { isLoading: true } : latestAt === undefined ? {} : { time: latestAt }),
      onPress: () => {
        openTab('activity');
      },
    },
  ];

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
                <RecordHeader record={display} objectName={object.singularName} stats={stats}>
                  <FavouriteButton data={data} slug={slug} kind="record" id={recordId} />
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
      {noteWindow}
    </>
  );
}
