// Brief
// Purpose: the workspace's landing page (spec 0041), timefix's dashboard in our design system: what needs me now.
// Main task: see today's meetings, tick a task due, open a deal going quiet, or take the next setup step.
// Leaves out: the assistant, Team today, the metrics band and the open hours line (no data yet), and any card with nothing in it.
import type {
  BookingsCalendarState,
  InvitationView,
  MemberSummary,
  ObjectSummary,
  Permission,
  RecordsView,
  TaskList as TaskListSource,
  TaskListState,
  ViewState,
} from '@crm/data';
import { useBookingsCalendar, useCalendar, useCaptureList, useTaskList, useView } from '@crm/data/react';
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
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import { providerOf } from '../bookings/provider.ts';
import { useNow } from '../bookings/useNow.ts';
import { recordLinks } from '../records/timeline.ts';
import { useToday } from '../tasks/day.ts';
import { useTaskEntries } from '../tasks/useTaskEntries.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { agendaOf, dayRange, minutesOf, splitAgenda, type AgendaItem } from './agenda.ts';
import { ATTENTION_SHOWN, type AttentionPlan } from './attention.ts';
import { nextStep, setupSteps, type SetupFacts, type SetupStepId } from './setup.ts';
import { strings } from './strings.ts';

/** How many open tasks Tasks due draws, as timefix's card does. */
export const TASKS_SHOWN = 5;

/** Needs attention's deals, as the route opened them. */
export interface HomeAttention {
  readonly plan: AttentionPlan;
  readonly view: RecordsView;
}

/** Props for Home, from the route's loader. */
export interface HomeScreenProps {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
  readonly permissions: readonly Permission[];
  /** My open tasks assigned to me: the list My tasks holds. */
  readonly tasks: TaskListSource;
  /** Undefined when the workspace has no Deals to ask about. */
  readonly attention: HomeAttention | undefined;
  /** Open invitations, read only for a member who may invite. */
  readonly invitations: readonly InvitationView[] | undefined;
}

/** The browser's time zone, the one My tasks and Bookings draw days in. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Home: Finish setting up, then Today, Tasks due and Needs attention side by side. */
export function HomeScreen(props: HomeScreenProps) {
  // Needs attention's window is held only when there are Deals to ask about, so its hook sits in its own branch.
  return props.attention === undefined ? (
    <HomeBody {...props} attentionState={undefined} />
  ) : (
    <WithAttention {...props} attention={props.attention} />
  );
}

function WithAttention(props: HomeScreenProps & { readonly attention: HomeAttention }) {
  const state = useView(props.attention.view, [props.attention.plan.stageId]);
  const { onRangeChange } = state.source;
  // The first rows only: Home shows a handful and counts the rest.
  useEffect(() => {
    onRangeChange({ start: 0, end: ATTENTION_SHOWN });
  }, [onRangeChange]);
  return <HomeBody {...props} attentionState={state} />;
}

function HomeBody({
  slug,
  objects,
  members,
  meId,
  permissions,
  tasks,
  attention,
  invitations,
  attentionState,
}: HomeScreenProps & { readonly attentionState: ViewState | undefined }) {
  const { data } = useRouteContext({ from: '__root__' });
  const timeZone = useMemo(() => browserZone(), []);
  const today = useToday(timeZone);
  const range = useMemo(() => dayRange(today), [today]);
  const day = useBookingsCalendar(
    useMemo(() => data.bookings.calendar(slug, range.from, range.to), [data, slug, range]),
  );
  const taskState = useTaskList(tasks);
  const setup = useSetupFacts(slug, meId, permissions, members, invitations);

  const steps = setupSteps(setup);
  const agenda = useMemo(() => (day.status === 'ready' ? agendaOf(day, meId) : []), [day, meId]);
  const isQuiet =
    steps.every((step) => step.done) &&
    day.status === 'ready' &&
    agenda.length === 0 &&
    taskState.status === 'ready' &&
    taskState.source.count === 0 &&
    (attentionState === undefined || (attentionState.status === 'ready' && attentionState.count.count === 0));

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
            <SetupCard slug={slug} facts={setup} />
            <TileGrid>
              <TodayCard slug={slug} objects={objects} today={today} state={day} agenda={agenda} />
              <TasksDueCard slug={slug} objects={objects} members={members} list={tasks} state={taskState} />
              {attention !== undefined && attentionState !== undefined && (
                <AttentionCard
                  slug={slug}
                  objects={objects}
                  plan={attention.plan}
                  view={attention.view}
                  state={attentionState}
                />
              )}
            </TileGrid>
          </PageColumn>
        ),
      }}
    />
  );
}

/** What the setup steps are read from, each only for a member who may take that step. */
function useSetupFacts(
  slug: string,
  meId: string | undefined,
  permissions: readonly Permission[],
  members: readonly MemberSummary[],
  invitations: readonly InvitationView[] | undefined,
): SetupFacts {
  const { data } = useRouteContext({ from: '__root__' });
  const calendar = useCalendar(useMemo(() => data.calendar.view(slug), [data, slug]));
  const pages = useCaptureList(useMemo(() => data.bookingPages.view(slug), [data, slug]));
  const forms = useCaptureList(useMemo(() => data.forms.view(slug), [data, slug]));
  const may = (permission: Permission) => permissions.includes(permission);
  return {
    ...(calendar.status === 'ready' && calendar.enabled
      ? { calendars: calendar.connections.map((connection) => connection.accountEmail) }
      : {}),
    ...(may('booking.manage') && pages.status === 'ready'
      ? { bookingPages: pages.items.filter((page) => page.ownerMemberId === meId).length }
      : {}),
    ...(may('forms.manage') && forms.status === 'ready' ? { forms: forms.items.length } : {}),
    ...(may('members.invite') && invitations !== undefined
      ? { team: { members: members.length, invited: invitations.filter((each) => !each.isExpired).length } }
      : {}),
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
  if (next === undefined) return null;
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
      return `/w/${slug}/captures/links`;
    case 'form':
      return `/w/${slug}/captures/forms`;
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
      return facts.team === undefined || facts.team.members <= 1 ? strings.justYou : strings.people(facts.team.members);
  }
}

const locale = () => navigator.languages[0] ?? 'en-GB';

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
  if (state.status === 'ready' && agenda.length === 0) return null;
  const openDay = () => {
    void navigate({ to: '/w/$slug/bookings/calendar', params: { slug }, search: { d: today } });
  };
  const frame = (body: ReactNode, isBusy = false) => (
    <Card
      title={strings.today}
      isBusy={isBusy}
      actions={
        <Button variant="ghost" onPress={openDay}>
          {strings.allBookings}
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
  return frame(<BookingList label={strings.today} groups={groups} onOpen={openDay} />);
}

/** "30 min", "1 hr", "1 hr 30 min". */
function lengthOf(minutes: number): string {
  return minutes < 60 ? strings.minutes(minutes) : strings.hours(Math.floor(minutes / 60), minutes % 60);
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
  readonly list: TaskListSource;
  readonly state: TaskListState;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const entries = useTaskEntries(state.source, members);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  if ((state.status === 'ready' && state.source.count === 0) || state.status === 'unavailable') return null;
  return (
    <Card
      title={strings.tasksDue}
      isBusy={state.status === 'loading'}
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
        status={state.status}
        onRetry={list.retry}
        newIds={state.newIds}
        emptyTitle={strings.tasksDue}
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

/** Needs attention: open deals I own that nobody changed in 14 days, stalest first, the rest counted. */
function AttentionCard({
  slug,
  objects,
  plan,
  view,
  state,
}: {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly plan: AttentionPlan;
  readonly view: RecordsView;
  readonly state: ViewState;
}) {
  const navigate = useNavigate();
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const deals = objects.find((object) => object.id === plan.objectId);
  // Refused (the filter no longer fits the object) or out of reach reads as nothing to say, not a failure.
  if (state.status === 'ready' && state.count.count === 0) return null;
  if (
    state.status === 'error' &&
    state.error?.code !== undefined &&
    ['FILTER_INVALID', 'NOT_FOUND'].includes(state.error.code)
  ) {
    return null;
  }
  const openDeals = () => {
    if (deals !== undefined) void navigate({ to: '/w/$slug/objects/$object', params: { slug, object: deals.apiSlug } });
  };
  const frame = (body: ReactNode, isBusy = false, footer?: string) => (
    <Card
      title={strings.needsAttention}
      description={strings.attentionText}
      isBusy={isBusy}
      {...(footer === undefined ? {} : { footer })}
      actions={
        deals === undefined ? undefined : (
          <Button variant="ghost" onPress={openDeals}>
            {strings.allDeals}
          </Button>
        )
      }
    >
      {body}
    </Card>
  );
  if (state.status === 'loading') return frame(<Skeleton shape="block" />, true);
  if (state.status === 'error') {
    return frame(
      <Failed
        title={strings.attentionFailed}
        {...(state.error === undefined ? {} : { message: state.error.message })}
        onRetry={view.retry}
      />,
    );
  }
  const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' });
  const rows: LinkRow[] = [];
  for (let index = 0; index < Math.min(ATTENTION_SHOWN, state.source.count); index += 1) {
    const record = state.source.getItem(index);
    if (record === undefined) continue;
    const stage = record.values[plan.stageId];
    const href = link(record.objectId, record.id);
    rows.push({
      id: record.id,
      title: record.display.name,
      address: typeof stage === 'string' ? (plan.stages.get(stage) ?? '') : '',
      chips: record.updatedAt === undefined ? [] : [strings.changed(date.format(new Date(record.updatedAt)))],
      ...(href === undefined ? {} : { href }),
    });
  }
  const hidden = Math.max(0, state.count.count - rows.length);
  return frame(
    <LinkList
      density="compact"
      placement="card"
      isToolbarHidden
      label={strings.needsAttention}
      searchLabel={strings.needsAttention}
      rows={rows}
      status={rows.length === 0 ? 'loading' : 'ready'}
      onOpen={(id) => {
        const row = rows.find((each) => each.id === id);
        if (row?.href !== undefined) void navigate({ to: row.href });
      }}
    />,
    false,
    hidden > 0 ? strings.more(hidden) : undefined,
  );
}
