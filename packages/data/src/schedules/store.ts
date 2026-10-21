// Availability schedules (spec 0035): one held list per workspace and member
// (the caller's own, or a colleague's for `booking.admin`), the one copy the
// Availability list, a schedule's editor and a page editor's picker all read.
// Every write shows at once (`show`), puts back what it changed on a refusal,
// and puts the server's answer in place once it lands. A `schedules` change
// event (AC-977) reads every held list of the workspace again, so another
// tab's save shows within a second; a list nobody holds is read when next
// held. A failed read keeps what is shown; only a first read shows the failure.
import type { BookingAvailability, ScheduleList, ScheduleView } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';

/** The calls the store makes (the data layer adds the mutation ids). */
export interface SchedulesApi {
  readonly list: (input: {
    readonly workspace: string;
    readonly memberId?: string;
    readonly timeZone: string;
  }) => Promise<ScheduleList>;
  readonly create: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly memberId?: string;
    readonly name: string;
    readonly timeZone: string;
    readonly availability?: BookingAvailability;
    readonly isDefault?: boolean;
  }) => Promise<ScheduleView>;
  readonly update: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly name?: string;
    readonly availability?: BookingAvailability;
    readonly updatedAt: string;
  }) => Promise<ScheduleView>;
  readonly setDefault: (input: { readonly workspace: string; readonly id: string }) => Promise<ScheduleView>;
  readonly duplicate: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly newId: string;
  }) => Promise<ScheduleView>;
  readonly remove: (input: {
    readonly workspace: string;
    readonly id: string;
  }) => Promise<{ readonly id: string; readonly repointed: { readonly pages: number } }>;
}

/** What the store needs: the calls, the id minter for new schedules, and the live watch. */
export interface SchedulesDeps {
  readonly api: SchedulesApi;
  readonly mintId: () => string;
  /** Listens to the workspace's changes while a list is held (AC-977); the answer stops. None in tests. */
  readonly watch?: (workspace: string) => () => void;
}

/** One member's schedules as a screen reads them. */
export type SchedulesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly memberId: string; readonly schedules: readonly ScheduleView[] };

/** One member's schedules, as a screen retains them. */
export interface SchedulesView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SchedulesState;
  /** Held while a screen shows it: read when first held. */
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure); at once when one did. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** The default first, then by name ignoring case (AC-969). */
export function sortSchedules(schedules: readonly ScheduleView[]): readonly ScheduleView[] {
  return [...schedules].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      (a.id ?? '').localeCompare(b.id ?? ''),
  );
}

/** "<name> copy", "<name> copy 2" …, the first free one within 60 characters, as the server names a duplicate. */
export function copyName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((each) => each.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? ' copy' : ` copy ${String(n)}`;
    const wanted = `${name.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (!lower.has(wanted.toLowerCase())) return wanted;
  }
}

type Schedules = readonly ScheduleView[];

/** How long a read stays fresh: a screen held again within it (the loader's read, then the screen's) asks nothing. */
const FRESH_MS = 1_000;

/** The schedules store: every workspace's and member's lists. */
export function createSchedulesStore(deps: SchedulesDeps) {
  const lists = new Map<string, ReturnType<typeof makeList>>();

  function makeList(workspace: string, memberId: string | undefined, timeZone: string) {
    let state: SchedulesState = { status: 'loading' };
    let held = 0;
    let readAt: number | undefined;
    let reading: Promise<void> | undefined;
    let settled: Promise<void> | undefined;
    // Moves on every write; a read that started before one landed is asked again.
    let epoch = 0;
    let writing = 0;
    // A read dropped because a write was out: read again once the writes are in.
    let isStale = false;
    let stopWatching: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const set = (next: SchedulesState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    /** An answer in place, unless it is what the list already shows: a read changing nothing re-renders nothing. */
    const land = (answer: ScheduleList) => {
      const schedules = sortSchedules(answer.schedules);
      if (state.status === 'ready' && state.memberId === answer.memberId && sameSchedules(state.schedules, schedules)) {
        return;
      }
      set({ status: 'ready', memberId: answer.memberId, schedules });
    };
    const read = (): Promise<void> => {
      reading ??= (async () => {
        const startedAt = epoch;
        try {
          const answer = await deps.api.list({
            workspace,
            ...(memberId === undefined ? {} : { memberId }),
            timeZone,
          });
          reading = undefined;
          if (startedAt !== epoch || writing > 0) {
            if (state.status !== 'ready') land(answer);
            if (writing === 0) await read();
            else isStale = true;
            return;
          }
          isStale = false;
          readAt = Date.now();
          land(answer);
        } catch (error) {
          reading = undefined;
          if (state.status !== 'ready') {
            set({ status: 'error', error: toDataError(error) });
            throw toDataError(error);
          }
        }
      })();
      return reading;
    };
    return {
      view: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => state,
        retain() {
          held += 1;
          if (held === 1) stopWatching = deps.watch?.(workspace);
          // Held again after a while away (a change may have gone by unheard): shown at once, read again behind.
          if (held === 1 && (readAt === undefined || Date.now() - readAt > FRESH_MS)) {
            void read().catch(() => undefined);
          }
          return () => {
            held -= 1;
            if (held === 0) {
              stopWatching?.();
              stopWatching = undefined;
            }
          };
        },
        ready() {
          settled ??= read();
          return settled.catch((error: unknown) => {
            settled = undefined;
            throw error;
          });
        },
        reload() {
          void read().catch(() => undefined);
        },
      } satisfies SchedulesView,
      memberOf: () => (state.status === 'ready' ? state.memberId : memberId),
      isHeld: () => held > 0,
      items: (): Schedules | undefined => (state.status === 'ready' ? state.schedules : undefined),
      /** Applies `change` to the shown schedules, sorted again; nothing while not ready. */
      change(change: (schedules: Schedules) => Schedules) {
        if (state.status !== 'ready') return;
        set({ ...state, schedules: sortSchedules(change(state.schedules)) });
      },
      begin() {
        epoch += 1;
        writing += 1;
      },
      end() {
        epoch += 1;
        writing -= 1;
        if (writing === 0 && isStale) void read().catch(() => undefined);
      },
      /** Read again once the writes out now are in: a refusal left the list showing something it can't take back. */
      markStale() {
        isStale = true;
      },
      /**
       * Changed elsewhere (a `schedules` event): a read already under way may have been answered before that change
       * committed, so it is dropped and asked again.
       */
      invalidate() {
        epoch += 1;
        void read().catch(() => undefined);
      },
      read,
    };
  }

  const keyOf = (workspace: string, memberId: string | undefined, timeZone: string) =>
    `${workspace}:${memberId ?? 'me'}:${timeZone}`;
  const ofWorkspace = (workspace: string) =>
    [...lists.entries()].filter(([key]) => key.startsWith(`${workspace}:`)).map(([, list]) => list);
  /** The workspace's lists showing `memberId`'s schedules (the caller's own lists name no member until read). */
  const ofMember = (workspace: string, memberId: string) =>
    ofWorkspace(workspace).filter((list) => list.memberOf() === memberId);

  /**
   * One write over the lists showing the member's schedules: `show` at once,
   * the lists put back as they were on a refusal (only a list still showing
   * this change), the answer put in place by `land`.
   */
  async function write<Answer>(
    workspace: string,
    memberId: string,
    run: {
      readonly send: () => Promise<Answer>;
      readonly show: (schedules: Schedules) => Schedules;
      readonly land: (schedules: Schedules, answer: Answer) => Schedules;
    },
  ): Promise<Answer> {
    const touched = ofMember(workspace, memberId);
    const before = touched.map((list) => list.items());
    for (const list of touched) {
      list.begin();
      list.change(run.show);
    }
    let isStale = false;
    // What each list showed once this write's change was in: a refusal puts a list back only while it still shows it.
    const shown = touched.map((list) => list.items());
    try {
      const answer = await run.send();
      for (const list of touched) list.change((schedules) => run.land(schedules, answer));
      return answer;
    } catch (error) {
      const refusal = toDataError(error);
      // Changed elsewhere since the editor began: read again once this write is out, so the next save names it.
      isStale = refusal.code === 'STALE';
      touched.forEach((list, index) => {
        const was = before[index];
        if (was === undefined) return;
        if (list.items() === shown[index]) list.change(() => was);
        // The list moved on since (another write landed): it can't be put back, so it is read again instead.
        else list.markStale();
      });
      throw refusal;
    } finally {
      for (const list of touched) {
        list.end();
        if (isStale) void list.read().catch(() => undefined);
      }
    }
  }

  const replace = (answer: ScheduleView, id: string | null) => (schedules: Schedules) =>
    schedules.some((each) => each.id === id)
      ? schedules.map((each) => (each.id === id ? answer : each))
      : [...schedules, answer];
  /** The default mark on `id` only (the virtual default leaves once a stored one takes the mark). */
  const markDefault = (id: string) => (schedules: Schedules) =>
    schedules.filter((each) => each.id !== null).map((each) => ({ ...each, isDefault: each.id === id }));

  return {
    /** One member's schedules: the caller's own (`memberId` undefined), or a colleague's with `booking.admin`. */
    view(workspace: string, memberId: string | undefined, timeZone: string): SchedulesView {
      const key = keyOf(workspace, memberId, timeZone);
      const found = lists.get(key);
      if (found !== undefined) return found.view;
      const made = makeList(workspace, memberId, timeZone);
      lists.set(key, made);
      return made.view;
    },
    /**
     * A `schedules` event (AC-977), or a page write that moved a page between schedules: every held list of the
     * workspace reads again, dropping a read already under way; the rest read when next held.
     */
    changed(workspace: string): void {
      for (const list of ofWorkspace(workspace)) if (list.isHeld()) list.invalidate();
    },
    /** Drops every list (sign out). */
    clear(): void {
      lists.clear();
    },
    /**
     * A new schedule (AC-964), shown at once with the default's hours and in
     * the list once the server has it; `isDefault` with `availability` saves
     * the virtual default the first time (AC-963). Answers the stored schedule.
     */
    create(
      workspace: string,
      memberId: string,
      input: {
        /** The id to store it under (the screen's `newId`, so it knows the schedule before it lands); else minted. */
        readonly id?: string;
        readonly name: string;
        readonly timeZone: string;
        readonly availability?: BookingAvailability;
        readonly isDefault?: boolean;
        /** The member's id as the API takes it: only when it isn't the caller. */
        readonly forMember?: boolean;
      },
    ): Promise<ScheduleView> {
      const id = input.id ?? deps.mintId();
      const fallback = ofMember(workspace, memberId)[0]
        ?.items()
        ?.find((each) => each.isDefault);
      const draft: ScheduleView = {
        id,
        memberId,
        name: input.name.trim(),
        isDefault: input.isDefault === true,
        availability: input.availability ??
          fallback?.availability ?? { timeZone: input.timeZone, weekly: emptyWeek, overrides: [] },
        pages: input.isDefault === true ? (fallback?.pages ?? []) : [],
        updatedAt: null,
      };
      // Added beside the virtual default, the server stores that default too: the lists read it once this lands.
      const storesVirtual =
        input.isDefault !== true &&
        ofMember(workspace, memberId).some((list) => list.items()?.some((each) => each.id === null) === true);
      return write(workspace, memberId, {
        send: () =>
          deps.api.create({
            workspace,
            id,
            ...(input.forMember === true ? { memberId } : {}),
            name: input.name,
            timeZone: input.timeZone,
            ...(input.availability === undefined ? {} : { availability: input.availability }),
            ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          }),
        show: (schedules) =>
          input.isDefault === true ? [...markDefault(id)(schedules), draft] : [...schedules, draft],
        land: (schedules, answer) => replace(answer, id)(schedules),
      }).then((answer) => {
        if (storesVirtual) for (const list of ofMember(workspace, memberId)) void list.read().catch(() => undefined);
        return answer;
      });
    },
    /** Renames a schedule or replaces its hours (AC-970), shown at once; `STALE` when it changed meanwhile. */
    update(
      workspace: string,
      schedule: ScheduleView,
      change: { readonly name?: string; readonly availability?: BookingAvailability },
    ): Promise<ScheduleView> {
      const id = schedule.id;
      if (id === null || schedule.updatedAt === null) return Promise.reject(new Error('Save the default first.'));
      return write(workspace, schedule.memberId, {
        send: () =>
          deps.api.update({
            workspace,
            id,
            ...(change.name === undefined ? {} : { name: change.name }),
            ...(change.availability === undefined ? {} : { availability: change.availability }),
            updatedAt: schedule.updatedAt ?? '',
          }),
        show: (schedules) =>
          schedules.map((each) =>
            each.id === id
              ? {
                  ...each,
                  ...(change.name === undefined ? {} : { name: change.name.trim() }),
                  ...(change.availability === undefined ? {} : { availability: change.availability }),
                }
              : each,
          ),
        land: (schedules, answer) => replace(answer, id)(schedules),
      });
    },
    /** Moves the default mark (AC-962) at once; the pages that follow the default move with it. */
    setDefault(workspace: string, schedule: ScheduleView): Promise<ScheduleView> {
      const id = schedule.id;
      if (id === null) return Promise.resolve(schedule);
      return write(workspace, schedule.memberId, {
        send: () => deps.api.setDefault({ workspace, id }),
        show: markDefault(id),
        // The default's "Used by" now holds the pages that follow it: read the lists again for the counts.
        land: (schedules, answer) => replace(answer, id)(markDefault(id)(schedules)),
      }).finally(() => {
        for (const list of ofMember(workspace, schedule.memberId)) void list.read().catch(() => undefined);
      });
    },
    /** A copy, "<name> copy", shown at once and opened by its answer's id (AC-964). */
    duplicate(workspace: string, schedule: ScheduleView): Promise<ScheduleView> {
      const id = schedule.id;
      if (id === null) return Promise.reject(new Error('Save the default first.'));
      const newId = deps.mintId();
      const taken =
        ofMember(workspace, schedule.memberId)[0]
          ?.items()
          ?.map((each) => each.name) ?? [];
      const draft: ScheduleView = {
        ...schedule,
        id: newId,
        name: copyName(schedule.name, taken),
        isDefault: false,
        pages: [],
        updatedAt: null,
      };
      return write(workspace, schedule.memberId, {
        send: () => deps.api.duplicate({ workspace, id, newId }),
        show: (schedules) => [...schedules, draft],
        land: (schedules, answer) => replace(answer, newId)(schedules),
      });
    },
    /**
     * Deletes a schedule (AC-967) once the server has: it asks first, so its confirm shows the delete under way and
     * says a refusal itself, and the schedule leaves when it is gone. Its pages follow the default.
     */
    remove(workspace: string, schedule: ScheduleView): Promise<{ readonly pages: number }> {
      const id = schedule.id;
      if (id === null) return Promise.reject(new Error('The default can’t be deleted.'));
      return write(workspace, schedule.memberId, {
        send: () => deps.api.remove({ workspace, id }),
        show: (schedules) => schedules,
        land: (schedules) => schedules.filter((each) => each.id !== id),
      }).then((answer) => {
        // The default's "Used by" gained the pages: read the lists again for the counts.
        for (const list of ofMember(workspace, schedule.memberId)) void list.read().catch(() => undefined);
        return answer.repointed;
      });
    },
  };
}

const emptyWeek: BookingAvailability['weekly'] = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

/** Whether two lists hold the same schedules, as the server answers them (at most 20, so read whole). */
function sameSchedules(a: Schedules, b: Schedules): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** The schedules store. */
export type SchedulesStore = ReturnType<typeof createSchedulesStore>;
