// Brief
// Purpose: a restaurant's reservations on one page, after checklabs' Reservations page (spec 0066 B7 lite; spec 0065
//   AC-6560 to AC-6565): one place's day, live, with its online booking settings one button away.
// Main task: see the day's bookings on checklabs' day calendar (10:00 to midnight) and in its bookings list, take a
//   booking (New booking, or a time picked on the calendar), open one for its detail, and confirm, seat, finish, mark
//   no show or cancel in one tap, with Undo; seat a walk in at a free table that fits; look at the floor, each table a
//   tile with its state, its timer and its next reservation; open Online booking from the bar to change how guests
//   book and publish the page.
// Leaves out: checklabs' waitlist (a later phase: Walk in seats at once), its marketplace listing and deposits; moving
//   tables by drag and joining tables by hand (later slices). The no show hint (15 minutes past) is checklabs' alert,
//   never an automatic change. A row's action stays pending until the server answers, so a second tap never lands on
//   the next action (Seat, then Finish) under the finger. A past day reads only.
import type {
  ServiceDayView,
  ServiceFloor,
  TablePlace,
  ServiceTable,
  ServiceVisit,
  TablesStore,
  VisitStatus,
} from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Badge,
  breakpointToken,
  Button,
  Callout,
  Card,
  CardTitleLevel,
  EmptyState,
  focusLater,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  MonthCalendar,
  PageColumn,
  PersonLine,
  Popover,
  SectionBar,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  TileGrid,
  TopBar,
  WeekCalendar,
  type Hue,
  type TableColumn,
  type Toasts,
  type WeekCalendarBlock,
} from '@crm/ui';
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { minuteOfDay } from '../bookings/week.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { calendarStart } from './day-hours.ts';
import { DEFAULT_BOOKING_MINUTE, NewBookingDialog, OFF_CALENDAR, sourceOf, VisitSheet } from './NewBooking.tsx';
import { OnlineBookingDrawer, OnlineBookingNotice } from './OnlineBooking.tsx';
import type { ReservationsSearch } from './search.ts';
import { StartBusiness } from '../hospitality/StartBusiness.tsx';
import { strings } from './strings.ts';
import { WalkInDrawer } from './WalkIn.tsx';

/** The status a visit shows, its hue and the next likely move. */
const LOOK: Readonly<Record<VisitStatus, { readonly hue: Hue; readonly next?: VisitStatus }>> = {
  booked: { hue: 'blue', next: 'started' },
  confirmed: { hue: 'sky', next: 'started' },
  arrived: { hue: 'yellow', next: 'started' },
  started: { hue: 'green', next: 'completed' },
  completed: { hue: 'gray' },
  no_show: { hue: 'red' },
  cancelled: { hue: 'gray' },
};

/** Rows that are over for the night: they sort after everything still to happen. */
const OVER: ReadonlySet<VisitStatus> = new Set(['completed', 'no_show', 'cancelled']);

/** Still to happen: what can be confirmed, seated, marked a no show or cancelled. */
const OPEN: ReadonlySet<VisitStatus> = new Set(['booked', 'confirmed', 'arrived']);

/** Minutes a booked guest may be late before the stand is told (checklabs' no show alert). */
const LATE_MINUTES = 15;

/** The hours the day calendar shows before it scrolls: about checklabs' 560px, so the list starts on the first screen. */
const CALENDAR_HOURS = 8;

/**
 * A desk's window (the shell keeps its sidebar open from here, `bp-page-compact`): the bar holds the day's arrows and
 * every action, and the list every column. Under it the bar keeps the date, More and New booking, and the list what
 * the stand acts on.
 */
const DESK = `(width >= ${String(breakpointToken('bp-page-compact'))}px)`;

/** An instant's date on the place's clock. */
const dateIn = (at: Date, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(at);

/** The place date today on its own clock. */
const todayIn = (zone: string) => dateIn(new Date(), zone);

const shift = (date: string, days: number) => {
  const at = new Date(`${date}T12:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** The clock, ticking every 30 seconds while the screen shows, for the timers. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** Whether a media query matches now, following it as it changes. */
function useMatches(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener('change', changed);
      return () => {
        list.removeEventListener('change', changed);
      };
    },
    () => globalThis.matchMedia(query).matches,
    () => true,
  );
}

/** "1 h 05" or "25 min". */
const since = (from: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(from)) / 60_000));
  return minutes < 60 ? strings.minutes(minutes) : strings.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
};

/** Whether focus fell to the page (its control went with a change), so the screen hands it on. */
const focusFell = () => {
  const active = globalThis.document.activeElement;
  return active === null || active === globalThis.document.body || active.closest('[inert]') !== null;
};

/** Props for ReservationsScreen. */
export interface ReservationsScreenProps {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly toasts: Toasts;
  /** What the address names: the day (`?date=`, today when left out) and the place (`?place=`, the first). */
  readonly search: ReservationsSearch;
  /** Another day or place picked: today and the first place are left out, so the address stays plain. */
  readonly onSearch: (search: ReservationsSearch) => void;
}

/** The page: the place, then its day. */
export function ReservationsScreen({ slug, tables, toasts, search, onSearch }: ReservationsScreenProps) {
  const held = tables.places(slug);
  const loaded = useHospitality(held);
  const topBar = <TopBar title={strings.reservations} icon="calendar-check" />;
  if (loaded.status !== 'ready') {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{
          topBar,
          body:
            loaded.status === 'loading' ? (
              <Skeleton shape="block" />
            ) : (
              <EmptyState icon="circle-alert" title={loaded.error.message} onRetry={held.retry} />
            ),
        }}
      />
    );
  }
  const places = loaded.value.places;
  const place = places.find((each) => each.id === search.place) ?? places[0];
  if (place === undefined) {
    return (
      <WorkspacePage
        currentPage="reservations"
        page={{
          topBar,
          body: (
            <StartBusiness
              slug={slug}
              app="table_seating"
              icon="calendar-check"
              title={strings.startTitle}
              text={strings.startText}
              onDone={held.retry}
            />
          ),
        }}
      />
    );
  }
  const first = places[0]?.id;
  return (
    <PlaceDay
      key={place.id}
      slug={slug}
      tables={tables}
      places={places}
      place={place}
      toasts={toasts}
      {...(search.date === undefined ? {} : { date: search.date })}
      onDate={(date) =>
        onSearch({ ...(date === undefined ? {} : { date }), ...(place.id === first ? {} : { place: place.id }) })
      }
      onPlace={(next) =>
        onSearch({
          ...(search.date === undefined ? {} : { date: search.date }),
          ...(next === first ? {} : { place: next }),
        })
      }
    />
  );
}

/** A move in flight on a row: which status it asked for, so the row keeps showing that action, pending. */
type Pending = ReadonlyMap<string, VisitStatus>;

/** A bar action: in the bar on a desk's window, else in More. */
type BarAction = 'today' | 'walk-in' | 'view' | 'online';

function PlaceDay({
  slug,
  tables,
  places,
  place,
  toasts,
  date: asked,
  onDate,
  onPlace,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly places: readonly TablePlace[];
  readonly place: TablePlace;
  readonly toasts: Toasts;
  readonly date?: string;
  readonly onDate: (date: string | undefined) => void;
  readonly onPlace: (placeId: string) => void;
}) {
  const zone = place.timeZone;
  const today = todayIn(zone);
  const date = asked ?? today;
  const setDate = (next: string) => onDate(next === today ? undefined : next);
  const isToday = date === today;
  const isPast = date < today;
  const canManage = useCan('hospitality.manage');
  const [view, setView] = useState<'list' | 'floor'>('list');
  const [asking, setAsking] = useState<
    { readonly visit: ServiceVisit; readonly status: 'no_show' | 'cancelled' } | undefined
  >();
  const [openTable, setOpenTable] = useState<string | undefined>();
  // The sheets stay mounted once opened, so each slides out as it closes; a new opening is a new sheet (`key`).
  const [walkIn, setWalkIn] = useState<{ readonly key: number; readonly tableId?: string; readonly isOpen: boolean }>();
  const [booking, setBooking] = useState<{
    readonly key: number;
    readonly date: string;
    readonly minute: number;
    readonly isOpen: boolean;
  }>();
  const [settings, setSettings] = useState<{ readonly key: number; readonly isOpen: boolean }>();
  const opened = useRef(0);
  const [isJumpOpen, setJumpOpen] = useState(false);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Each row's next move, so focus can land on it once the button pressed has gone (Confirm, once confirmed).
  const nextRefs = useRef(new Map<string, HTMLButtonElement>());
  const [openVisit, setOpenVisit] = useState<string | undefined>();
  // Where focus goes back on the calendar once a sheet closes (its block, or its day when the block has gone).
  const [focusBlock, setFocusBlock] = useState<{ readonly dayKey: string; readonly blockId?: string } | undefined>();
  const [pending, setPending] = useState<Pending>(new Map());
  // The rows in flight, read synchronously: two taps in one frame both see the first one.
  const inFlight = useRef(new Set<string>());
  const dayHeld = tables.day(slug, place.id, date);
  const day = useHospitality(dayHeld);
  const floorHeld = tables.floor(slug, place.id);
  const floor = useHospitality(floorHeld);
  const now = useNow();
  const isDesk = useMatches(DESK);
  const time = (instant: string) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(
      new Date(instant),
    );
  const dayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
  // The bar's date stays short, so it keeps to one line beside the title at every width.
  const shortLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
  const tableList: readonly ServiceTable[] = floor.status === 'ready' ? floor.value.resources : [];
  const labelOf = (ids: readonly string[]) =>
    ids
      .map((id) => tableList.find((each) => each.id === id)?.label ?? '')
      .filter((label) => label !== '')
      .join(' + ');

  /** Once a sheet has closed and focus fell to the page (what opened it went), the page's title takes it. */
  const handFocusOn = () => focusLater(() => (focusFell() ? titleRef.current : undefined));

  const settle = (id: string) => {
    inFlight.current.delete(id);
    setPending((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  };

  // Each visit's latest Undo toast: a newer move on the same visit replaces it, so an older Undo (back past a later
  // move) is never offered (walk of 4 Nov 2026: Seat's Undo after Finish was refused).
  const undoToasts = useRef(new Map<string, string>());
  /** Moves a visit, with Undo for 10 seconds back to where it was. One move per row at a time. */
  const move = async (visit: ServiceVisit, status: VisitStatus) => {
    if (inFlight.current.has(visit.id)) return;
    inFlight.current.add(visit.id);
    setPending((current) => new Map(current).set(visit.id, status));
    const before = undoToasts.current.get(visit.id);
    if (before !== undefined) {
      toasts.dismiss(before);
      undoToasts.current.delete(visit.id);
    }
    const refused = await tables.setStatus(slug, place.id, date, visit.id, status);
    settle(visit.id);
    // The button pressed may have gone with the move (Confirm once confirmed, Finish once finished): focus moves to
    // the row's next move, else the page's title, never the page.
    focusLater(() => (focusFell() ? (nextRefs.current.get(visit.id) ?? titleRef.current) : undefined));
    if (refused !== undefined) {
      toasts.toast({ tone: 'danger', message: refused.message });
      return;
    }
    const key = toasts.toast(
      {
        tone: 'success',
        message: strings.moved(visit.name, strings.status[status]),
        action: {
          label: strings.undo,
          onAction: () => {
            if (inFlight.current.has(visit.id)) return;
            inFlight.current.add(visit.id);
            setPending((current) => new Map(current).set(visit.id, visit.status));
            void tables.setStatus(slug, place.id, date, visit.id, visit.status).then((undone) => {
              settle(visit.id);
              toasts.toast(
                undone === undefined
                  ? { tone: 'success', message: strings.undone(visit.name) }
                  : { tone: 'danger', message: undone.message },
                { timeout: 3_000 },
              );
            });
          },
        },
      },
      { timeout: 10_000 },
    );
    undoToasts.current.set(visit.id, key);
  };

  const isLate = (visit: ServiceVisit) =>
    isToday &&
    (visit.status === 'booked' || visit.status === 'confirmed') &&
    now - Date.parse(visit.start) > LATE_MINUTES * 60_000;

  /**
   * The row's moves, as checklabs' row has them: on a desk's window, Confirm for a booking not yet confirmed, then
   * the next move (Seat, Finish, today only); No show (today) and Cancel ask first (AC-6565), so they sit one step
   * away in the row's menu, with Confirm there too on a narrow list. A move in flight keeps its own button, pending,
   * and the others wait. A past day reads only.
   */
  const actionsOf = (visit: ServiceVisit) => {
    if (isPast) return null;
    const asked = pending.get(visit.id);
    const isConfirming = asked === 'confirmed';
    // Shown at once as confirmed, the row keeps its Confirm, pending, until the server answers.
    const canConfirm = isConfirming || (visit.status === 'booked' && asked === undefined);
    const next = isToday ? (asked !== undefined && !isConfirming ? asked : LOOK[visit.status].next) : undefined;
    const canFree = asked === undefined && OPEN.has(visit.status);
    const words: Partial<Record<VisitStatus, string>> = {
      started: strings.seat,
      completed: strings.finish,
      no_show: strings.noShow,
      cancelled: strings.cancel,
    };
    return (
      <>
        {canConfirm && isDesk && (
          <Button
            icon="check"
            isPending={isConfirming}
            isDisabled={asked !== undefined && !isConfirming}
            onPress={() => void move(visit, 'confirmed')}
          >
            {strings.confirm}
          </Button>
        )}
        {next !== undefined && (asked !== undefined || LOOK[visit.status].next !== undefined) && (
          <Button
            ref={(element) => {
              if (element === null) nextRefs.current.delete(visit.id);
              else nextRefs.current.set(visit.id, element);
            }}
            isPending={asked !== undefined && !isConfirming}
            isDisabled={isConfirming}
            onPress={() => void move(visit, next)}
          >
            {words[next] ?? strings.status[next]}
          </Button>
        )}
        {canFree && (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.moreFor(visit.name)} />
            <Menu
              label={strings.moreFor(visit.name)}
              onAction={(key) => {
                if (key === 'confirmed') void move(visit, 'confirmed');
                if (key === 'no_show' || key === 'cancelled') setAsking({ visit, status: key });
              }}
            >
              {!isDesk && visit.status === 'booked' && (
                <MenuItem id="confirmed" icon="check">
                  {strings.confirm}
                </MenuItem>
              )}
              {isToday && (
                <MenuItem id="no_show" icon="user-x">
                  {strings.noShow}
                </MenuItem>
              )}
              <MenuItem id="cancelled" icon="circle-x" isDanger>
                {strings.cancelReservation}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </>
    );
  };

  /**
   * The detail sheet's moves (checklabs' footer): No show (today) and Cancel reservation (each asking first), Confirm
   * for a booked guest, then the next move (Seat, Finish, today only) as the primary; a past day reads only.
   */
  const sheetActions = (visit: ServiceVisit) => {
    if (isPast) return null;
    const asked = pending.get(visit.id);
    const next = asked ?? LOOK[visit.status].next;
    const open = asked === undefined && OPEN.has(visit.status);
    return (
      <>
        {open && isToday && (
          <Button icon="user-x" onPress={() => setAsking({ visit, status: 'no_show' })}>
            {strings.noShow}
          </Button>
        )}
        {open && (
          <Button icon="circle-x" onPress={() => setAsking({ visit, status: 'cancelled' })}>
            {strings.cancelReservation}
          </Button>
        )}
        {asked === undefined && visit.status === 'booked' && (
          <Button icon="check" onPress={() => void move(visit, 'confirmed')}>
            {strings.confirm}
          </Button>
        )}
        {next !== undefined && isToday && (
          <Button variant="primary" isPending={asked !== undefined} onPress={() => void move(visit, next)}>
            {next === 'started' ? strings.seat : next === 'completed' ? strings.finish : strings.status[next]}
          </Button>
        )}
      </>
    );
  };

  const statusOf = (visit: ServiceVisit) =>
    isLate(visit) ? (
      <Badge dot="red" text={strings.late(since(visit.start, now))} />
    ) : (
      <Badge dot={LOOK[visit.status].hue} text={strings.status[visit.status]} />
    );

  // A desk's list has checklabs' row in columns: when, who (the phone, the occasion and the note under the name, as
  // checklabs' row has them, cut at the line's end), guests, table, the source (checklabs' pill), the state and the
  // moves. A narrower list keeps when, who (the state and the party first under the name) and the moves, so the name
  // always has its room.
  const columns: readonly TableColumn[] = isDesk
    ? [
        { id: 'time', label: strings.time, size: 'fit' },
        { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
        { id: 'party', label: strings.party, size: 'fit', align: 'end' },
        { id: 'table', label: strings.table, size: 'fit' },
        { id: 'source', label: strings.sourceTitle, size: 'fit' },
        { id: 'status', label: strings.statusTitle, size: 'fit' },
        { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', isInline: true },
      ]
    : [
        { id: 'time', label: strings.time, size: 'fit' },
        { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
        { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', isInline: true },
      ];

  /** Still to happen first, by time; then what is over for the night, by time. */
  const ordered = (visits: readonly ServiceVisit[]) =>
    [...visits].sort(
      (a, b) => Number(OVER.has(a.status)) - Number(OVER.has(b.status)) || Date.parse(a.start) - Date.parse(b.start),
    );

  /** The guest as checklabs' row has them: the name, and under it the phone (on a narrow list, the state first). */
  const guestOf = (visit: ServiceVisit) => (
    <PersonLine
      id={visit.id}
      name={visit.name}
      {...(!isDesk && isLate(visit) ? { tone: 'away' as const } : {})}
      meta={[
        ...(isDesk
          ? []
          : [
              isLate(visit) ? strings.late(since(visit.start, now)) : strings.status[visit.status],
              strings.guestsCount(visit.party),
            ]),
        ...(visit.phone === undefined ? [] : [visit.phone]),
        ...(visit.occasion === undefined ? [] : [strings.occasion(visit.occasion)]),
        ...(visit.note === undefined ? [] : [visit.note]),
      ]}
    />
  );

  const list = (value: ServiceDayView) => (
    <Table
      label={strings.listLabel(dayLabel)}
      columns={columns}
      rows={ordered(value.visits)}
      getRowId={(visit) => visit.id}
      onRowAction={setOpenVisit}
      emptyState={<EmptyState icon="calendar-check" title={strings.noReservations(dayLabel)} />}
      renderCell={(visit, column) => {
        switch (column) {
          case 'time':
            return time(visit.start);
          case 'guest':
            return guestOf(visit);
          case 'party':
            return String(visit.party);
          case 'table':
            return labelOf(visit.resourceIds);
          case 'source':
            return <Badge text={sourceOf(visit.source)} isWhole />;
          case 'status':
            return statusOf(visit);
          default:
            return actionsOf(visit);
        }
      }}
    />
  );

  const hourLabel = (hour: number) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
  const minuteLabel = (minute: number) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60),
    );
  // Bookings are taken from today on: a past day reads only.
  const canBook = !isPast;
  const nowMinute = minuteOfDay(new Date(now), zone);
  // The time now on the hour axis, without its day period so it fits the axis ("11:51", not "11:51 AM").
  const nowLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone })
    .formatToParts(new Date(now))
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  const theDay = {
    key: date,
    weekday: '',
    dayNumber: '',
    label: dayLabel,
    isToday,
    isPast,
  };

  /**
   * Checklabs' day calendar: the chosen day alone (the bar names it), 10:00 to midnight (from the day's first service
   * or booking when sooner), eight hours at a time, its bookings by time (cancelled and no shows left out); a picked
   * time books. Its line counts what is on it and the day's covers, as the Stats row did.
   */
  const calendar = (value: ServiceDayView | undefined) => {
    // A party still seated from before midnight is on the list and the floor, to Finish; the calendar draws this day.
    const shown = (value?.visits ?? []).filter(
      (visit) => !OFF_CALENDAR.has(visit.status) && dateIn(new Date(visit.start), zone) === date,
    );
    const blocks: readonly WeekCalendarBlock[] = shown.map((visit) => {
      const startMinute = minuteOfDay(new Date(visit.start), zone);
      const length = (Date.parse(visit.end) - Date.parse(visit.start)) / 60_000;
      const endMinute = Math.max(startMinute + 15, Math.min(24 * 60, startMinute + length));
      const table = labelOf(visit.resourceIds);
      return {
        id: visit.id,
        dayKey: date,
        startMinute,
        endMinute,
        title: visit.name,
        time: `${time(visit.start)} – ${time(visit.end)}`,
        detail: [strings.guestsCount(visit.party), ...(table === '' ? [] : [table])].join(' · '),
        kind: 'booking',
        hue: isLate(visit) ? 'red' : LOOK[visit.status].hue,
        ...(visit.status === 'booked' || visit.status === 'confirmed' ? {} : { status: strings.status[visit.status] }),
      };
    });
    const from = calendarStart(
      place.hours,
      date,
      blocks.map((block) => block.startMinute),
    );
    return (
      <>
        <SectionBar
          title={strings.dayCalendar}
          {...(value === undefined
            ? {}
            : { description: strings.dayCalendarHint(shown.length, value.covers, canBook) })}
        />
        <WeekCalendar
          label={strings.calendarLabel(dayLabel)}
          view="day"
          days={[theDay]}
          drawnHours={{ startMinute: from, endMinute: 24 * 60 }}
          visibleHours={CALENDAR_HOURS}
          blocks={blocks}
          {...(value === undefined ? { isLoading: true } : {})}
          {...(openVisit === undefined ? {} : { openId: openVisit })}
          {...(focusBlock === undefined ? {} : { focusDay: focusBlock })}
          selectedDay={date}
          onSelectDay={setDate}
          hourLabel={hourLabel}
          minuteLabel={minuteLabel}
          {...(isToday ? { now: { dayKey: today, minute: nowMinute, label: nowLabel } } : {})}
          scrollToMinute={isToday ? Math.max(from, (Math.floor(nowMinute / 60) - 1) * 60) : from}
          onOpen={setOpenVisit}
          onClose={() => setOpenVisit(undefined)}
          // A picked time opens New booking at its start; the table's hold sets the length (checklabs' click a slot).
          drawMinutes={30}
          drawStartMinute={() => DEFAULT_BOOKING_MINUTE}
          {...(canBook ? { onDraw: (span) => openBooking(span.dayKey, span.startMinute) } : {})}
        />
      </>
    );
  };

  /** A table's state tonight: who sits there, who comes next, and how it reads. */
  const tableState = (table: ServiceTable, value: ServiceDayView) => {
    const holding = value.visits.filter((visit) => visit.resourceIds.includes(table.id));
    const seated = holding.find((visit) => visit.status === 'started');
    const coming = holding
      .filter((visit) => OPEN.has(visit.status))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const late = coming !== undefined && isLate(coming);
    const soon = isToday && coming !== undefined && Date.parse(coming.start) - now < 30 * 60_000;
    const state: 'seated' | 'attention' | 'soon' | 'free' =
      seated !== undefined ? 'seated' : late ? 'attention' : soon ? 'soon' : 'free';
    const hue: Hue =
      state === 'seated' ? 'green' : state === 'attention' ? 'red' : state === 'soon' ? 'yellow' : 'gray';
    return { holding, seated, coming, late, state, hue };
  };

  const tile = (table: ServiceTable, value: ServiceDayView) => {
    const { seated, coming, late, state, hue } = tableState(table, value);
    return (
      <Card
        key={table.id}
        title={table.label}
        description={strings.seats(table.minCapacity, table.maxCapacity)}
        eyebrow={<Badge dot={hue} text={strings.tableState[state]} />}
        // Timers only tonight: another day has nobody sitting yet.
        actions={
          seated === undefined || !isToday ? undefined : <Badge text={since(seated.seatedAt ?? seated.start, now)} />
        }
        footer={null}
        footerNote={coming === undefined ? strings.noneNext : strings.next(time(coming.start), coming.party)}
        onPress={() => {
          setOpenTable(table.id);
        }}
      >
        {seated !== undefined
          ? `${seated.name} · ${strings.guestsCount(seated.party)}`
          : late && coming !== undefined
            ? strings.late(since(coming.start, now))
            : undefined}
      </Card>
    );
  };

  /** The floor, one group per area in the place's order (tables without one last), each a dense grid of tiles. */
  const tiles = (value: ServiceDayView, plan: ServiceFloor | undefined) => {
    const areas = [...(plan?.areas ?? [])].sort((a, b) => a.position - b.position);
    const groups = [
      ...areas.map((area) => ({
        id: area.id,
        name: area.name,
        tables: tableList.filter((table) => table.areaId === area.id),
      })),
      {
        id: 'none',
        name: strings.noArea,
        tables: tableList.filter((table) => table.areaId === undefined || !areas.some((a) => a.id === table.areaId)),
      },
    ].filter((group) => group.tables.length > 0);
    return groups.map((group) => {
      const free = group.tables.filter((table) => tableState(table, value).state === 'free').length;
      const hasBar = groups.length > 1 || group.id !== 'none';
      const grid = <TileGrid columns="dense">{group.tables.map((table) => tile(table, value))}</TileGrid>;
      return (
        <Fragment key={group.id}>
          {hasBar ? (
            <SectionBar title={group.name} isTitleQuiet description={strings.freeOf(free, group.tables.length)} />
          ) : null}
          {/* With no area's bar (an h2) over them, the tiles' names are the page's next heading level. */}
          {hasBar ? grid : <CardTitleLevel value={2}>{grid}</CardTitleLevel>}
        </Fragment>
      );
    });
  };

  const openBooking = (onDay: string, minute: number) => {
    opened.current += 1;
    setBooking({ key: opened.current, date: onDay, minute, isOpen: true });
  };
  const openWalkIn = (tableId?: string) => {
    opened.current += 1;
    setWalkIn({ key: opened.current, ...(tableId === undefined ? {} : { tableId }), isOpen: true });
  };
  const openSettings = () => {
    opened.current += 1;
    setSettings({ key: opened.current, isOpen: true });
  };
  const run = (action: BarAction) => {
    if (action === 'today') setDate(today);
    else if (action === 'walk-in') openWalkIn();
    else if (action === 'view') setView(view === 'list' ? 'floor' : 'list');
    else openSettings();
  };
  // Narrower than a desk's window, the bar keeps the date, More and New booking; More holds, in checklabs' order,
  // the rest (Walk in sits by the bookings list there, where the host works).
  const inMore: readonly BarAction[] = isDesk
    ? []
    : [...(isToday ? [] : (['today'] as const)), 'view', ...(canManage ? (['online'] as const) : [])];

  const placeSwitch =
    places.length > 1 ? (
      <Select
        label={strings.place}
        isLabelHidden={isDesk}
        items={places.map((each) => ({ id: each.id, label: each.name }))}
        value={place.id}
        onChange={(next) => {
          if (typeof next === 'string') onPlace(next);
        }}
      />
    ) : null;

  const topBar = (
    <TopBar
      title={strings.reservations}
      icon="calendar-check"
      titleRef={titleRef}
      // The day, always in the bar (a phone too), and the way to any other: checklabs' date field. On a desk's window
      // the day's arrows sit beside it, where nothing that comes and goes in the bar can move them.
      meta={
        <>
          <Button
            ref={jumpRef}
            variant="ghost"
            iconRight="chevron-down"
            label={strings.pickDay(shortLabel)}
            isExpanded={isJumpOpen}
            onPress={() => setJumpOpen((open) => !open)}
          >
            {shortLabel}
          </Button>
          <Popover
            triggerRef={jumpRef}
            isOpen={isJumpOpen}
            onOpenChange={setJumpOpen}
            label={strings.goToDate}
            placement="bottom start"
          >
            <MonthCalendar
              label={strings.goToDate}
              // Opened from its button, focus is on the chosen day, so the arrows move at once.
              // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the month opens only when its button is pressed
              autoFocus
              value={date}
              onChange={(next) => {
                setJumpOpen(false);
                setDate(next);
              }}
            />
          </Popover>
          {isDesk && (
            <>
              <Button
                variant="ghost"
                icon="chevron-left"
                label={strings.previousDay}
                onPress={() => setDate(shift(date, -1))}
              />
              <Button
                variant="ghost"
                icon="chevron-right"
                label={strings.nextDay}
                onPress={() => setDate(shift(date, 1))}
              />
              {/* Today only away from today, after the arrows, so they never move. */}
              {!isToday && <Button onPress={() => setDate(today)}>{strings.today}</Button>}
            </>
          )}
        </>
      }
    >
      {isDesk && placeSwitch}
      {isDesk && (
        <SegmentedControl
          label={strings.view}
          value={view}
          onChange={(next) => setView(next === 'floor' ? 'floor' : 'list')}
          segments={[
            { value: 'list', label: strings.list, icon: 'list', isIconOnly: true },
            { value: 'floor', label: strings.floor, icon: 'layout-grid', isIconOnly: true },
          ]}
        />
      )}
      {isDesk && canManage && (
        <Button icon="globe" onPress={openSettings}>
          {strings.onlineBooking}
        </Button>
      )}
      {isDesk && isToday && (
        <Button icon="user-plus" onPress={() => openWalkIn()}>
          {strings.walkIn}
        </Button>
      )}
      {inMore.length > 0 && (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.more} />
          <Menu
            label={strings.more}
            onAction={(key) => {
              if (key === 'today' || key === 'walk-in' || key === 'view' || key === 'online') run(key);
            }}
          >
            {inMore.map((action) =>
              action === 'today' ? (
                <MenuItem key={action} id={action} icon="calendar">
                  {strings.today}
                </MenuItem>
              ) : action === 'view' ? (
                <MenuItem key={action} id={action} icon={view === 'list' ? 'layout-grid' : 'list'}>
                  {view === 'list' ? strings.showFloor : strings.showList}
                </MenuItem>
              ) : (
                <MenuItem key={action} id={action} icon="globe">
                  {strings.onlineBooking}
                </MenuItem>
              ),
            )}
          </Menu>
        </MenuTrigger>
      )}
      {canBook && (
        <Button
          variant="primary"
          icon="plus"
          isLabelCollapsible
          label={strings.newBooking}
          onPress={() => openBooking(date, DEFAULT_BOOKING_MINUTE)}
        >
          {strings.newBooking}
        </Button>
      )}
    </TopBar>
  );

  const bookingsBar = (count: number | undefined) => (
    <SectionBar
      title={count === undefined ? strings.bookingsTitle : strings.bookings(count)}
      // Narrower than a desk's window, Walk in sits by the list (as checklabs' waitlist sits by its bookings).
      {...(!isDesk && isToday
        ? {
            end: (
              <Button icon="user-plus" onPress={() => openWalkIn()}>
                {strings.walkIn}
              </Button>
            ),
          }
        : {})}
    />
  );
  // Checklabs' order is the calendar over the list; a narrower window puts the list (where the host works) first.
  const listView = (value: ServiceDayView | undefined) => {
    const rows = (
      <>
        {bookingsBar(value?.visits.length)}
        {value === undefined ? <Skeleton shape="text" lines={4} /> : list(value)}
      </>
    );
    return isDesk ? (
      <>
        {calendar(value)}
        {rows}
      </>
    ) : (
      <>
        {rows}
        {calendar(value)}
      </>
    );
  };

  const ready = day.status === 'ready' ? day.value : undefined;
  // One column whatever loads, its slots fixed, so a day loading never remounts the notice, the list or the calendar.
  const body =
    day.status === 'error' ? (
      <EmptyState icon="circle-alert" title={day.error.message} onRetry={dayHeld.retry} />
    ) : (
      <PageColumn>
        {!isDesk && placeSwitch}
        {/* Guests can't reserve online yet: the one line that says so, with the way in (setup's own). */}
        {canManage ? (
          <OnlineBookingNotice slug={slug} tables={tables} placeId={place.id} onOpen={openSettings} />
        ) : null}
        {ready?.truncated === true ? <Callout tone="info">{strings.truncated}</Callout> : null}
        {view === 'list' ? (
          listView(ready)
        ) : floor.status === 'error' ? (
          <EmptyState icon="circle-alert" title={floor.error.message} onRetry={floorHeld.retry} />
        ) : floor.status === 'loading' || ready === undefined ? (
          <Skeleton shape="block" />
        ) : (
          tiles(ready, floor.value)
        )}
      </PageColumn>
    );

  const shownVisit = ready?.visits.find((visit) => visit.id === openVisit);
  const detailTable = tableList.find((table) => table.id === openTable);
  const detail = detailTable === undefined || ready === undefined ? undefined : tableState(detailTable, ready);

  return (
    <>
      <WorkspacePage currentPage="reservations" page={{ topBar, body }} />
      <Modal
        isOpen={detailTable !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenTable(undefined);
        }}
        title={detailTable === undefined ? '' : strings.tableDetail(detailTable.label)}
        icon="table"
        actions={
          <>
            <Button slot="close">{strings.close}</Button>
            {isToday && detail !== undefined && detail.seated === undefined && detailTable !== undefined && (
              <Button
                variant="primary"
                icon="user-plus"
                onPress={() => {
                  openWalkIn(detailTable.id);
                  setOpenTable(undefined);
                }}
              >
                {strings.walkInHere}
              </Button>
            )}
          </>
        }
      >
        {detailTable !== undefined && detail !== undefined && (
          <>
            <p>
              {strings.seats(detailTable.minCapacity, detailTable.maxCapacity)} · {strings.tableState[detail.state]}
            </p>
            {!isToday && <Callout tone="info">{strings.tableNotToday}</Callout>}
            <Table
              label={strings.tableDetail(detailTable.label)}
              columns={[
                { id: 'time', label: strings.time, size: 'fit' },
                { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
                { id: 'status', label: strings.statusTitle, size: 'fit' },
                {
                  id: 'actions',
                  label: strings.actions,
                  isLabelHidden: true,
                  align: 'end',
                  size: 'fit',
                  isInline: true,
                },
              ]}
              rows={ordered(detail.holding)}
              getRowId={(visit) => visit.id}
              emptyState={<EmptyState icon="table" title={strings.tableEmpty} />}
              renderCell={(visit, column) =>
                column === 'time'
                  ? time(visit.start)
                  : column === 'guest'
                    ? `${visit.name} · ${strings.guestsCount(visit.party)}`
                    : column === 'status'
                      ? statusOf(visit)
                      : isToday
                        ? actionsOf(visit)
                        : null
              }
            />
          </>
        )}
      </Modal>
      <VisitSheet
        visit={shownVisit}
        when={shownVisit === undefined ? '' : `${dayLabel}, ${time(shownVisit.start)} – ${time(shownVisit.end)}`}
        tableLabel={shownVisit === undefined ? '' : labelOf(shownVisit.resourceIds)}
        status={
          shownVisit === undefined
            ? { hue: 'gray', text: '' }
            : isLate(shownVisit)
              ? { hue: 'red', text: strings.late(since(shownVisit.start, now)) }
              : { hue: LOOK[shownVisit.status].hue, text: strings.status[shownVisit.status] }
        }
        renderActions={() => (shownVisit === undefined ? null : sheetActions(shownVisit))}
        onClose={() => {
          if (shownVisit !== undefined) {
            setFocusBlock(
              OFF_CALENDAR.has(shownVisit.status) ? { dayKey: date } : { dayKey: date, blockId: shownVisit.id },
            );
          }
          setOpenVisit(undefined);
        }}
      />
      {booking !== undefined && (
        <NewBookingDialog
          key={booking.key}
          isOpen={booking.isOpen}
          slug={slug}
          tables={tables}
          placeId={place.id}
          zone={zone}
          date={booking.date}
          minute={booking.minute}
          now={now}
          floorTables={tableList}
          areas={floor.status === 'ready' ? floor.value.areas : []}
          onClose={() => {
            setBooking({ ...booking, isOpen: false });
            handFocusOn();
          }}
          onBooked={(name, bookedDay) => {
            setBooking({ ...booking, isOpen: false });
            handFocusOn();
            if (bookedDay !== date) setDate(bookedDay);
            toasts.toast({ tone: 'success', message: strings.booked(name) });
          }}
        />
      )}
      {walkIn !== undefined && (
        <WalkInDrawer
          key={walkIn.key}
          isOpen={walkIn.isOpen}
          slug={slug}
          tables={tables}
          place={place}
          date={today}
          {...(walkIn.tableId === undefined ? {} : { tableId: walkIn.tableId })}
          onClose={() => {
            setWalkIn({ ...walkIn, isOpen: false });
            handFocusOn();
          }}
          onSeated={(label, party) => {
            setWalkIn({ ...walkIn, isOpen: false });
            handFocusOn();
            toasts.toast({ tone: 'success', message: strings.seatedWalkIn(label, party) });
          }}
        />
      )}
      {settings !== undefined && canManage && (
        <OnlineBookingDrawer
          key={settings.key}
          isOpen={settings.isOpen}
          slug={slug}
          tables={tables}
          place={place}
          toasts={toasts}
          onClose={() => {
            setSettings({ ...settings, isOpen: false });
            handFocusOn();
          }}
        />
      )}
      <Modal
        isOpen={asking !== undefined}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        title={
          asking?.status === 'no_show'
            ? strings.noShowTitle(asking.visit.name)
            : strings.cancelTitle(asking?.visit.name ?? '')
        }
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button slot="close">{strings.keepReservation}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (asking !== undefined) void move(asking.visit, asking.status);
                setAsking(undefined);
              }}
            >
              {asking?.status === 'no_show' ? strings.noShow : strings.cancelReservation}
            </Button>
          </>
        }
      >
        {strings.freesTable}
      </Modal>
    </>
  );
}
