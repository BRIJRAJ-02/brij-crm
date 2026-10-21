// Brief
// Purpose: Bookings › Calendar and Bookings › List (spec 0025, AC-646), on the reference product's bookings page: a week calendar (bookings and the member's own calendar events) and a list (Upcoming, Past, Canceled) with sort and pages.
// Main task: see the week at a glance, open a booking or an event for its details, or page through the list.
// Leaves out: changing a booking from here (the actions arrive next), the new meeting dialog, team views and filing, and live arrival (it reads again when the page is shown again).
import {
  isDataError,
  type BookingListItem,
  type BookingPageView,
  type BookingsCalendarHeld,
  type BookingsTab,
  type BookingsView,
  type CalendarConnectionView,
  type CalendarEventItem,
  type ObjectSummary,
  type CreateTimeBlockInput,
  type TimeBlockOccurrence,
} from '@crm/data';
import { useBookings, useBookingsCalendar } from '@crm/data/react';
import {
  Badge,
  BookingList,
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Link,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Modal,
  PageColumn,
  Pagination,
  Panel,
  SectionBar,
  SegmentedControl,
  useKeyboardPlatform,
  focusLater,
  Skeleton,
  WeekCalendar,
  type BookingListGroup,
  type Hue,
  type Toasts,
  type WeekCalendarBlock,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { providerOf } from './provider.ts';
import { useNow } from './useNow.ts';
import { createPortal } from 'react-dom';
import { browserZone } from '../booking/zone.ts';
import { availabilityHref } from '../booking/links.ts';
import { linksHref } from '../captures/tabs.ts';
import { recordLinks, type RecordLink } from '../records/timeline.ts';
import { belongsElsewhere, isUndoKey, type KeyTarget } from '../workspace/undo.ts';
import { DrawCard } from './DrawCard.tsx';
import { NewMeetingDialog, type NewMeeting } from './NewMeetingDialog.tsx';
import { instantOf, spanNames, type DrawnSpan } from './span.ts';
import { PAGE_SIZES, type BookingsSearch } from './search.ts';
import { BookingActions, BookingDialog, type BookingAsk, type HostBookingActions } from './BookingActions.tsx';
import { strings } from './strings.ts';
import { useBookingsToolbarSlot } from './toolbarSlot.ts';
import {
  addDays,
  bookingPieces,
  dayKeyOf,
  eventPieces,
  piecesOf,
  rangeLabel,
  scrollMinute,
  timeRange,
  weekDays,
  weekOf,
} from './week.ts';

export type { BookingsTab };
export type { BookingsSearch };

/** The list's tabs, in order. */
export const TABS: readonly BookingsTab[] = ['upcoming', 'past', 'cancelled'];

/** Each connection's hue, in the order they were connected. */
const CALENDAR_HUES: readonly Hue[] = ['blue', 'green', 'purple', 'orange', 'sky', 'yellow', 'red', 'lime'];

/** Where a booking happens, as a line. */
function whereOf(booking: BookingListItem): string {
  switch (booking.location.type) {
    case 'video':
      return booking.videoUrl ?? strings.video;
    case 'phone':
      return strings.phone;
    default:
      return booking.location.value;
  }
}

/** The person's page, when the booking names one and the reader can open People. */
function personHrefOf(booking: BookingListItem, link: RecordLink, people: ObjectSummary | undefined) {
  return booking.personRecordId === undefined || people === undefined
    ? undefined
    : link(people.id, booking.personRecordId);
}

/** "Monday, 19 October · 9:00 – 9:30 AM". */
function whenOf(startsAt: string, endsAt: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(startsAt),
  );
  return `${day} · ${timeRange(startsAt, endsAt, locale)}`;
}

/** The filters in force: a link, and the calendars shown. */
function filterCount(search: BookingsSearch): number {
  return (search.link === undefined ? 0 : 1) + (search.conn === undefined ? 0 : 1);
}

/** Filter: one link's bookings, and which calendars' events show. */
function FilterMenu({
  search,
  pages,
  connections,
  onSearch,
}: {
  readonly search: BookingsSearch;
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}) {
  if (pages.length < 2 && connections.length < 2) return null;
  const shown = new Set(search.conn ?? connections.map((connection) => connection.id));
  const count = filterCount(search);
  const selected = [
    ...(search.link === undefined ? ['link:all'] : [`link:${search.link}`]),
    ...[...shown].map((id) => `conn:${id}`),
  ];
  return (
    <MenuTrigger>
      <Button icon="list-filter">{count === 0 ? strings.filter : strings.filterCount(count)}</Button>
      <Menu
        label={strings.filterMenu}
        selectionMode="multiple"
        selectedKeys={selected}
        onSelectionChange={(keys) => {
          const next = new Set([...keys].map(String));
          const added = [...next].find((key) => !selected.includes(key));
          const removed = selected.find((key) => !next.has(key));
          const touched = added ?? removed;
          if (touched === undefined) return;
          if (touched.startsWith('link:')) {
            const id = touched.slice(5);
            onSearch({ link: id === 'all' || added === undefined ? undefined : id, page: 1 });
            return;
          }
          const id = touched.slice(5);
          const conn = new Set(shown);
          if (added === undefined) conn.delete(id);
          else conn.add(id);
          onSearch({ conn: conn.size === connections.length ? undefined : [...conn] });
        }}
        onAction={(key) => {
          if (key === 'clear') onSearch({ link: undefined, conn: undefined, page: 1 });
        }}
      >
        {pages.length >= 2 && (
          <MenuSection label={strings.links}>
            <MenuItem id="link:all">{strings.allLinks}</MenuItem>
            {pages.map((page) => (
              <MenuItem key={page.id} id={`link:${page.id}`}>
                {page.title}
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {connections.length >= 2 && (
          <MenuSection label={strings.calendars}>
            {connections.map((connection) => (
              <MenuItem key={connection.id} id={`conn:${connection.id}`}>
                {connection.accountEmail}
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {count > 0 && (
          <>
            <MenuSeparator />
            <MenuItem id="clear">{strings.clearFilters}</MenuItem>
          </>
        )}
      </Menu>
    </MenuTrigger>
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
}: {
  readonly booking: BookingListItem;
  readonly personHref: string | undefined;
  readonly locale: string;
  readonly actions?: HostBookingActions | undefined;
  /** In the week's popover: Reschedule and Cancel booking are drawn by the screen (see BookingActions). */
  readonly onAsk?: ((ask: BookingAsk) => void) | undefined;
  /** The button to focus as the card opens again after the screen's dialog was dismissed. */
  readonly focusOnMount?: BookingAsk | undefined;
}) {
  const now = useNow();
  return (
    <>
      <Badge text={strings.status[booking.status]} tone={booking.status === 'confirmed' ? 'accent' : 'neutral'} />
      {booking.eventFailed && booking.status === 'confirmed' && <Callout tone="warning">{strings.eventFailed}</Callout>}
      <DescriptionList
        layout="stacked"
        items={[
          {
            term: booking.pageTitle,
            description:
              personHref === undefined ? booking.visitorName : <Link href={personHref}>{booking.visitorName}</Link>,
          },
          { term: strings.when, description: whenOf(booking.startsAt, booking.endsAt, locale) },
          {
            term: strings.who,
            description: <Link href={`mailto:${booking.visitorEmail}`}>{booking.visitorEmail}</Link>,
          },
          ...(booking.guests.length === 0 ? [] : [{ term: strings.guests, description: booking.guests.join(', ') }]),
          {
            term: strings.where,
            description:
              booking.videoUrl === undefined ? (
                whereOf(booking)
              ) : (
                <Link href={booking.videoUrl}>{booking.videoUrl}</Link>
              ),
          },
          ...(booking.note === undefined ? [] : [{ term: strings.note, description: strings.quoted(booking.note) }]),
          ...(booking.cancelReason === undefined
            ? []
            : [{ term: strings.cancelReason, description: booking.cancelReason }]),
        ]}
      />
      {booking.status === 'confirmed' && booking.videoUrl !== undefined && (
        <Link href={booking.videoUrl}>{`${strings.joinCall}: ${providerOf(booking.videoUrl)}`}</Link>
      )}
      {/* Its buttons show for a confirmed booking only; it stays mounted so a cancel's confirm outlives the
          booking showing cancelled at once, until the server answers. */}
      {actions !== undefined && Date.parse(booking.startsAt) > now.getTime() && (
        <BookingActions
          booking={booking}
          actions={actions}
          locale={locale}
          {...(onAsk === undefined ? {} : { onAsk })}
          {...(focusOnMount === undefined ? {} : { focusOnMount })}
        />
      )}
    </>
  );
}

/** One of the member's own calendar events: what, when, which calendar, and that Timefix doesn't manage it. */
function EventCard({
  event,
  connection,
  locale,
}: {
  readonly event: CalendarEventItem;
  readonly connection: CalendarConnectionView | undefined;
  readonly locale: string;
}) {
  return (
    <>
      <DescriptionList
        layout="stacked"
        items={[
          { term: strings.when, description: whenOf(event.startsAt, event.endsAt, locale) },
          { term: event.title, description: strings.fromCalendar },
          ...(connection === undefined ? [] : [{ term: strings.calendar, description: connection.accountEmail }]),
          ...(event.location === undefined ? [] : [{ term: strings.where, description: event.location }]),
        ]}
      />
      {event.videoUrl !== undefined && (
        <Link href={event.videoUrl}>{`${strings.joinCall}: ${providerOf(event.videoUrl)}`}</Link>
      )}
    </>
  );
}

/** A busy time's card: when, that it is busy and why, and which calendar holds it. Nothing more is kept. */
function BusyCard({
  busy,
  connection,
  locale,
}: {
  readonly busy: { readonly startsAt: string; readonly endsAt: string };
  readonly connection: CalendarConnectionView | undefined;
  readonly locale: string;
}) {
  return (
    <DescriptionList
      layout="stacked"
      items={[
        { term: strings.when, description: whenOf(busy.startsAt, busy.endsAt, locale) },
        { term: strings.busy, description: strings.busyNote },
        ...(connection === undefined ? [] : [{ term: strings.calendar, description: connection.accountEmail }]),
      ]}
    />
  );
}

/** What removing closed time asks: its title, what reopens, and the commit's words, busy and not. */
function removeWords(
  turn: Pick<TimeBlockOccurrence, 'kind' | 'repeat' | 'label' | 'startsAt' | 'endsAt'>,
  locale: string,
): { readonly title: string; readonly text: string; readonly action: string; readonly busy: string } {
  const start = new Date(turn.startsAt);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const from = clock.format(start);
  const to = clock.format(new Date(turn.endsAt));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(start);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(start);
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
  onRemove,
  isRemoveFocused = false,
}: {
  readonly turn: TimeBlockOccurrence;
  readonly locale: string;
  /** Asks to remove the block: the screen's confirm. */
  readonly onRemove: () => void;
  /** Focus Remove as the card opens: its confirm was just dismissed. */
  readonly isRemoveFocused?: boolean;
}) {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(turn.startsAt));
  const remove = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isRemoveFocused) focusLater(() => remove.current);
    // Only as the card opens again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <DescriptionList
        layout="stacked"
        items={[
          { term: strings.when, description: whenOf(turn.startsAt, turn.endsAt, locale) },
          ...(turn.label === undefined ? [] : [{ term: strings.why, description: turn.label }]),
          ...(turn.repeat === 'weekly' ? [{ term: strings.repeats, description: strings.everyWeek(weekday) }] : []),
          { term: strings.bookingPages, description: turn.kind === 'hold' ? strings.heldNote : strings.blockedNote },
        ]}
      />
      <Button ref={remove} variant="danger" icon="trash" onPress={onRemove}>
        {turn.kind === 'hold'
          ? strings.releaseHold
          : turn.repeat === 'weekly'
            ? strings.removeEvery(weekday)
            : strings.removeBlock}
      </Button>
    </>
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
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const words = removeWords(turn, locale);
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
  readonly locale: string;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
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
    <PageColumn>
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
  // Book someone in: the span the New meeting dialog books.
  const [meeting, setMeeting] = useState<DrawnSpan | undefined>(undefined);
  const bookable = pages.filter((page) => page.status === 'live');
  const personHref = usePersonHref(slug, objects);
  const state = useBookingsCalendar(week);
  const now = useNow();
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
  const today = dayKeyOf(now);
  const isThisWeek = weekOf(today) === search.week;
  const range = rangeLabel(search.week, locale);
  const shownConnections = new Set(search.conn ?? connections.map((connection) => connection.id));
  const hueOf = new Map(
    connections.map((connection, index) => [connection.id, CALENDAR_HUES[index % CALENDAR_HUES.length] ?? 'blue']),
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
          <Button
            variant="ghost"
            icon="chevron-left"
            label={strings.previousWeek}
            onPress={() => onSearch({ week: addDays(search.week, -7), day: addDays(search.day, -7) })}
          />
          <Button
            variant={isThisWeek ? 'primary' : 'secondary'}
            onPress={() => onSearch({ week: weekOf(today), day: today })}
          >
            {isThisWeek
              ? strings.today
              : strings.todayOn(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(now))}
          </Button>
          <Button
            variant="ghost"
            icon="chevron-right"
            label={strings.nextWeek}
            onPress={() => onSearch({ week: addDays(search.week, 7), day: addDays(search.day, 7) })}
          />
          <FilterMenu search={search} pages={pages} connections={connections} onSearch={onSearch} />
        </>
      }
    />
  );
  if (state.status === 'loading') {
    // The week itself, busy and empty, so it arrives in place.
    return (
      <>
        <Toolbar>{toolbar}</Toolbar>
        <WeekCalendar
          label={strings.weekLabel(range)}
          days={weekDayItems(days, today, locale)}
          blocks={[]}
          isLoading
          selectedDay={days.includes(search.day) ? search.day : (days[0] ?? search.week)}
          onSelectDay={(day) => onSearch({ day })}
          hourLabel={(hour) => new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))}
          now={{ dayKey: today, minute: now.getHours() * 60 + now.getMinutes() }}
          scrollToMinute={scrollMinute(days, now, [])}
          onOpen={() => undefined}
          onClose={() => undefined}
        />
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <Toolbar>{toolbar}</Toolbar>
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => week.reload()}>
          {state.message === '' ? strings.failedText : state.message}
        </EmptyState>
      </>
    );
  }
  const bookings = state.bookings.filter((booking) => search.link === undefined || booking.pageId === search.link);
  const events = state.events.filter((event) => shownConnections.has(event.connectionId));
  const byBooking = new Map(bookings.map((booking) => [booking.id, booking]));
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const byTurn = new Map(state.blocks.map((turn) => [turn.key, turn]));
  // Busy time (spec 0024): the member's own calendar time with nobody else invited, by its time alone.
  const busyTimes = state.busy.filter((busy) => shownConnections.has(busy.connectionId));
  const byBusy = new Map(busyTimes.map((busy) => [`busy:${busy.connectionId}:${busy.startsAt}:${busy.endsAt}`, busy]));
  const pieces = [
    ...bookingPieces(bookings, days).map((piece) => ({ piece, kind: 'booking' as const })),
    ...eventPieces(events, days).map((piece) => ({ piece, kind: 'event' as const })),
    ...state.blocks
      .flatMap((turn) => piecesOf(turn.key, turn.startsAt, turn.endsAt, days))
      .map((piece) => ({ piece, kind: 'closed' as const })),
    ...[...byBusy]
      .flatMap(([key, busy]) => piecesOf(key, busy.startsAt, busy.endsAt, days))
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
          time: timeRange(booking.startsAt, booking.endsAt, locale),
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
          time: timeRange(busy.startsAt, busy.endsAt, locale),
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
          time: timeRange(turn.startsAt, turn.endsAt, locale),
          ...(turn.label === undefined ? {} : { detail: turn.label }),
          kind: turn.kind === 'hold' ? 'held' : 'blocked',
        },
      ];
    }
    const event = byEvent.get(piece.sourceId);
    if (event === undefined) return [];
    const hue = hueOf.get(event.connectionId);
    const provider = providerOf.get(event.connectionId);
    return [
      {
        id: piece.id,
        dayKey: piece.dayKey,
        startMinute: piece.startMinute,
        endMinute: piece.endMinute,
        title: event.title,
        time: timeRange(event.startsAt, event.endsAt, locale),
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
  const openEvent = open?.kind === 'event' ? byEvent.get(open.piece.sourceId) : undefined;
  const openTurn = open?.kind === 'closed' ? byTurn.get(open.piece.sourceId) : undefined;
  const openBusy = open?.kind === 'busy' ? byBusy.get(open.piece.sourceId) : undefined;
  const live = bookings.filter((booking) => booking.status === 'confirmed').length;
  const hourFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric' });
  return (
    <>
      <Toolbar>{toolbar}</Toolbar>
      {search.conn !== undefined && search.conn.length === 0 && connections.length > 0 && (
        <Callout tone="info" title={strings.noCalendarsTitle}>
          {strings.noCalendarsText}
        </Callout>
      )}
      <WeekCalendar
        label={strings.weekLabel(range)}
        days={weekDayItems(days, today, locale)}
        blocks={blocks}
        selectedDay={days.includes(search.day) ? search.day : (days[0] ?? search.week)}
        onSelectDay={(day) => onSearch({ day })}
        hourLabel={(hour) => hourFormat.format(new Date(2000, 0, 1, hour))}
        now={{ dayKey: today, minute: now.getHours() * 60 + now.getMinutes() }}
        scrollToMinute={scrollMinute(
          days,
          now,
          pieces.map(({ piece }) => piece),
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
                      refocus?.pieceId === open.piece.id && refocus.button !== 'remove' ? refocus.button : undefined,
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
            { draft: meeting, draftLabel: strings.drawCard(spanNames(meeting, locale).title) }
          : draft === undefined
            ? {}
            : {
                draft,
                draftLabel: strings.drawCard(spanNames(draft, locale).title),
                draftCard: (
                  <DrawCard
                    key={drawCount}
                    span={draft}
                    locale={locale}
                    privatePages={pages
                      .filter((page) => page.isPrivate)
                      .map((page) => ({ id: page.id, title: page.title }))}
                    overlapping={overlapping(bookings, draft)}
                    onSpanChange={setDraft}
                    onClose={({ kind, repeat, label, pageId }) => {
                      const drawn = draft;
                      const preview: BlockPreview = {
                        kind,
                        repeat,
                        ...(label === undefined ? {} : { label }),
                        startsAt: instantOf(drawn.dayKey, drawn.startMinute).toISOString(),
                        endsAt: instantOf(drawn.dayKey, drawn.endMinute).toISOString(),
                      };
                      return onBlock(
                        {
                          kind,
                          repeat,
                          date: drawn.dayKey,
                          startMinute: drawn.startMinute,
                          endMinute: drawn.endMinute,
                          timeZone: browserZone(),
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
                    {...(bookable.length === 0 || instantOf(draft.dayKey, draft.startMinute) < now
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
          return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
        }}
      />
      <p>{strings.weekSummary(live)}</p>
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
          onSpanChange={setMeeting}
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
function overlapping(bookings: readonly BookingListItem[], span: DrawnSpan): number {
  const start = instantOf(span.dayKey, span.startMinute).getTime();
  const end = instantOf(span.dayKey, span.endMinute).getTime();
  return bookings.filter(
    (booking) =>
      booking.status === 'confirmed' && Date.parse(booking.startsAt) < end && Date.parse(booking.endsAt) > start,
  ).length;
}

/** The local day a booking starts on, as a key. */
const dayKeyOfInstant = (instant: string) => dayKeyOf(new Date(instant));

/** The bookings under their day bands (Today, Tomorrow, then the date), in the order given. */
function groupsOf(
  bookings: readonly BookingListItem[],
  personHref: (booking: BookingListItem) => string | undefined,
  locale: string,
): readonly BookingListGroup[] {
  const now = new Date();
  const today = dayKeyOf(now);
  const tomorrow = addDays(today, 1);
  const shortDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  const groups: { id: string; label: string; rows: BookingListGroup['rows'][number][] }[] = [];
  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    const id = dayKeyOfInstant(booking.startsAt);
    const href = personHref(booking);
    const row = {
      id: booking.id,
      date: shortDate(start),
      time: timeRange(booking.startsAt, booking.endsAt, locale),
      // Join only while it can still be joined: not once cancelled, nor once it has ended.
      ...(booking.videoUrl === undefined ||
      booking.status === 'cancelled' ||
      Date.parse(booking.endsAt) <= now.getTime()
        ? {}
        : { join: { href: booking.videoUrl, provider: providerOf(booking.videoUrl) } }),
      title: booking.pageTitle,
      ...(booking.note === undefined ? {} : { note: booking.note }),
      guestName: booking.visitorName,
      ...(href === undefined ? {} : { guestHref: href }),
      ...(booking.status === 'cancelled' ? { badge: strings.cancelled } : {}),
    };
    const last = groups.at(-1);
    if (last?.id === id) last.rows.push(row);
    else
      groups.push({
        id,
        label: id === today ? strings.today : id === tomorrow ? strings.tomorrow : shortDate(start),
        rows: [row],
      });
  }
  return groups;
}

/** The list's bar: Upcoming · Past · Canceled, then the sort (when there is something to sort) and Filter. */
function ListBar({
  search,
  pages,
  sort,
  onSearch,
}: {
  readonly search: BookingsSearch;
  readonly pages: readonly BookingPageView[];
  readonly sort?: { readonly label: string; readonly next: 'asc' | 'desc' };
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
            if (tab !== undefined && tab !== search.tab) onSearch({ tab, page: 1, sort: undefined });
          }}
          segments={TABS.map((id) => ({ value: id, label: strings.tabs[id] }))}
        />
      }
      end={
        <>
          {sort !== undefined && (
            <Button variant="ghost" icon="chevrons-up-down" onPress={() => onSearch({ sort: sort.next, page: 1 })}>
              {sort.label}
            </Button>
          )}
          <FilterMenu search={search} pages={pages} connections={[]} onSearch={onSearch} />
        </>
      }
    />
  );
}

/** Props for the list: its three held reads, the address, and what Filter offers. */
export interface BookingsListScreenProps {
  readonly slug: string;
  readonly search: BookingsSearch;
  readonly lists: Readonly<Record<BookingsTab, BookingsView>>;
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly locale: string;
  /** The host's changes to a booking from its card (AC-640). */
  readonly actions?: HostBookingActions;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}

/**
 * Bookings › List: Upcoming, Past or Canceled, each with its own empty state,
 * a page of bookings under day bands, the sort and the pages; a row opens its
 * card in a Panel.
 */
export function BookingsListScreen({
  slug,
  search,
  lists,
  objects,
  pages,
  locale,
  onSearch,
  actions,
}: BookingsListScreenProps) {
  const personHref = usePersonHref(slug, objects);
  // The open booking by id, read from the list as it is now: a change (here or by the guest) shows in the panel.
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const tab = search.tab;
  const view = lists[tab];
  const state = useBookings(view);
  const open = state.status === 'ready' ? state.bookings.find((booking) => booking.id === openId) : undefined;
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
  const body = (() => {
    if (state.status === 'loading')
      return { bar: <ListBar search={search} pages={pages} onSearch={onSearch} />, list: <Skeleton shape="block" /> };
    if (state.status === 'error') {
      return {
        bar: <ListBar search={search} pages={pages} onSearch={onSearch} />,
        list: (
          <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
            {state.message === '' ? strings.failedText : state.message}
          </EmptyState>
        ),
      };
    }
    // The server answers upcoming soonest first, past and canceled latest first; the toggle flips it.
    const natural = tab === 'upcoming' ? 'asc' : 'desc';
    const sort = tab === 'cancelled' ? 'desc' : (search.sort ?? natural);
    const filtered = state.bookings.filter((booking) => search.link === undefined || booking.pageId === search.link);
    const ordered = sort === natural ? filtered : [...filtered].reverse();
    const count = Math.max(1, Math.ceil(ordered.length / search.per));
    const page = Math.min(search.page, count);
    const shown = ordered.slice((page - 1) * search.per, page * search.per);
    const byId = new Map(shown.map((booking) => [booking.id, booking]));
    const sortLabel =
      tab === 'upcoming'
        ? sort === 'asc'
          ? strings.sortSoonest
          : strings.sortLatest
        : sort === 'desc'
          ? strings.sortRecent
          : strings.sortOldest;
    return {
      bar: (
        <ListBar
          search={search}
          pages={pages}
          onSearch={onSearch}
          {...(tab !== 'cancelled' && ordered.length >= 2
            ? { sort: { label: sortLabel, next: sort === 'asc' ? ('desc' as const) : ('asc' as const) } }
            : {})}
        />
      ),
      list: (
        <>
          <BookingList
            label={strings.listLabel[tab]}
            groups={groupsOf(shown, personHref, locale)}
            onOpen={(id) => {
              const booking = byId.get(id);
              if (booking !== undefined) setOpenId(booking.id);
            }}
            emptyState={
              <EmptyState
                icon="calendar-days"
                title={strings.empty[tab].title}
                {...(tab === 'upcoming'
                  ? {
                      actions: (
                        <>
                          <Link href={linksHref(slug)}>{strings.openLinks}</Link>
                          <Link href={availabilityHref(slug)}>{strings.openAvailability}</Link>
                        </>
                      ),
                    }
                  : {})}
              >
                {strings.empty[tab].text}
              </EmptyState>
            }
          />
          <Pagination
            label={strings.listLabel[tab]}
            page={page}
            pageSize={search.per}
            total={ordered.length}
            pageSizes={PAGE_SIZES}
            onPage={(next) => onSearch({ page: next })}
            onPageSize={(per) => onSearch({ per, page: 1 })}
          />
        </>
      ),
    };
  })();
  return (
    <PageColumn>
      <Toolbar>{body.bar}</Toolbar>
      {body.list}
      {open !== undefined && (
        <Panel title={strings.details} isOpen onClose={() => setOpenId(undefined)}>
          <BookingCard booking={open} personHref={personHref(open)} locale={locale} actions={panelActions} />
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
