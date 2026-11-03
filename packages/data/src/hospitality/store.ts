// The Hospitality suite's setup (spec 0065, H0), as Settings › Apps and Settings › Business hold it: the Apps page,
// the business with its places, and each place's floor (areas and tables). Loaded on first use
// (`data.hospitality.load()`), never in the first load. Each is one held copy per workspace (and place), read when a
// screen first holds it. A change shows at once where the copy can show it (a table moved, archived or taken
// offline, an app installed or removed), is sent, and the server's answer (the whole copy) replaces it; refused, the
// copy goes back and the refusal comes back to the screen, which says why beside the control. Only admins and
// managers change these, rarely and one at a time, so no change event carries them: another tab sees a change the
// next time it holds the copy. Installing or removing an app tells the sidebar, whose Hospitality section follows.
import type {
  AppsView,
  BusinessProfile,
  BusinessProfileFields,
  BusinessView,
  DiningTable,
  FirstBusiness,
  HospitalityApp,
  Place,
  PlaceFields,
  PlaceFloor,
  PlaceHours,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** A copy as a screen holds it. */
export type HospitalityHeldState<Value> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly value: Value; readonly isSaving: boolean };

/** A held copy: read when a screen first holds it, read again on Try again. */
export interface HospitalityHeld<Value> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => HospitalityHeldState<Value>;
  /** Held while a screen shows it; read when first held, unless a read just landed. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly retry: () => void;
}

type Options = { signal?: AbortSignal };
type Scoped = { workspace: string };

/** The hospitality procedures the store calls, as the data layer's client answers them. */
export interface HospitalityProcedures {
  readonly apps: (input: Scoped, options: Options) => Promise<AppsView>;
  readonly install: (
    input: Scoped & {
      app: HospitalityApp;
      withNeeded: boolean;
      business?: FirstBusiness;
      mutationId: string;
    },
    options: Options,
  ) => Promise<AppsView>;
  readonly remove: (
    input: Scoped & { app: HospitalityApp; withDependents: boolean; mutationId: string },
    options: Options,
  ) => Promise<AppsView>;
  readonly business: (input: Scoped, options: Options) => Promise<BusinessView>;
  readonly saveBusiness: (
    input: Scoped & { profile: BusinessProfileFields; mutationId: string },
    options: Options,
  ) => Promise<BusinessProfile>;
  readonly createPlace: (
    input: Scoped & { id: string; place: PlaceFields; mutationId: string },
    options: Options,
  ) => Promise<Place>;
  readonly updatePlace: (
    input: Scoped & { placeId: string; place?: PlaceFields; hours?: PlaceHours; mutationId: string },
    options: Options,
  ) => Promise<Place>;
  readonly floor: (input: Scoped & { placeId: string }, options: Options) => Promise<PlaceFloor>;
  readonly saveArea: (
    input: Scoped & { placeId: string; areaId?: string; id?: string; name: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly deleteArea: (
    input: Scoped & { placeId: string; areaId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly addTables: (
    input: Scoped & {
      placeId: string;
      labels: string[];
      areaId?: string;
      minGuests: number;
      maxGuests: number;
      online: boolean;
      mutationId: string;
    },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly updateTable: (
    input: Scoped & { placeId: string; tableId: string; mutationId: string } & TableChange,
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly moveTable: (
    input: Scoped & { placeId: string; tableId: string; toIndex: number; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly archiveTable: (
    input: Scoped & { placeId: string; tableId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly restoreTable: (
    input: Scoped & { placeId: string; tableId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly deleteTable: (
    input: Scoped & { placeId: string; tableId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
}

/** What one table change may set: `areaId: null` takes it out of its area. */
export interface TableChange {
  label?: string;
  areaId?: string | null;
  minGuests?: number;
  maxGuests?: number;
  online?: boolean;
  joins?: string[];
}

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
const FRESH_MS = 1_000;

/** The value a held state shows, or `fallback` while it shows none. */
const valueOf = <Value>(state: HospitalityHeldState<Value>, fallback: Value): Value =>
  state.status === 'ready' ? state.value : fallback;

/** One held copy of `Value`, read with `load`, with a change laid over it while it is on its way. */
function holder<Value>(load: () => Promise<Value>, now: () => number) {
  let state: HospitalityHeldState<Value> = { status: 'loading' };
  let reading: Promise<Value> | undefined;
  let readAt: number | undefined;
  const listeners = new Set<() => void>();
  const set = (next: HospitalityHeldState<Value>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const read = (): Promise<Value> => {
    reading ??= load().then(
      (value) => {
        reading = undefined;
        readAt = now();
        set({ status: 'ready', value, isSaving: false });
        return value;
      },
      (error: unknown) => {
        reading = undefined;
        const refused = toDataError(error);
        if (state.status !== 'ready') set({ status: 'error', error: refused });
        throw refused;
      },
    );
    return reading;
  };
  // Changes go out one after another, so the server sees them in the order they were made, and only the latest
  // answer decides what shows; a refusal puts back what was there before that change.
  let queue: Promise<unknown> = Promise.resolve();
  let made = 0;
  const change = async (
    next: (value: Value) => Value,
    send: () => Promise<Value | ((value: Value) => Value)>,
  ): Promise<DataError | undefined> => {
    if (state.status !== 'ready') return undefined;
    made += 1;
    const mine = made;
    const was = state.value;
    set({ status: 'ready', value: next(was), isSaving: true });
    const sent = queue.then(send);
    queue = sent.catch(() => undefined);
    try {
      const landed = await sent;
      if (mine === made) {
        const after = valueOf(held.getSnapshot(), was);
        set({
          status: 'ready',
          value: typeof landed === 'function' ? (landed as (value: Value) => Value)(after) : landed,
          isSaving: false,
        });
      }
      return undefined;
    } catch (error) {
      if (mine === made) set({ status: 'ready', value: was, isSaving: false });
      return toDataError(error);
    }
  };
  const held: HospitalityHeld<Value> = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain() {
      if (readAt === undefined || now() - readAt >= FRESH_MS) void read().catch(() => undefined);
      return () => undefined;
    },
    retry() {
      if (state.status === 'error') set({ status: 'loading' });
      void read().catch(() => undefined);
    },
  };
  return { held, read, change };
}

/** `tables` with the live ones in `order` (by id), positions renumbered, archived ones after. */
function reordered(tables: readonly DiningTable[], tableId: string, toIndex: number): DiningTable[] {
  const live = tables.filter((table) => !table.archived);
  const moving = live.find((table) => table.id === tableId);
  if (moving === undefined) return [...tables];
  const rest = live.filter((table) => table.id !== tableId);
  rest.splice(Math.min(Math.max(toIndex, 0), rest.length), 0, moving);
  return [...rest.map((table, position) => ({ ...table, position })), ...tables.filter((table) => table.archived)];
}

/** The store, made once by the data layer the first time a screen asks (`data.hospitality.load()`). */
export function openHospitality(given: {
  readonly api: HospitalityProcedures;
  /** The data layer's one call path (retries, the session's end, refusals as DataError). */
  readonly call: <T>(run: (options: Options) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  /** An app was installed or removed: the sidebar's Hospitality section reads its pages again. */
  readonly onAppsChanged?: (workspace: string) => void;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const appsHeld = new Map<string, ReturnType<typeof holder<AppsView>>>();
  const businessHeld = new Map<string, ReturnType<typeof holder<BusinessView>>>();
  const floors = new Map<string, ReturnType<typeof holder<PlaceFloor>>>();

  const appsOf = (workspace: string) => {
    let found = appsHeld.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.apps({ workspace }, options)), now);
      appsHeld.set(workspace, found);
    }
    return found;
  };
  const businessOf = (workspace: string) => {
    let found = businessHeld.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.business({ workspace }, options)), now);
      businessHeld.set(workspace, found);
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

  /** Each place's table count follows its floor, so Business shows it without a read. */
  const countTables = (workspace: string, placeId: string, floor: PlaceFloor) => {
    const held = businessHeld.get(workspace);
    if (held === undefined) return;
    void held.change(
      (view) => ({
        ...view,
        places: view.places.map((place) =>
          place.id === placeId ? { ...place, tables: floor.tables.filter((table) => !table.archived).length } : place,
        ),
      }),
      () => Promise.resolve((view: BusinessView) => view),
    );
  };

  /** One floor write: shown at once by `show`, then the server's floor. */
  const onFloor = (
    workspace: string,
    placeId: string,
    show: (floor: PlaceFloor) => PlaceFloor,
    send: (mutationId: string, options: Options) => Promise<PlaceFloor>,
  ): Promise<DataError | undefined> =>
    floorOf(workspace, placeId).change(show, async () => {
      const floor = await call((options) => send(mintId(), options));
      countTables(workspace, placeId, floor);
      return floor;
    });

  /** An apps write; the sidebar follows once it landed. */
  const onApps = async (
    workspace: string,
    show: (view: AppsView) => AppsView,
    send: (mutationId: string, options: Options) => Promise<AppsView>,
  ): Promise<DataError | undefined> => {
    const refused = await appsOf(workspace).change(show, () => call((options) => send(mintId(), options)));
    if (refused === undefined) {
      // A first install made the business and its first place: Business reads them again when next held.
      businessHeld.delete(workspace);
      given.onAppsChanged?.(workspace);
    }
    return refused;
  };

  const markInstalled = (apps: readonly HospitalityApp[], installed: boolean) => (view: AppsView) => ({
    ...view,
    apps: view.apps.map((each) => (apps.includes(each.app) ? { ...each, installed } : each)),
  });

  return {
    /** A new id for a place or area the screen makes, so a retry makes one. */
    newId: mintId,

    /** Settings › Apps (AC-6501): the apps, read when first held. */
    apps: (workspace: string): HospitalityHeld<AppsView> => appsOf(workspace).held,
    /** Reads the Apps page now (the route's loader); rejects with the refusal. */
    readApps: (workspace: string): Promise<AppsView> => appsOf(workspace).read(),
    /**
     * Installs an app (AC-6503): shown installed at once. `APP_NEEDED` (Menu QR without Menu) and `BUSINESS_NEEDED`
     * (the first install without its card) come back as refusals for the screen to ask, and the app shows as before.
     */
    install: (
      workspace: string,
      app: HospitalityApp,
      options: { readonly withNeeded?: boolean; readonly business?: FirstBusiness } = {},
    ): Promise<DataError | undefined> =>
      onApps(
        workspace,
        markInstalled(options.withNeeded === true ? ['menu', app] : [app], true),
        (mutationId, callOptions) =>
          api.install(
            {
              workspace,
              app,
              withNeeded: options.withNeeded === true,
              ...(options.business === undefined ? {} : { business: options.business }),
              mutationId,
            },
            callOptions,
          ),
      ),
    /** Removes an app (the screen asks first, AC-6503); `withDependents` removes Menu QR with Menu (AC-6505). */
    remove: (workspace: string, app: HospitalityApp, withDependents = false): Promise<DataError | undefined> =>
      onApps(workspace, markInstalled(withDependents ? [app, 'menu_qr'] : [app], false), (mutationId, callOptions) =>
        api.remove({ workspace, app, withDependents, mutationId }, callOptions),
      ),

    /** Settings › Business (AC-6507, AC-6508): the profile and the places, read when first held. */
    business: (workspace: string): HospitalityHeld<BusinessView> => businessOf(workspace).held,
    /** Reads Business now (the route's loader); rejects with the refusal. */
    readBusiness: (workspace: string): Promise<BusinessView> => businessOf(workspace).read(),
    /** Saves the profile, whole; shown at once (the currency stays the workspace's). */
    saveBusiness: (workspace: string, profile: BusinessProfileFields): Promise<DataError | undefined> =>
      businessOf(workspace).change(
        (view) => ({
          ...view,
          profile: {
            ...view.profile,
            name: profile.name,
            kind: profile.kind,
            links: profile.links ?? view.profile?.links ?? [],
          },
        }),
        async () => {
          const saved = await call((options) =>
            api.saveBusiness({ workspace, profile, mutationId: mintId() }, options),
          );
          return (view: BusinessView) => ({ ...view, profile: saved });
        },
      ),
    /** Adds a place under `id` (the screen's own, from `newId`); it shows once the server made it. */
    createPlace: (workspace: string, id: string, place: PlaceFields): Promise<DataError | undefined> =>
      businessOf(workspace).change(
        (view) => view,
        async () => {
          const made = await call((options) =>
            api.createPlace({ workspace, id, place, mutationId: mintId() }, options),
          );
          return (view: BusinessView) => ({
            ...view,
            places: [...view.places.filter((each) => each.id !== made.id), made],
          });
        },
      ),
    /** Changes a place's address and contact, its hours, or both; hours show at once. */
    updatePlace: (
      workspace: string,
      placeId: string,
      change: { readonly place?: PlaceFields; readonly hours?: PlaceHours },
    ): Promise<DataError | undefined> =>
      businessOf(workspace).change(
        (view) => ({
          ...view,
          places: view.places.map((each) =>
            each.id === placeId && change.hours !== undefined ? { ...each, hours: change.hours } : each,
          ),
        }),
        async () => {
          const saved = await call((options) =>
            api.updatePlace(
              {
                workspace,
                placeId,
                ...(change.place === undefined ? {} : { place: change.place }),
                ...(change.hours === undefined ? {} : { hours: change.hours }),
                mutationId: mintId(),
              },
              options,
            ),
          );
          return (view: BusinessView) => ({
            ...view,
            places: view.places.map((each) => (each.id === saved.id ? saved : each)),
          });
        },
      ),

    /** One place's areas and tables (AC-6509), read when first held. */
    floor: (workspace: string, placeId: string): HospitalityHeld<PlaceFloor> => floorOf(workspace, placeId).held,
    /** Reads a floor now; rejects with the refusal. */
    readFloor: (workspace: string, placeId: string): Promise<PlaceFloor> => floorOf(workspace, placeId).read(),
    /** Adds an area (`areaId` absent) or renames one. */
    saveArea: (workspace: string, placeId: string, name: string, areaId?: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) =>
          areaId === undefined
            ? floor
            : { ...floor, areas: floor.areas.map((area) => (area.id === areaId ? { ...area, name } : area)) },
        (mutationId, options) =>
          api.saveArea(
            { workspace, placeId, name, ...(areaId === undefined ? { id: mintId() } : { areaId }), mutationId },
            options,
          ),
      ),
    /** Deletes an area; its tables stay with no area. */
    deleteArea: (workspace: string, placeId: string, areaId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({
          ...floor,
          areas: floor.areas.filter((area) => area.id !== areaId),
          tables: floor.tables.map((table) => {
            if (table.areaId !== areaId) return table;
            const { areaId: _gone, ...rest } = table;
            return rest;
          }),
        }),
        (mutationId, options) => api.deleteArea({ workspace, placeId, areaId, mutationId }, options),
      ),
    /** Adds tables at once ("T1 to T10"); they show once the server made them. */
    addTables: (
      workspace: string,
      placeId: string,
      input: {
        readonly labels: readonly string[];
        readonly areaId?: string;
        readonly minGuests: number;
        readonly maxGuests: number;
        readonly online?: boolean;
      },
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => floor,
        (mutationId, options) =>
          api.addTables(
            {
              workspace,
              placeId,
              labels: [...input.labels],
              ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
              minGuests: input.minGuests,
              maxGuests: input.maxGuests,
              online: input.online ?? true,
              mutationId,
            },
            options,
          ),
      ),
    /** Changes one table; its fields show at once (joins once the server kept both sides). */
    updateTable: (
      workspace: string,
      placeId: string,
      tableId: string,
      change: TableChange,
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({
          ...floor,
          tables: floor.tables.map((table) => {
            if (table.id !== tableId) return table;
            const { areaId, joins: _joins, ...fields } = change;
            const next = { ...table, ...fields };
            if (areaId === undefined) return next;
            if (areaId === null) {
              const { areaId: _gone, ...rest } = next;
              return rest;
            }
            return { ...next, areaId };
          }),
        }),
        (mutationId, options) => api.updateTable({ workspace, placeId, tableId, ...change, mutationId }, options),
      ),
    /** Moves a table to `toIndex` among the live ones (drag to reorder); shown at once. */
    moveTable: (workspace: string, placeId: string, tableId: string, toIndex: number): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({ ...floor, tables: reordered(floor.tables, tableId, toIndex) }),
        (mutationId, options) => api.moveTable({ workspace, placeId, tableId, toIndex, mutationId }, options),
      ),
    /** Archives a table (it leaves online fitting, keeps its holds); shown at once, last. */
    archiveTable: (workspace: string, placeId: string, tableId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => {
          const moving = floor.tables.find((table) => table.id === tableId);
          return moving === undefined
            ? floor
            : {
                ...floor,
                tables: [...floor.tables.filter((table) => table.id !== tableId), { ...moving, archived: true }],
              };
        },
        (mutationId, options) => api.archiveTable({ workspace, placeId, tableId, mutationId }, options),
      ),
    /** Brings an archived table back, last among the live ones. */
    restoreTable: (workspace: string, placeId: string, tableId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => floor,
        (mutationId, options) => api.restoreTable({ workspace, placeId, tableId, mutationId }, options),
      ),
    /** Deletes a table for good (the screen asks first); gone at once. */
    deleteTable: (workspace: string, placeId: string, tableId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({ ...floor, tables: floor.tables.filter((table) => table.id !== tableId) }),
        (mutationId, options) => api.deleteTable({ workspace, placeId, tableId, mutationId }, options),
      ),

    /** Signed out: forgets every copy. */
    clear: (): void => {
      appsHeld.clear();
      businessHeld.clear();
      floors.clear();
    },
  };
}

/** The Hospitality store, as `data.hospitality.load()` answers it. */
export type HospitalityStore = ReturnType<typeof openHospitality>;
