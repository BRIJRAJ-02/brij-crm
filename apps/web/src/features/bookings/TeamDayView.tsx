// Brief
// Purpose: the team's day side by side (spec 0030, as spec 0037 amends it): who is free, who is booked, who is away,
// what needs a host and what clashes, for everyone the reader may see.
// Main task: spot what needs doing (Needs a host, a clash, a meeting outside someone's hours) and act on a teammate's
// column (book someone in, block time, time off, reassign) where the reader Manages them.
// Leaves out: changing working hours (Availability › Team), dragging a booking to another column (Reassign from its
// card instead, AC-777), and colleagues' calendar details (Busy only, AC-770).
import type {
  DataLayer,
  TeamDayHeld,
  TeamDayIssue,
  TeamDayItem,
  BookingAssignment,
  BookingListItem,
  BookingPageView,
  CalendarConnectionView,
  CalendarListState,
  CalendarsHeld,
  ObjectSummary,
  PageDestinationState,
  RecordSearch,
  TeamDay as TeamDayAnswer,
  TeamDayColumn,
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
  type TeamDayLaneItem,
  type TeamDayPerson,
  type Toasts,
  type WeekCalendarBlock,
  type WeekCalendarSpan,
} from '@crm/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { offsetLabel } from '../../public/booking/time.ts';
import { CalendarHealthChip, useCalendarHealth, useSchedulingStore } from '../booking/CalendarHealth.tsx';
import { TimeOffDialog } from '../booking/TimeOffDialog.tsx';
import { membersSettingsHref } from '../settings/nav.ts';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { AwayReassignDialog } from './AwayReassignDialog.tsx';
import { BookingDialog, type BookingAsk, type HostBookingActions } from './BookingActions.tsx';
import { BlockCard, BookingCard, BusyCard, EventCard, RemoveBlockDialog, usePersonHref } from './BookingsScreen.tsx';
import { DrawCard, type ForPerson } from './DrawCard.tsx';
import { NewMeetingDialog, type NewMeeting } from './NewMeetingDialog.tsx';
import { ReassignDialog } from './ReassignDialog.tsx';
import { instantOf, spanNames, type DrawnSpan } from './span.ts';
import { strings } from './strings.ts';
import { minuteOfDay, scrollMinute, timeRange } from './week.ts';
import { newLinkOnlyPageHref } from '../booking/links.ts';
import type { BlockDraft, BlockPreview } from './BookingsScreen.tsx';

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
  /** Whether filters narrow the day (the empty state then offers to clear them). */
  readonly isFiltered: boolean;
  readonly onClearFilters: () => void;
  /** Where the toolbar holds the day's issue counts (AC-1436); null until it is drawn. */
  readonly issuesSlot: HTMLElement | null;
}

/** A card's question, drawn here (a dialog can't sit over the card's popover): numbered, so each mounts afresh. */
type Question =
  | { readonly kind: 'remove'; readonly turn: TimeBlockOccurrence }
  | { readonly kind: BookingAsk; readonly booking: BookingListItem; readonly seats: readonly BookingAssignment[] };

/** A question as the day holds it: numbered, so each one mounts its dialog afresh. */
type Asked = Question & { readonly opening: number };

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

/** The words on a booking's block when it is news: no show, needs a host, host away, outside hours, a clash. */
function bookingStatus(
  booking: BookingListItem,
  issues: readonly TeamDayIssue[],
  memberId: string,
): string | undefined {
  if (booking.noShow === true) return strings.noShow;
  if (booking.needsHost) return strings.needsHost;
  if (booking.hostAway === true) return strings.hostAway;
  const mine = issues.filter((issue) => issue.memberId === memberId && issue.bookingId === booking.id);
  if (mine.some((issue) => issue.kind === 'clash')) return strings.clash;
  if (mine.some((issue) => issue.kind === 'outsideHours')) return strings.outsideHours;
  return undefined;
}

/** A column's head: how the day stands, in a word or two. */
function statusOf(column: TeamDayColumn): Pick<TeamDayPerson, 'status' | 'tone'> {
  if (column.away !== undefined) return { status: strings.teamAway, tone: 'away' };
  if (column.booked > 0) return { status: strings.teamBooked(column.booked), tone: 'booked' };
  if (column.open.length === 0) return { status: strings.teamNoHours, tone: 'off' };
  return { status: strings.teamFree, tone: 'free' };
}

/** The Team day: the grid of people, the lane, the issue counts in the toolbar, and every dialog a card asks for. */
export function TeamDayView(props: TeamDayViewProps) {
  const { slug, data, held, day, timeZone, locale, toasts, actions } = props;
  const state = useTeamDay(held);
  const access = useMyAccess();
  const me = access?.memberId;
  const canInvite = useCan('members.invite');
  const personHref = usePersonHref(slug, props.objects);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [laneOpen, setLaneOpen] = useState<string | undefined>(undefined);
  const [asked, setAsked] = useState<Asked | undefined>(undefined);
  const [isAsking, setAsking] = useState(false);
  const [focus, setFocus] = useState<{ readonly dayKey: string; readonly blockId?: string } | undefined>(undefined);
  // A span drawn on someone's column, and whose; New meeting's span once Book someone in was chosen.
  const [draft, setDraft] = useState<{ readonly memberId: string; readonly span: WeekCalendarSpan } | undefined>(
    undefined,
  );
  const [drawCount, setDrawCount] = useState(0);
  const [meeting, setMeeting] = useState<{ readonly memberId: string; readonly span: DrawnSpan } | undefined>(
    undefined,
  );
  const [timeOffFor, setTimeOffFor] = useState<{ readonly id: string; readonly name: string } | undefined>(undefined);
  const answer = state.status === 'ready' ? state : undefined;
  const columns = answer?.columns ?? [];
  // Each colleague's calendar health on their head (spec 0037, AC-1307): quiet while all is well.
  const store = useSchedulingStore(data, columns.length > 1);
  const health = useCalendarHealth(
    store,
    slug,
    columns.filter((column) => column.memberId !== me).map((column) => column.memberId),
  );
  const byBooking = useMemo(() => new Map((answer?.bookings ?? []).map((booking) => [booking.id, booking])), [answer]);
  const placed = useMemo((): readonly Placed[] => {
    if (answer === undefined) return [];
    return answer.columns.flatMap((column) =>
      column.items.flatMap((item): Placed[] => {
        const { startsAt, endsAt } = spanOf(item);
        const startMinute = minuteIn(startsAt, answer, timeZone);
        const endMinute = Math.max(minuteIn(endsAt, answer, timeZone), startMinute + 1);
        const base = {
          dayKey: column.memberId,
          startMinute,
          endMinute,
          time: timeRange(startsAt, endsAt, locale, timeZone),
        };
        if (item.kind === 'booking') {
          const booking = byBooking.get(item.bookingId);
          if (booking === undefined) return [];
          const status = bookingStatus(booking, answer.issues, column.memberId);
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
        // An all day event of the reader's own would close the whole column: their week keeps those to the list.
        if (item.event.allDay) return [];
        return [
          {
            kind: 'event',
            event: item.event,
            block: { ...base, id: `${column.memberId}:event:${item.event.id}`, title: item.event.title, kind: 'event' },
          },
        ];
      }),
    );
  }, [answer, byBooking, locale, timeZone]);

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
  // Fewer than two people to show (AC-764): the reader alone, with no team or no reach over it.
  if (answer !== undefined && columns.length < 2 && !props.isFiltered && (answer.needsHost ?? []).length === 0) {
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
        {canInvite ? strings.teamNeedsTeamText : strings.teamNeedsTeamSolo}
      </EmptyState>
    );
  }

  const columnOf = (memberId: string) => columns.find((column) => column.memberId === memberId);
  const shownSelected =
    selected !== undefined && columnOf(selected) !== undefined ? selected : (columns[0]?.memberId ?? '');
  // Whom the reader may act for (AC-773): themself and the people they Manage, for For on the cards and dialogs.
  const forPeople: readonly ForPerson[] = columns
    .filter((column) => column.memberId !== me && column.canManage)
    .map((column) => ({ id: column.memberId, name: column.name }));
  const people: TeamDayPerson[] = columns.map((column) => {
    const { status, tone } = statusOf(column);
    const reason = column.away?.reason === undefined ? undefined : strings.awayReasons[column.away.reason];
    const differs = column.timeZone !== timeZone;
    const at = Date.parse(answer?.from ?? props.now.toISOString());
    const chip = health.get(column.memberId);
    return {
      id: column.memberId,
      name: column.name,
      ...(column.jobTitle === undefined ? {} : { title: column.jobTitle }),
      status,
      tone,
      ...(differs ? { badge: offsetLabel(column.timeZone, at) } : {}),
      ...(chip === undefined ? {} : { extra: <CalendarHealthChip state={chip} name={column.name} isQuiet /> }),
      label: strings.columnLabel(column.name, column.jobTitle, reason === undefined ? status : `${status}, ${reason}`),
      ...(column.away === undefined || answer === undefined
        ? {}
        : {
            band: {
              label: strings.awayBand(reason),
              startMinute: minuteIn(column.away.span.startsAt, answer, timeZone),
              endMinute: minuteIn(column.away.span.endsAt, answer, timeZone),
            },
          }),
    };
  });
  const blocks = placed.map((each) => each.block);
  const open = placed.find((each) => each.block.id === openId);
  const minuteLabel = (minute: number) => {
    const at = new Date(2000, 0, 1);
    at.setMinutes(minute);
    return memoIntl(
      `bookings-minute:${locale}`,
      () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
    ).format(at);
  };
  const hourFormat = memoIntl(`bookings-hour:${locale}`, () => new Intl.DateTimeFormat(locale, { hour: 'numeric' }));
  const ask = (question: Question) => {
    setOpenId(undefined);
    setLaneOpen(undefined);
    setAsked((was) => ({ ...question, opening: (was?.opening ?? 0) + 1 }));
    setAsking(true);
  };
  const bookingCard = (booking: BookingListItem) => (
    <BookingCard
      booking={booking}
      personHref={personHref(booking)}
      locale={locale}
      actions={actions}
      onAsk={(kind, seats) => ask({ kind, booking, seats })}
    />
  );
  const detail: ReactNode =
    open === undefined ? undefined : open.kind === 'booking' ? (
      bookingCard(open.booking)
    ) : open.kind === 'closed' ? (
      columnOf(open.block.dayKey)?.canManage === true || open.block.dayKey === me ? (
        <BlockCard turn={open.turn} locale={locale} onRemove={() => ask({ kind: 'remove', turn: open.turn })} />
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
  // The lane (AC-1435): Needs a host and Host away, by start.
  const laneItems: TeamDayLaneItem[] = (answer?.needsHost ?? []).flatMap((id) => {
    const booking = byBooking.get(id);
    if (booking === undefined) return [];
    const time = timeRange(booking.startsAt, booking.endsAt, locale, timeZone);
    const host = booking.hostRemoved === true || booking.hostName === '' ? strings.leftWorkspace : booking.hostName;
    const status = booking.needsHost ? strings.needsHost : strings.hostAway;
    return [
      {
        id,
        time,
        title: booking.pageTitle,
        detail: strings.laneDetail(booking.visitorName, host),
        status,
        label: strings.laneLabel(booking.pageTitle, time, booking.visitorName, status),
      },
    ];
  });
  const laneBooking = laneOpen === undefined ? undefined : byBooking.get(laneOpen);
  const issues = answer?.issues ?? [];
  const outside = issues.filter((issue) => issue.kind === 'outsideHours');
  const clashes = issues.filter((issue) => issue.kind === 'clash');
  const issueItem = (issue: TeamDayIssue, index: number) => {
    const booking = byBooking.get(issue.bookingId);
    const column = columnOf(issue.memberId);
    if (booking === undefined || column === undefined) return null;
    return (
      <MenuItem key={`${issue.kind}:${String(index)}`} id={`${issue.memberId}:${issue.bookingId}:${String(index)}`}>
        {strings.issueLine(
          timeRange(booking.startsAt, booking.endsAt, locale, timeZone),
          booking.pageTitle,
          column.name,
        )}
      </MenuItem>
    );
  };
  const issuesButton =
    issues.length === 0 || props.issuesSlot === null
      ? null
      : createPortal(
          <MenuTrigger>
            <Button variant="ghost" icon="triangle-alert">
              {strings.issuesSummary(outside.length, clashes.length)}
            </Button>
            <Menu
              label={strings.issuesMenu}
              onAction={(key) => {
                const [memberId = '', bookingId = ''] = String(key).split(':');
                setSelected(memberId);
                // Its block, focused and scrolled to: Enter opens its card.
                setFocus({ dayKey: memberId, blockId: `${memberId}:${bookingId}` });
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
  const others = columns.filter((column) => column.memberId !== me);
  return (
    <>
      {issuesButton}
      <TeamDay
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
        {...(props.isToday
          ? { now: { dayKey: day, minute: minuteOfDay(props.now, timeZone), label: props.nowLabel } }
          : {})}
        scrollToMinute={scrollMinute(
          [day],
          props.now,
          timeZone,
          blocks.map((block) => ({ startMinute: block.startMinute, endMinute: block.endMinute })),
          9 * 60,
        )}
        openHours={(memberId) => {
          const column = columnOf(memberId);
          if (column === undefined || answer === undefined) return undefined;
          return column.open.map((span) => ({
            startMinute: minuteIn(span.startsAt, answer, timeZone),
            endMinute: minuteIn(span.endsAt, answer, timeZone),
          }));
        }}
        emptyHint={strings.teamEmpty}
        {...(openId === undefined ? {} : { openId })}
        {...(detail === undefined ? {} : { detail })}
        onOpen={(id) => {
          setDraft(undefined);
          setLaneOpen(undefined);
          setOpenId(id);
        }}
        onClose={() => setOpenId(undefined)}
        {...(focus === undefined ? {} : { focusPerson: focus })}
        onDraw={(span) => {
          const column = columnOf(span.dayKey);
          if (column === undefined) return;
          setOpenId(undefined);
          // See only (AC-773): nothing to act on, and the reader is told why rather than nothing happening.
          if (column.memberId !== me && !column.canManage) {
            toasts.toast({ tone: 'info', message: strings.seeOnlyColumn(column.name) });
            return;
          }
          setDrawCount((count) => count + 1);
          setDraft({ memberId: column.memberId, span });
        }}
        drawMinutes={30}
        drawStartMinute={() => 9 * 60}
        {...(draft === undefined || drawnSpan === undefined || drawnFor === undefined
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
                    setDraft(undefined);
                    setTimeOffFor({ id: drawnFor.memberId, name: drawnFor.name });
                  }}
                  onClose={({ kind, repeat, label, pageId, forMemberId }) => {
                    const whose = forMemberId ?? me ?? drawnFor.memberId;
                    const preview: BlockPreview = {
                      kind,
                      repeat,
                      ...(label === undefined ? {} : { label }),
                      startsAt: instantOf(day, draft.span.startMinute, timeZone).toISOString(),
                      endsAt: instantOf(day, draft.span.endMinute, timeZone).toISOString(),
                    };
                    return props
                      .onBlock(
                        {
                          kind,
                          repeat,
                          date: day,
                          startMinute: draft.span.startMinute,
                          endMinute: draft.span.endMinute,
                          timeZone,
                          ...(label === undefined ? {} : { label }),
                          ...(pageId === undefined ? {} : { pageId }),
                          ...(forMemberId === undefined ? {} : { forMemberId }),
                        },
                        forMemberId === undefined ? [preview] : [],
                        { memberId: whose, preview: [preview] },
                      )
                      .then(() => {
                        setDraft(undefined);
                        const name = forPeople.find((person) => person.id === forMemberId)?.name;
                        toasts.toast({
                          tone: 'success',
                          message:
                            kind === 'hold'
                              ? strings.timeHeld
                              : name === undefined
                                ? strings.timeBlocked
                                : strings.timeBlockedFor(name),
                        });
                      });
                  }}
                  {...(props.pages.some((page) => page.status === 'live') &&
                  instantOf(day, draft.span.startMinute, timeZone) >= props.now
                    ? {
                        onBook: () => {
                          setMeeting({ memberId: draft.memberId, span: drawnSpan });
                          setDraft(undefined);
                        },
                      }
                    : {})}
                />
              ),
            })}
        onDraftClose={() => setDraft(undefined)}
        lane={{
          items: laneItems,
          ...(laneOpen === undefined ? {} : { openId: laneOpen }),
          ...(laneBooking === undefined ? {} : { detail: bookingCard(laneBooking) }),
          onOpen: (id) => {
            setOpenId(undefined);
            setLaneOpen(id);
          },
          onClose: () => setLaneOpen(undefined),
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
              setAsking(false);
              toasts.toast({ tone: 'success', message: strings.reopened });
            })
          }
          onClose={() => setAsking(false)}
        />
      )}
      {asked?.kind === 'reassign' && isAsking && actions !== undefined && (
        <ReassignDialog
          key={asked.opening}
          booking={byBooking.get(asked.booking.id) ?? asked.booking}
          seats={asked.seats}
          actions={actions}
          onClose={() => setAsking(false)}
          onReassigned={() => setAsking(false)}
        />
      )}
      {asked?.kind === 'reassignAway' && isAsking && actions !== undefined && (
        <AwayReassignDialog
          key={asked.opening}
          booking={byBooking.get(asked.booking.id) ?? asked.booking}
          seats={asked.seats}
          actions={actions}
          onClose={() => setAsking(false)}
          onReassigned={() => setAsking(false)}
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
            onClose={() => setAsking(false)}
            onDone={() => setAsking(false)}
          />
        )}
      {meeting !== undefined && (
        <NewMeetingDialog
          span={meeting.span}
          onSpanChange={(span) => setMeeting({ memberId: meeting.memberId, span: { ...span, dayKey: day } })}
          locale={locale}
          hasCalendar={props.connections.length > 0}
          pages={props.pages.filter((page) => page.status === 'live')}
          forPeople={forPeople}
          {...(meeting.memberId === me ? {} : { initialFor: meeting.memberId })}
          newKey={props.newBookingKey}
          people={props.peopleSearch}
          calendars={props.calendars}
          pageDestination={props.pageDestination}
          onBook={async (input) => {
            const booked = await props.onBookAsHost(input);
            toasts.toast(
              booked.notInCrm === undefined
                ? { tone: 'success', message: strings.booked(input.name) }
                : { tone: 'info', message: strings.bookedNotInCrm(input.name, booked.notInCrm) },
            );
          }}
          onClose={() => setMeeting(undefined)}
        />
      )}
      <TimeOffDialog
        data={data}
        slug={slug}
        member={timeOffFor === undefined || timeOffFor.id === me ? undefined : timeOffFor}
        entry={undefined}
        isOpen={timeOffFor !== undefined}
        people={others
          .filter((column) => column.memberId !== timeOffFor?.id)
          .map((column) => ({ id: column.memberId, name: column.name }))}
        onClose={() => setTimeOffFor(undefined)}
        onSaved={() => {
          const name = timeOffFor === undefined || timeOffFor.id === me ? undefined : timeOffFor.name;
          setTimeOffFor(undefined);
          toasts.toast({ tone: 'success', message: strings.timeOffSaved(name) });
          held.reload();
        }}
        onOpenBookings={() => setTimeOffFor(undefined)}
      />
    </>
  );
}
