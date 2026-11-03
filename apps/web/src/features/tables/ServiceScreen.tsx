// Brief
// Purpose: run the evening at the host stand (spec 0066 B7 lite; 0065 AC-6560 to AC-6565): one place's day, live.
// Main task: see who comes when, and seat, finish, mark no show or cancel in one tap, with Undo; or look at the floor,
//   each table a tile with its state, the time since seating and its next reservation.
// Leaves out: walk ins, moving tables by drag and joining tables by hand (later slices). Laid out as checklabs'
//   reservations page (the date, then the bookings list) with its floor as tiles after the owner's references; the
//   no show hint (15 minutes past) is checklabs' alert, never an automatic change.
import type {
  HospitalityStore,
  Place,
  Resource,
  ServiceDayView,
  ServiceVisit,
  TablesStore,
  VisitStatus,
} from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  PageColumn,
  SegmentedControl,
  Select,
  Skeleton,
  Stats,
  Table,
  TileGrid,
  TopBar,
  type Hue,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
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

/** Minutes a booked guest may be late before the stand is told (checklabs' no show alert). */
const LATE_MINUTES = 15;

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
  const business = useHospitality(hospitality.business(slug));
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
              <EmptyState icon="circle-alert" title={business.error.message} />
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
  const [view, setView] = useState<'list' | 'floor'>('list');
  const [asking, setAsking] = useState<
    { readonly visit: ServiceVisit; readonly status: 'no_show' | 'cancelled' } | undefined
  >();
  const day = useHospitality(tables.day(slug, place.id, date));
  const floor = useHospitality(hospitality.floor(slug, place.id));
  const now = useNow();
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
  // The bar's date stays short, so a phone keeps the bar on one line.
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

  // Each visit's latest Undo toast: a newer move on the same visit replaces it, so an older Undo (back past a later
  // move) is never offered (walk of 4 Nov 2026: Seat's Undo after Finish was refused).
  const undoToasts = useRef(new Map<string, string>());
  /** Moves a visit, with Undo for 10 seconds back to where it was. */
  const move = async (visit: ServiceVisit, status: VisitStatus) => {
    const before = undoToasts.current.get(visit.id);
    if (before !== undefined) {
      toasts.dismiss(before);
      undoToasts.current.delete(visit.id);
    }
    const refused = await tables.setStatus(slug, place.id, date, visit.id, status);
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
            void tables.setStatus(slug, place.id, date, visit.id, visit.status).then((undone) => {
              if (undone !== undefined) toasts.toast({ tone: 'danger', message: undone.message });
            });
          },
        },
      },
      { timeout: 10_000 },
    );
    undoToasts.current.set(visit.id, key);
  };

  const isLate = (visit: ServiceVisit) =>
    (visit.status === 'booked' || visit.status === 'confirmed') &&
    now - Date.parse(visit.start) > LATE_MINUTES * 60_000;

  const actionsOf = (visit: ServiceVisit) => {
    const next = LOOK[visit.status].next;
    const canFree = visit.status === 'booked' || visit.status === 'confirmed' || visit.status === 'arrived';
    return (
      <>
        {next !== undefined && (
          <Button
            size="sm"
            variant={next === 'started' ? 'primary' : 'secondary'}
            onPress={() => void move(visit, next)}
          >
            {next === 'started' ? strings.seat : strings.finish}
          </Button>
        )}
        {canFree && (
          // No show and Cancel ask first (AC-6565), so they sit one step away, in the row's menu.
          <MenuTrigger>
            <Button variant="ghost" size="sm" icon="ellipsis" label={strings.moreFor(visit.name)} />
            <Menu
              label={strings.moreFor(visit.name)}
              onAction={(key) => {
                if (key === 'no_show' || key === 'cancelled') setAsking({ visit, status: key });
              }}
            >
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

  const columns: readonly TableColumn[] = [
    { id: 'time', label: strings.time, size: 'fit' },
    { id: 'guest', label: strings.guest, isRowHeader: true, size: 'fill' },
    { id: 'status', label: strings.statusTitle, size: 'fit' },
    { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
  ];

  const list = (value: ServiceDayView) => (
    <Table
      label={strings.listLabel(dayLabel)}
      columns={columns}
      rows={value.visits}
      getRowId={(visit) => visit.id}
      emptyState={<EmptyState icon="calendar-check" title={strings.noReservations(dayLabel)} />}
      renderCell={(visit, column) => {
        switch (column) {
          case 'time':
            return time(visit.start);
          case 'guest':
            // One line a phone can hold: who, how many, where, and anything to know.
            return [
              visit.name,
              strings.guestsCount(visit.party),
              labelOf(visit.resourceIds),
              visit.occasion === undefined ? '' : strings.occasion(visit.occasion),
              visit.note ?? '',
            ]
              .filter((part) => part !== '')
              .join(' · ');
          case 'status':
            return isLate(visit) ? (
              <Badge dot="red" text={strings.late(since(visit.start, now))} />
            ) : (
              <Badge dot={LOOK[visit.status].hue} text={strings.status[visit.status]} />
            );
          default:
            return actionsOf(visit);
        }
      }}
    />
  );

  const tiles = (value: ServiceDayView) => (
    <TileGrid columns="auto">
      {tableList.map((table) => {
        const holding = value.visits.filter((visit) => visit.resourceIds.includes(table.id));
        const seated = holding.find((visit) => visit.status === 'started');
        const coming = holding
          .filter((visit) => visit.status === 'booked' || visit.status === 'confirmed' || visit.status === 'arrived')
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
        const late = coming !== undefined && isLate(coming);
        const soon = coming !== undefined && Date.parse(coming.start) - now < 30 * 60_000;
        const state = seated !== undefined ? 'seated' : late ? 'attention' : soon ? 'soon' : 'free';
        const hue: Hue =
          state === 'seated' ? 'green' : state === 'attention' ? 'red' : state === 'soon' ? 'yellow' : 'gray';
        return (
          <Card
            key={table.id}
            title={table.label}
            description={strings.seats(table.minCapacity, table.maxCapacity)}
            eyebrow={<Badge dot={hue} text={strings.tableState[state]} />}
            footerNote={coming === undefined ? strings.noneNext : strings.next(time(coming.start), coming.party)}
            actions={seated === undefined ? undefined : <Badge text={since(seated.seatedAt ?? seated.start, now)} />}
          >
            {seated !== undefined
              ? `${seated.name} · ${strings.guestsCount(seated.party)}`
              : late
                ? strings.late(since(coming.start, now))
                : null}
          </Card>
        );
      })}
    </TileGrid>
  );

  const topBar = (
    <TopBar title={strings.service} icon="table" meta={shortLabel}>
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
      <Button size="sm" isDisabled={date === today} onPress={() => setDate(today)}>
        {strings.today}
      </Button>
      <Button size="sm" icon="chevron-right" label={strings.nextDay} onPress={() => setDate(shift(date, 1))} />
      <SegmentedControl
        label={strings.view}
        value={view}
        onChange={(next) => setView(next === 'floor' ? 'floor' : 'list')}
        segments={[
          { value: 'list', label: strings.list, icon: 'list' },
          { value: 'floor', label: strings.floor, icon: 'layout-grid' },
        ]}
      />
    </TopBar>
  );

  const body =
    day.status === 'loading' ? (
      <Skeleton shape="block" />
    ) : day.status === 'error' ? (
      <EmptyState icon="circle-alert" title={day.error.message} />
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
        {view === 'list' ? list(day.value) : tiles(day.value)}
        {day.value.truncated && <EmptyState icon="info" title={strings.truncated} />}
      </PageColumn>
    );

  return (
    <>
      <WorkspacePage currentPage="service" page={{ topBar, body }} />
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
            <Button slot="close">{strings.keep}</Button>
            <Button
              variant="danger"
              onPress={() => {
                if (asking !== undefined) void move(asking.visit, asking.status);
                setAsking(undefined);
              }}
            >
              {asking?.status === 'no_show' ? strings.noShow : strings.cancel}
            </Button>
          </>
        }
      >
        {strings.freesTable}
      </Modal>
    </>
  );
}
