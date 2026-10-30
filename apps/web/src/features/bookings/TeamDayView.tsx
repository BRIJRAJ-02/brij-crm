// Brief
// Purpose: the team's day side by side (spec 0030, as spec 0037 amends it): who is free, who is booked, who is away,
// what needs a host and what clashes, for everyone the reader may see.
// Main task: spot what needs doing (Needs a host, a clash, a meeting outside someone's hours) and act on a teammate's
// column (book someone in, block time, time off, reassign) where the reader Manages them.
// Leaves out: changing working hours (Availability › Team), dragging a booking to another column (Reassign from its
// card instead, AC-777), and colleagues' calendar details (Busy only, AC-770).
import type {
  BookingAssignment,
  BookingListItem,
  BookingPageView,
  CalendarConnectionView,
  CalendarListState,
  CalendarsHeld,
  DataLayer,
  ObjectSummary,
  PageDestinationState,
  RecordSearch,
  TeamDay as TeamDayAnswer,
  TeamDayColumn,
  TeamDayHeld,
  TeamDayIssue,
  TeamDayItem,
  TimeBlockOccurrence,
} from '@crm/data';
import { useTeamDay } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  linkHue,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  memoIntl,
  TeamDay,
  type BookingListRow,
  type TeamDayPerson,
  type Toasts,
  type WeekCalendarBlock,
  type WeekCalendarSpan,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { offsetLabel } from '../../public/booking/time.ts';
import { calendarHealthStrings } from '../booking/calendar-health-strings.ts';
import {
  CalendarHealthChip,
  needsReconnect,
  useCalendarHealth,
  useSchedulingStore,
} from '../booking/CalendarHealth.tsx';
import { newLinkOnlyPageHref } from '../booking/links.ts';
import { TimeOffDialog } from '../booking/TimeOffDialog.tsx';
import { membersSettingsHref } from '../settings/nav.ts';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { AwayReassignDialog } from './AwayReassignDialog.tsx';
import { BookingDialog, type BookingAsk, type HostBookingActions } from './BookingActions.tsx';
import {
  BlockCard,
  BookingCard,
  BusyCard,
  EventCard,
  RemoveBlockDialog,
  usePersonHref,
  type BlockDraft,
  type BlockPreview,
} from './BookingsScreen.tsx';
import { DrawCard, type ForPerson } from './DrawCard.tsx';
import { NewMeetingDialog, type NewMeeting, type NewMeetingDialogProps } from './NewMeetingDialog.tsx';
import { ReassignDialog } from './ReassignDialog.tsx';
import { instantOf, spanNames, type DrawnSpan } from './span.ts';
import { strings } from './strings.ts';
import { openingMinute, type MinuteSpan } from './team-grid.ts';
import { minuteOfDay, timeRange } from './week.ts';

/** What the Team day needs beside its held read. */
export interface TeamDayViewProps {
  readonly slug: string;
  readonly data: DataLayer;
  readonly held: TeamDayHeld;
  /** The day shown, `yyyy-MM-dd` on the reader's clock. */
  readonly day: string;
  readonly isToday: boolean;
  readonly now: Date;
  readonly nowLabel: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly zone: { readonly short: string; readonly name: string };
  readonly pages: readonly BookingPageView[];
  readonly objects: readonly ObjectSummary[];
  readonly connections: readonly CalendarConnectionView[];
  readonly calendars: CalendarListState | undefined;
  readonly pageDestination?: ((pageId: string) => CalendarsHeld<PageDestinationState>) | undefined;
  readonly peopleSearch?: (() => RecordSearch) | undefined;
  readonly newBookingKey: () => string;
  /** The meeting limits a time lands against, for New meeting's warning (spec 0037, J7). */
  readonly limitsAt?: NewMeetingDialogProps['limitsAt'];
  readonly onBookAsHost: (meeting: NewMeeting) => Promise<{ readonly notInCrm?: string }>;
  /** Closes a span on someone's column: its preview shows at once there (and on the reader's own week). */
  readonly onBlock: (
    draft: BlockDraft,
    preview: readonly BlockPreview[],
    team: { readonly memberId: string; readonly preview: readonly BlockPreview[] },
  ) => Promise<{ readonly id: string }>;
  readonly onRemoveBlock: (blockId: string) => Promise<void>;
  readonly actions: HostBookingActions | undefined;
  readonly toasts: Toasts;
  /** Everyone the reader may see, for the heads while the first read of a day loads. */
  readonly members: readonly { readonly id: string; readonly name: string }[];
  /** Whether filters narrow the day (the empty state then offers to clear them). */
  readonly isFiltered: boolean;
  /** Ordered by job title (Filter's order, AC-1438): the heads show each title, so the order explains itself. */
  readonly isTitleOrder: boolean;
  readonly onClearFilters: () => void;
  /** Where the toolbar holds the day's issue count (AC-1436); null until it is drawn. */
  readonly issuesSlot: HTMLElement | null;
}

/** A card's question, drawn here (a dialog can't sit over the card's popover). */
type Question =
  | { readonly kind: 'remove'; readonly turn: TimeBlockOccurrence }
  | { readonly kind: BookingAsk; readonly booking: BookingListItem; readonly seats: readonly BookingAssignment[] };

/**
 * A question as the day holds it: numbered, so each one mounts its dialog afresh, with where it came from (a block on
 * the grid, or a row of the lane), so a dismissed dialog opens its card again and a finished one focuses its block.
 */
type Asked = Question & {
  readonly opening: number;
  readonly from:
    | { readonly kind: 'grid'; readonly pieceId: string; readonly memberId: string }
    | { readonly kind: 'lane'; readonly bookingId: string };
};

/** One block as the grid draws it, and what it stands for. */
type Placed =
  | { readonly kind: 'booking'; readonly block: WeekCalendarBlock; readonly booking: BookingListItem }
  | { readonly kind: 'closed'; readonly block: WeekCalendarBlock; readonly turn: TimeBlockOccurrence }
  | { readonly kind: 'busy'; readonly block: WeekCalendarBlock; readonly span: { startsAt: string; endsAt: string } }
  | {
      readonly kind: 'event';
      readonly block: WeekCalendarBlock;
      readonly event: Extract<TeamDayItem, { kind: 'event' }>['event'];
    };

/** A span drawn on someone's column (or kept behind its dialog), and whose. */
interface Drawn {
  readonly memberId: string;
  readonly span: WeekCalendarSpan;
}

/** An instant's minute in the day shown: 0 before it starts, 1440 once it is over. */
function minuteIn(at: string, day: TeamDayAnswer, zone: string): number {
  const time = Date.parse(at);
  if (time <= Date.parse(day.from)) return 0;
  if (time >= Date.parse(day.to)) return 1440;
  return minuteOfDay(new Date(time), zone);
}

/** Where an item starts and ends. */
const spanOf = (item: TeamDayItem) =>
  item.kind === 'event' ? { startsAt: item.event.startsAt, endsAt: item.event.endsAt } : item;

/** A column's head: how the day stands, in a word or two. */
function statusOf(column: TeamDayColumn): Pick<TeamDayPerson, 'status' | 'tone'> {
  if (column.away !== undefined) return { status: strings.teamAway, tone: 'away' };
  if (column.booked > 0) return { status: strings.teamBooked(column.booked), tone: 'booked' };
  if (column.open.length === 0) return { status: strings.teamNoHours, tone: 'off' };
  return { status: strings.teamFree, tone: 'free' };
}

/** The Team day: the grid of people, the lane, the issue count in the toolbar, and every dialog a card asks for. */
export function TeamDayView(props: TeamDayViewProps) {
  const { slug, data, held, day, timeZone, locale, toasts, actions } = props;
  const state = useTeamDay(held);
  const me = useMyAccess()?.memberId;
  const canInvite = useCan('members.invite');
  const personHref = usePersonHref(slug, props.objects);
  // The last day read, so a filter or another day keeps the heads in place while the next read is out.
  const [lastReady, setLastReady] = useState<TeamDayAnswer | undefined>(undefined);
  if (state.status === 'ready' && lastReady !== state) setLastReady(state);
  const answer = state.status === 'ready' ? state : undefined;
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [laneOpen, setLaneOpen] = useState<string | undefined>(undefined);
  const [asked, setAsked] = useState<Asked | undefined>(undefined);
  const [isAsking, setAsking] = useState(false);
  // The card's button to focus as it opens again after its dialog was dismissed.
  const [refocus, setRefocus] = useState<BookingAsk | 'remove' | undefined>(undefined);
  const [focus, setFocus] = useState<
    { readonly dayKey: string; readonly blockId?: string; readonly isAsked?: boolean } | undefined
  >(undefined);
  const [draft, setDraft] = useState<Drawn | undefined>(undefined);
  const [drawCount, setDrawCount] = useState(0);
  // A span kept drawn behind New meeting or Time off, so the column has its focus back when the dialog closes.
  const [meeting, setMeeting] = useState<Drawn | undefined>(undefined);
  const [timeOffFor, setTimeOffFor] = useState<(Drawn & { readonly name: string }) | undefined>(undefined);
  // The draft as of the last render, so a save that settles later knows whether its card is still open.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const columns = useMemo(() => answer?.columns ?? [], [answer]);
  const byColumn = useMemo(() => new Map(columns.map((column) => [column.memberId, column])), [columns]);
  // Each colleague's calendar trouble on their head (spec 0037, AC-1307): nothing while all is well.
  const store = useSchedulingStore(data, columns.length > 1);
  const health = useCalendarHealth(
    store,
    slug,
    columns.filter((column) => column.memberId !== me).map((column) => column.memberId),
  );
  const byBooking = useMemo(() => new Map((answer?.bookings ?? []).map((booking) => [booking.id, booking])), [answer]);
  // A booking's issue on a member's column, looked up once per answer rather than per block.
  const issueOf = useMemo(() => {
    const found = new Map<string, TeamDayIssue['kind']>();
    for (const issue of answer?.issues ?? []) {
      const key = `${issue.memberId}:${issue.bookingId}`;
      if (found.get(key) !== 'clash') found.set(key, issue.kind);
    }
    return found;
  }, [answer]);
  const nowMs = props.now.getTime();
  // The reader's own events carry their calendar's mark, as on their week; bookings carry Timefix's.
  const markOf = useMemo(
    () =>
      new Map(
        props.connections.map(
          (connection) => [connection.id, connection.provider === 'google' ? 'google-calendar' : 'outlook'] as const,
        ),
      ),
    [props.connections],
  );
  const placed = useMemo((): readonly Placed[] => {
    if (answer === undefined) return [];
    return answer.columns.flatMap((column) =>
      column.items.flatMap((item): Placed[] => {
        // A booking's time and status are the booking's own (one copy: a move or a cancel from its card shows here).
        const booking = item.kind === 'booking' ? byBooking.get(item.bookingId) : undefined;
        if (item.kind === 'booking' && booking === undefined) return [];
        const { startsAt, endsAt } = booking ?? spanOf(item);
        const startMinute = minuteIn(startsAt, answer, timeZone);
        const endMinute = Math.max(minuteIn(endsAt, answer, timeZone), startMinute + 1);
        const base = {
          dayKey: column.memberId,
          startMinute,
          endMinute,
          time: timeRange(startsAt, endsAt, locale, timeZone),
        };
        if (booking !== undefined) {
          const isLive = booking.status === 'confirmed';
          const issue = issueOf.get(`${column.memberId}:${booking.id}`);
          // Needs a host and Host away say so once, in the strip over the grid, not again on the block.
          const status = !isLive
            ? undefined
            : booking.noShow === true
              ? strings.noShow
              : issue === 'clash'
                ? strings.clash
                : issue === 'outsideHours'
                  ? strings.outsideHours
                  : undefined;
          return [
            {
              kind: 'booking',
              booking,
              block: {
                ...base,
                id: `${column.memberId}:${booking.id}`,
                title: booking.pageTitle,
                detail: booking.visitorName,
                kind: 'booking',
                hue: linkHue(booking.pageId),
                // Every booking came through Timefix: its mark, beside the title (synced calendar time has none).
                provider: 'timefix',
                isCancelled: !isLive,
                ...(status === undefined ? {} : { status }),
              },
            },
          ];
        }
        if (item.kind === 'block' || item.kind === 'hold') {
          const turn: TimeBlockOccurrence = {
            key: item.key,
            blockId: item.blockId,
            kind: item.kind,
            repeat: item.repeat,
            ...(item.label === undefined ? {} : { label: item.label }),
            startsAt: item.startsAt,
            endsAt: item.endsAt,
          };
          return [
            {
              kind: 'closed',
              turn,
              block: {
                ...base,
                id: `${column.memberId}:${item.key}`,
                title: item.label ?? (item.kind === 'hold' ? strings.held : strings.blocked),
                kind: item.kind === 'hold' ? 'held' : 'blocked',
              },
            },
          ];
        }
        if (item.kind === 'busy') {
          return [
            {
              kind: 'busy',
              span: { startsAt: item.startsAt, endsAt: item.endsAt },
              block: {
                ...base,
                id: `${column.memberId}:busy:${item.startsAt}:${item.endsAt}`,
                title: strings.busy,
                kind: 'busy',
              },
            },
          ];
        }
        if (item.kind !== 'event') return [];
        // An all day event of the reader's own would close the whole column: their week keeps those to the list.
        if (item.event.allDay) return [];
        const mark = markOf.get(item.event.connectionId);
        return [
          {
            kind: 'event',
            event: item.event,
            block: {
              ...base,
              id: `${column.memberId}:event:${item.event.id}`,
              title: item.event.title,
              kind: 'event',
              ...(mark === undefined ? {} : { provider: mark }),
            },
          },
        ];
      }),
    );
  }, [answer, byBooking, issueOf, locale, timeZone, markOf]);
  const blocks = useMemo(() => placed.map((each) => each.block), [placed]);
  // Each column's open hours in minutes, once per answer (the grid asks for them on every draw).
  const openByColumn = useMemo(() => {
    const found = new Map<string, readonly MinuteSpan[]>();
    if (answer === undefined) return found;
    for (const column of answer.columns) {
      found.set(
        column.memberId,
        column.open.map((span) => ({
          startMinute: minuteIn(span.startsAt, answer, timeZone),
          endMinute: minuteIn(span.endsAt, answer, timeZone),
        })),
      );
    }
    return found;
  }, [answer, timeZone]);
  const isToday = props.isToday;
  const nowMinute = isToday ? minuteOfDay(props.now, timeZone) : undefined;
  // The team's working day, or now within it on today: never midnight or an empty evening.
  const scrollTo = useMemo(
    () => openingMinute([...openByColumn.values()].flat(), nowMinute),
    // Where the day opens is decided once per day read: the minute ticking by must not scroll it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openByColumn],
  );
  const shownColumns = answer?.columns ?? lastReady?.columns;
  const people = useMemo((): readonly TeamDayPerson[] => {
    const at = Date.parse(answer?.from ?? lastReady?.from ?? new Date(nowMs).toISOString());
    const mine = offsetLabel(timeZone, at);
    if (shownColumns === undefined) {
      // The first read of the day is out: the heads of everyone the reader may see, so the grid lands in place.
      return props.members.map((member) => ({ id: member.id, name: member.name, status: '', tone: 'free' as const }));
    }
    return shownColumns.map((column) => {
      const { status, tone } = statusOf(column);
      const reason = column.away?.reason === undefined ? undefined : strings.awayReasons[column.away.reason];
      // Their offset only when it differs from the reader's that day (an alias such as Asia/Calcutta is the same zone).
      const theirs = offsetLabel(column.timeZone, at);
      // Only trouble earns room on a head (Reconnect, Some calendars skipped): no calendar, or a working one, says nothing.
      const chip = health.get(column.memberId);
      const trouble = chip?.status === 'ready' && needsReconnect(chip.health) ? chip : undefined;
      const range = answer ?? lastReady;
      return {
        id: column.memberId,
        name: column.name,
        status,
        tone,
        ...(theirs === mine ? {} : { badge: theirs }),
        ...(column.jobTitle === undefined ? {} : { title: column.jobTitle }),
        ...(trouble === undefined
          ? {}
          : {
              extra: <CalendarHealthChip state={trouble} name={column.name} isQuiet />,
              extraLabel:
                trouble.health.status === 'skipped' ? calendarHealthStrings.skipped : calendarHealthStrings.reconnect,
            }),
        // Only people the reader Manages, and themself, take a drawn span (AC-773): the rest are See only.
        canAct: column.memberId === me || column.canManage,
        ...(column.away === undefined || range === undefined
          ? {}
          : {
              band: {
                label: strings.awayBand(reason),
                startMinute: minuteIn(column.away.span.startsAt, range, timeZone),
                endMinute: minuteIn(column.away.span.endsAt, range, timeZone),
              },
            }),
      };
    });
  }, [answer, lastReady, shownColumns, health, me, timeZone, nowMs, props.members]);
  // The lane (AC-1435): Needs a host and Host away, while they are still ahead or under way.
  const laneRows = useMemo(
    (): readonly BookingListRow[] =>
      (answer?.needsHost ?? []).flatMap((id) => {
        const booking = byBooking.get(id);
        if (booking === undefined || booking.status !== 'confirmed' || Date.parse(booking.endsAt) <= nowMs) return [];
        const start = memoIntl(
          `bookings-minute-zone:${locale}:${timeZone}`,
          () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }),
        ).format(new Date(booking.startsAt));
        const host = booking.hostRemoved === true || booking.hostName === '' ? strings.formerHost : booking.hostName;
        return [
          {
            id,
            date: start,
            time: '',
            title: booking.pageTitle,
            guestName: booking.visitorName,
            hostName: host,
            ...(booking.needsHost ? {} : { badge: strings.hostAway, badgeTone: 'accent' as const }),
          },
        ];
      }),
    [answer, byBooking, locale, timeZone, nowMs],
  );

  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => held.reload()}>
        {state.message === '' ? strings.failedText : state.message}
      </EmptyState>
    );
  }
  if (answer !== undefined && columns.length === 0 && props.isFiltered) {
    return (
      <EmptyState
        title={strings.teamNoneMatch}
        actions={<Button onPress={props.onClearFilters}>{strings.clearFilters}</Button>}
      />
    );
  }
  // Fewer than two people to show (AC-764): the reader alone, with nobody else in the workspace yet.
  if (answer !== undefined && columns.length < 2 && !props.isFiltered && laneRows.length === 0) {
    return (
      <EmptyState
        icon="users"
        title={strings.teamNeedsTeam}
        actions={
          canInvite ? (
            <ButtonLink variant="primary" icon="user-plus" href={membersSettingsHref(slug)}>
              {strings.inviteMembers}
            </ButtonLink>
          ) : undefined
        }
      >
        {canInvite ? strings.teamNeedsTeamText : undefined}
      </EmptyState>
    );
  }

  const columnOf = (memberId: string) => byColumn.get(memberId);
  const shownSelected =
    selected !== undefined && people.some((person) => person.id === selected) ? selected : (people[0]?.id ?? '');
  // Whom the reader may act for (AC-773): the people they Manage, for For on the cards and dialogs.
  const forPeople: readonly ForPerson[] = columns
    .filter((column) => column.memberId !== me && column.canManage)
    .map((column) => ({ id: column.memberId, name: column.name }));
  /** Whether the reader Manages a member (themself included): Reassign on a card of theirs (AC-777, AC-1337). */
  const managesHost = (memberId: string) => memberId === me || columnOf(memberId)?.canManage === true;
  /** Whether a member owns a live page of their own a booking for them can go on (New meeting lists only those). */
  const canBookFor = (memberId: string) =>
    props.pages.some(
      (page) =>
        page.status === 'live' && (memberId === me ? true : page.ownerMemberId === memberId && page.scope === 'member'),
    );
  const open = placed.find((each) => each.block.id === openId);
  const hourFormat = memoIntl(`bookings-hour:${locale}`, () => new Intl.DateTimeFormat(locale, { hour: 'numeric' }));
  const minuteLabel = (minute: number) => {
    const at = new Date(2000, 0, 1);
    at.setMinutes(minute);
    return memoIntl(
      `bookings-minute:${locale}`,
      () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
    ).format(at);
  };
  /** A card's question: the card closes and its dialog opens here. */
  const ask = (question: Question, from: Asked['from']) => {
    setOpenId(undefined);
    setLaneOpen(undefined);
    setRefocus(undefined);
    setAsked((was) => ({ ...question, from, opening: (was?.opening ?? 0) + 1 }));
    setAsking(true);
  };
  /** Dismissed: its card opens again, focus on the button that asked. */
  const dismiss = () => {
    setAsking(false);
    if (asked === undefined) return;
    setRefocus(asked.kind);
    if (asked.from.kind === 'lane') setLaneOpen(asked.from.bookingId);
    else if (placed.some((each) => each.block.id === (asked.from.kind === 'grid' ? asked.from.pieceId : '')))
      setOpenId(asked.from.pieceId);
    else setFocus({ dayKey: asked.from.memberId });
  };
  /** Gone through: focus goes to its block while it still shows (a reassigned booking moved column), else its column. */
  const done = () => {
    setAsking(false);
    if (asked === undefined) return;
    if (asked.from.kind === 'grid') {
      setFocus({ dayKey: asked.from.memberId, ...(asked.kind === 'remove' ? {} : { blockId: asked.from.pieceId }) });
    } else setFocus({ dayKey: shownSelected });
  };
  const bookingCard = (booking: BookingListItem, from: Asked['from']) => (
    <BookingCard
      key={booking.id}
      booking={booking}
      personHref={personHref(booking)}
      locale={locale}
      actions={actions}
      managesHost={managesHost}
      onAsk={(kind, seats) => ask({ kind, booking, seats }, from)}
      focusOnMount={refocus === 'remove' ? undefined : refocus}
    />
  );
  const detail: ReactNode =
    open === undefined ? undefined : open.kind === 'booking' ? (
      bookingCard(open.booking, { kind: 'grid', pieceId: open.block.id, memberId: open.block.dayKey })
    ) : open.kind === 'closed' ? (
      managesHost(open.block.dayKey) ? (
        <BlockCard
          key={open.turn.key}
          turn={open.turn}
          locale={locale}
          isRemoveFocused={refocus === 'remove'}
          onRemove={() =>
            ask(
              { kind: 'remove', turn: open.turn },
              { kind: 'grid', pieceId: open.block.id, memberId: open.block.dayKey },
            )
          }
        />
      ) : (
        <BusyCard busy={open.turn} connection={undefined} locale={locale} />
      )
    ) : open.kind === 'busy' ? (
      <BusyCard busy={open.span} connection={undefined} locale={locale} />
    ) : (
      <EventCard
        event={open.event}
        connection={props.connections.find((connection) => connection.id === open.event.connectionId)}
        locale={locale}
      />
    );
  const laneBooking = laneOpen === undefined ? undefined : byBooking.get(laneOpen);
  const issues = answer?.issues ?? [];
  const outside = issues.filter((issue) => issue.kind === 'outsideHours');
  const clashes = issues.filter((issue) => issue.kind === 'clash');
  const issueItem = (issue: TeamDayIssue, index: number) => {
    const booking = byBooking.get(issue.bookingId);
    const column = columnOf(issue.memberId);
    if (booking === undefined || column === undefined) return null;
    return (
      <MenuItem
        key={`${issue.kind}:${String(index)}`}
        id={`${issue.memberId}:${issue.bookingId}:${String(index)}`}
        description={timeRange(booking.startsAt, booking.endsAt, locale, timeZone)}
      >
        {strings.issueLine(booking.pageTitle, column.name)}
      </MenuItem>
    );
  };
  const issuesButton =
    issues.length === 0 || props.issuesSlot === null
      ? null
      : createPortal(
          <MenuTrigger>
            <Button variant="warning" icon="triangle-alert" iconRight="chevron-down">
              {strings.issuesCount(issues.length)}
            </Button>
            <Menu
              label={strings.issuesMenu}
              onAction={(key) => {
                const [memberId = '', bookingId = ''] = String(key).split(':');
                setSelected(memberId);
                // Its block, focused and scrolled to: Enter opens its card.
                setFocus({ dayKey: memberId, blockId: `${memberId}:${bookingId}`, isAsked: true });
              }}
            >
              {outside.length > 0 && <MenuSection label={strings.issuesOutside}>{outside.map(issueItem)}</MenuSection>}
              {clashes.length > 0 && <MenuSection label={strings.issuesClashes}>{clashes.map(issueItem)}</MenuSection>}
            </Menu>
          </MenuTrigger>,
          props.issuesSlot,
        );
  const drawnFor = draft === undefined ? undefined : columnOf(draft.memberId);
  const drawnSpan: DrawnSpan | undefined =
    draft === undefined
      ? undefined
      : { dayKey: day, startMinute: draft.span.startMinute, endMinute: draft.span.endMinute };
  // Behind New meeting or Time off the span stays drawn, with no card, so focus has its column back afterwards.
  const kept = meeting ?? timeOffFor;
  const others = columns.filter((column) => column.memberId !== me);
  const drawLength = props.pages.find((page) => page.status === 'live')?.durations[0] ?? 30;
  return (
    <>
      {issuesButton}
      <TeamDay
        isTitleShown={props.isTitleOrder}
        label={strings.teamLabel(
          new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
            new Date(`${day}T12:00:00Z`),
          ),
        )}
        people={people}
        selectedPerson={shownSelected}
        onSelectPerson={setSelected}
        blocks={blocks}
        isLoading={state.status === 'loading'}
        isFill
        zone={props.zone}
        hourLabel={(hour) => hourFormat.format(new Date(2000, 0, 1, hour))}
        minuteLabel={minuteLabel}
        {...(nowMinute === undefined ? {} : { now: { dayKey: day, minute: nowMinute, label: props.nowLabel } })}
        scrollToMinute={scrollTo}
        openHours={(memberId) => openByColumn.get(memberId)}
        emptyHint={strings.noMeetingsDay}
        {...(openId === undefined ? {} : { openId })}
        {...(detail === undefined ? {} : { detail })}
        onOpen={(id) => {
          setDraft(undefined);
          setLaneOpen(undefined);
          setRefocus(undefined);
          setOpenId(id);
        }}
        onClose={() => {
          setRefocus(undefined);
          setOpenId(undefined);
        }}
        {...(focus === undefined ? {} : { focusPerson: focus })}
        onDraw={(span) => {
          const column = columnOf(span.dayKey);
          if (column === undefined) return;
          setOpenId(undefined);
          // See only (AC-773): the column draws nothing (`canAct`); the server refuses it anyway.
          if (column.memberId !== me && !column.canManage) return;
          setDrawCount((count) => count + 1);
          setDraft({ memberId: column.memberId, span });
        }}
        drawMinutes={drawLength}
        // Enter on a column draws from where that person's hours begin (else 9:00).
        drawStartMinute={(memberId) => openByColumn.get(memberId)?.[0]?.startMinute ?? 9 * 60}
        {...(kept !== undefined
          ? {
              draft: kept.span,
              draftLabel: strings.drawCard(spanNames({ ...kept.span, dayKey: day }, locale, timeZone).title),
            }
          : draft === undefined || drawnSpan === undefined || drawnFor === undefined
            ? {}
            : {
                draft: draft.span,
                draftLabel: strings.drawCard(spanNames(drawnSpan, locale, timeZone).title),
                draftCard: (
                  <DrawCard
                    key={drawCount}
                    span={drawnSpan}
                    locale={locale}
                    privatePages={props.pages
                      .filter((page) => page.isPrivate && page.ownerMemberId === me)
                      .map((page) => ({ id: page.id, title: page.title }))}
                    createLinkOnlyHref={newLinkOnlyPageHref(slug)}
                    overlapping={
                      drawnFor.items.filter((item) => {
                        if (item.kind !== 'booking') return false;
                        const start = instantOf(day, draft.span.startMinute, timeZone).getTime();
                        const end = instantOf(day, draft.span.endMinute, timeZone).getTime();
                        return Date.parse(item.startsAt) < end && Date.parse(item.endsAt) > start;
                      }).length
                    }
                    onSpanChange={(next) =>
                      setDraft({
                        memberId: draft.memberId,
                        span: { dayKey: draft.memberId, startMinute: next.startMinute, endMinute: next.endMinute },
                      })
                    }
                    forPeople={forPeople}
                    {...(drawnFor.memberId === me ? {} : { initialFor: drawnFor.memberId })}
                    onTimeOff={() => {
                      setTimeOffFor({ ...draft, name: drawnFor.name });
                      setDraft(undefined);
                    }}
                    onClose={({ kind, repeat, label, pageId, forMemberId }) => {
                      const drawn = draft;
                      const whose = forMemberId ?? me ?? drawnFor.memberId;
                      const preview: BlockPreview = {
                        kind,
                        repeat,
                        ...(label === undefined ? {} : { label }),
                        startsAt: instantOf(day, drawn.span.startMinute, timeZone).toISOString(),
                        endsAt: instantOf(day, drawn.span.endMinute, timeZone).toISOString(),
                      };
                      return props
                        .onBlock(
                          {
                            kind,
                            repeat,
                            date: day,
                            startMinute: drawn.span.startMinute,
                            endMinute: drawn.span.endMinute,
                            timeZone,
                            ...(label === undefined ? {} : { label }),
                            ...(pageId === undefined ? {} : { pageId }),
                            ...(forMemberId === undefined ? {} : { forMemberId }),
                          },
                          forMemberId === undefined ? [preview] : [],
                          { memberId: whose, preview: [preview] },
                        )
                        .then(
                          (made) => {
                            // Saved: its card closes (not a newer span drawn meanwhile), and the toast offers Undo.
                            if (draftRef.current === drawn) setDraft(undefined);
                            const name = forPeople.find((person) => person.id === forMemberId)?.name;
                            const toast = toasts.toast({
                              tone: 'success',
                              message:
                                kind === 'hold'
                                  ? strings.timeHeld
                                  : name === undefined
                                    ? strings.timeBlocked
                                    : strings.timeBlockedFor(name),
                              action: {
                                label: strings.undo,
                                onAction: () => {
                                  toasts.dismiss(toast);
                                  props.onRemoveBlock(made.id).then(
                                    () => toasts.toast({ tone: 'success', message: strings.reopened }),
                                    () => toasts.toast({ tone: 'danger', message: strings.removeFailed }),
                                  );
                                },
                              },
                            });
                          },
                          (error: unknown) => {
                            // The card shows a refusal while it is open; once closed, only a toast can.
                            if (draftRef.current !== drawn) {
                              toasts.toast({
                                tone: 'danger',
                                message: kind === 'hold' ? strings.holdFailed : strings.blockFailed,
                              });
                            }
                            throw error;
                          },
                        );
                    }}
                    {...(canBookFor(drawnFor.memberId) && instantOf(day, draft.span.startMinute, timeZone) >= props.now
                      ? {
                          onBook: () => {
                            setMeeting(draft);
                            setDraft(undefined);
                          },
                        }
                      : {})}
                  />
                ),
              })}
        onDraftClose={() => setDraft(undefined)}
        lane={{
          rows: laneRows,
          ...(laneOpen === undefined ? {} : { openId: laneOpen }),
          ...(laneBooking === undefined
            ? {}
            : { detail: bookingCard(laneBooking, { kind: 'lane', bookingId: laneBooking.id }) }),
          onOpen: (id) => {
            setOpenId(undefined);
            setRefocus(undefined);
            setLaneOpen(id);
          },
          onClose: () => {
            setRefocus(undefined);
            setLaneOpen(undefined);
          },
        }}
      />
      {answer?.truncated !== undefined && (
        <Callout tone="info" isAnnounced>
          {strings.teamTruncated(answer.truncated.shown, answer.truncated.total)}
        </Callout>
      )}
      {asked?.kind === 'remove' && (
        <RemoveBlockDialog
          key={asked.opening}
          turn={asked.turn}
          isOpen={isAsking}
          locale={locale}
          onRemove={() =>
            props.onRemoveBlock(asked.turn.blockId).then(() => {
              done();
              toasts.toast({ tone: 'success', message: strings.reopened });
            })
          }
          onClose={dismiss}
        />
      )}
      {asked?.kind === 'reassign' && isAsking && actions !== undefined && (
        <ReassignDialog
          key={asked.opening}
          booking={byBooking.get(asked.booking.id) ?? asked.booking}
          seats={asked.seats}
          actions={actions}
          onClose={dismiss}
          onReassigned={done}
        />
      )}
      {asked?.kind === 'reassignAway' && isAsking && actions !== undefined && (
        <AwayReassignDialog
          key={asked.opening}
          booking={byBooking.get(asked.booking.id) ?? asked.booking}
          seats={asked.seats}
          actions={actions}
          onClose={dismiss}
          onReassigned={done}
        />
      )}
      {asked !== undefined &&
        asked.kind !== 'remove' &&
        asked.kind !== 'reassign' &&
        asked.kind !== 'reassignAway' &&
        actions !== undefined && (
          <BookingDialog
            key={asked.opening}
            booking={byBooking.get(asked.booking.id) ?? asked.booking}
            actions={actions}
            locale={locale}
            ask={isAsking ? asked.kind : undefined}
            onClose={dismiss}
            onDone={done}
          />
        )}
      {meeting !== undefined && (
        <NewMeetingDialog
          span={{ dayKey: day, startMinute: meeting.span.startMinute, endMinute: meeting.span.endMinute }}
          onSpanChange={(span) =>
            setMeeting({
              memberId: meeting.memberId,
              span: { dayKey: meeting.memberId, startMinute: span.startMinute, endMinute: span.endMinute },
            })
          }
          locale={locale}
          hasCalendar={props.connections.length > 0}
          pages={props.pages.filter((page) => page.status === 'live')}
          forPeople={forPeople}
          {...(meeting.memberId === me ? {} : { initialFor: meeting.memberId })}
          newKey={props.newBookingKey}
          limitsAt={props.limitsAt}
          people={props.peopleSearch}
          calendars={props.calendars}
          pageDestination={props.pageDestination}
          onBook={async (input) => {
            const booked = await props.onBookAsHost(input);
            // Said as the week says it: the invitation goes from the reader's calendar only for their own booking.
            const fromMine = input.forMemberId === undefined && props.connections.length > 0;
            toasts.toast(
              booked.notInCrm === undefined
                ? {
                    tone: 'success',
                    message: fromMine ? strings.booked(input.name) : strings.bookedQuietly(input.name),
                  }
                : { tone: 'info', message: strings.bookedNotInCrm(input.name, booked.notInCrm) },
              booked.notInCrm === undefined ? undefined : { timeout: strings.notInCrmToastMs },
            );
          }}
          onClose={() => setMeeting(undefined)}
        />
      )}
      <TimeOffDialog
        data={data}
        slug={slug}
        member={
          timeOffFor === undefined || timeOffFor.memberId === me
            ? undefined
            : { id: timeOffFor.memberId, name: timeOffFor.name }
        }
        entry={undefined}
        initialDay={day}
        isOpen={timeOffFor !== undefined}
        people={others
          .filter((column) => column.memberId !== timeOffFor?.memberId)
          .map((column) => ({ id: column.memberId, name: column.name }))}
        onClose={() => setTimeOffFor(undefined)}
        onSaved={() => {
          const name = timeOffFor === undefined || timeOffFor.memberId === me ? undefined : timeOffFor.name;
          setTimeOffFor(undefined);
          toasts.toast({ tone: 'success', message: strings.timeOffSaved(name) });
        }}
        onOpenBookings={() => setTimeOffFor(undefined)}
      />
    </>
  );
}
