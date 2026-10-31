// `@crm/data/react`: the data layer's React binding (spec 0005). Screens read
// a view and the live status through it, so they never subscribe to the store
// themselves.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { BoardStatus, BoardStore } from './records/board.ts';
import type { DataError } from './errors.ts';
import type { OperatorHeld } from './operator/store.ts';
import type { RecordFacts, RecordFactsState } from './records/facts.ts';
import type { ActivityFeed, ActivityState } from './activity/feed.ts';
import type { LinkSection, LinkSectionState } from './links/sections.ts';
import type { AccountSecurityState, AccountSecurityView } from './account/security.ts';
import type { AccountSessionsState, AccountSessionsView } from './account/sessions.ts';
import type {
  BookingsCalendarHeld,
  BookingsCalendarState,
  BookingsState,
  BookingsView,
  TeamDayHeld,
  TeamDayState,
} from './bookings/store.ts';
import type { MeetingsHeld, MeetingsState } from './bookings/meetings.ts';
import type { CalendarSettingsHeld, CalendarSettingsState, CalendarState, CalendarView } from './calendar/store.ts';
import type { CalendarListState, CalendarsHeld, PageDestinationState } from './calendar/calendars.ts';
import type { CaptureListState, CaptureListView } from './captures/list.ts';
import type { HomeHeld, HomeMetricsState, HomeRecentsState, TeamTodayState } from './home/store.ts';
import type { RoutingReportHeld, RoutingReportState } from './routing/reports.ts';
import type { PageRulesHeld } from './routing/page-rules.ts';
import type { AutomationsHeld, AutomationsState } from './automations/store.ts';
import type {
  EmailPreferencesState,
  EmailPreferencesStore,
  EmailUnsubscribeState,
  EmailUnsubscribeStore,
} from './email-preferences.ts';
import type { JobView, RoutingRule } from '@crm/contracts';
import type { JobsSnapshot, JobsView } from './jobs/store.ts';
import type { SchedulesState, SchedulesView } from './schedules/store.ts';
import type { PreferencesHeld, PreferencesState } from './preferences/store.ts';
import type { PictureChoiceHeld, PictureChoiceState } from './profile/picture.ts';
import type { LinkPageHeld, LinkPageState } from './link-page/store.ts';
import type { SocialLinksHeld, SocialLinksState } from './profile/socials.ts';
import type { LiveStatus } from './live/live.ts';
import type { NavSnapshot, NavSource } from './navigation/store.ts';
import type { DueTasksSnapshot, DueTasksSource } from './tasks/due.ts';
import type { PendingOptions } from './options.ts';
import type {
  DuplicateCheck,
  DuplicateCheckState,
  DuplicatePairsList,
  DuplicatePairsState,
} from './duplicates/store.ts';
import type { RecordsView, ViewReader, ViewState } from './records/layer.ts';
import type {
  EntriesState,
  EntriesView,
  ListBoard,
  ListBoardState,
  RecordEntries,
  RecordEntriesState,
} from './lists/entries.ts';
import type { RecordState, RecordSubscription } from './records/one.ts';
import type { AggregateSource, AggregateState } from './records/aggregate-source.ts';
import type { ReportFiguresSource, ReportFiguresState } from './reports/figures-source.ts';
import type { RecordSearch, RecordSearchState } from './records/search.ts';
import type { TrashedSource, TrashedState } from './records/trashed.ts';
import type { SavedViewSnapshot, SavedViewSource, ViewsListSnapshot, ViewsListSource } from './views/store.ts';
import type { TrashState, TrashView } from './trash/store.ts';
import type { TaskList, TaskListState, TaskSubscription, TaskSubscriptionState } from './tasks/store.ts';
import type { NoteList, NoteListState, NoteSession, NoteSessionState } from './notes/store.ts';
import type { CommentsState, RecordComments } from './comments/store.ts';
import type { InboxList, InboxListState, InboxSettings, InboxSettingsState } from './inbox/store.ts';
import type { UnreadSource } from './inbox/unread.ts';

/**
 * A view's current state (its rows, count, status, cell refusals and row
 * notes), re-rendering when it changes: at most once a frame, and only for
 * records it shows. While the screen is mounted it holds the view, so the
 * view keeps its rows; once no screen shows it for a while, the layer lets
 * them go. `attributeIds` are the columns the screen shows now (spec 0006,
 * AC-55): only those and the primary are read, and a column shown later is
 * fetched for the loaded rows alone.
 */
export function useView(view: RecordsView, attributeIds: readonly string[] = []): ViewState {
  const reader = useRef<ViewReader | undefined>(undefined);
  // One string, so a new array with the same columns changes nothing.
  const columns = attributeIds.join('\u0000');
  useEffect(() => {
    const retained = view.retain(split(columns));
    reader.current = retained;
    return () => {
      retained.release();
      reader.current = undefined;
    };
    // The columns reach a retained view through `columns` below: a new column never retains it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    reader.current?.columns(split(columns));
  }, [columns]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}

const split = (columns: string): readonly string[] => (columns === '' ? [] : columns.split('\u0000'));

/** One column of a board as a screen reads it: its option (or `null`), and its window's state once its cards came. */
export interface BoardColumnView {
  readonly id: string | null;
  readonly view?: RecordsView;
  readonly state?: ViewState;
}

/** A board as a screen reads it: its status, what failed, and each column with its window's state. */
export interface BoardView {
  readonly status: BoardStatus;
  readonly error?: DataError;
  readonly columns: readonly BoardColumnView[];
}

/**
 * A board's state (spec 0021), re-rendering when it or any column changes.
 * While the screen is mounted it holds the board and every column's window
 * with the card fields it shows (`attributeIds`), so each column keeps its
 * cards; once no screen shows them for a while, the layer lets them go.
 */
export function useBoard(board: BoardStore<RecordsView>, attributeIds: readonly string[] = []): BoardView {
  useEffect(() => board.retain(), [board]);
  const state = useSyncExternalStore(board.subscribe, board.getSnapshot);
  const views = useMemo(
    () => state.columns.flatMap((column) => (column.view === undefined ? [] : [column.view])),
    [state.columns],
  );
  const columns = attributeIds.join('\u0000');
  useEffect(() => {
    const readers = views.map((view) => view.retain(split(columns)));
    return () => {
      for (const reader of readers) reader.release();
    };
  }, [views, columns]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = views.map((view) => view.subscribe(listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [views],
  );
  // The same array while no column's state changed, so React sees a stable snapshot.
  const last = useRef<readonly ViewState[]>([]);
  const getSnapshot = useCallback(() => {
    const next = views.map((view) => view.getSnapshot());
    if (next.length === last.current.length && next.every((each, index) => each === last.current[index])) {
      return last.current;
    }
    last.current = next;
    return next;
  }, [views]);
  const states = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => {
    const byView = new Map(views.map((view, index) => [view, states[index]]));
    return {
      status: state.status,
      ...(state.error === undefined ? {} : { error: state.error }),
      columns: state.columns.map((column) => {
        const columnState = column.view === undefined ? undefined : byView.get(column.view);
        return {
          id: column.id,
          ...(column.view === undefined ? {} : { view: column.view }),
          ...(columnState === undefined ? {} : { state: columnState }),
        };
      }),
    };
  }, [state, states, views]);
}

/** What `useLiveStatus` reads: the data layer's `live`. */
export interface LiveSource {
  readonly status: () => LiveStatus;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Whether other people's changes are arriving (`live`, `paused` or `off`), re-rendering when it changes. */
export function useLiveStatus(live: LiveSource): LiveStatus {
  return useSyncExternalStore(live.subscribe, live.status);
}

/**
 * A view of a workspace's jobs (spec 0008), re-rendering when it changes.
 * While the screen is mounted it holds the view, so its jobs update live.
 */
export function useJobs(view: JobsView): JobsSnapshot {
  useEffect(() => view.retain(), [view]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}

/** What `useJob` reads: one job by id, and a way to hear when held jobs change (`data.jobs`). */
export interface JobSource {
  readonly get: (workspace: string, jobId: string) => JobView | undefined;
  readonly follow: (listener: () => void) => () => void;
}

/**
 * One job this browser follows (a bulk change's bar, spec 0022): where it is
 * and its progress, re-rendering as its events arrive; undefined with no id.
 */
export function useJob(jobs: JobSource, workspace: string, jobId: string | undefined): JobView | undefined {
  const read = useCallback(
    () => (jobId === undefined ? undefined : jobs.get(workspace, jobId)),
    [jobs, workspace, jobId],
  );
  return useSyncExternalStore(jobs.follow, read);
}

/** Something a screen retains while it shows it, and reads through useSyncExternalStore. */
interface Retained<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  readonly retain: () => () => void;
}

/** A retained source's state: held while the screen is mounted, re-rendering when it changes. */
function useRetained<State>(source: Retained<State>): State {
  useEffect(() => source.retain(), [source]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}

/**
 * A view's calculations (the CRM flow pass, `data.records.aggregates`): a
 * table's footer or a board's column totals, re-rendering when the answers
 * change. Held while the screen is mounted, so they read again after changes;
 * the answers shown stay while a newer read is out.
 */
export function useAggregates(source: AggregateSource): AggregateState {
  return useRetained(source);
}

/**
 * A report's figures (the reports lane, `data.reports.figures`): loading, error or the bars, points or number,
 * re-rendering when they change. Held while the screen is mounted, so they read again after a change that may move
 * them; the figures shown stay while a newer read is out.
 */
export function useReportFigures(source: ReportFiguresSource): ReportFiguresState {
  return useRetained(source);
}

/**
 * One record's state (spec 0006, `records.one`; the record page, spec 0017):
 * the store's one body with pending edits on top, its status and its
 * refused values, re-rendering when it changes. While the screen is mounted
 * it holds the record, so live changes keep reaching it.
 */
export function useRecord(record: RecordSubscription): RecordState {
  return useRetained(record);
}

/** A record's timeline (spec 0017), re-rendering when entries arrive. Held while the screen is mounted. */
export function useActivity(feed: ActivityFeed): ActivityState {
  return useRetained(feed);
}

/**
 * One record's related section (spec 0017, milestone 3): its rows, total and
 * state, this tab's own Add and Remove shown at once, re-rendering when they
 * change. Held while the screen is mounted, so changes anywhere reach it.
 */
export function useLinkSection(section: LinkSection): LinkSectionState {
  return useRetained(section);
}

/**
 * Only where a record's timeline stands (`loading`, `ready`, `error`,
 * `unavailable`), re-rendering only when that changes, not with every entry:
 * for a screen that shows the timeline elsewhere and only needs its status.
 */
export function useActivityStatus(feed: ActivityFeed): ActivityState['status'] {
  return useSyncExternalStore(feed.subscribe, () => feed.getSnapshot().status);
}

/**
 * When a record's newest timeline entry happened (ISO 8601 in UTC), or
 * `undefined` before its first page or with none: a record header's "Last
 * activity". Re-renders only when that instant changes, not with every entry.
 */
export function useLatestActivityAt(feed: ActivityFeed): string | undefined {
  return useSyncExternalStore(feed.subscribe, () => feed.getSnapshot().entries[0]?.at);
}

/**
 * The trash (spec 0022): its rows, count, status and refusals, re-rendering
 * when they change. While the screen is mounted it holds the view, so it
 * settles live as records are deleted, restored or purged anywhere.
 */
export function useTrash(view: TrashView): TrashState {
  return useRetained(view);
}

/**
 * A list of tasks (spec 0019): a record's open or done tasks, re-rendering
 * when a task in it or the list itself changes. Held while the screen is
 * mounted, so it stays live and settles.
 */
export function useTaskList(list: TaskList): TaskListState {
  return useRetained(list);
}

/**
 * Only a task list's total (a tab's count), re-rendering only when it moves,
 * not with every task. Holds the list while the screen is mounted, so the
 * count stays live.
 */
export function useTaskTotal(list: TaskList): TaskListState['total'] {
  useEffect(() => list.retain(), [list]);
  return useSyncExternalStore(list.subscribe, () => list.getSnapshot().total);
}

/** One task (the task dialog), re-rendering when it changes. Held while the screen is mounted. */
export function useTask(task: TaskSubscription): TaskSubscriptionState {
  return useRetained(task);
}

/**
 * The record picker's search (spec 0014), re-rendering as answers land. The
 * screen asks (`search.ask`) as the person types and disposes the search
 * when the picker closes.
 */
export function useRecordSearch(search: RecordSearch): RecordSearchState {
  return useSyncExternalStore(search.subscribe, search.getSnapshot);
}

/**
 * A form's likely duplicates (spec 0049, AC-4904), re-rendering as checks land. The screen asks (`check.ask`) as its
 * fields change and disposes the check when the form closes.
 */
export function useDuplicateCheck(check: DuplicateCheck): DuplicateCheckState {
  return useSyncExternalStore(check.subscribe, check.getSnapshot);
}

/** An object's likely pairs, or one record's (spec 0049, AC-4906, AC-4907), re-rendering as pages and dismissals land. */
export function useDuplicatePairs(list: DuplicatePairsList): DuplicatePairsState {
  return useSyncExternalStore(list.subscribe, list.getSnapshot);
}

/** A missing record looked up in the trash (spec 0017), asked when first read. */
export function useTrashed(source: TrashedSource): TrashedState {
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}

/** What `usePendingOptions` reads: the data layer's `options.pending`. */
export interface PendingOptionsSource {
  readonly getSnapshot: () => PendingOptions;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Options a cell made that their attribute doesn't list yet (spec 0012,
 * AC-238), re-rendering when one is asked for or refused: a table merges
 * them into its columns (`withPendingOptions`), so the new label shows at once.
 */
export function usePendingOptions(source: PendingOptionsSource): PendingOptions {
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}

/**
 * An object's saved views in switcher order (spec 0020), re-rendering when
 * they change. Held while the screen is mounted, so live changes reach it.
 */
export function useViewsList(source: ViewsListSource): ViewsListSnapshot {
  return useRetained(source);
}

/** One saved view whole (spec 0020), re-rendering when it changes. Held while the screen is mounted. */
export function useSavedView(source: SavedViewSource): SavedViewSnapshot {
  return useRetained(source);
}

/**
 * Bookings, the workspace's upcoming or past list (spec 0025), re-rendering
 * when it changes. Held while the screen is mounted, so it is read again when
 * the person comes back to the page, and every minute while the page shows
 * and live updates are paused or off.
 */
export function useBookings(view: BookingsView): BookingsState {
  return useRetained(view);
}

/**
 * Bookings' week (spec 0025): a range's bookings and the reader's calendar
 * events, re-rendering when they change. Held while the screen is mounted,
 * so it is read again when the person comes back to the page, and every
 * minute while the page shows and live updates are paused or off.
 */
export function useBookingsCalendar(view: BookingsCalendarHeld): BookingsCalendarState {
  return useRetained(view);
}

/**
 * The Team day (spec 0030): one day of the reader's See reach, a column each, re-rendering when it changes. Held while
 * the screen is mounted, so it is kept current as the week is.
 */
export function useTeamDay(view: TeamDayHeld): TeamDayState {
  return useRetained(view);
}

/**
 * Bookings' list of every meeting, a page at a time, re-rendering as pages land. Held while the screen is mounted, so
 * what it shows is read again when the person comes back to the page, and every minute while the page shows and live
 * updates are paused or off.
 */
export function useMeetings(list: MeetingsHeld): MeetingsState {
  return useRetained(list);
}

/** Settings › Automations (parity #53): the held list and run log, re-rendering as they change. Held while mounted. */
export function useAutomations(held: AutomationsHeld): AutomationsState {
  return useRetained(held);
}

/** Home's Team today (spec 0041), re-rendering when it is read again. Held while the screen is mounted. */
export function useTeamToday(view: HomeHeld<TeamTodayState>): TeamTodayState {
  return useRetained(view);
}

/**
 * A form's or a team page's routing report (spec 0043, AC-1612), re-rendering when it is read again. Held while the
 * screen is mounted, so it is read again when the person comes back to the page or marks a booking no show.
 */
export function useRoutingReport(view: RoutingReportHeld): RoutingReportState {
  return useRetained(view);
}

/**
 * A team page's routing rules as the data layer holds them (spec 0043, AC-1608), re-rendering when a write or a
 * read changes the page: undefined until the held booking page list holds it. Held while the card is mounted.
 */
export function usePageRules(held: PageRulesHeld): readonly RoutingRule[] | undefined {
  return useRetained(held);
}

/** Home's metrics row (spec 0041), re-rendering when it is read again. Held while the screen is mounted. */
export function useHomeMetrics(view: HomeHeld<HomeMetricsState>): HomeMetricsState {
  return useRetained(view);
}

/** Home's Recently viewed (spec 0041), re-rendering when it is read again. Held while the screen is mounted. */
export function useHomeRecents(view: HomeHeld<HomeRecentsState>): HomeRecentsState {
  return useRetained(view);
}

/**
 * The member's calendar connections (spec 0024, Settings › Calendar),
 * re-rendering when they change. Held while the screen is mounted, so a
 * connection still syncing its first window is read again until it is done.
 */
export function useCalendar(view: CalendarView): CalendarState {
  return useRetained(view);
}

/** The member's accounts and each of their calendars (spec 0024 milestone 5), read when the screen first holds them. */
export function useCalendarList(held: CalendarsHeld<CalendarListState>): CalendarListState {
  return useRetained(held);
}

/** A booking page's own "Add events to" (spec 0024, AC-997), read when the screen first holds it. */
export function usePageDestination(held: CalendarsHeld<PageDestinationState>): PageDestinationState {
  return useRetained(held);
}

/** The signed in person's own sessions (spec 0033), read from the top when the screen first holds them. */
export function useAccountSessions(view: AccountSessionsView): AccountSessionsState {
  return useRetained(view);
}

/** Two factor's state and this session's freshness (spec 0033), read when the screen first holds it. */
export function useAccountSecurity(view: AccountSecurityView): AccountSecurityState {
  return useRetained(view);
}

/** The workspace's calendar settings (spec 0024, AC-609), read when the screen first holds them. */
export function useCalendarSettings(held: CalendarSettingsHeld): CalendarSettingsState {
  return useRetained(held);
}

/** The member's own preferences in a workspace (Settings › Account › Preferences), read when first held. */
export function usePreferences(held: PreferencesHeld): PreferencesState {
  return useRetained(held);
}

/**
 * A held scheduling read from the lazy scheduling chunk (spec 0037: delegations, `DelegationsHeld`, and time off,
 * `TimeOffHeld`), read when first held. One generic hook, so each new read costs the first load nothing.
 */
export function useScheduling<State>(held: Retained<State>): State {
  return useRetained(held);
}

/** The person's link page blocks (Settings › Account › Link page, spec 0051), read when first held. */
export function useLinkPage(held: LinkPageHeld): LinkPageState {
  return useRetained(held);
}

/** Whether the person's picture shows on their public pages (Settings › Account › Profile), read when first held. */
export function usePictureChoice(held: PictureChoiceHeld): PictureChoiceState {
  return useRetained(held);
}

/** The person's own social links (booking socials, 25 Oct 2026), read when first held. */
export function useSocialLinks(held: SocialLinksHeld): SocialLinksState {
  return useRetained(held);
}

/**
 * A Captures list (Links' booking pages, Forms' forms), re-rendering when a
 * write anywhere changes it. Held while the screen is mounted: read again
 * when held after a while away, so another tab's changes show on return.
 */
export function useCaptureList<Item>(view: CaptureListView<Item>): CaptureListState<Item> {
  return useRetained(view);
}

/** A record's notes (spec 0019), re-rendering when they change. Held while the screen is mounted. */
export function useNoteList(list: NoteList): NoteListState {
  return useRetained(list);
}

/** Only a note list's total (the Notes tab's count). Holds the list while the screen is mounted, so it stays live. */
export function useNoteTotal(list: NoteList): NoteListState['total'] {
  useEffect(() => list.retain(), [list]);
  return useSyncExternalStore(list.subscribe, () => list.getSnapshot().total);
}

/** An open note (the note window), re-rendering as it saves. Held while the window is mounted. */
export function useNoteSession(session: NoteSession): NoteSessionState {
  return useRetained(session);
}

/** An email preferences page's state (the emails lane): its choices as they now stand, re-rendering when they change. */
export function useEmailPreferences(store: EmailPreferencesStore): EmailPreferencesState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** A one click unsubscribe page's state (the emails lane): asking, saving, done or refused. */
export function useEmailUnsubscribe(store: EmailUnsubscribeStore): EmailUnsubscribeState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Stands in for no schedules view: never held, never read, always loading. */
const NO_SCHEDULES: SchedulesView = {
  subscribe: () => () => undefined,
  getSnapshot: () => SCHEDULES_LOADING,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};
const SCHEDULES_LOADING: SchedulesState = { status: 'loading' };

/**
 * A member's availability schedules (spec 0035), re-rendering when they
 * change. Held while the screen is mounted, so a save in another tab shows.
 * Pass undefined while nothing needs them (a closed dialog, a reader who may
 * not read them): nothing is held or read, and the state stays loading.
 */
export function useSchedules(view: SchedulesView | undefined): SchedulesState {
  return useRetained(view ?? NO_SCHEDULES);
}

/**
 * The member's own sidebar in a workspace (spec 0034), with their changes
 * waiting for an answer already applied, re-rendering when it changes. Held
 * while the frame is mounted, so another tab's change reaches it live.
 */
export function useNav(source: NavSource): NavSnapshot {
  return useRetained(source);
}

/**
 * The sidebar's Tasks badge (spec 0034, AC-924): how many of my open tasks
 * are overdue or due today, live. Held while the frame is mounted.
 */
export function useDueTasks(source: DueTasksSource): DueTasksSnapshot {
  return useRetained(source);
}

/**
 * A record's threads (spec 0038): the Comments tab's open and resolved
 * threads and counts, re-rendering when they change. Held while the screen
 * is mounted, so it stays live.
 */
export function useComments(comments: RecordComments): CommentsState {
  return useRetained(comments);
}

/**
 * Only a record's open thread count (the Comments tab's label), re-rendering
 * only when it moves. Holds the threads while mounted, so the count is live.
 */
export function useCommentCount(comments: RecordComments): number | undefined {
  useEffect(() => comments.retain(), [comments]);
  return useSyncExternalStore(comments.subscribe, () => {
    const state = comments.getSnapshot();
    return state.status === 'ready' ? state.openCount : undefined;
  });
}

/**
 * The member's unread notifications in a workspace (spec 0038, AC-1174),
 * from `data.inbox.unread(workspace)`: undefined until the first answer, 100
 * for more than 99 ("99+"), 0 for none. Held while mounted, so it is live on
 * every page; the sidebar's Inbox badge reads it.
 */
export function useInboxUnread(source: UnreadSource): number | undefined {
  return useRetained(source);
}

/** One tab and filter of the inbox (spec 0038), re-rendering when it changes. Held while mounted, so it stays live. */
export function useInboxList(list: InboxList): InboxListState {
  return useRetained(list);
}

/** The member's notification settings (spec 0038), re-rendering when they change. Held while mounted. */
export function useNotificationSettings(settings: InboxSettings): InboxSettingsState {
  return useRetained(settings);
}

/**
 * A record's facts for its stat strip (13 Oct reference batch 4): its next
 * meeting and its stage age, read each time the screen holds them.
 */
export function useRecordFacts(facts: RecordFacts): RecordFactsState {
  return useRetained(facts);
}

/** One held operator console read (spec 0047): its state, kept current while the screen shows it. */
export function useOperator<T>(held: OperatorHeld<T>): T {
  return useSyncExternalStore(held.subscribe, held.getSnapshot, held.getSnapshot);
}

/** A list's rows (spec 0048), held while the screen shows them: the view lets go 30 seconds after it leaves. */
export function useEntries(view: EntriesView): EntriesState {
  useEffect(() => view.retain(), [view]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}

/** A list board's columns (spec 0048, AC-4820), held while the screen shows them. */
export function useListBoard(board: ListBoard): ListBoardState {
  useEffect(() => board.retain(), [board]);
  return useSyncExternalStore(board.subscribe, board.getSnapshot);
}

/** A record's entries for its page's Lists section (spec 0048, AC-4822), held while the section shows them. */
export function useRecordEntries(source: RecordEntries): RecordEntriesState {
  useEffect(() => source.retain(), [source]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}
