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
  BusinessView,
  Resource,
  FirstBusiness,
  HospitalityApp,
  Place,
  PlaceFields,
  PlaceFloor,
  PlaceHours,
  PlaceQrCodes,
  MemberReach,
  MemberReachView,
  PropertiesView,
  Property,
  PropertyFields,
  ResourceKind,
} from '@crm/contracts';
import { dataError, toDataError, type DataError } from '../errors.ts';

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
/** A call that works in one property (spec 0065 H7): left out, the workspace's first. */
type InProperty = { property?: string };

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
  readonly business: (input: Scoped & InProperty, options: Options) => Promise<BusinessView>;
  readonly properties: (input: Scoped, options: Options) => Promise<PropertiesView>;
  readonly createProperty: (
    input: Scoped & { id: string; name: string; kind: Property['kind']; currency: string; mutationId: string },
    options: Options,
  ) => Promise<PropertiesView>;
  readonly removeProperty: (
    input: Scoped & { property: string; mutationId: string },
    options: Options,
  ) => Promise<PropertiesView>;
  readonly memberReach: (input: Scoped & { memberId: string }, options: Options) => Promise<MemberReachView>;
  readonly setMemberReach: (
    input: Scoped & { memberId: string; reach: MemberReach; mutationId: string },
    options: Options,
  ) => Promise<MemberReachView>;
  readonly saveBusiness: (
    input: Scoped & InProperty & { profile: PropertyFields; mutationId: string },
    options: Options,
  ) => Promise<Property>;
  readonly createPlace: (
    input: Scoped & InProperty & { id: string; place: PlaceFields; mutationId: string },
    options: Options,
  ) => Promise<Place>;
  readonly updatePlace: (
    input: Scoped & { placeId: string; place?: PlaceFields; hours?: PlaceHours; mutationId: string },
    options: Options,
  ) => Promise<Place>;
  readonly resources: (input: Scoped & { placeId: string }, options: Options) => Promise<PlaceFloor>;
  readonly saveArea: (
    input: Scoped & { placeId: string; areaId?: string; id?: string; name: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly deleteArea: (
    input: Scoped & { placeId: string; areaId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly addResources: (
    input: Scoped & {
      placeId: string;
      kind: ResourceKind;
      labels: string[];
      areaId?: string;
      minCapacity: number;
      maxCapacity: number;
      online: boolean;
      mutationId: string;
    },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly updateResource: (
    input: Scoped & { placeId: string; resourceId: string; mutationId: string } & ResourceChange,
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly moveResource: (
    input: Scoped & { placeId: string; resourceId: string; toIndex: number; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly archiveResource: (
    input: Scoped & { placeId: string; resourceId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly restoreResource: (
    input: Scoped & { placeId: string; resourceId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly deleteResource: (
    input: Scoped & { placeId: string; resourceId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceFloor>;
  readonly qrCodes: (input: Scoped & { placeId: string }, options: Options) => Promise<PlaceQrCodes>;
  readonly regenerateTableCode: (
    input: Scoped & { placeId: string; resourceId: string; mutationId: string },
    options: Options,
  ) => Promise<PlaceQrCodes>;
}

/** What one table change may set: `areaId: null` takes it out of its area. */
export interface ResourceChange {
  kind?: ResourceKind;
  label?: string;
  areaId?: string | null;
  minCapacity?: number;
  maxCapacity?: number;
  online?: boolean;
  joins?: string[];
}

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
const FRESH_MS = 1_000;

/** The value a held state shows, or `fallback` while it shows none. */
const valueOf = <Value>(state: HospitalityHeldState<Value>, fallback: Value): Value =>
  state.status === 'ready' ? state.value : fallback;

/**
 * One held copy of `Value`, read with `load`, with a change laid over it while it is on its way (changes go out in
 * order; a refusal puts back what was there). Table seating's store and the business page's store (spec 0066, B4)
 * hold theirs the same way.
 */
export function holder<Value>(load: () => Promise<Value>, now: () => number) {
  let state: HospitalityHeldState<Value> = { status: 'loading' };
  let reading: Promise<Value> | undefined;
  let readAt: number | undefined;
  // A write landed while a read was out: that read may have started before it, so another follows it.
  let readAgain = false;
  const listeners = new Set<() => void>();
  const set = (next: HospitalityHeldState<Value>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const followUp = () => {
    if (!readAgain) return;
    readAgain = false;
    void read().catch(() => undefined);
  };
  const read = (): Promise<Value> => {
    reading ??= load().then(
      (value) => {
        reading = undefined;
        readAt = now();
        set({ status: 'ready', value, isSaving: false });
        followUp();
        return value;
      },
      (error: unknown) => {
        reading = undefined;
        const refused = toDataError(error);
        if (state.status !== 'ready') set({ status: 'error', error: refused });
        followUp();
        throw refused;
      },
    );
    return reading;
  };
  /** Reads again after a write elsewhere landed: at once, or once more after a read already out (it may predate it). */
  const reread = (): void => {
    if (reading === undefined) void read().catch(() => undefined);
    else readAgain = true;
  };
  // Changes go out one after another, so the server sees them in the order they were made, and only the latest
  // answer decides what shows; a refusal puts back what was there before that change.
  let queue: Promise<unknown> = Promise.resolve();
  let made = 0;
  let pending = 0;
  // A refused change that wasn't the latest can't put back what it changed (a later one is laid over it), so the
  // copy is read again once every change has answered.
  let stale = false;
  const settle = () => {
    pending -= 1;
    if (pending === 0 && stale) {
      stale = false;
      void read().catch(() => undefined);
    }
  };
  const change = async (
    next: (value: Value) => Value,
    send: () => Promise<Value | ((value: Value) => Value)>,
  ): Promise<DataError | undefined> => {
    if (state.status !== 'ready') return dataError('NOT_READY', 'Still loading, try again.');
    made += 1;
    const mine = made;
    const was = state.value;
    set({ status: 'ready', value: next(was), isSaving: true });
    pending += 1;
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
      else stale = true;
      return toDataError(error);
    } finally {
      settle();
    }
  };
  /** Lays `next` over the copy as it stands, outside the change queue (a count another copy's write moved). */
  const patch = (next: (value: Value) => Value) => {
    if (state.status === 'ready') set({ ...state, value: next(state.value) });
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
  return { held, read, reread, change, patch };
}

/** `tables` with the live ones in `order` (by id), positions renumbered, archived ones after. */
function reordered(tables: readonly Resource[], resourceId: string, toIndex: number): Resource[] {
  const live = tables.filter((table) => !table.archived);
  const moving = live.find((table) => table.id === resourceId);
  if (moving === undefined) return [...tables];
  const rest = live.filter((table) => table.id !== resourceId);
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
  /**
   * Where this device keeps the business each workspace's member last chose (AC-6517); none keeps it for the app load
   * only. Reads and writes may throw (blocked storage), which reads as no choice.
   */
  readonly choices?: { readonly get: (key: string) => string | null; readonly set: (key: string, id: string) => void };
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const appsHeld = new Map<string, ReturnType<typeof holder<AppsView>>>();
  const businessHeld = new Map<string, ReturnType<typeof holder<BusinessView>>>();
  const propertiesHeld = new Map<string, ReturnType<typeof holder<PropertiesView>>>();
  // The business each workspace works in on this device (AC-6517), and the screens following it.
  const chosen = new Map<string, string>();
  const choiceListeners = new Set<() => void>();
  const choiceKey = (workspace: string) => `crm.business.${workspace}`;
  const storedChoice = (workspace: string): string | undefined => {
    try {
      return given.choices?.get(choiceKey(workspace)) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const floors = new Map<string, ReturnType<typeof holder<PlaceFloor>>>();
  const qrHeld = new Map<string, ReturnType<typeof holder<PlaceQrCodes>>>();
  const qrOf = (workspace: string, placeId: string) => {
    const key = `${workspace}:${placeId}`;
    let found = qrHeld.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.qrCodes({ workspace, placeId }, options)), now);
      qrHeld.set(key, found);
    }
    return found;
  };

  const appsOf = (workspace: string) => {
    let found = appsHeld.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.apps({ workspace }, options)), now);
      appsHeld.set(workspace, found);
    }
    return found;
  };
  const propertiesOf = (workspace: string) => {
    let found = propertiesHeld.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.properties({ workspace }, options)), now);
      propertiesHeld.set(workspace, found);
    }
    return found;
  };
  /**
   * The business this workspace works in: the one chosen on this device while the workspace still has it, else none
   * (the first). With one business there is nothing to choose, so nothing is ever named (AC-6516).
   */
  const choiceOf = (workspace: string): string | undefined => {
    const listed = propertiesHeld.get(workspace)?.held.getSnapshot();
    if (listed?.status !== 'ready' || listed.value.properties.length < 2) return undefined;
    const picked = chosen.get(workspace) ?? storedChoice(workspace);
    const found = listed.value.properties.find((each) => each.id === picked);
    // The first is what none names: its copy is the one every screen already holds.
    return found === undefined || found.id === listed.value.properties[0]?.id ? undefined : found.id;
  };
  const businessOf = (workspace: string, property = choiceOf(workspace)) => {
    const key = `${workspace}:${property ?? ''}`;
    let found = businessHeld.get(key);
    if (found === undefined) {
      found = holder(
        () => call((options) => api.business({ workspace, ...(property === undefined ? {} : { property }) }, options)),
        now,
      );
      businessHeld.set(key, found);
    }
    return found;
  };
  /** The chosen business, as a held copy a screen follows: it changes when the member switches (AC-6517). */
  const choiceHeld = (workspace: string): HospitalityHeld<string | undefined> => ({
    subscribe(listener) {
      choiceListeners.add(listener);
      const listed = propertiesOf(workspace).held.subscribe(listener);
      return () => {
        choiceListeners.delete(listener);
        listed();
      };
    },
    getSnapshot: () => {
      const listed = propertiesOf(workspace).held.getSnapshot();
      if (listed.status !== 'ready') return listed;
      const value = choiceOf(workspace);
      // One snapshot per answer, so a screen re-renders only when the choice or the list moved.
      const last = choiceSnapshots.get(workspace);
      if (last !== undefined && last.value === value && last.listed === listed) return last.state;
      const state = { status: 'ready' as const, value, isSaving: listed.isSaving };
      choiceSnapshots.set(workspace, { value, listed, state });
      return state;
    },
    retain: () => propertiesOf(workspace).held.retain(),
    retry: () => propertiesOf(workspace).held.retry(),
  });
  const choiceHelds = new Map<string, HospitalityHeld<string | undefined>>();
  const guards = new Map<string, () => Promise<boolean>>();
  const choose = (workspace: string, property: string): void => {
    chosen.set(workspace, property);
    try {
      given.choices?.set(choiceKey(workspace), property);
    } catch {
      // Blocked storage: the choice lasts for this app load.
    }
    for (const listener of choiceListeners) listener();
  };
  const choiceSnapshots = new Map<
    string,
    {
      readonly value: string | undefined;
      readonly listed: HospitalityHeldState<PropertiesView>;
      readonly state: HospitalityHeldState<string | undefined>;
    }
  >();
  const floorOf = (workspace: string, placeId: string) => {
    const key = `${workspace}:${placeId}`;
    let found = floors.get(key);
    if (found === undefined) {
      found = holder(() => call((options) => api.resources({ workspace, placeId }, options)), now);
      floors.set(key, found);
    }
    return found;
  };

  /** Each place's table count follows its floor, so Business shows it without a read. */
  const countTables = (workspace: string, placeId: string, floor: PlaceFloor) => {
    const held = businessHeld.get(`${workspace}:${choiceOf(workspace) ?? ''}`);
    if (held === undefined) return;
    held.patch((view) => ({
      ...view,
      places: view.places.map((place) =>
        place.id === placeId
          ? { ...place, resourceCount: floor.resources.filter((table) => !table.archived).length }
          : place,
      ),
    }));
  };

  /** One floor write: shown at once by `show`, then the server's floor. */
  const onFloor = (
    workspace: string,
    placeId: string,
    show: (floor: PlaceFloor) => PlaceFloor,
    send: (mutationId: string, options: Options) => Promise<PlaceFloor>,
  ): Promise<DataError | undefined> =>
    floorOf(workspace, placeId).change(show, async () => {
      // The Tables page lists the QR copy: once a floor write lands, a table gone from the floor leaves it, and the
      // copy is read again for added and renamed tables and their codes.
      const qr = qrHeld.get(`${workspace}:${placeId}`);
      const floor = await call((options) => send(mintId(), options));
      countTables(workspace, placeId, floor);
      if (qr !== undefined) {
        const live = new Set(floor.resources.filter((each) => !each.archived).map((each) => each.id));
        qr.patch((codes) => ({ ...codes, tables: codes.tables.filter((each) => live.has(each.id)) }));
        // A read already out (one a new zone's write started) may predate this write: one more follows it.
        qr.reread();
      }
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
      // The business card made the business and its first place: an open Business reads them again.
      businessHeld.get(`${workspace}:`)?.reread();
      propertiesHeld.get(workspace)?.reread();
      given.onAppsChanged?.(workspace);
    }
    return refused;
  };

  /** A businesses write: shown at once by `show`, then the server's list; the sidebar's switcher follows. */
  const onProperties = async (
    workspace: string,
    show: (view: PropertiesView) => PropertiesView,
    send: (mutationId: string, options: Options) => Promise<PropertiesView>,
  ): Promise<DataError | undefined> => {
    const refused = await propertiesOf(workspace).change(show, () => call((options) => send(mintId(), options)));
    if (refused === undefined) given.onAppsChanged?.(workspace);
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
     * Turns an app on (AC-6503), and with `business` sets the business up: shown on at once. `APP_NEEDED` (Menu QR
     * without Menu) comes back as a refusal for the screen to ask, and the app shows as before.
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
    /** Switches an app off (the screen asks first, AC-6503); `withDependents` takes Menu QR with Menu (AC-6505). */
    remove: (workspace: string, app: HospitalityApp, withDependents = false): Promise<DataError | undefined> =>
      onApps(workspace, markInstalled(withDependents ? [app, 'menu_qr'] : [app], false), (mutationId, callOptions) =>
        api.remove({ workspace, app, withDependents, mutationId }, callOptions),
      ),

    /** The workspace's businesses (spec 0065 H7, AC-6516, AC-6517), read when first held. */
    properties: (workspace: string): HospitalityHeld<PropertiesView> => propertiesOf(workspace).held,
    /** Reads the businesses now (a route's loader, before it reads the chosen one); rejects with the refusal. */
    readProperties: (workspace: string): Promise<PropertiesView> => propertiesOf(workspace).read(),
    /** The business this workspace works in on this device: undefined is the first (AC-6517). */
    choice: (workspace: string): HospitalityHeld<string | undefined> => {
      // One held copy per workspace, so a screen's subscription stays put across renders.
      let found = choiceHelds.get(workspace);
      if (found === undefined) {
        found = choiceHeld(workspace);
        choiceHelds.set(workspace, found);
      }
      return found;
    },
    /**
     * Lets an open screen hold a switch while it has unsaved changes: `guard` asks the person and answers whether to go
     * on. Undefined lets every switch through. One per workspace: the screen in front.
     */
    guardChoice: (workspace: string, guard: (() => Promise<boolean>) | undefined): void => {
      if (guard === undefined) guards.delete(workspace);
      else guards.set(workspace, guard);
    },
    /** Lets go of `guard` only while it is still the one holding switches, so a screen never drops another's. */
    dropGuard: (workspace: string, guard: () => Promise<boolean>): void => {
      if (guards.get(workspace) === guard) guards.delete(workspace);
    },
    /** Switches the business shown (the sidebar's switcher, a Businesses row), once the guard, if any, agrees. */
    requestChoice: async (workspace: string, property: string): Promise<boolean> => {
      const guard = guards.get(workspace);
      if (guard !== undefined && !(await guard())) return false;
      choose(workspace, property);
      return true;
    },
    /** Switches the business every hospitality screen shows (AC-6517), kept on this device. */
    choose,
    /**
     * The business this workspace works in now, as a call names it: undefined is the first (or the list not read yet),
     * which no call names. The Menu store and the screens' links read it.
     */
    current: (workspace: string): string | undefined => choiceOf(workspace),
    /**
     * Adds a business (AC-6516) under `id` (the screen's own, from `newId`); it lists once the server made it, and
     * the sidebar's switcher follows. `LIMIT_REACHED` past 20 comes back for the screen to say.
     */
    createProperty: (
      workspace: string,
      property: {
        readonly id: string;
        readonly name: string;
        readonly kind: Property['kind'];
        readonly currency: string;
      },
    ): Promise<DataError | undefined> =>
      onProperties(
        workspace,
        (view) => view,
        (mutationId, options) => api.createProperty({ workspace, ...property, mutationId }, options),
      ),
    /** Removes an empty business (AC-6590; the screen asks first): gone at once, back with the reason if refused. */
    removeProperty: (workspace: string, property: string): Promise<DataError | undefined> =>
      onProperties(
        workspace,
        (view) => ({ ...view, properties: view.properties.filter((each) => each.id !== property) }),
        (mutationId, options) => api.removeProperty({ workspace, property, mutationId }, options),
      ),

    /**
     * Where one member may work (spec 0065 H7, AC-6594), for their panel in Settings › Members: read when the panel
     * opens, never held (an admin changes it rarely, and the panel reads it again each time). Rejects with the refusal.
     */
    memberReach: (workspace: string, memberId: string): Promise<MemberReachView> =>
      call((options) => api.memberReach({ workspace, memberId }, options)),
    /**
     * Sets where one member may work (AC-6594, AC-6597): the panel shows the choice at once and puts it back on a
     * refusal, which comes back here; the server's answer otherwise.
     */
    setMemberReach: async (
      workspace: string,
      memberId: string,
      reach: MemberReach,
    ): Promise<MemberReachView | DataError> => {
      try {
        return await call((options) =>
          api.setMemberReach({ workspace, memberId, reach, mutationId: mintId() }, options),
        );
      } catch (error) {
        return toDataError(error);
      }
    },
    /** Settings › Business (AC-6507, AC-6508): the chosen business's profile and places, read when first held. */
    business: (workspace: string): HospitalityHeld<BusinessView> => businessOf(workspace).held,
    /** Reads Business now (the route's loader); rejects with the refusal. */
    readBusiness: (workspace: string): Promise<BusinessView> => businessOf(workspace).read(),
    /**
     * Saves the chosen business's profile, whole; shown at once. A currency change is refused `IN_USE` while it has
     * prices (AC-6519), and the screen says why.
     */
    saveBusiness: (workspace: string, profile: PropertyFields): Promise<DataError | undefined> =>
      businessOf(workspace).change(
        (view) =>
          view.profile === undefined
            ? view
            : {
                ...view,
                profile: {
                  ...view.profile,
                  name: profile.name,
                  kind: profile.kind,
                  links: profile.links ?? view.profile.links,
                  ...(profile.currency === undefined ? {} : { currency: profile.currency }),
                },
              },
        async () => {
          const property = choiceOf(workspace);
          const saved = await call((options) =>
            api.saveBusiness(
              { workspace, ...(property === undefined ? {} : { property }), profile, mutationId: mintId() },
              options,
            ),
          );
          // The switcher and the list name it: they read again.
          propertiesHeld.get(workspace)?.reread();
          return (view: BusinessView) => ({ ...view, profile: saved });
        },
      ),
    /** Adds a place under `id` (the screen's own, from `newId`); it shows once the server made it. */
    createPlace: (workspace: string, id: string, place: PlaceFields): Promise<DataError | undefined> =>
      businessOf(workspace).change(
        (view) => view,
        async () => {
          const property = choiceOf(workspace);
          const made = await call((options) =>
            api.createPlace(
              { workspace, ...(property === undefined ? {} : { property }), id, place, mutationId: mintId() },
              options,
            ),
          );
          propertiesHeld.get(workspace)?.reread();
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

    /**
     * One place's table QR codes (spec 0065, H2), read when first held (and again when held after a second, so tables
     * added on the place's page show).
     */
    qrCodes: (workspace: string, placeId: string): HospitalityHeld<PlaceQrCodes> => qrOf(workspace, placeId).held,
    /** Reads a place's codes now (the route's loader); rejects with the refusal. */
    readQrCodes: (workspace: string, placeId: string): Promise<PlaceQrCodes> => qrOf(workspace, placeId).read(),
    /**
     * A new code for one table (H2; the screen asks first, since the old print stops working). The code is the
     * server's to draw, so the copy shows saving until it lands; refused, nothing changed.
     */
    regenerateTableCode: (workspace: string, placeId: string, resourceId: string): Promise<DataError | undefined> =>
      qrOf(workspace, placeId).change(
        (codes) => codes,
        () =>
          call((options) => api.regenerateTableCode({ workspace, placeId, resourceId, mutationId: mintId() }, options)),
      ),

    /** One place's areas and tables (AC-6509), read when first held. */
    floor: (workspace: string, placeId: string): HospitalityHeld<PlaceFloor> => floorOf(workspace, placeId).held,
    /** Reads a floor now; rejects with the refusal. */
    listResources: (workspace: string, placeId: string): Promise<PlaceFloor> => floorOf(workspace, placeId).read(),
    /**
     * Adds an area (`areaId` absent) or renames one. A new area takes `newId` when the screen minted one (`newId()`)
     * to use at once, such as a table drawer's new zone the table is saved into; it shows once the server made it.
     */
    saveArea: (
      workspace: string,
      placeId: string,
      name: string,
      areaId?: string,
      newId?: string,
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) =>
          areaId === undefined
            ? floor
            : { ...floor, areas: floor.areas.map((area) => (area.id === areaId ? { ...area, name } : area)) },
        (mutationId, options) =>
          api.saveArea(
            {
              workspace,
              placeId,
              name,
              ...(areaId === undefined ? { id: newId ?? mintId() } : { areaId }),
              mutationId,
            },
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
          resources: floor.resources.map((table) => {
            if (table.areaId !== areaId) return table;
            const { areaId: _gone, ...rest } = table;
            return rest;
          }),
        }),
        (mutationId, options) => api.deleteArea({ workspace, placeId, areaId, mutationId }, options),
      ),
    /** Adds tables at once ("T1 to T10"); they show once the server made them. */
    addResources: (
      workspace: string,
      placeId: string,
      input: {
        readonly kind: ResourceKind;
        readonly labels: readonly string[];
        readonly areaId?: string;
        readonly minCapacity: number;
        readonly maxCapacity: number;
        readonly online?: boolean;
      },
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => floor,
        (mutationId, options) =>
          api.addResources(
            {
              workspace,
              placeId,
              kind: input.kind,
              labels: [...input.labels],
              ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
              minCapacity: input.minCapacity,
              maxCapacity: input.maxCapacity,
              online: input.online ?? true,
              mutationId,
            },
            options,
          ),
      ),
    /** Changes one table; its fields show at once (joins once the server kept both sides). */
    updateResource: (
      workspace: string,
      placeId: string,
      resourceId: string,
      change: ResourceChange,
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({
          ...floor,
          resources: floor.resources.map((table) => {
            if (table.id !== resourceId) return table;
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
        (mutationId, options) => api.updateResource({ workspace, placeId, resourceId, ...change, mutationId }, options),
      ),
    /** Moves a table to `toIndex` among the live ones (drag to reorder); shown at once. */
    moveResource: (
      workspace: string,
      placeId: string,
      resourceId: string,
      toIndex: number,
    ): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({ ...floor, resources: reordered(floor.resources, resourceId, toIndex) }),
        (mutationId, options) => api.moveResource({ workspace, placeId, resourceId, toIndex, mutationId }, options),
      ),
    /** Archives a table (it leaves online fitting, keeps its holds); shown at once, last. */
    archiveResource: (workspace: string, placeId: string, resourceId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => {
          const moving = floor.resources.find((table) => table.id === resourceId);
          return moving === undefined
            ? floor
            : {
                ...floor,
                resources: [
                  ...floor.resources.filter((table) => table.id !== resourceId),
                  { ...moving, archived: true },
                ],
              };
        },
        (mutationId, options) => api.archiveResource({ workspace, placeId, resourceId, mutationId }, options),
      ),
    /** Brings an archived table back, last among the live ones. */
    restoreResource: (workspace: string, placeId: string, resourceId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => floor,
        (mutationId, options) => api.restoreResource({ workspace, placeId, resourceId, mutationId }, options),
      ),
    /** Deletes a table for good (the screen asks first); gone at once. */
    deleteResource: (workspace: string, placeId: string, resourceId: string): Promise<DataError | undefined> =>
      onFloor(
        workspace,
        placeId,
        (floor) => ({ ...floor, resources: floor.resources.filter((table) => table.id !== resourceId) }),
        (mutationId, options) => api.deleteResource({ workspace, placeId, resourceId, mutationId }, options),
      ),

    /** Signed out: forgets every copy. */
    clear: (): void => {
      appsHeld.clear();
      businessHeld.clear();
      propertiesHeld.clear();
      chosen.clear();
      guards.clear();
      choiceSnapshots.clear();
      floors.clear();
    },
  };
}

/** The Hospitality store, as `data.hospitality.load()` answers it. */
export type HospitalityStore = ReturnType<typeof openHospitality>;
