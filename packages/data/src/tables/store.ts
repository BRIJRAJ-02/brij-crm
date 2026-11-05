// Table seating's staff side (spec 0066 B7 lite), as the setup screen, the Service list and the floor hold it: a
// place's setup (rules, checklist, Publish), the page's places and tables (read again each time the page is opened,
// so Settings' changes show), and a place's day. Loaded on first use (`data.tables.load()`), never in
// the first load. Each is one held copy per workspace and place (and day). A status move shows at once (seated,
// finished, no show, cancelled, or Undo back), is sent, and the server's answer settles it; refused, the row goes back
// and the refusal comes back to the screen. Every write at a place (a guest's reservation, change or cancel too)
// stores a `visits` change event naming the place: each held day of that place reads again, once for a burst. Where
// live updates are off (a host without the relay), a held day also reads again every minute while it is shown.
import type {
  FreeTablesView,
  ServiceDayView,
  ServiceFloor,
  ServicePlaces,
  ServiceVisit,
  TableNotifySet,
  TableRules,
  TableSetupView,
  VisitStatus,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { holder, type HospitalityHeld } from '../hospitality/store.ts';

type Options = { signal?: AbortSignal };
type Scoped = { workspace: string };

/** The tables procedures the store calls, as the data layer's client answers them. */
export interface TablesProcedures {
  readonly setup: (input: Scoped & { placeId: string }, options: Options) => Promise<TableSetupView>;
  readonly saveSetup: (
    input: Scoped & { placeId: string; rules: TableRules; mutationId: string },
    options: Options,
  ) => Promise<TableSetupView>;
  readonly places: (input: Scoped, options: Options) => Promise<ServicePlaces>;
  readonly floor: (input: Scoped & { placeId: string }, options: Options) => Promise<ServiceFloor>;
  readonly day: (input: Scoped & { placeId: string; date: string }, options: Options) => Promise<ServiceDayView>;
  readonly setStatus: (
    input: Scoped & { appointmentId: string; status: VisitStatus; mutationId: string },
    options: Options,
  ) => Promise<{ id: string; status: VisitStatus }>;
  readonly setNotify: (
    input: Scoped & { placeId: string; on: boolean; mutationId: string },
    options: Options,
  ) => Promise<TableNotifySet>;
  readonly freeTables: (
    input: Scoped & { placeId: string; party: number },
    options: Options,
  ) => Promise<FreeTablesView>;
  readonly walkIn: (
    input: Scoped & {
      placeId: string;
      party: number;
      resourceIds: string[];
      name?: string;
      mutationId: string;
    },
    options: Options,
  ) => Promise<{ id: string; status: VisitStatus }>;
  readonly book: (
    input: Scoped & {
      placeId: string;
      start: string;
      party: number;
      name: string;
      phone?: string;
      email?: string;
      note?: string;
      resourceIds?: string[];
      mutationId: string;
    },
    options: Options,
  ) => Promise<{ id: string; status: VisitStatus }>;
}

/** A reservation the host takes on the Service screen (checklabs' New booking). */
export interface StaffBooking {
  /** The start, an ISO instant. */
  readonly start: string;
  readonly party: number;
  readonly name: string;
  readonly phone?: string;
  readonly email?: string;
  readonly note?: string;
  /** The tables picked; left out, the engine picks the best fit. */
  readonly resourceIds?: readonly string[];
}

/** A walk in as the Service screen seats it: the party, the tables picked (one, or up to 3 joined), a name if given. */
export interface WalkIn {
  readonly party: number;
  readonly resourceIds: readonly string[];
  readonly name?: string;
}

/** How often a shown day reads again when nothing live tells it to (Vercel has no relay). */
export const DAY_POLL_MS = 60_000;

/** The covers of a day's visits, as the server counts them. */
function coversOf(visits: readonly ServiceVisit[]): ServiceDayView['covers'] {
  const sum = (statuses: readonly VisitStatus[]) =>
    visits.filter((visit) => statuses.includes(visit.status)).reduce((total, visit) => total + visit.party, 0);
  return {
    booked: sum(['booked', 'confirmed', 'arrived', 'started', 'completed']),
    seated: sum(['started']),
    toCome: sum(['booked', 'confirmed', 'arrived']),
  };
}

/** A day with one visit moved to `status` (Seated starts its clock now; a move back clears it), covers counted again. */
export function withStatus(day: ServiceDayView, id: string, status: VisitStatus, at: string): ServiceDayView {
  const visits = day.visits.map((visit): ServiceVisit => {
    if (visit.id !== id) return visit;
    if (status === 'started') return { ...visit, status, seatedAt: visit.seatedAt ?? at };
    if (status === 'booked' || status === 'confirmed' || status === 'arrived') {
      const { seatedAt: _seatedAt, ...rest } = visit;
      return { ...rest, status };
    }
    return { ...visit, status };
  });
  return { ...day, visits, covers: coversOf(visits) };
}

/** The store, made once by the data layer the first time a screen asks (`data.tables.load()`). */
export function openTables(given: {
  readonly api: TablesProcedures;
  readonly call: <T>(run: (options: Options) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  readonly now?: () => number;
  /** Whether live updates reach this tab; without them a shown day polls. */
  readonly isLive?: () => boolean;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const setups = new Map<string, ReturnType<typeof holder<TableSetupView>>>();
  const placesHeld = new Map<string, ReturnType<typeof holder<ServicePlaces>>>();
  const floors = new Map<string, ReturnType<typeof holder<ServiceFloor>>>();
  const days = new Map<string, ReturnType<typeof holder<ServiceDayView>>>();
  const shown = new Map<string, number>();
  // Each day's held view as screens get it, made once: a new object each call made a screen let go and hold again on
  // every render, reading the day each time and racing its own row moves (review of 5 November 2026).
  const shownDays = new Map<string, HospitalityHeld<ServiceDayView>>();

  const setupOf = (workspace: string, placeId: string) => {
    const key = `${workspace}:${placeId}`;
    let found = setups.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.setup({ workspace, placeId }, options)), now);
      setups.set(key, found);
    }
    return found;
  };
  const placesOf = (workspace: string) => {
    let found = placesHeld.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.places({ workspace }, options)), now);
      placesHeld.set(workspace, found);
    }
    return found;
  };
  const floorOf = (workspace: string, placeId: string) => {
    const key = `${workspace}:${placeId}`;
    let found = floors.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.floor({ workspace, placeId }, options)), now);
      floors.set(key, found);
    }
    return found;
  };
  const dayKey = (workspace: string, placeId: string, date: string) => `${workspace}:${placeId}:${date}`;
  const dayOf = (workspace: string, placeId: string, date: string) => {
    const key = dayKey(workspace, placeId, date);
    let found = days.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.day({ workspace, placeId, date }, options)), now);
      days.set(key, found);
    }
    return found;
  };

  /** A held day that reads again while shown: every minute without live updates. The same object for the same day. */
  const shownDay = (workspace: string, placeId: string, date: string): HospitalityHeld<ServiceDayView> => {
    const key = dayKey(workspace, placeId, date);
    const known = shownDays.get(key);
    if (known !== undefined) return known;
    const made = dayOf(workspace, placeId, date);
    const view: HospitalityHeld<ServiceDayView> = {
      ...made.held,
      retain() {
        const release = made.held.retain();
        shown.set(key, (shown.get(key) ?? 0) + 1);
        const timer = setInterval(() => {
          if (given.isLive?.() !== true) void made.read().catch(() => undefined);
        }, DAY_POLL_MS);
        return () => {
          clearInterval(timer);
          const left = (shown.get(key) ?? 1) - 1;
          if (left <= 0) shown.delete(key);
          else shown.set(key, left);
          release();
        };
      },
    };
    shownDays.set(key, view);
    return view;
  };

  return {
    /** A place's Table setup: the rules (defaults until saved), the checklist, Publish's readiness and the page key. */
    setup: (workspace: string, placeId: string): HospitalityHeld<TableSetupView> => setupOf(workspace, placeId).held,
    /**
     * Saves the rules (`online: true` is Publish). Shown at once; refused (Publish with a step not done answers
     * CONFLICT with that step's one line fix), the rules go back and the refusal comes back.
     */
    saveSetup: (workspace: string, placeId: string, rules: TableRules): Promise<DataError | undefined> =>
      setupOf(workspace, placeId).change(
        (view) => ({ ...view, rules }),
        () => call((options) => api.saveSetup({ workspace, placeId, rules, mutationId: mintId() }, options)),
      ),
    /** The places the Reservations page picks between, for whoever opens it. */
    places: (workspace: string): HospitalityHeld<ServicePlaces> => placesOf(workspace).held,
    /** A place's areas and live tables for the Reservations page, for whoever opens it. */
    floor: (workspace: string, placeId: string): HospitalityHeld<ServiceFloor> => floorOf(workspace, placeId).held,
    /** A place's day for the Service list and floor (`date` on the place's wall clock). */
    day: shownDay,
    /**
     * Moves a reservation to `status` (seat, finish, no show, cancel, or Undo back), shown at once on every held day
     * of the place; refused (SLOT_TAKEN when the table went meanwhile), it goes back and the refusal comes back.
     */
    setStatus: (
      workspace: string,
      placeId: string,
      date: string,
      appointmentId: string,
      status: VisitStatus,
    ): Promise<DataError | undefined> =>
      dayOf(workspace, placeId, date).change(
        (day) => withStatus(day, appointmentId, status, new Date(now()).toISOString()),
        async () => {
          const moved = await call((options) =>
            api.setStatus({ workspace, appointmentId, status, mutationId: mintId() }, options),
          );
          return (day: ServiceDayView) => withStatus(day, moved.id, moved.status, new Date(now()).toISOString());
        },
      ),
    /**
     * The reader's new reservation emails at a place, on or off: shown at once on the held setup; refused, it goes
     * back and the refusal comes back.
     */
    setNotify: (workspace: string, placeId: string, on: boolean): Promise<DataError | undefined> =>
      setupOf(workspace, placeId).change(
        (view) => ({ ...view, notifyMe: on }),
        async () => {
          const set = await call((options) => api.setNotify({ workspace, placeId, on, mutationId: mintId() }, options));
          return (view: TableSetupView) => ({ ...view, notifyMe: set.notifyMe });
        },
      ),
    /**
     * The tables free now for a walk in's party, best fit first, read fresh each time (never held: the floor moves
     * by the minute). Throws the DataError on a refusal.
     */
    freeTables: (workspace: string, placeId: string, party: number): Promise<FreeTablesView> =>
      call((options) => api.freeTables({ workspace, placeId, party }, options)),
    /**
     * Seats a walk in now. The held day of `date` (the place's today) reads again once the server answers, so the
     * party shows Seated on the list and the floor; refused (SLOT_TAKEN when the table went meanwhile), nothing
     * changed and the refusal comes back.
     */
    walkIn: async (
      workspace: string,
      placeId: string,
      date: string,
      walkIn: WalkIn,
    ): Promise<DataError | undefined> => {
      try {
        await call((options) =>
          api.walkIn(
            {
              workspace,
              placeId,
              party: walkIn.party,
              resourceIds: [...walkIn.resourceIds],
              ...(walkIn.name === undefined || walkIn.name.trim() === '' ? {} : { name: walkIn.name.trim() }),
              mutationId: mintId(),
            },
            options,
          ),
        );
      } catch (error) {
        return toDataError(error);
      }
      await dayOf(workspace, placeId, date)
        .read()
        .catch(() => undefined);
      return undefined;
    },
    /**
     * Takes a reservation for a guest (checklabs' New booking). The held day of `date` reads again once the server
     * answers, so it shows on the list and the day calendar; refused (SLOT_TAKEN when the time or table is no longer
     * free), nothing changed and the refusal comes back.
     */
    book: async (
      workspace: string,
      placeId: string,
      date: string,
      booking: StaffBooking,
    ): Promise<DataError | undefined> => {
      const text = (value: string | undefined) =>
        value === undefined || value.trim() === '' ? undefined : value.trim();
      const phone = text(booking.phone);
      const email = text(booking.email);
      const note = text(booking.note);
      try {
        await call((options) =>
          api.book(
            {
              workspace,
              placeId,
              start: booking.start,
              party: booking.party,
              name: booking.name.trim(),
              ...(phone === undefined ? {} : { phone }),
              ...(email === undefined ? {} : { email }),
              ...(note === undefined ? {} : { note }),
              ...(booking.resourceIds === undefined ? {} : { resourceIds: [...booking.resourceIds] }),
              mutationId: mintId(),
            },
            options,
          ),
        );
      } catch (error) {
        return toDataError(error);
      }
      await dayOf(workspace, placeId, date)
        .read()
        .catch(() => undefined);
      return undefined;
    },
    /**
     * A `visits` change event: every day of these places a screen shows reads again (each read is permission
     * checked); a day held but not shown reads when it is shown again.
     */
    placesChanged(workspace: string, placeIds: readonly string[]) {
      for (const [key, held] of days) {
        const [ws, placeId] = key.split(':');
        if (ws === workspace && placeId !== undefined && placeIds.includes(placeId) && shown.has(key)) {
          void held.read().catch(() => undefined);
        }
      }
    },
    /** Sign out: every held copy goes. */
    clear() {
      setups.clear();
      placesHeld.clear();
      floors.clear();
      days.clear();
      shown.clear();
      shownDays.clear();
    },
  };
}

/** The store's public face. */
export type TablesStore = ReturnType<typeof openTables>;
