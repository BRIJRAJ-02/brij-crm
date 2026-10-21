// Brief
// Purpose: the workspace's landing page (spec 0041), timefix's dashboard in our design system: what needs me now.
// Main task: see today's meetings, tick a task due, or take the next setup step.
// Leaves out: the assistant, Team today, the metrics band and the open hours line (no data yet), and any card with nothing in it.
import type {
  BookingsCalendarState,
  CaptureListView,
  InvitationView,
  MemberSummary,
  ObjectSummary,
  Permission,
  TaskList as TaskListSource,
  TaskListState,
} from '@crm/data';
import { useBookingsCalendar, useCalendar, useCaptureList, useTaskList } from '@crm/data/react';
import {
  BookingList,
  Button,
  Card,
  EmptyState,
  LinkList,
  PageColumn,
  Skeleton,
  TaskList,
  TileGrid,
  TopBar,
  type BookingListGroup,
  type LinkRow,
  type ListSource,
  type TaskEntry,
} from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { providerOf } from '../bookings/provider.ts';
import { useNow } from '../bookings/useNow.ts';
import { recordLinks } from '../records/timeline.ts';
import { useToday } from '../tasks/day.ts';
import { useTaskEntries } from '../tasks/useTaskEntries.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { agendaOf, dayRange, minutesOf, splitAgenda, type AgendaItem } from './agenda.ts';
import { nextStep, setupSteps, type SetupFacts, type SetupStepId } from './setup.ts';
import { strings } from './strings.ts';

/** How many open tasks Tasks due draws, as timefix's card does. */
export const TASKS_SHOWN = 5;

/** Props for Home, from the route's loader. */
export interface HomeScreenProps {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
  readonly permissions: readonly Permission[];
  /** My open tasks assigned to me: the list My tasks holds; undefined when it couldn't be opened. */
  readonly tasks: TaskListSource | undefined;
  /** Open invitations, read only for a member who may invite. */
  readonly invitations: readonly InvitationView[] | undefined;
}

/** The browser's time zone, the one My tasks and Bookings draw days in. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The browser's language, the one Bookings formats times in. */
const locale = () => navigator.languages[0] ?? 'en-GB';

/** A task list that never loads: the shape Tasks due holds when My tasks couldn't be opened. */
const NO_TASKS: TaskListState = {
  status: 'error',
  source: { count: 0, getItem: () => undefined, getKey: (task) => task.id, onRangeChange: () => undefined },
  newIds: new Set(),
  hasMore: false,
  loadingMore: false,
  loaded: 0,
};

/** Home: Finish setting up, then Today and Tasks due side by side. */
export function HomeScreen({ slug, objects, members, meId, permissions, tasks, invitations }: HomeScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const timeZone = useMemo(() => browserZone(), []);
  const today = useToday(timeZone);
  const range = useMemo(() => dayRange(today), [today]);
  const day = useBookingsCalendar(
    useMemo(() => data.bookings.calendar(slug, range.from, range.to), [data, slug, range]),
  );
  const taskState = useTasks(tasks);
  const setup = useSetupFacts(slug, meId, permissions, members, invitations);

  const steps = setupSteps(setup.facts);
  const agenda = useMemo(() => (day.status === 'ready' ? agendaOf(day, meId) : []), [day, meId]);
  // What each section shows: decided once here, for the cards and for the page's quiet state alike.
  const showsSetup = !setup.isLoading && nextStep(steps) !== undefined;
  const showsToday = day.status !== 'ready' || agenda.length > 0;
  const showsTasks =
    taskState.status !== 'unavailable' && !(taskState.status === 'ready' && taskState.source.count === 0);
  const isQuiet = !setup.isLoading && !showsSetup && !showsToday && !showsTasks;

  return (
    <WorkspacePage
      currentPage="home"
      page={{
        topBar: <TopBar title={strings.home} icon="house" />,
        body: isQuiet ? (
          <PageColumn align="center">
            <EmptyState icon="house" title={strings.quietTitle}>
              {strings.quietText}
            </EmptyState>
          </PageColumn>
        ) : (
          <PageColumn>
            {showsSetup && <SetupCard slug={slug} facts={setup.facts} />}
            <TileGrid>
              {showsToday && <TodayCard slug={slug} objects={objects} today={today} state={day} agenda={agenda} />}
              {showsTasks && (
                <TasksDueCard
                  slug={slug}
                  objects={objects}
                  members={members}
                  {...(tasks === undefined ? {} : { list: tasks })}
                  state={taskState}
                />
              )}
            </TileGrid>
          </PageColumn>
        ),
      }}
    />
  );
}

/** A task list that is never read, failed: what Tasks due holds when My tasks couldn't be opened. */
const FAILED_TASKS: TaskListSource = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_TASKS,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  retry: () => undefined,
  more: () => Promise.resolve(),
};

/** My open tasks' state, or a failed one when the list couldn't be opened (the card's Try again loads Home again). */
function useTasks(tasks: TaskListSource | undefined): TaskListState {
  return useTaskList(tasks ?? FAILED_TASKS);
}

/** The setup steps' facts, and whether any of them is still loading. */
interface SetupRead {
  readonly facts: SetupFacts;
  readonly isLoading: boolean;
}

/** An empty list that is never read: a step the member may not take holds this, so nothing is fetched for it. */
function idleList<Item>(): CaptureListView<Item> {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => IDLE,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

/** The idle list's one snapshot (immutable), so React sees the same state every time it asks. */
const IDLE = { status: 'ready', items: [], pendingIds: new Set<string>() } as const;

/** What the setup steps are read from, each only for a member who may take that step. */
function useSetupFacts(
  slug: string,
  meId: string | undefined,
  permissions: readonly Permission[],
  members: readonly MemberSummary[],
  invitations: readonly InvitationView[] | undefined,
): SetupRead {
  const { data } = useRouteContext({ from: '__root__' });
  const mayPages = permissions.includes('booking.manage');
  const mayForms = permissions.includes('forms.manage');
  const calendar = useCalendar(useMemo(() => data.calendar.view(slug), [data, slug]));
  const pages = useCaptureList(
    useMemo(() => (mayPages ? data.bookingPages.view(slug) : idleList<never>()), [data, slug, mayPages]),
  );
  const forms = useCaptureList(
    useMemo(() => (mayForms ? data.forms.view(slug) : idleList<never>()), [data, slug, mayForms]),
  );
  return {
    isLoading: calendar.status === 'loading' || pages.status === 'loading' || forms.status === 'loading',
    facts: {
      ...(calendar.status === 'ready' && calendar.enabled
        ? { calendars: calendar.connections.map((connection) => connection.accountEmail) }
        : {}),
      ...(mayPages && pages.status === 'ready'
        ? { bookingPages: pages.items.filter((page) => page.ownerMemberId === meId).length }
        : {}),
      ...(mayForms && forms.status === 'ready' ? { forms: forms.items.length } : {}),
      ...(permissions.includes('members.invite') && invitations !== undefined
        ? { team: { members: members.length, invited: invitations.filter((each) => !each.isExpired).length } }
        : {}),
    },
  };
}

/** A card's first read failed: its words and Try again, the rest of Home untouched. */
function Failed({
  title,
  message,
  onRetry,
}: {
  readonly title: string;
  readonly message?: string;
  readonly onRetry: () => void;
}) {
  return (
    <EmptyState tone="error" title={title} onRetry={onRetry}>
      {message ?? strings.failedText}
    </EmptyState>
  );
}

/** Finish setting up: the steps left, the next one's button, each row opening where the step is done. */
function SetupCard({ slug, facts }: { readonly slug: string; readonly facts: SetupFacts }) {
  const navigate = useNavigate();
  const steps = setupSteps(facts);
  const next = nextStep(steps);
  const left = steps.filter((step) => !step.done).length;
  const open = (id: SetupStepId) => {
    switch (id) {
      case 'calendar':
        void navigate({ to: '/w/$slug/settings/account/calendars', params: { slug } });
        return;
      case 'bookingPage':
        void navigate({ to: '/w/$slug/captures/links', params: { slug } });
        return;
      case 'form':
        void navigate({ to: '/w/$slug/captures/forms', params: { slug } });
        return;
      case 'invite':
        void navigate({ to: '/w/$slug/settings/members', params: { slug } });
    }
  };
  const rows: LinkRow[] = steps.map((step) => ({
    id: step.id,
    title: strings.steps[step.id].title,
    address: valueOf(step.id, facts),
    chips: [],
    href: hrefOf(slug, step.id),
    ...(step.done ? { isOff: true, badge: strings.done } : {}),
    ...(step.id === next
      ? {
          actions: (
            <Button
              variant="primary"
              onPress={() => {
                open(step.id);
              }}
            >
              {strings.steps[step.id].action}
            </Button>
          ),
        }
      : {}),
  }));
  return (
    <Card title={strings.setupTitle} description={strings.setupLeft(left)}>
      <LinkList
        density="compact"
        placement="card"
        isToolbarHidden
        label={strings.setupTitle}
        searchLabel={strings.setupTitle}
        rows={rows}
        onOpen={(id) => {
          const step = steps.find((each) => each.id === id);
          if (step !== undefined) open(step.id);
        }}
      />
    </Card>
  );
}

/** Where each step is done. */
function hrefOf(slug: string, id: SetupStepId): string {
  switch (id) {
    case 'calendar':
      return `/w/${slug}/settings/account/calendars`;
    case 'bookingPage':
      return `/w/${slug}/booking-pages`;
    case 'form':
      return `/w/${slug}/forms`;
    case 'invite':
      return `/w/${slug}/settings/members`;
  }
}

/** The fact a step's row ends in: the state of the thing it names, never a hint. */
function valueOf(id: SetupStepId, facts: SetupFacts): string {
  switch (id) {
    case 'calendar':
      return facts.calendars?.[0] ?? strings.notConnected;
    case 'bookingPage':
      return facts.bookingPages === undefined || facts.bookingPages === 0
        ? strings.noneYet
        : strings.pages(facts.bookingPages);
    case 'form':
      return facts.forms === undefined || facts.forms === 0 ? strings.noneYet : strings.forms(facts.forms);
    case 'invite':
      if (facts.team === undefined) return strings.justYou;
      if (facts.team.members > 1) return strings.people(facts.team.members);
      return facts.team.invited > 0 ? strings.invited(facts.team.invited) : strings.justYou;
  }
}

/** Today: the member's bookings and calendar events, those that ended under Earlier, the rest under Coming up. */
function TodayCard({
  slug,
  objects,
  today,
  state,
  agenda,
}: {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly today: string;
  readonly state: BookingsCalendarState;
  readonly agenda: readonly AgendaItem[];
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const now = useNow();
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const people = objects.find((object) => object.standardKey === 'people');
  const openDay = () => {
    void navigate({ to: '/w/$slug/bookings/calendar', params: { slug }, search: { d: today } });
  };
  const frame = (body: ReactNode, isBusy = false) => (
    <Card
      title={strings.today}
      isBusy={isBusy}
      actions={
        <Button variant="ghost" onPress={openDay}>
          {strings.calendar}
        </Button>
      }
    >
      {body}
    </Card>
  );
  if (state.status === 'loading') return frame(<Skeleton shape="block" />, true);
  if (state.status === 'error') {
    return frame(
      <Failed
        title={strings.todayFailed}
        message={state.message}
        onRetry={() => {
          data.bookings.reloadAll(slug);
        }}
      />,
    );
  }
  const { earlier, next } = splitAgenda(agenda, now);
  const time = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' });
  const rowOf = (item: AgendaItem): BookingListGroup['rows'][number] => {
    const href =
      item.personRecordId === undefined || people === undefined ? undefined : link(people.id, item.personRecordId);
    return {
      id: item.id,
      date: item.allDay ? strings.allDay : time.format(new Date(item.startsAt)),
      time: item.allDay ? '' : lengthOf(minutesOf(item)),
      title: item.title,
      ...(item.videoUrl === undefined || Date.parse(item.endsAt) <= now.getTime()
        ? {}
        : { join: { href: item.videoUrl, provider: providerOf(item.videoUrl) } }),
      ...(item.guestName === undefined ? {} : { guestName: item.guestName }),
      ...(href === undefined ? {} : { guestHref: href }),
    };
  };
  const groups: BookingListGroup[] = [
    ...(earlier.length === 0 ? [] : [{ id: 'earlier', label: strings.earlier, rows: earlier.map(rowOf) }]),
    ...(next.length === 0 ? [] : [{ id: 'next', label: strings.comingUp, rows: next.map(rowOf) }]),
  ];
  return frame(<BookingList label={strings.today} placement="card" groups={groups} onOpen={openDay} />);
}

/** "30 min", "1 hr", "1 hr 30 min". */
function lengthOf(minutes: number): string {
  return minutes < 60 ? strings.minutes(minutes) : strings.hours(Math.floor(minutes / 60), minutes % 60);
}

/**
 * The task entries without their assignee: every task here is the member's own, so the same face on every row
 * says nothing. Each entry is copied once and kept while its task stays the same object.
 */
function useOwnEntries(source: ListSource<TaskEntry>): ListSource<TaskEntry> {
  const cache = useMemo(() => ({ entries: new WeakMap<TaskEntry, TaskEntry>() }), []);
  return useMemo(
    () => ({
      ...source,
      getItem: (index: number) => {
        const entry = source.getItem(index);
        if (entry === undefined) return undefined;
        const held = cache.entries.get(entry);
        if (held !== undefined) return held;
        const { assignee: _assignee, ...own } = entry;
        cache.entries.set(entry, own);
        return own;
      },
    }),
    [source, cache],
  );
}

/** Tasks due: the first five of My tasks' open list, earliest due first; a tick is the same one My tasks makes. */
function TasksDueCard({
  slug,
  objects,
  members,
  list,
  state,
}: {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly list?: TaskListSource;
  readonly state: TaskListState;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  const navigate = useNavigate();
  const entries = useOwnEntries(useTaskEntries(state.source, members));
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const count = state.source.count;
  const hidden = count - TASKS_SHOWN;
  const footer =
    state.status !== 'ready' || hidden <= 0
      ? undefined
      : state.hasMore
        ? strings.moreInTasks
        : strings.moreTasks(hidden);
  return (
    <Card
      title={strings.tasksDue}
      isBusy={state.status === 'loading'}
      {...(footer === undefined ? {} : { footer })}
      actions={
        <Button
          variant="ghost"
          onPress={() => {
            void navigate({ to: '/w/$slug/tasks', params: { slug } });
          }}
        >
          {strings.allTasks}
        </Button>
      }
    >
      <TaskList
        label={strings.tasksDue}
        layout="inline"
        maxRows={TASKS_SHOWN}
        tasks={entries}
        status={state.status === 'unavailable' ? 'no-access' : state.status}
        onRetry={() => {
          if (list === undefined) void router.invalidate();
          else list.retry();
        }}
        newIds={state.newIds}
        emptyTitle={strings.noTasksDue}
        recordHref={(record) => link(record.objectId, record.recordId)}
        onToggle={(task, isDone) => {
          void data.tasks.setDone(slug, task.id, isDone);
        }}
        onAction={(task) => {
          void navigate({ to: '/w/$slug/tasks', params: { slug }, search: { task: task.id } });
        }}
      />
    </Card>
  );
}
