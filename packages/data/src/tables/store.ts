// Table seating's staff side (spec 0066 B7 lite), as the setup screen, the Service list and the floor hold it: a
// place's setup (rules, checklist, Publish) and a place's day. Loaded on first use (`data.tables.load()`), never in
// the first load. Each is one held copy per workspace and place (and day). A status move shows at once (seated,
// finished, no show, cancelled, or Undo back), is sent, and the server's answer settles it; refused, the row goes back
// and the refusal comes back to the screen. Every write at a place (a guest's reservation, change or cancel too)
// stores a `visits` change event naming the place: each held day of that place reads again, once for a burst. Where
// live updates are off (a host without the relay), a held day also reads again every minute while it is shown.
import type { ServiceDayView, ServiceVisit, TableRules, TableSetupView, VisitStatus } from '@crm/contracts';
import type { DataError } from '../errors.ts';
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
  readonly day: (input: Scoped & { placeId: string; date: string }, options: Options) => Promise<ServiceDayView>;
  readonly setStatus: (
    input: Scoped & { appointmentId: string; status: VisitStatus; mutationId: string },
    options: Options,
  ) => Promise<{ id: string; status: VisitStatus }>;
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
  const days = new Map<string, ReturnType<typeof holder<ServiceDayView>>>();
  const shown = new Map<string, number>();

  const setupOf = (workspace: string, placeId: string) => {
    const key = `${workspace}:${placeId}`;
    let found = setups.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.setup({ workspace, placeId }, options)), now);
      setups.set(key, found);
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

  /** A held day that reads again while shown: every minute without live updates. */
  const shownDay = (workspace: string, placeId: string, date: string): HospitalityHeld<ServiceDayView> => {
    const made = dayOf(workspace, placeId, date);
    const key = dayKey(workspace, placeId, date);
    return {
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
    /** A `visits` change event: every held day of these places reads again (each read is permission checked). */
    placesChanged(workspace: string, placeIds: readonly string[]) {
      for (const [key, held] of days) {
        const [ws, placeId] = key.split(':');
        if (ws === workspace && placeId !== undefined && placeIds.includes(placeId)) {
          void held.read().catch(() => undefined);
        }
      }
    },
    /** Sign out: every held copy goes. */
    clear() {
      setups.clear();
      days.clear();
      shown.clear();
    },
  };
}

/** The store's public face. */
export type TablesStore = ReturnType<typeof openTables>;
