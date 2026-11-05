// Brief
// Purpose: run the evening at the host stand (spec 0066 B7 lite; 0065 AC-6560 to AC-6565): one place's day, live.
// Main task: see every reservation of the day on checklabs' day calendar and its bookings list, take a booking (New
//   booking, or a time picked on the calendar), open one for its detail, and seat, finish, confirm, mark no show or
//   cancel in one tap, with Undo; seat a walk in at a free table that fits; or look at the floor, each table a tile
//   with its state, its timer and its next reservation, that opens the table with Seat and Finish.
// Leaves out: moving tables by drag and joining tables by hand (later slices). Laid out as checklabs' reservations
//   page (the date, then the bookings list) with its floor as tiles grouped by area after the owner's references; the
//   no show hint (15 minutes past) is checklabs' alert, never an automatic change. A row's action stays pending until
//   the server answers, so a second tap never lands on the next action (Seat, then Finish) under the finger.
import type {
  FreeTablesView,
  HospitalityStore,
  Place,
  PlaceFloor,
  Resource,
  ServiceDayView,
  ServiceVisit,
  TablesStore,
  VisitStatus,
} from '@crm/data';
import { isDataError } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  ChoiceChips,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  PageColumn,
  SectionBar,
  SegmentedControl,
  Select,
  Skeleton,
  Stats,
  Table,
  TileGrid,
  TopBar,
  TruncatedText,
  WeekCalendar,
  type Hue,
  type TableColumn,
  type Toasts,
  type WeekCalendarBlock,
} from '@crm/ui';
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { minuteOfDay, weekDays, weekOf } from '../bookings/week.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DEFAULT_BOOKING_MINUTE, NewBookingDialog, OFF_CALENDAR, VisitSheet } from './NewBooking.tsx';
import { strings } from './strings.ts';

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

/** Minutes a booked guest may be late before the stand is told (checklabs' no show alert). */
const LATE_MINUTES = 15;

/** The largest walk in the stand seats from the screen; a bigger party is a reservation. */
const WALK_IN_MAX = 12;

/** Where the day calendar opens (checklabs draws 10:00 to midnight). */
const CALENDAR_FROM = 10 * 60;

/** Wide enough for the bar's date beside its controls; a phone drops it (the day shows in the list's label). */
const WIDE = '(min-width: 40rem)';

/** The place date today on its own clock. */
const todayIn = (zone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(
    new Date(),
  );

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

/** The page: the place, the day, the list or the floor. */
export function ServiceScreen({
  slug,
  tables,
  hospitality,
  toasts,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly hospitality: HospitalityStore;
  readonly toasts: Toasts;
}) {
  const held = hospitality.business(slug);
  const business = useHospitality(held);
  const [placeId, setPlaceId] = useState<string | undefined>();
  const topBar = <TopBar title={strings.service} icon="table" />;
  if (business.status !== 'ready') {
    return (
      <WorkspacePage
        currentPage="service"
        page={{
          topBar,
          body:
            business.status === 'loading' ? (
              <Skeleton shape="block" />
            ) : (
              <EmptyState icon="circle-alert" title={business.error.message} onRetry={held.retry} />
            ),
        }}
      />
    );
  }
  const place = business.value.places.find((each) => each.id === placeId) ?? business.value.places[0];
  if (place === undefined) {
    return (
      <WorkspacePage
        currentPage="service"
        page={{
          topBar,
          body: (
            <EmptyState
              icon="store"
              title={strings.noPlace}
              actions={
                <ButtonLink href={businessSettingsHref(slug)} variant="primary" icon="store">
                  {strings.addPlace}
                </ButtonLink>
              }
            />
          ),
        }}
      />
    );
  }
  return (
    <PlaceService
      key={place.id}
      slug={slug}
      tables={tables}
      hospitality={hospitality}
      places={business.value.places}
      place={place}
      onPlace={setPlaceId}
      toasts={toasts}
    />
  );
}

/** A move in flight on a row: which status it asked for, so the row keeps showing that action, pending. */
type Pending = ReadonlyMap<string, VisitStatus>;

function PlaceService({
  slug,
  tables,
  hospitality,
  places,
  place,
  onPlace,
  toasts,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly hospitality: HospitalityStore;
  readonly places: readonly Place[];
  readonly place: Place;
  readonly onPlace: (placeId: string) => void;
  readonly toasts: Toasts;
}) {
  const zone = place.timeZone;
  const today = todayIn(zone);
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const [view, setView] = useState<'list' | 'floor'>('list');
  const [asking, setAsking] = useState<
    { readonly visit: ServiceVisit; readonly status: 'no_show' | 'cancelled' } | undefined
  >();
  const [openTable, setOpenTable] = useState<string | undefined>();
  const [walkIn, setWalkIn] = useState<{ readonly tableId?: string } | undefined>();
  // New booking, at the time picked on the calendar or 19:00; and the booking whose detail is open.
  const [booking, setBooking] = useState<{ readonly date: string; readonly minute: number } | undefined>();
  const [openVisit, setOpenVisit] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>(new Map());
  // The rows in flight, read synchronously: two taps in one frame both see the first one.
  const inFlight = useRef(new Set<string>());
  const dayHeld = tables.day(slug, place.id, date);
  const day = useHospitality(dayHeld);
  const floorHeld = hospitality.floor(slug, place.id);
  const floor = useHospitality(floorHeld);
  const now = useNow();
  const isWide = useMatches(WIDE);
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
  // The bar's date stays short, so a wide bar keeps to one line; a phone leaves it out.
  const shortLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
  const tableList: readonly Resource[] =
    floor.status === 'ready' ? floor.value.resources.filter((each) => !each.archived) : [];
  const labelOf = (ids: readonly string[]) =>
    ids
      .map((id) => tableList.find((each) => each.id === id)?.label ?? '')
      .filter((label) => label !== '')
      .join(' + ');

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

  /** The row's next move, as a button; while a move is in flight, that move's button, pending, in its place. */
  const actionsOf = (visit: ServiceVisit) => {
    const asked = pending.get(visit.id);
    const next = asked ?? LOOK[visit.status].next;
    const canFree =
      asked === undefined && (visit.status === 'booked' || visit.status === 'confirmed' || visit.status === 'arrived');
    const canConfirm = asked === undefined && visit.status === 'booked';
    const words: Partial<Record<VisitStatus, string>> = {
      started: strings.seat,
      completed: strings.finish,
      no_show: strings.noShow,
      cancelled: strings.cancel,
    };
    return (
      <>
        {next !== undefined && (asked !== undefined || LOOK[visit.status].next !== undefined) && (
          <Button
            size="sm"
            variant={next === 'started' ? 'primary' : 'secondary'}
            isPending={asked !== undefined}
            onPress={() => void move(visit, next)}
          >
            {words[next] ?? strings.status[next]}
          </Button>
        )}
        {canFree && (
          // No show and Cancel ask first (AC-6565), so they sit one step away, in the row's menu.
          <MenuTrigger>
            <Button variant="ghost" size="sm" icon="ellipsis" label={strings.moreFor(visit.name)} />
            <Menu
              label={strings.moreFor(visit.name)}
              onAction={(key) => {
                if (key === 'confirmed') void move(visit, 'confirmed');
                if (key === 'no_show' || key === 'cancelled') setAsking({ visit, status: key });
              }}
            >
              {canConfirm && (
                <MenuItem id="confirmed" icon="check">
                  {strings.confirm}
                </MenuItem>
              )}
              <MenuItem id="no_show" icon="user-x">
                {strings.noShow}
              </MenuItem>
              <MenuItem id="cancelled" icon="circle-x" isDanger>
                {strings.cancel}
              </MenuItem>
            </Menu>
          </MenuTrigger>
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

  // A phone keeps what the stand acts on: when, who (with the party), the state and the action; a wider screen adds
  // Guests, Table and the note (truncated, the guest's column takes the room).
  const columns: readonly TableColumn[] = isWide
    ? [
        { id: 'time', label: strings.time, size: 'fit' },
        { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
        { id: 'party', label: strings.party, size: 'fit', align: 'end' },
        { id: 'table', label: strings.table, size: 'fit' },
        { id: 'note', label: strings.note },
        { id: 'status', label: strings.statusTitle, size: 'fit' },
        { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
      ]
    : [
        { id: 'time', label: strings.time, size: 'fit' },
        { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
        { id: 'status', label: strings.statusTitle, size: 'fit' },
        { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
      ];

  /** Still to happen first, by time; then what is over for the night, by time. */
  const ordered = (visits: readonly ServiceVisit[]) =>
    [...visits].sort(
      (a, b) => Number(OVER.has(a.status)) - Number(OVER.has(b.status)) || Date.parse(a.start) - Date.parse(b.start),
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
            return [
              visit.name,
              ...(isWide ? [] : [strings.guestsCount(visit.party)]),
              ...(visit.occasion === undefined ? [] : [strings.occasion(visit.occasion)]),
            ].join(' · ');
          case 'party':
            return String(visit.party);
          case 'table':
            return labelOf(visit.resourceIds);
          case 'note':
            return visit.note === undefined ? '' : <TruncatedText>{visit.note}</TruncatedText>;
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
  const week = weekDays(weekOf(date));
  const nowMinute = minuteOfDay(new Date(now), zone);

  /** Checklabs' day calendar: the day's bookings by time (cancelled and no shows left out); a picked time books. */
  const calendar = (value: ServiceDayView) => {
    const shown = value.visits.filter((visit) => !OFF_CALENDAR.has(visit.status));
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
        detail: [strings.partyOf(visit.party), ...(table === '' ? [] : [table])].join(' · '),
        kind: 'booking',
        hue: isLate(visit) ? 'red' : LOOK[visit.status].hue,
        ...(visit.status === 'booked' || visit.status === 'confirmed' ? {} : { status: strings.status[visit.status] }),
      };
    });
    return (
      <>
        <SectionBar title={strings.dayCalendar} description={strings.dayCalendarHint(shown.length)} />
        <WeekCalendar
          label={strings.calendarLabel(dayLabel)}
          view="day"
          days={week.map((key) => {
            const at = new Date(`${key}T12:00:00.000Z`);
            const format = (options: Intl.DateTimeFormatOptions) =>
              new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(at);
            return {
              key,
              weekday: format({ weekday: 'short' }),
              dayNumber: format({ day: 'numeric' }),
              label: format({ weekday: 'long', day: 'numeric', month: 'long' }),
              isToday: key === today,
              isPast: key < today,
            };
          })}
          blocks={blocks}
          selectedDay={date}
          onSelectDay={setDate}
          hourLabel={hourLabel}
          minuteLabel={minuteLabel}
          {...(isToday ? { now: { dayKey: today, minute: nowMinute, label: minuteLabel(nowMinute) } } : {})}
          scrollToMinute={isToday ? Math.max(CALENDAR_FROM, (Math.floor(nowMinute / 60) - 1) * 60) : CALENDAR_FROM}
          emptyHint={strings.calendarEmpty}
          onOpen={setOpenVisit}
          onClose={() => setOpenVisit(undefined)}
          drawMinutes={30}
          onDraw={(span) => setBooking({ date: span.dayKey, minute: span.startMinute })}
        />
        <SectionBar title={strings.bookings(value.visits.length)} />
      </>
    );
  };

  /** A table's state tonight: who sits there, who comes next, and how it reads. */
  const tableState = (table: Resource, value: ServiceDayView) => {
    const holding = value.visits.filter((visit) => visit.resourceIds.includes(table.id));
    const seated = holding.find((visit) => visit.status === 'started');
    const coming = holding
      .filter((visit) => visit.status === 'booked' || visit.status === 'confirmed' || visit.status === 'arrived')
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const late = coming !== undefined && isLate(coming);
    const soon = isToday && coming !== undefined && Date.parse(coming.start) - now < 30 * 60_000;
    const state: 'seated' | 'attention' | 'soon' | 'free' =
      seated !== undefined ? 'seated' : late ? 'attention' : soon ? 'soon' : 'free';
    const hue: Hue =
      state === 'seated' ? 'green' : state === 'attention' ? 'red' : state === 'soon' ? 'yellow' : 'gray';
    return { holding, seated, coming, late, state, hue };
  };

  const tile = (table: Resource, value: ServiceDayView) => {
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
  const tiles = (value: ServiceDayView, plan: PlaceFloor | undefined) => {
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
      return (
        <Fragment key={group.id}>
          {groups.length > 1 || group.id !== 'none' ? (
            <SectionBar title={group.name} isTitleQuiet description={strings.freeOf(free, group.tables.length)} />
          ) : null}
          <TileGrid columns="dense">{group.tables.map((table) => tile(table, value))}</TileGrid>
        </Fragment>
      );
    });
  };

  const topBar = (
    <TopBar title={strings.service} icon="table" {...(isWide ? { meta: shortLabel } : {})}>
      {places.length > 1 && (
        <Select
          label={strings.place}
          isLabelHidden
          items={places.map((each) => ({ id: each.id, label: each.name }))}
          value={place.id}
          onChange={(next) => {
            if (typeof next === 'string') onPlace(next);
          }}
        />
      )}
      <Button size="sm" icon="chevron-left" label={strings.previousDay} onPress={() => setDate(shift(date, -1))} />
      {/* A phone keeps the bar to one line: Today shows only away from today (the calendar's days pick the rest). */}
      {(isWide || !isToday) && (
        <Button size="sm" isDisabled={isToday} onPress={() => setDate(today)}>
          {strings.today}
        </Button>
      )}
      <Button size="sm" icon="chevron-right" label={strings.nextDay} onPress={() => setDate(shift(date, 1))} />
      <SegmentedControl
        label={strings.view}
        value={view}
        onChange={(next) => setView(next === 'floor' ? 'floor' : 'list')}
        segments={[
          { value: 'list', label: strings.list, icon: 'list', isIconOnly: !isWide },
          { value: 'floor', label: strings.floor, icon: 'layout-grid', isIconOnly: !isWide },
        ]}
      />
      {isToday &&
        (isWide ? (
          <Button size="sm" icon="user-plus" onPress={() => setWalkIn({})}>
            {strings.walkIn}
          </Button>
        ) : (
          <Button size="sm" icon="user-plus" label={strings.walkIn} onPress={() => setWalkIn({})} />
        ))}
      {isWide ? (
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onPress={() => setBooking({ date, minute: DEFAULT_BOOKING_MINUTE })}
        >
          {strings.newBooking}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          label={strings.newBooking}
          onPress={() => setBooking({ date, minute: DEFAULT_BOOKING_MINUTE })}
        />
      )}
    </TopBar>
  );

  const body =
    day.status === 'loading' ? (
      <Skeleton shape="block" />
    ) : day.status === 'error' ? (
      <EmptyState icon="circle-alert" title={day.error.message} onRetry={dayHeld.retry} />
    ) : (
      <PageColumn>
        <Stats
          label={strings.coversLabel}
          items={[
            { id: 'booked', label: strings.coversBooked, value: String(day.value.covers.booked) },
            { id: 'seated', label: strings.coversSeated, value: String(day.value.covers.seated) },
            { id: 'toCome', label: strings.coversToCome, value: String(day.value.covers.toCome) },
          ]}
        />
        {day.value.truncated && <Callout tone="info">{strings.truncated}</Callout>}
        {view === 'list' ? (
          <>
            {calendar(day.value)}
            {list(day.value)}
          </>
        ) : floor.status === 'error' ? (
          <EmptyState icon="circle-alert" title={floor.error.message} onRetry={floorHeld.retry} />
        ) : floor.status === 'loading' ? (
          <Skeleton shape="block" />
        ) : (
          tiles(day.value, floor.value)
        )}
      </PageColumn>
    );

  const shownVisit = day.status === 'ready' ? day.value.visits.find((visit) => visit.id === openVisit) : undefined;
  const detailTable = tableList.find((table) => table.id === openTable);
  const detail = detailTable === undefined || day.status !== 'ready' ? undefined : tableState(detailTable, day.value);

  return (
    <>
      <WorkspacePage currentPage="service" page={{ topBar, body }} />
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
                  setWalkIn({ tableId: detailTable.id });
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
                { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
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
        renderActions={() => (shownVisit === undefined ? null : actionsOf(shownVisit))}
        onClose={() => setOpenVisit(undefined)}
      />
      {booking !== undefined && (
        <NewBookingDialog
          slug={slug}
          tables={tables}
          placeId={place.id}
          zone={zone}
          date={booking.date}
          minute={booking.minute}
          floorTables={tableList}
          areas={floor.status === 'ready' ? floor.value.areas : []}
          onClose={() => setBooking(undefined)}
          onBooked={(name, bookedDay) => {
            setBooking(undefined);
            if (bookedDay !== date) setDate(bookedDay);
            toasts.toast({ tone: 'success', message: strings.booked(name) });
          }}
        />
      )}
      {walkIn !== undefined && (
        <WalkInDialog
          slug={slug}
          tables={tables}
          place={place}
          date={today}
          {...(walkIn.tableId === undefined ? {} : { tableId: walkIn.tableId })}
          onClose={() => setWalkIn(undefined)}
          onSeated={(label, party) => {
            setWalkIn(undefined);
            toasts.toast({ tone: 'success', message: strings.seatedWalkIn(label, party) });
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
              variant="danger"
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

/**
 * A walk in, in three steps on one sheet: how many, then the free tables that fit them now (best fit first, as the
 * engine allocates), then Seat now. The same engine and locks as a reservation; a table taken meanwhile says so and
 * the free tables read again.
 */
function WalkInDialog({
  slug,
  tables,
  place,
  date,
  tableId,
  onClose,
  onSeated,
}: {
  readonly slug: string;
  readonly tables: TablesStore;
  readonly place: Place;
  readonly date: string;
  readonly tableId?: string;
  readonly onClose: () => void;
  readonly onSeated: (label: string, party: number) => void;
}) {
  const [party, setParty] = useState<number | undefined>();
  const [round, setRound] = useState(0);
  const [free, setFree] = useState<
    | { readonly key: string; readonly status: 'ready'; readonly value: FreeTablesView }
    | { readonly key: string; readonly status: 'error'; readonly message: string }
    | undefined
  >();
  const [picked, setPicked] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [isSeating, setSeating] = useState(false);
  const key = `${String(party)}|${String(round)}`;
  const shown = free?.key === key ? free : undefined;

  useEffect(() => {
    if (party === undefined) return;
    let current = true;
    const asked = `${String(party)}|${String(round)}`;
    tables.freeTables(slug, place.id, party).then(
      (value) => {
        if (!current) return;
        setFree({ key: asked, status: 'ready', value });
        // A walk in started from a table picks that table when it fits; else the best fit.
        const first =
          value.tables.find((each) => tableId !== undefined && each.resourceIds.includes(tableId)) ?? value.tables[0];
        setPicked(first === undefined ? undefined : first.resourceIds.join('+'));
      },
      (error: unknown) => {
        if (current)
          setFree({
            key: asked,
            status: 'error',
            message: isDataError(error) ? error.message : strings.offline,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [tables, slug, place.id, party, round, tableId]);

  const choice =
    shown?.status === 'ready' ? shown.value.tables.find((each) => each.resourceIds.join('+') === picked) : undefined;

  const seat = () => {
    if (isSeating || party === undefined || choice === undefined) return;
    setSeating(true);
    setProblem(undefined);
    void tables
      .walkIn(slug, place.id, date, {
        party,
        resourceIds: choice.resourceIds,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
      })
      .then((refused) => {
        setSeating(false);
        if (refused === undefined) {
          onSeated(choice.label, party);
          return;
        }
        setProblem(refused.message);
        // Taken meanwhile: the free tables read again, so the list never offers it twice.
        if (refused.code === 'SLOT_TAKEN') setRound((count) => count + 1);
      });
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !isSeating) onClose();
      }}
      title={strings.walkInTitle}
      icon="user-plus"
      isBusy={isSeating}
      actions={
        <>
          <Button slot="close" isDisabled={isSeating}>
            {strings.cancel}
          </Button>
          <Button variant="primary" icon="table" isDisabled={choice === undefined} isPending={isSeating} onPress={seat}>
            {isSeating ? strings.seating : strings.seatNow}
          </Button>
        </>
      }
    >
      {problem !== undefined && (
        <Callout tone="danger" isAnnounced>
          {problem}
        </Callout>
      )}
      <ChoiceChips
        label={strings.walkInParty}
        tone="strong"
        isSingle
        choices={Array.from({ length: WALK_IN_MAX }, (_, index) => ({
          id: String(index + 1),
          label: String(index + 1),
        }))}
        selected={party === undefined ? [] : [String(party)]}
        onChange={(next) => {
          const size = Number(next[0]);
          if (Number.isInteger(size) && size > 0) {
            setParty(size);
            setPicked(undefined);
            setProblem(undefined);
          }
        }}
      />
      {party === undefined ? (
        <p>{strings.walkInPickParty}</p>
      ) : shown === undefined ? (
        <Skeleton shape="text" lines={2} />
      ) : shown.status === 'error' ? (
        <EmptyState
          icon="circle-alert"
          title={shown.message}
          layout="row"
          onRetry={() => setRound((count) => count + 1)}
        />
      ) : shown.value.tables.length === 0 ? (
        <Callout tone="warning" isAnnounced>
          {strings.walkInNone(party)}
        </Callout>
      ) : (
        <>
          <ChoiceChips
            label={strings.walkInTables}
            labelAside={strings.walkInHold(shown.value.holdMinutes)}
            tone="strong"
            isSingle
            choices={shown.value.tables.map((each) => ({
              id: each.resourceIds.join('+'),
              label: strings.freeTable(each.label, each.seats),
            }))}
            selected={picked === undefined ? [] : [picked]}
            onChange={(next) => setPicked(next[0])}
          />
          <Field
            label={strings.walkInName}
            hint={strings.walkInNameHint}
            name="walk-in-name"
            maxLength={120}
            value={name}
            onChange={setName}
            onSubmit={seat}
          />
        </>
      )}
    </Modal>
  );
}
