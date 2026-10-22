// Brief
// Purpose: Bookings › Calendar and Bookings › List (spec 0025, AC-646), on the reference product's bookings page: a week calendar (bookings and the member's own calendar events) and a list (Upcoming, Past, Canceled) with sort and pages.
// Main task: see the week at a glance, open a booking or an event for its details, or page through the list.
// Leaves out: changing a booking from here (the actions arrive next), the new meeting dialog, team views and filing, and live arrival (it reads again when the page is shown again).
import {
  isDataError,
  type BookingAssignment,
  type BookingListItem,
  type BookingPageView,
  type BookingsCalendarHeld,
  type BookingsTab,
  type MeetingListItem,
  type MeetingSource,
  type MeetingsHeld,
  type MeetingsQuery,
  type CalendarConnectionView,
  type CalendarListState,
  type CalendarsHeld,
  type CalendarEventItem,
  type ObjectSummary,
  type CreateTimeBlockInput,
  type TimeBlockOccurrence,
} from '@crm/data';
import { useBookingsCalendar, useCalendarList, useMeetings } from '@crm/data/react';
import {
  BookingList,
  Button,
  ButtonLink,
  Callout,
  DescriptionList,
  EmptyState,
  Link,
  MeetingCard,
  memoIntl,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Modal,
  PageColumn,
  VisuallyHidden,
  Panel,
  SectionBar,
  SegmentedControl,
  useFormatSettings,
  useKeyboardPlatform,
  focusLater,
  Skeleton,
  WeekCalendar,
  type BookingListGroup,
  type Hue,
  type Toasts,
  type WeekCalendarBlock,
  type MeetingCardRow,
} from '@crm/ui';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { offsetLabel, zoneDisplay } from '../../public/booking/time.ts';
import { providerOf } from './provider.ts';
import { useNow } from './useNow.ts';
import { createPortal } from 'react-dom';
import { newLinkOnlyPageHref } from '../booking/links.ts';
import { linksHref } from '../captures/tabs.ts';
import { recordLinks, type RecordLink } from '../records/timeline.ts';
import { belongsElsewhere, isUndoKey, type KeyTarget } from '../workspace/undo.ts';
import { CalendarsFrame, CalendarsToggle, useCalendarsPanel, type CalendarsPanel } from './CalendarsAside.tsx';
import { calendarSettingsHref } from '../settings/nav.ts';
import { DrawCard } from './DrawCard.tsx';
import { NewMeetingDialog, type NewMeeting } from './NewMeetingDialog.tsx';
import { instantOf, spanNames, type DrawnSpan } from './span.ts';
import type { BookingsSearch } from './search.ts';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { assignedItems } from './assignment.ts';
import { ReassignDialog } from './ReassignDialog.tsx';
import { BookingDialog, useBookingActions, type BookingAsk, type HostBookingActions } from './BookingActions.tsx';
import { strings } from './strings.ts';
import { useBookingsToolbarSlot } from './toolbarSlot.ts';
import {
  addDays,
  allDayKeys,
  bookingPieces,
  dayKeyOf,
  minuteOfDay,
  eventPieces,
  piecesOf,
  rangeLabel,
  scrollMinute,
  shownWeek,
  timeRange,
  weekBounds,
  weekDays,
  weekOf,
} from './week.ts';
import { useFirstDay } from '../workspace/first-day.ts';

export type { BookingsTab };
export type { BookingsSearch };

/** The list's tabs, in order. */
export const TABS: readonly BookingsTab[] = ['upcoming', 'past', 'cancelled'];

/** Each connection's hue, in the order they were connected. */
const CALENDAR_HUES: readonly Hue[] = ['blue', 'green', 'purple', 'orange', 'sky', 'yellow', 'red', 'lime'];

/**
 * Where, as the card's row: a call by its provider ("Google Meet", never its address; Join is in the footer), a
 * phone call, or the place.
 */
function whereRowOf(booking: BookingListItem): Pick<MeetingCardRow, 'icon' | 'label' | 'value'> {
  switch (booking.location.type) {
    case 'video':
      return {
        icon: 'video',
        label: strings.where,
        value: booking.videoUrl === undefined ? strings.video : providerOf(booking.videoUrl),
      };
    case 'phone':
      return { icon: 'phone', label: strings.where, value: strings.phone };
    default:
      return { icon: 'map-pin', label: strings.where, value: booking.location.value };
  }
}

/** Where a booking stands, as the card's quiet dot beside its time. */
function statusOf(booking: BookingListItem): { readonly label: string; readonly hue: Hue } {
  if (booking.status === 'cancelled') return { label: strings.status.cancelled, hue: 'gray' };
  if (booking.needsHost) return { label: strings.needsHost, hue: 'orange' };
  if (booking.noShow === true) return { label: strings.noShow, hue: 'red' };
  return { label: strings.status.confirmed, hue: 'green' };
}

/**
 * A card with nothing to change (no host actions given): the footer hook still runs, as hooks must, and these are
 * never called, since the card draws no footer then.
 */
const NO_ACTIONS: HostBookingActions = {
  cancel: () => Promise.reject(new Error('no actions')),
  move: () => Promise.reject(new Error('no actions')),
  moveSlots: () => Promise.reject(new Error('no actions')),
  guestLink: () => Promise.reject(new Error('no actions')),
  assignments: () => Promise.resolve([]),
  reassign: () => Promise.reject(new Error('no actions')),
  rotations: () => Promise.resolve([]),
  markNoShow: () => Promise.reject(new Error('no actions')),
  notify: () => undefined,
};

/** The person's page, when the booking names one and the reader can open People. */
function personHrefOf(booking: BookingListItem, link: RecordLink, people: ObjectSummary | undefined) {
  return booking.personRecordId === undefined || people === undefined
    ? undefined
    : link(people.id, booking.personRecordId);
}

/** "Monday, 19 October · 9:00 – 9:30 AM". */
function whenOf(startsAt: string, endsAt: string, locale: string, zone: string): string {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  }).format(new Date(startsAt));
  return `${day} · ${timeRange(startsAt, endsAt, locale, zone)}`;
}

/**
 * An all day event's days: its dates, read as calendar dates (kept as midnight UTC, the end day left out), never
 * moved into the local zone. "Friday, October 23 · All day", or "Friday, October 23 to Saturday, October 24".
 */
function allDayWhenOf(startsAt: string, endsAt: string, locale: string): string {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const first = new Date(`${startsAt.slice(0, 10)}T12:00:00`);
  const last = new Date(`${endsAt.slice(0, 10)}T12:00:00`);
  last.setDate(last.getDate() - 1);
  return last <= first
    ? `${format.format(first)} · ${strings.allDay}`
    : strings.dayToDay(format.format(first), format.format(last));
}

/**
 * Filter: one link's bookings (the calendars are the panel beside the view), and on the list which meetings show
 * (All, Bookings or Calendar events), each its own group of one choice. With nothing to choose, no button. Filtered,
 * it reads "Filter · N", with a quiet clear beside it.
 */
function FilterMenu({
  search,
  pages,
  onSearch,
  hasSources = false,
}: {
  readonly search: BookingsSearch;
  readonly pages: readonly BookingPageView[];
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
  /** The list: which meetings show is chosen here too. */
  readonly hasSources?: boolean;
}) {
  const hasLinks = pages.length >= 2;
  if (!hasLinks && !hasSources) return null;
  const count =
    (search.link === undefined ? 0 : 1) + (hasSources && search.source !== 'all' && search.link === undefined ? 1 : 0);
  // A link's bookings are bookings only (calendar events have no page), so Show says so while one is picked.
  const shownSource = search.link === undefined ? search.source : 'bookings';
  const first = (keys: ReadonlySet<string | number>) => [...keys].map(String)[0];
  return (
    <>
      <MenuTrigger>
        <Button icon="list-filter">{count === 0 ? strings.filter : strings.filterCount(count)}</Button>
        <Menu label={strings.filterMenu}>
          {hasSources && (
            <MenuSection
              label={strings.sourceLabel}
              selectionMode="single"
              selectedKeys={[shownSource]}
              onSelectionChange={(keys) => {
                const source = SOURCES.find((each) => each === first(keys));
                if (source !== undefined) onSearch({ source, ...(source === 'bookings' ? {} : { link: undefined }) });
              }}
            >
              {SOURCES.map((id) => (
                <MenuItem key={id} id={id}>
                  {strings.sources[id]}
                </MenuItem>
              ))}
            </MenuSection>
          )}
          {hasLinks && (
            <MenuSection
              label={strings.links}
              selectionMode="single"
              // Its own key, apart from Show's "all": one menu holds both groups.
              selectedKeys={[search.link ?? 'all-links']}
              onSelectionChange={(keys) => {
                const link = first(keys);
                if (link !== undefined) onSearch({ link: link === 'all-links' ? undefined : link });
              }}
            >
              <MenuItem id="all-links">{strings.allLinks}</MenuItem>
              {pages.map((page) => (
                <MenuItem key={page.id} id={page.id}>
                  {page.title}
                </MenuItem>
              ))}
            </MenuSection>
          )}
        </Menu>
      </MenuTrigger>
      {count > 0 && (
        <Button
          variant="ghost"
          icon="x"
          label={strings.clearFilters}
          onPress={() => onSearch({ link: undefined, ...(hasSources ? { source: 'all' as const } : {}) })}
        />
      )}
    </>
  );
}

/** A booking's card: its state, the guest, when, who, the note, Join call, and the host's changes while it's ahead. */
function BookingCard({
  booking,
  personHref,
  locale,
  actions,
  onAsk,
  focusOnMount,
  headingLevel = 3,
}: {
  readonly booking: BookingListItem;
  readonly personHref: string | undefined;
  readonly locale: string;
  readonly actions?: HostBookingActions | undefined;
  /** In the week's popover: Reschedule and Cancel booking are drawn by the screen (see useBookingActions). */
  readonly onAsk?: ((ask: BookingAsk) => void) | undefined;
  /** The button to focus as the card opens again after the screen's dialog was dismissed. */
  readonly focusOnMount?: BookingAsk | undefined;
  /** 3 in the week's popover or sheet; 4 under the List's panel title. */
  readonly headingLevel?: 3 | 4;
}) {
  // The member's zone (their Preferences, else the browser's), as the week is drawn in.
  const { timeZone } = useFormatSettings();
  // Read again when its host changes (a reassign or a move through the rotation lands).
  // Read again after a reassign here (a second rotation's seat leaves the organiser as it was).
  const [reads, setReads] = useState(0);
  const read = useAssignments(booking.id, actions, `${booking.hostMemberId}:${String(reads)}`);
  const assigned =
    read === undefined
      ? []
      : 'failed' in read
        ? [{ term: strings.assignedTerm, description: strings.assignedFailed }]
        : assignedItems(read.rows, locale);
  const seats = read === undefined || 'failed' in read ? [] : read.rows.filter((row) => row.voidedAt === undefined);
  // Admins reassign a round robin seat (AC-748; Manage over both hosts, today booking.admin's, AC-1337).
  const canReassign = useCan('booking.admin');
  const [reassigning, setReassigning] = useState(false);
  const [isChatOpen, setChatOpen] = useState(false);
  const chatId = useId();
  const footer = useBookingActions({
    booking,
    actions: actions ?? NO_ACTIONS,
    locale,
    ...(onAsk === undefined ? {} : { onAsk }),
    ...(focusOnMount === undefined ? {} : { focusOnMount }),
    ...(canReassign && seats.length > 0
      ? {
          onReassign: () => {
            setReassigning(true);
          },
        }
      : {}),
  });
  const hasActions = actions !== undefined;
  const now = useNow();
  const isConfirmed = booking.status === 'confirmed';
  const hasNotice = booking.hostRemoved === true || (isConfirmed && (booking.eventFailed || booking.needsHost));
  const notices = hasNotice ? (
    <>
      {booking.hostRemoved === true && <Callout tone="info">{strings.hostRemoved}</Callout>}
      {booking.eventFailed && isConfirmed && <Callout tone="warning">{strings.eventFailed}</Callout>}
      {booking.needsHost && isConfirmed && (
        <Callout tone="warning" title={strings.needsHost}>
          {strings.needsHostText}
        </Callout>
      )}
    </>
  ) : undefined;
  // Join is the card's own, first and primary while the call can be joined, so a reader without host actions
  // still joins.
  const join =
    booking.status === 'confirmed' && booking.videoUrl !== undefined && Date.parse(booking.endsAt) > now.getTime() ? (
      <ButtonLink
        variant="primary"
        size="lg"
        icon="video"
        href={booking.videoUrl}
        isExternal
        label={strings.joinProvider(providerOf(booking.videoUrl))}
      >
        {strings.join}
      </ButtonLink>
    ) : undefined;
  const footerActions =
    join === undefined && (!hasActions || footer.actions === undefined) ? undefined : (
      <>
        {join}
        {hasActions && footer.actions}
      </>
    );
  return (
    <>
      <MeetingCard
        headingLevel={headingLevel}
        title={strings.cardTitle(booking.visitorName, booking.pageTitle)}
        when={whenOf(booking.startsAt, booking.endsAt, locale, timeZone)}
        status={statusOf(booking)}
        {...(notices === undefined ? {} : { notices })}
        peopleLabel={strings.cardPeople}
        people={[
          {
            id: `${booking.id}-guest`,
            name: booking.visitorName,
            ...(personHref === undefined ? {} : { href: personHref }),
            detail: booking.visitorEmail,
            isDetailCopyable: true,
          },
          ...booking.guests.map((guest) => ({ id: `${booking.id}-${guest}`, name: guest })),
        ]}
        rows={[
          { id: 'where', ...whereRowOf(booking) },
          ...(booking.note === undefined
            ? []
            : [
                {
                  id: 'note',
                  icon: 'message-square' as const,
                  label: strings.note,
                  value: strings.quoted(booking.note),
                },
              ]),
          ...(booking.chat === undefined
            ? []
            : [
                {
                  id: 'chat',
                  icon: 'bot' as const,
                  label: strings.bookedHow,
                  value: strings.bookedByChat,
                  action: (
                    <Button
                      variant="ghost"
                      isExpanded={isChatOpen}
                      controls={chatId}
                      onPress={() => setChatOpen((open) => !open)}
                    >
                      {isChatOpen ? strings.hideChat : strings.viewChat(booking.chat.length)}
                    </Button>
                  ),
                  children: (
                    <div id={chatId} hidden={!isChatOpen}>
                      {isChatOpen && (
                        <DescriptionList
                          layout="stacked"
                          items={booking.chat.map((line, index) => ({
                            id: String(index),
                            term: line.role === 'visitor' ? strings.chatVisitor : strings.chatAssistant,
                            description: line.text,
                          }))}
                        />
                      )}
                    </div>
                  ),
                },
              ]),
          ...(booking.cancelReason === undefined
            ? []
            : [{ id: 'reason', icon: 'circle-x' as const, label: strings.cancelReason, value: booking.cancelReason }]),
          ...assigned.map((item, index) => ({
            id: `assigned-${String(index)}`,
            icon: 'users-round' as const,
            label: item.term,
            value: item.description,
          })),
        ]}
        {...(footerActions === undefined ? {} : { actions: footerActions })}
      />
      {hasActions && footer.dialogs}
      {reassigning && actions !== undefined && (
        <ReassignDialog
          booking={booking}
          seats={seats}
          actions={actions}
          onClose={() => {
            setReassigning(false);
          }}
          onReassigned={() => {
            setReassigning(false);
            setReads((count) => count + 1);
          }}
        />
      )}
    </>
  );
}

/**
 * The booking's ledger rows (spec 0029, AC-742): read once per opened booking, newest first; none for a personal
 * page's booking. Undefined while the read is under way, so the Assigned lines simply appear.
 */
function useAssignments(
  bookingId: string,
  actions: HostBookingActions | undefined,
  /** Changes when the rows may have: the host, or a reassign done here. */
  version: string,
): { readonly rows: readonly BookingAssignment[] } | { readonly failed: true } | undefined {
  const [read, setRead] = useState<
    | { readonly id: string; readonly rows: readonly BookingAssignment[] }
    | { readonly id: string; readonly failed: true }
    | undefined
  >(undefined);
  useEffect(() => {
    if (actions === undefined) return;
    let isCurrent = true;
    actions.assignments(bookingId).then(
      (rows) => {
        if (isCurrent) setRead({ id: bookingId, rows });
      },
      () => {
        if (isCurrent) setRead({ id: bookingId, failed: true });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [actions, bookingId, version]);
  return read === undefined || read.id !== bookingId ? undefined : read;
}

/** One of the member's own calendar events: what, when, which calendar, and that Timefix doesn't manage it. */
function EventCard({
  event,
  connection,
  locale,
  headingLevel = 3,
}: {
  readonly event: CalendarEventItem;
  readonly connection: CalendarConnectionView | undefined;
  readonly locale: string;
  /** 3 in the week's popover or sheet; 4 under the List's panel title. */
  readonly headingLevel?: 3 | 4;
}) {
  // The member's zone (their Preferences, else the browser's), as the week is drawn in.
  const { timeZone } = useFormatSettings();
  const now = useNow();
  return (
    <MeetingCard
      headingLevel={headingLevel}
      title={event.title}
      when={
        event.allDay
          ? allDayWhenOf(event.startsAt, event.endsAt, locale)
          : whenOf(event.startsAt, event.endsAt, locale, timeZone)
      }
      rows={[
        ...(event.location === undefined
          ? []
          : [{ id: 'where', icon: 'map-pin' as const, label: strings.where, value: event.location }]),
        ...(event.videoUrl === undefined
          ? []
          : [{ id: 'call', icon: 'video' as const, label: strings.call, value: providerOf(event.videoUrl) }]),
        ...(connection === undefined
          ? []
          : [{ id: 'calendar', icon: 'calendar' as const, label: strings.calendar, value: connection.accountEmail }]),
        // Why it has no actions here, with a connection or without.
        { id: 'managed', icon: 'info' as const, label: strings.calendar, value: strings.fromCalendar },
      ]}
      {...(event.videoUrl === undefined || Date.parse(event.endsAt) <= now.getTime()
        ? {}
        : {
            actions: (
              <ButtonLink
                variant="primary"
                size="lg"
                icon="video"
                href={event.videoUrl}
                isExternal
                label={strings.joinProvider(providerOf(event.videoUrl))}
              >
                {strings.join}
              </ButtonLink>
            ),
          })}
    />
  );
}

/** A busy time's card: when, that it is busy and why, and which calendar holds it. Nothing more is kept. */
function BusyCard({
  busy,
  connection,
  locale,
  headingLevel = 3,
}: {
  readonly busy: { readonly startsAt: string; readonly endsAt: string };
  readonly connection: CalendarConnectionView | undefined;
  readonly locale: string;
  /** 3 in the week's popover or sheet; 4 under the List's panel title. */
  readonly headingLevel?: 3 | 4;
}) {
  // The member's zone (their Preferences, else the browser's), as the week is drawn in.
  const { timeZone } = useFormatSettings();
  return (
    <MeetingCard
      headingLevel={headingLevel}
      title={strings.busy}
      when={whenOf(busy.startsAt, busy.endsAt, locale, timeZone)}
      rows={[
        ...(connection === undefined
          ? []
          : [{ id: 'calendar', icon: 'calendar' as const, label: strings.calendar, value: connection.accountEmail }]),
        { id: 'why', icon: 'info' as const, label: strings.busy, value: strings.busyNote },
      ]}
    />
  );
}

/** What removing closed time asks: its title, what reopens, and the commit's words, busy and not. */
function removeWords(
  turn: Pick<TimeBlockOccurrence, 'kind' | 'repeat' | 'label' | 'startsAt' | 'endsAt'>,
  locale: string,
  zone: string,
): { readonly title: string; readonly text: string; readonly action: string; readonly busy: string } {
  const start = new Date(turn.startsAt);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone });
  const from = clock.format(start);
  const to = clock.format(new Date(turn.endsAt));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: zone }).format(start);
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  }).format(start);
  if (turn.kind === 'hold') {
    return {
      title: strings.releaseHoldTitle(turn.label),
      text: strings.releasesHold(day, from, to),
      action: strings.releaseHoldAction,
      busy: strings.releasing,
    };
  }
  if (turn.repeat === 'weekly') {
    return {
      title: strings.removeWeeklyTitle(turn.label),
      text: strings.reopensWeekly(weekday, from, to),
      action: strings.removeEvery(weekday),
      busy: strings.removing,
    };
  }
  return {
    title: strings.removeBlockTitle(turn.label),
    text: strings.reopensOnce(day, from, to),
    action: strings.removeBlockAction,
    busy: strings.removing,
  };
}

/**
 * A block's or hold's card: when, why, whether it repeats, what it does, and
 * Remove (Release for a hold; for a weekly block, every week). Remove asks
 * first, since nothing brings a removed block back (the house rule in Modal's
 * README): the screen closes this card and draws the confirm (a dialog can't
 * sit over the card's popover), and opens the card again, focus on Remove,
 * when the confirm is dismissed.
 */
function BlockCard({
  turn,
  locale,
  headingLevel = 3,
  onRemove,
  isRemoveFocused = false,
}: {
  readonly turn: TimeBlockOccurrence;
  readonly locale: string;
  /** 3 in the week's popover or sheet; 4 under the List's panel title. */
  readonly headingLevel?: 3 | 4;
  /** Asks to remove the block: the screen's confirm. */
  readonly onRemove: () => void;
  /** Focus Remove as the card opens: its confirm was just dismissed. */
  readonly isRemoveFocused?: boolean;
}) {
  // The member's zone (their Preferences, else the browser's), as the week is drawn in.
  const { timeZone } = useFormatSettings();
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(new Date(turn.startsAt));
  const remove = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isRemoveFocused) focusLater(() => remove.current);
    // Only as the card opens again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <MeetingCard
      headingLevel={headingLevel}
      title={turn.label ?? (turn.kind === 'hold' ? strings.held : strings.blocked)}
      when={whenOf(turn.startsAt, turn.endsAt, locale, timeZone)}
      rows={[
        ...(turn.repeat === 'weekly'
          ? [{ id: 'repeats', icon: 'refresh-cw' as const, label: strings.repeats, value: strings.everyWeek(weekday) }]
          : []),
        {
          id: 'pages',
          icon: 'link' as const,
          label: strings.bookingPages,
          value: turn.kind === 'hold' ? strings.heldNote : strings.blockedNote,
        },
      ]}
      endAction={
        <Button ref={remove} size="lg" variant="ghost-danger" icon="trash" onPress={onRemove}>
          {turn.kind === 'hold'
            ? strings.releaseHold
            : turn.repeat === 'weekly'
              ? strings.removeEvery(weekday)
              : strings.removeBlock}
        </Button>
      }
    />
  );
}

/**
 * Removing closed time, asked first: what reopens and that it can't be undone. The commit stays busy until the
 * server answers (the block left the week at once), a refusal shows here with the block back, and the screen
 * hands focus on either way. Mount one per question (key it), and keep it while it closes, so its exit plays.
 */
function RemoveBlockDialog({
  turn,
  isOpen,
  locale,
  onRemove,
  onClose,
}: {
  readonly turn: TimeBlockOccurrence;
  readonly isOpen: boolean;
  readonly locale: string;
  /** Removes it: settles once the server has it, rejects with why on a refusal. */
  readonly onRemove: () => Promise<void>;
  /** Dismissed: Cancel or Esc. */
  readonly onClose: () => void;
}) {
  // The member's zone (their Preferences, else the browser's), as the week is drawn in.
  const { timeZone } = useFormatSettings();
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const words = removeWords(turn, locale, timeZone);
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onRemove().then(
      () => {
        setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) && error.message !== '' ? error.message : strings.removeFailed);
      },
    );
  };
  return (
    <Modal
      title={words.title}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={remove}>
            {isBusy ? words.busy : words.action}
          </Button>
        </>
      }
    >
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      {words.text}
    </Modal>
  );
}

/** A tab's tools: at the end of the Bookings strip once the layout has drawn it, else at the top of the tab. */
function Toolbar({ children }: { readonly children: ReactNode }) {
  const slot = useBookingsToolbarSlot();
  return slot === null ? <>{children}</> : createPortal(children, slot);
}

/** A drawn span to close, as the data layer takes it. */
export type BlockDraft = Omit<CreateTimeBlockInput, 'workspace' | 'mutationId' | 'id'>;

/** A block's turn to show at once, before the server answers (the data layer names it). */
export type BlockPreview = Omit<TimeBlockOccurrence, 'key' | 'blockId'>;

/** Props for the calendar: its held week, the address, and what Filter offers. */
export interface BookingsCalendarScreenProps {
  readonly slug: string;
  readonly search: BookingsSearch;
  readonly week: BookingsCalendarHeld;
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  /** The member's accounts and calendars (spec 0024 milestone 5): each event's colour, and the calendars panel. */
  readonly calendars: CalendarsHeld<CalendarListState>;
  /** Puts away the notice that new bookings moved to another calendar. */
  readonly onDismissNotice: () => void;
  readonly locale: string;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
  /** The member's open hours on a day (their availability), to shade the rest; undefined when unknown. */
  readonly openHours?: (
    dayKey: string,
  ) => readonly { readonly startMinute: number; readonly endMinute: number }[] | undefined;
  /** Reopens the time a block closed (spec 0027); settles once the server has it, throws on a refusal. */
  readonly onRemoveBlock: (blockId: string) => Promise<void>;
  /**
   * Closes a drawn span (spec 0027): `preview` shows at once, and the promise
   * settles once the server has it, or throws a data error on a refusal.
   */
  readonly onBlock: (draft: BlockDraft, preview: readonly BlockPreview[]) => Promise<{ readonly id: string }>;
  /** Books someone into a drawn span (spec 0027); settles once made, throws a data error on a refusal. */
  readonly onBookAsHost: (meeting: NewMeeting) => Promise<void>;
  /** Mints a new booking's idempotency key, once per New meeting dialog. */
  readonly newBookingKey: () => string;
  /** Where the member's day starts, for a span drawn from the keyboard (their hours; 9:00 when unknown). */
  readonly workingStart: (dayKey: string) => number;
  /** Confirms and refuses what outlives its card (a removal, a refusal after the card closed). */
  readonly toasts: Toasts;
  /** The host's changes to a booking from its card (AC-640). */
  readonly actions?: HostBookingActions;
}

/** Bookings › Calendar: the range, previous week, Today, next week and Filter, then the grid and the week's count. */
export function BookingsCalendarScreen(props: BookingsCalendarScreenProps) {
  return (
    // The week fills the view edge to edge, its hours scrolling inside (the owner, 22 October 2026).
    <PageColumn align="flush">
      <WeekView {...props} />
    </PageColumn>
  );
}

/** The grid's day heads: each day's short and long names, and whether it is today or past. */
function weekDayItems(days: readonly string[], today: string, locale: string) {
  return days.map((key) => {
    const date = new Date(`${key}T12:00:00`);
    return {
      key,
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
      dayNumber: String(date.getDate()),
      label: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
      isToday: key === today,
      isPast: key < today,
    };
  });
}

/** A dialog a card on the week asked for: removing its block's time, or rescheduling or cancelling its booking. */
type CardQuestion =
  | {
      readonly kind: 'remove';
      readonly turn: TimeBlockOccurrence;
      readonly pieceId: string;
      readonly dayKey: string;
    }
  | {
      readonly kind: BookingAsk;
      readonly booking: BookingListItem;
      readonly pieceId: string;
      readonly dayKey: string;
    };

/** A question as the week holds it: numbered, so each one mounts its dialog afresh. */
type CardAsk = CardQuestion & { readonly opening: number };

/** The week view's toolbar, grid and count. */
function WeekView(props: BookingsCalendarScreenProps) {
  const { slug, objects, search, week, pages, connections, locale, onSearch, onRemoveBlock, onBlock } = props;
  const { workingStart, toasts, onBookAsHost, newBookingKey } = props;
  const calendarList = useCalendarList(props.calendars);
  const accounts = calendarList.status === 'ready' ? calendarList.accounts : [];
  // Book someone in: the span the New meeting dialog books.
  const [meeting, setMeeting] = useState<DrawnSpan | undefined>(undefined);
  const bookable = pages.filter((page) => page.status === 'live');
  const personHref = usePersonHref(slug, objects);
  const state = useBookingsCalendar(week);
  const now = useNow();
  const firstDay = useFirstDay();
  // The member's zone (their Preferences, else the browser's): the week's days, hours, blocks and now line.
  const { timeZone } = useFormatSettings();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  // A dialog a card asked for, drawn here rather than over the card's popover (React Aria draws popovers above every
  // dialog): the card closes while it is open, opens again when it is dismissed, and once its change went through
  // focus goes to the day it was on. `opening` keys each one, so it mounts afresh and keeps its exit.
  const [asking, setAsking] = useState<CardAsk | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<CardAsk | undefined>(undefined);
  if (asking !== undefined && asking !== lastAsked) setLastAsked(asking);
  // The card's button to focus when it opens again after its dialog was dismissed.
  const [refocus, setRefocus] = useState<{ readonly pieceId: string; readonly button: CardAsk['kind'] } | undefined>(
    undefined,
  );
  const [focusDay, setFocusDay] = useState<{ readonly dayKey: string; readonly blockId?: string } | undefined>(
    undefined,
  );
  const openings = useRef(0);
  const [draft, setDraft] = useState<DrawnSpan | undefined>(undefined);
  // Each new drawing gets a fresh card; moving the span with From and To keeps the card as it is.
  const [drawCount, setDrawCount] = useState(0);
  // The draft as of the last render, so a save that settles later knows whether its card is still open.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // The newest block or hold made here, and its toast: Undo and ⌘Z take it back.
  const lastBlock = useRef<{ readonly id: string; readonly toast: string } | undefined>(undefined);
  const undoBlock = (id: string) => {
    if (lastBlock.current?.id === id) {
      toasts.dismiss(lastBlock.current.toast);
      lastBlock.current = undefined;
    }
    onRemoveBlock(id).then(
      () => toasts.toast({ tone: 'success', message: strings.reopened }),
      () => toasts.toast({ tone: 'danger', message: strings.removeFailed }),
    );
  };
  const undoRef = useRef(undoBlock);
  useEffect(() => {
    undoRef.current = undoBlock;
  });
  const platform = useKeyboardPlatform();
  useEffect(() => {
    // Ahead of the workspace's own ⌘Z (record edits), which would undo something else: here it takes the block back.
    const listener = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      if (lastBlock.current === undefined || !isUndoKey(event, platform) || belongsElsewhere(target)) return;
      event.preventDefault();
      undoRef.current(lastBlock.current.id);
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [platform]);
  const days = weekDays(search.week);
  // The week's midnights in the member's zone, worked out once per week and zone rather than per block.
  const bounds = useMemo(() => weekBounds(weekDays(search.week), timeZone), [search.week, timeZone]);
  const today = dayKeyOf(now, timeZone);
  const nowMinute = minuteOfDay(now, timeZone);
  // The zone the hours are in, over the hour axis: the member's may not be the device's clock. Its offset as it is in
  // the week on screen (the picked day's noon), so a week past a daylight saving change names the offset it is in.
  const shownAt = instantOf(days.includes(search.day) ? search.day : search.week, 12 * 60, timeZone).getTime();
  const zone = {
    short: offsetLabel(timeZone, shownAt),
    name: strings.timesIn(zoneDisplay(timeZone, shownAt)),
  };
  const isThisWeek = weekOf(today, firstDay) === search.week;
  const range = rangeLabel(search.week, locale);
  // Each event in its calendar's colour (the member's pick, else the provider's); before the list reads, its account's.
  const connectionHue = new Map(
    connections.map((connection, index) => [connection.id, CALENDAR_HUES[index % CALENDAR_HUES.length] ?? 'blue']),
  );
  const calendarById = new Map(
    accounts.flatMap((account) => account.calendars.map((calendar) => [calendar.id, calendar] as const)),
  );
  // The calendars the panel shows (`cal`, the view only), of those on the member's week.
  const pickedCalendars = search.cal === undefined ? undefined : new Set(search.cal);
  const isShownEvent = (item: { readonly calendarId: string }) =>
    calendarById.get(item.calendarId)?.showInWeek !== false &&
    (pickedCalendars === undefined || pickedCalendars.has(item.calendarId));
  const panel = useCalendarsPanel(calendarList.status === 'ready' ? accounts.length > 0 : undefined);
  const hasNoCalendar = calendarList.status === 'ready' && accounts.length === 0;
  const framed = (content: ReactNode) => (
    <CalendarsFrame
      isFill
      isFlush
      slug={slug}
      search={search}
      calendars={props.calendars}
      panel={panel}
      onSearch={onSearch}
      onDismissNotice={props.onDismissNotice}
      jumpTo={{
        value: days.includes(search.day) ? search.day : (days[0] ?? search.week),
        onChange: (day) => onSearch({ week: weekOf(day, firstDay), day }),
        // The week on screen, tinted on the month.
        ...shownWeek(days),
      }}
    >
      {content}
    </CalendarsFrame>
  );
  const providerOf = new Map(
    connections.map(
      (connection) => [connection.id, connection.provider === 'google' ? 'google-calendar' : 'outlook'] as const,
    ),
  );
  const toolbar = (
    <SectionBar
      title={range}
      end={
        <>
          <CalendarsToggle panel={panel} slug={slug} hasNoCalendar={hasNoCalendar} />
          <Button
            variant="ghost"
            icon="chevron-left"
            label={strings.previousWeek}
            onPress={() => onSearch({ week: addDays(search.week, -7), day: addDays(search.day, -7) })}
          />
          {/* Secondary: the page's one primary is New (the owner, 22 October 2026). */}
          <Button variant="secondary" onPress={() => onSearch({ week: weekOf(today, firstDay), day: today })}>
            {isThisWeek
              ? strings.today
              : strings.todayOn(
                  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(now),
                )}
          </Button>
          <Button
            variant="ghost"
            icon="chevron-right"
            label={strings.nextWeek}
            onPress={() => onSearch({ week: addDays(search.week, 7), day: addDays(search.day, 7) })}
          />
          <FilterMenu search={search} pages={pages} onSearch={onSearch} />
        </>
      }
    />
  );
  if (state.status === 'loading') {
    // The week itself, busy and empty, so it arrives in place.
    return (
      <>
        <Toolbar>{toolbar}</Toolbar>
        {framed(
          <WeekCalendar
            label={strings.weekLabel(range)}
            days={weekDayItems(days, today, locale)}
            blocks={[]}
            isLoading
            isFill
            selectedDay={days.includes(search.day) ? search.day : (days[0] ?? search.week)}
            onSelectDay={(day) => onSearch({ day })}
            zone={zone}
            hourLabel={(hour) =>
              new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))
            }
            now={{ dayKey: today, minute: nowMinute }}
            scrollToMinute={scrollMinute(days, now, timeZone, [], workingStart(today))}
            {...(props.openHours === undefined ? {} : { openHours: props.openHours })}
            onOpen={() => undefined}
            onClose={() => undefined}
          />,
        )}
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <Toolbar>{toolbar}</Toolbar>
        {framed(
          <EmptyState tone="error" title={strings.failedTitle} onRetry={() => week.reload()}>
            {state.message === '' ? strings.failedText : state.message}
          </EmptyState>,
        )}
      </>
    );
  }
  const bookings = state.bookings.filter((booking) => search.link === undefined || booking.pageId === search.link);
  const events = state.events.filter(isShownEvent);
  // All day events, one chip a day in the row over the hours (by their dates, never moved into the local zone).
  const allDay = events
    .filter((event) => event.allDay)
    .flatMap((event) =>
      allDayKeys(event, days).map((dayKey) => ({
        id: `allday:${event.id}:${dayKey}`,
        eventId: event.id,
        dayKey,
        title: event.title,
        hue: calendarById.get(event.calendarId)?.hue ?? connectionHue.get(event.connectionId),
      })),
    );
  const byAllDay = new Map(allDay.map((item) => [item.id, item]));
  const byBooking = new Map(bookings.map((booking) => [booking.id, booking]));
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const byTurn = new Map(state.blocks.map((turn) => [turn.key, turn]));
  // Busy time (spec 0024): the member's own calendar time with nobody else invited, by its time alone.
  const busyTimes = state.busy.filter(isShownEvent);
  const byBusy = new Map(busyTimes.map((busy) => [`busy:${busy.connectionId}:${busy.startsAt}:${busy.endsAt}`, busy]));
  const pieces = [
    ...bookingPieces(bookings, bounds).map((piece) => ({ piece, kind: 'booking' as const })),
    ...eventPieces(events, bounds).map((piece) => ({ piece, kind: 'event' as const })),
    ...state.blocks
      .flatMap((turn) => piecesOf(turn.key, turn.startsAt, turn.endsAt, bounds))
      .map((piece) => ({ piece, kind: 'closed' as const })),
    ...[...byBusy]
      .flatMap(([key, busy]) => piecesOf(key, busy.startsAt, busy.endsAt, bounds))
      .map((piece) => ({ piece, kind: 'busy' as const })),
  ];
  const blocks: WeekCalendarBlock[] = pieces.flatMap(({ piece, kind }): WeekCalendarBlock[] => {
    if (kind === 'booking') {
      const booking = byBooking.get(piece.sourceId);
      if (booking === undefined) return [];
      return [
        {
          id: piece.id,
          dayKey: piece.dayKey,
          startMinute: piece.startMinute,
          endMinute: piece.endMinute,
          title: booking.pageTitle,
          time: timeRange(booking.startsAt, booking.endsAt, locale, timeZone),
          detail: booking.visitorName,
          kind: 'booking',
          provider: 'timefix',
          isCancelled: booking.status === 'cancelled',
        },
      ];
    }
    if (kind === 'busy') {
      const busy = byBusy.get(piece.sourceId);
      if (busy === undefined) return [];
      const provider = providerOf.get(busy.connectionId);
      return [
        {
          id: piece.id,
          dayKey: piece.dayKey,
          startMinute: piece.startMinute,
          endMinute: piece.endMinute,
          title: strings.busy,
          time: timeRange(busy.startsAt, busy.endsAt, locale, timeZone),
          kind: 'busy',
          ...(provider === undefined ? {} : { provider }),
        },
      ];
    }
    if (kind === 'closed') {
      const turn = byTurn.get(piece.sourceId);
      if (turn === undefined) return [];
      return [
        {
          id: piece.id,
          dayKey: piece.dayKey,
          startMinute: piece.startMinute,
          endMinute: piece.endMinute,
          title: turn.kind === 'hold' ? strings.held : strings.blocked,
          time: timeRange(turn.startsAt, turn.endsAt, locale, timeZone),
          ...(turn.label === undefined ? {} : { detail: turn.label }),
          kind: turn.kind === 'hold' ? 'held' : 'blocked',
        },
      ];
    }
    const event = byEvent.get(piece.sourceId);
    if (event === undefined) return [];
    const hue = calendarById.get(event.calendarId)?.hue ?? connectionHue.get(event.connectionId);
    const provider = providerOf.get(event.connectionId);
    return [
      {
        id: piece.id,
        dayKey: piece.dayKey,
        startMinute: piece.startMinute,
        endMinute: piece.endMinute,
        title: event.title,
        time: timeRange(event.startsAt, event.endsAt, locale, timeZone),
        kind: 'event',
        ...(hue === undefined ? {} : { hue }),
        ...(provider === undefined ? {} : { provider }),
      },
    ];
  });
  const open = pieces.find(({ piece }) => piece.id === openId);
  /** A card's question: the card closes and its dialog opens here. */
  const ask = (question: CardQuestion) => {
    openings.current += 1;
    setRefocus(undefined);
    setOpenId(undefined);
    setAsking({ ...question, opening: openings.current });
  };
  /** Dismissed: the card opens again, focus on the button that asked; its block gone meanwhile, its day. */
  const dismiss = (asked: CardAsk) => {
    setAsking(undefined);
    if (pieces.some(({ piece }) => piece.id === asked.pieceId)) {
      setRefocus({ pieceId: asked.pieceId, button: asked.kind });
      setOpenId(asked.pieceId);
    } else setFocusDay({ dayKey: asked.dayKey });
  };
  /** Gone through: the button that asked may be gone, so focus goes to its block while it is still on the week
   * (a booking drawn cancelled, or at its new time), else the day it was on. */
  const done = (asked: CardAsk) => {
    setAsking(undefined);
    setFocusDay({ dayKey: asked.dayKey, ...(asked.kind === 'remove' ? {} : { blockId: asked.pieceId }) });
  };
  const openBooking = open?.kind === 'booking' ? byBooking.get(open.piece.sourceId) : undefined;
  const openAllDay = openId === undefined ? undefined : byAllDay.get(openId);
  const openEvent =
    open?.kind === 'event'
      ? byEvent.get(open.piece.sourceId)
      : openAllDay === undefined
        ? undefined
        : byEvent.get(openAllDay.eventId);
  const openTurn = open?.kind === 'closed' ? byTurn.get(open.piece.sourceId) : undefined;
  const openBusy = open?.kind === 'busy' ? byBusy.get(open.piece.sourceId) : undefined;
  const live = bookings.filter((booking) => booking.status === 'confirmed').length;
  const hourFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric' });
  return (
    <>
      <Toolbar>{toolbar}</Toolbar>
      {framed(
        <>
          <WeekCalendar
            label={strings.weekLabel(range)}
            days={weekDayItems(days, today, locale)}
            blocks={blocks}
            allDay={allDay.map(({ id, dayKey, title, hue }) => ({
              id,
              dayKey,
              title,
              ...(hue === undefined ? {} : { hue }),
            }))}
            {...(props.openHours === undefined ? {} : { openHours: props.openHours })}
            emptyHint={strings.noMeetingsWeek}
            isFill
            selectedDay={days.includes(search.day) ? search.day : (days[0] ?? search.week)}
            onSelectDay={(day) => onSearch({ day })}
            zone={zone}
            hourLabel={(hour) => hourFormat.format(new Date(2000, 0, 1, hour))}
            now={{ dayKey: today, minute: nowMinute }}
            scrollToMinute={scrollMinute(
              days,
              now,
              timeZone,
              pieces.map(({ piece }) => piece),
              workingStart(today),
            )}
            {...(openId === undefined ? {} : { openId })}
            detail={
              openBusy !== undefined ? (
                <BusyCard
                  busy={openBusy}
                  connection={connections.find((connection) => connection.id === openBusy.connectionId)}
                  locale={locale}
                />
              ) : openTurn !== undefined && open !== undefined ? (
                <BlockCard
                  key={openTurn.key}
                  turn={openTurn}
                  locale={locale}
                  isRemoveFocused={refocus?.pieceId === open.piece.id && refocus.button === 'remove'}
                  onRemove={() => {
                    ask({ kind: 'remove', turn: openTurn, pieceId: open.piece.id, dayKey: open.piece.dayKey });
                  }}
                />
              ) : openBooking === undefined ? (
                openEvent === undefined ? undefined : (
                  <EventCard
                    event={openEvent}
                    connection={connections.find((connection) => connection.id === openEvent.connectionId)}
                    locale={locale}
                  />
                )
              ) : (
                <BookingCard
                  booking={openBooking}
                  personHref={personHref(openBooking)}
                  locale={locale}
                  actions={props.actions}
                  {...(open === undefined
                    ? {}
                    : {
                        onAsk: (kind: BookingAsk) => {
                          ask({ kind, booking: openBooking, pieceId: open.piece.id, dayKey: open.piece.dayKey });
                        },
                        focusOnMount:
                          refocus?.pieceId === open.piece.id && refocus.button !== 'remove'
                            ? refocus.button
                            : undefined,
                      })}
                />
              )
            }
            onOpen={(id) => {
              setDraft(undefined);
              setRefocus(undefined);
              setOpenId(id);
            }}
            onClose={() => {
              setRefocus(undefined);
              setOpenId(undefined);
            }}
            {...(focusDay === undefined ? {} : { focusDay })}
            onDraw={(span) => {
              setOpenId(undefined);
              setDrawCount((count) => count + 1);
              setDraft(span);
            }}
            {...(meeting !== undefined
              ? // The span stays drawn behind New meeting, so the week shows where it will go.
                { draft: meeting, draftLabel: strings.drawCard(spanNames(meeting, locale, timeZone).title) }
              : draft === undefined
                ? {}
                : {
                    draft,
                    draftLabel: strings.drawCard(spanNames(draft, locale, timeZone).title),
                    draftCard: (
                      <DrawCard
                        key={drawCount}
                        span={draft}
                        locale={locale}
                        privatePages={pages
                          .filter((page) => page.isPrivate)
                          .map((page) => ({ id: page.id, title: page.title }))}
                        createLinkOnlyHref={newLinkOnlyPageHref(slug)}
                        overlapping={overlapping(bookings, draft, timeZone)}
                        onSpanChange={setDraft}
                        onClose={({ kind, repeat, label, pageId }) => {
                          const drawn = draft;
                          const preview: BlockPreview = {
                            kind,
                            repeat,
                            ...(label === undefined ? {} : { label }),
                            startsAt: instantOf(drawn.dayKey, drawn.startMinute, timeZone).toISOString(),
                            endsAt: instantOf(drawn.dayKey, drawn.endMinute, timeZone).toISOString(),
                          };
                          return onBlock(
                            {
                              kind,
                              repeat,
                              date: drawn.dayKey,
                              startMinute: drawn.startMinute,
                              endMinute: drawn.endMinute,
                              timeZone,
                              ...(label === undefined ? {} : { label }),
                              ...(pageId === undefined ? {} : { pageId }),
                            },
                            [preview],
                          ).then(
                            (made) => {
                              // Saved: the card closes, and the toast offers Undo (as calendars do).
                              if (draftRef.current === drawn) setDraft(undefined);
                              const toast = toasts.toast({
                                tone: 'success',
                                message: kind === 'hold' ? strings.timeHeld : strings.timeBlocked,
                                action: {
                                  label: strings.undo,
                                  onAction: () => undoBlock(made.id),
                                },
                              });
                              lastBlock.current = { id: made.id, toast };
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
                        {...(bookable.length === 0 || instantOf(draft.dayKey, draft.startMinute, timeZone) < now
                          ? {}
                          : {
                              onBook: () => {
                                setMeeting(draft);
                                setDraft(undefined);
                              },
                            })}
                      />
                    ),
                  })}
            onDraftClose={() => setDraft(undefined)}
            drawMinutes={pages[0]?.durations[0] ?? 30}
            drawStartMinute={workingStart}
            minuteLabel={(minute) => {
              const at = new Date(2000, 0, 1);
              at.setMinutes(minute);
              // Built once per locale: half hour blocks ask for their start on every draw.
              return memoIntl(
                `bookings-minute:${locale}`,
                () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
              ).format(at);
            }}
          />
          {/* The week's count for screen readers; on screen the grid says it (the owner, 22 October 2026). */}
          <VisuallyHidden>{strings.weekSummary(live)}</VisuallyHidden>
        </>,
      )}
      {/* The dialogs a card asked for, each mounted afresh per question and kept while it closes. */}
      {lastAsked?.kind === 'remove' && (
        <RemoveBlockDialog
          key={lastAsked.opening}
          turn={lastAsked.turn}
          isOpen={asking === lastAsked}
          locale={locale}
          onRemove={() =>
            onRemoveBlock(lastAsked.turn.blockId).then(() => {
              done(lastAsked);
              toasts.toast({ tone: 'success', message: strings.reopened });
            })
          }
          onClose={() => {
            dismiss(lastAsked);
          }}
        />
      )}
      {lastAsked !== undefined && lastAsked.kind !== 'remove' && props.actions !== undefined && (
        <BookingDialog
          key={lastAsked.opening}
          // The booking as the week holds it now (cancelled at once behind its confirm), or as it was asked about.
          booking={byBooking.get(lastAsked.booking.id) ?? lastAsked.booking}
          actions={props.actions}
          locale={locale}
          ask={asking === lastAsked ? lastAsked.kind : undefined}
          onClose={() => {
            dismiss(lastAsked);
          }}
          onDone={() => {
            done(lastAsked);
          }}
        />
      )}
      {meeting !== undefined && (
        <NewMeetingDialog
          span={meeting}
          onSpanChange={(span) => {
            setMeeting(span);
            // A day outside the week on screen moves the week there, so the span still shows and focus has its day.
            if (!days.includes(span.dayKey)) onSearch({ week: weekOf(span.dayKey, firstDay), day: span.dayKey });
          }}
          locale={locale}
          hasCalendar={connections.length > 0}
          pages={bookable}
          newKey={newBookingKey}
          onBook={async (input) => {
            await onBookAsHost(input);
            toasts.toast({
              tone: 'success',
              message: connections.length > 0 ? strings.booked(input.name) : strings.bookedQuietly(input.name),
            });
          }}
          onClose={() => setMeeting(undefined)}
        />
      )}
    </>
  );
}

/** How many confirmed bookings a drawn span overlaps (they stay booked; the card says so). */
function overlapping(bookings: readonly BookingListItem[], span: DrawnSpan, zone: string): number {
  const start = instantOf(span.dayKey, span.startMinute, zone).getTime();
  const end = instantOf(span.dayKey, span.endMinute, zone).getTime();
  return bookings.filter(
    (booking) =>
      booking.status === 'confirmed' && Date.parse(booking.startsAt) < end && Date.parse(booking.endsAt) > start,
  ).length;
}

/** A meeting's start and end, whichever kind it is. */
const spanOf = (item: MeetingListItem) =>
  item.kind === 'booking'
    ? { startsAt: item.booking.startsAt, endsAt: item.booking.endsAt }
    : { startsAt: item.event.startsAt, endsAt: item.event.endsAt };

/** A meeting's row id: its kind and its id, so a booking and an event never share one. */
const rowIdOf = (item: MeetingListItem) => (item.kind === 'booking' ? `b:${item.booking.id}` : `e:${item.event.id}`);

/**
 * Meetings under their day bands (Today, Tomorrow, then the date), in the order given: a booking titled by its
 * page with "You and <guest>", the guest linked to their person; an event by its title with its calendar's colour
 * and name and its attendees.
 */
function groupsOf(
  items: readonly MeetingListItem[],
  calendarOf: (calendarId: string) => { readonly name: string; readonly hue: Hue } | undefined,
  personHref: (booking: BookingListItem) => string | undefined,
  locale: string,
  me: string | undefined,
  zone: string,
): readonly BookingListGroup[] {
  const now = new Date();
  // Days and times in the member's zone, the one the week is drawn in.
  const today = dayKeyOf(now, zone);
  const tomorrow = addDays(today, 1);
  // A band's date, named from its day key alone (noon UTC read in UTC), so no zone moves it.
  const shortDate = (key: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    }).format(new Date(`${key}T12:00:00Z`));
  const groups: { id: string; label: string; rows: BookingListGroup['rows'][number][] }[] = [];
  for (const item of items) {
    const { startsAt, endsAt } = spanOf(item);
    // An all day event's dates are calendar dates (midnight UTC): read by date, never moved into the local zone.
    const isAllDay = item.kind === 'event' && item.event.allDay;
    const id = isAllDay ? startsAt.slice(0, 10) : dayKeyOf(new Date(startsAt), zone);
    const videoUrl = item.kind === 'booking' ? item.booking.videoUrl : item.event.videoUrl;
    const isCancelled =
      item.kind === 'booking' ? item.booking.status === 'cancelled' : item.event.status === 'cancelled';
    const shared = {
      id: rowIdOf(item),
      // Under its day's band, a row says its time alone (the band says the day): the time on the date's line, bold,
      // and nothing under it; an all day event says All day.
      date: isAllDay ? strings.allDay : timeRange(startsAt, endsAt, locale, zone),
      time: '',
      // Join only while it can still be joined: not once cancelled, nor once it has ended.
      ...(videoUrl === undefined || isCancelled || Date.parse(endsAt) <= now.getTime()
        ? {}
        : { join: { href: videoUrl, provider: providerOf(videoUrl) } }),
      ...(isCancelled ? { badge: strings.cancelled } : {}),
    };
    const row =
      item.kind === 'booking'
        ? (() => {
            // As in round 6: the page's title, then the guest, a link to their person.
            const href = personHref(item.booking);
            return {
              ...shared,
              title: item.booking.pageTitle,
              guestName: item.booking.visitorName,
              ...(href === undefined ? {} : { guestHref: href }),
              // A colleague's booking (an admin's view, a team page) says whose it is: "Sam Lee and Ada".
              ...(me === undefined || item.booking.hostMemberId === me || item.booking.hostName === ''
                ? {}
                : { hostName: item.booking.hostName }),
              // Every booking says where it stands (the owner, 22 October 2026): Canceled (above), Needs a host
              // (round robin, spec 0029, AC-749), No show (spec 0043), else Confirmed while it is ahead (a past one
              // needs no tag). Calendar events have their calendar's dot instead.
              ...(item.booking.status === 'cancelled'
                ? {}
                : item.booking.needsHost
                  ? { badge: strings.needsHost, badgeTone: 'accent' as const }
                  : item.booking.noShow === true
                    ? { badge: strings.noShow }
                    : Date.parse(item.booking.endsAt) > now.getTime()
                      ? { badge: strings.status.confirmed }
                      : {}),
              ...(item.booking.note === undefined ? {} : { note: item.booking.note }),
              ...(item.booking.guests.length === 0 ? {} : { attendees: item.booking.guests }),
            };
          })()
        : (() => {
            const calendar = calendarOf(item.event.calendarId);
            return {
              ...shared,
              title: item.event.title,
              ...(calendar === undefined ? {} : { calendar }),
              attendees: item.attendees,
              moreAttendees: item.attendeeCount - item.attendees.length,
            };
          })();
    const last = groups.at(-1);
    if (last?.id === id) last.rows.push(row);
    else
      groups.push({
        id,
        label: id === today ? strings.today : id === tomorrow ? strings.tomorrow : shortDate(id),
        rows: [row],
      });
  }
  return groups;
}

/** The list's bar: Upcoming · Past · Canceled, then the calendars and Filter (which meetings, which link). */
function ListBar({
  slug,
  search,
  pages,
  panel,
  hasNoCalendar,
  onSearch,
}: {
  readonly slug: string;
  readonly search: BookingsSearch;
  readonly pages: readonly BookingPageView[];
  readonly panel: CalendarsPanel;
  /** The calendars read and none is connected: Connect calendar in the toggle's place. */
  readonly hasNoCalendar: boolean;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}) {
  return (
    <SectionBar
      start={
        <SegmentedControl
          label={strings.tabsLabel}
          value={search.tab}
          onChange={(value) => {
            const tab = TABS.find((each) => each === value);
            if (tab !== undefined && tab !== search.tab) onSearch({ tab });
          }}
          segments={TABS.map((id) => ({ value: id, label: strings.tabs[id] }))}
        />
      }
      end={
        <>
          {search.source !== 'bookings' && search.link === undefined && (
            <CalendarsToggle panel={panel} slug={slug} hasNoCalendar={hasNoCalendar} />
          )}
          <FilterMenu search={search} pages={pages} onSearch={onSearch} hasSources />
        </>
      }
    />
  );
}

/** The list's sources, in order. */
const SOURCES: readonly MeetingSource[] = ['all', 'bookings', 'calendar'];

/** Props for the list: its held pages, the address, the calendars and what Filter offers. */
export interface BookingsListScreenProps {
  readonly slug: string;
  readonly search: BookingsSearch;
  /** The data layer's held list for a question (tab, source, the calendars picked): the same one every time. */
  readonly meetings: (query: MeetingsQuery) => MeetingsHeld;
  /** The member's accounts and calendars: each event's colour and name, and the calendars panel. */
  readonly calendars: CalendarsHeld<CalendarListState>;
  readonly onDismissNotice: () => void;
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly locale: string;
  /** The host's changes to a booking from its card (AC-640). */
  readonly actions?: HostBookingActions;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}

/**
 * Keeps focus when the last page lands and "Show more" goes with it: focus moves to the title of the first row it
 * added, so a keyboard user carries on where the new rows start instead of falling back to the page.
 */
function useFocusAfterMore(label: string, isReady: boolean, isShown: boolean, count: number) {
  const pressed = useRef<number | undefined>(undefined);
  useEffect(() => {
    // A reload (the list reading again) took the button, not the last page: nothing to carry on from.
    if (!isReady) pressed.current = undefined;
    const before = pressed.current;
    if (isShown || before === undefined) return;
    pressed.current = undefined;
    const frame = requestAnimationFrame(() => {
      // Only when focus went with the button: someone who moved on keeps their place.
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      const rows = document.querySelectorAll<HTMLElement>(`section[aria-label="${CSS.escape(label)}"] li`);
      const row = rows[Math.min(before, rows.length - 1)];
      row?.querySelector<HTMLElement>('button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isReady, isShown, label]);
  return {
    /** Show more was pressed with this many rows shown. */
    press: () => {
      pressed.current = count;
    },
  };
}

/**
 * Bookings › List: every meeting on Upcoming, Past or Canceled (bookings and the member's own calendar events),
 * narrowed to All, Bookings or Calendar and to the calendars the panel picks, under day bands, a page at a time
 * (More); a row opens its card in a Panel.
 */
export function BookingsListScreen({
  slug,
  search,
  meetings,
  calendars,
  onDismissNotice,
  objects,
  pages,
  locale,
  onSearch,
  actions,
}: BookingsListScreenProps) {
  const personHref = usePersonHref(slug, objects);
  // The member's zone (their Preferences, else the browser's): each row's day band and time.
  const { timeZone } = useFormatSettings();
  const listNow = useNow();
  const calendarList = useCalendarList(calendars);
  const byCalendar = new Map(
    (calendarList.status === 'ready' ? calendarList.accounts : []).flatMap((account) =>
      account.calendars.map((calendar) => [calendar.id, { name: calendar.name, hue: calendar.hue }] as const),
    ),
  );
  const hasCalendar = calendarList.status === 'ready' && calendarList.accounts.length > 0;
  const panel = useCalendarsPanel(calendarList.status === 'ready' ? hasCalendar : undefined);
  // The open meeting by row id, read from the list as it is now: a change shows in the panel.
  // A colleague's booking (an admin's view, a team page) names its host rather than "You".
  const me = useMyAccess()?.memberId;
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const tab = search.tab;
  // One booking page's bookings: calendar events have no page, so the server is asked for bookings only, and paging
  // stays whole.
  const source = search.link === undefined ? search.source : 'bookings';
  const list = meetings({
    when: tab,
    source,
    ...(search.cal === undefined ? {} : { calendarIds: search.cal }),
  });
  const state = useMeetings(list);
  // One booking page: its bookings only (calendar events have no page).
  const items =
    state.status === 'ready'
      ? state.items.filter(
          (item) => search.link === undefined || (item.kind === 'booking' && item.booking.pageId === search.link),
        )
      : [];
  const open = items.find((item) => rowIdOf(item) === openId);
  const more = useFocusAfterMore(
    strings.listLabel[tab],
    state.status === 'ready',
    state.status === 'ready' && (state.hasMore || state.moreFailed),
    items.length,
  );
  // A change closes the panel: the lists are read again, and the booking may move tabs.
  const panelActions = useMemo(
    () =>
      actions === undefined
        ? undefined
        : {
            ...actions,
            cancel: (id: string, reason: string) => actions.cancel(id, reason).then(() => setOpenId(undefined)),
            move: (id: string, start: string) => actions.move(id, start).then(() => setOpenId(undefined)),
          },
    [actions],
  );
  const bar = (
    <ListBar
      slug={slug}
      search={search}
      pages={pages}
      panel={panel}
      hasNoCalendar={calendarList.status === 'ready' && !hasCalendar}
      onSearch={onSearch}
    />
  );
  const body =
    state.status === 'loading' ? (
      <Skeleton shape="block" />
    ) : state.status === 'error' ? (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => list.reload()}>
        {state.message === '' ? strings.failedText : state.message}
      </EmptyState>
    ) : (
      <>
        <BookingList
          // Rows' times are on the member's clock: the list's name says so for screen readers.
          label={`${strings.listLabel[tab]}, ${strings.timesIn(zoneDisplay(timeZone, listNow.getTime()))}`}
          groups={groupsOf(items, (calendarId) => byCalendar.get(calendarId), personHref, locale, me, timeZone)}
          onOpen={setOpenId}
          emptyState={
            search.link !== undefined || search.cal !== undefined || source !== 'all' ? (
              <EmptyState
                layout="fill"
                icon="calendar-days"
                title={strings.noMatch}
                actions={
                  <Button
                    variant="secondary"
                    onPress={() => onSearch({ link: undefined, cal: undefined, source: 'all' })}
                  >
                    {strings.clearFilters}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                layout="fill"
                icon="calendar-days"
                title={strings.empty[tab].title}
                actions={
                  tab === 'upcoming' ? (
                    <>
                      <ButtonLink variant="primary" icon="link" href={linksHref(slug)}>
                        {strings.shareBookingPage}
                      </ButtonLink>
                      {calendarList.status === 'ready' && !hasCalendar && (
                        <Link href={calendarSettingsHref(slug)}>{strings.connectCalendar}</Link>
                      )}
                    </>
                  ) : undefined
                }
              >
                {strings.empty[tab].text}
              </EmptyState>
            )
          }
        />
        {(state.hasMore || state.moreFailed) && (
          <Button
            variant="secondary"
            isPending={state.isLoadingMore}
            onPress={() => {
              more.press();
              list.loadMore();
            }}
          >
            {state.moreFailed ? strings.moreFailed : strings.more}
          </Button>
        )}
      </>
    );
  return (
    // The list fills the view and scrolls inside it, so its day bands stick and an empty list says so in its middle.
    <PageColumn align="fill">
      <Toolbar>{bar}</Toolbar>
      <CalendarsFrame
        isFill
        slug={slug}
        search={search}
        calendars={calendars}
        panel={panel}
        onSearch={onSearch}
        onDismissNotice={onDismissNotice}
        isHidden={source === 'bookings'}
      >
        {body}
      </CalendarsFrame>
      {open !== undefined && (
        <Panel title={strings.details} isOpen onClose={() => setOpenId(undefined)}>
          {open.kind === 'booking' ? (
            <BookingCard
              headingLevel={4}
              booking={open.booking}
              personHref={personHref(open.booking)}
              locale={locale}
              actions={panelActions}
            />
          ) : (
            <EventCard event={open.event} connection={undefined} locale={locale} headingLevel={4} />
          )}
        </Panel>
      )}
    </PageColumn>
  );
}

/** The person's page for a booking, from the workspace's objects. */
function usePersonHref(slug: string, objects: readonly ObjectSummary[]) {
  const link = recordLinks(slug, objects);
  const people = objects.find((object) => object.standardKey === 'people');
  return (booking: BookingListItem) => personHrefOf(booking, link, people);
}

/** A Bookings tab while its first read loads. */
export function BookingsPending() {
  return (
    <PageColumn>
      <Skeleton shape="block" />
    </PageColumn>
  );
}

/** A Bookings tab when its first read failed, with Try again. */
export function BookingsFailed({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={onRetry}>
        {message}
      </EmptyState>
    </PageColumn>
  );
}
