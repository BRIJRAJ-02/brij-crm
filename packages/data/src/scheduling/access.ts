// Scheduling access (spec 0037, AC-1266 to AC-1268): who may see or manage whose scheduling. Two held lists per
// workspace, the one copy each screen reads: `mine` (the delegations the signed in member holds and those over
// them, Settings › Account › Scheduling access) and `everyone` (every delegation in the workspace, Settings ›
// Members' Scheduling column, `members.manage` only). Plus `visible`, the members in the caller's See reach
// (`members.visible`), which Availability's Viewing Select and the "For" pickers read.
//
// A grant or a removal shows at once in every held list it belongs to, is sent, and is put back with a toast if
// refused (the answer says whether it landed). An `access` change naming the member (spec 0009, AC-146; spec 0037,
// AC-1274) reads every held list again and forgets `visible`, so a delegation someone else gave or took back
// reaches the open screen. Delegations are settings, as bookings are: no outbox kind of their own beyond that.
import type {
  CalendarHealth,
  DelegationTarget,
  DelegationView,
  DelegationsList,
  SchedulingLevel,
  VisibleMember,
  VisibleMembers,
} from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { MutationLog } from '../live/mutations.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';
import { createCalendarHealthStore, type CalendarHealthApi } from './health.ts';
import { createLimitsStore, type LimitsApi, type LimitsDraft } from './limits.ts';
import { createTimeOffStore, type TimeOffApi, type TimeOffDraft } from './time-off.ts';
import { createTeamWeekStore, type TeamWeekApi } from './team-week.ts';
import type {
  BulkHoursResult,
  DayHours,
  MeetingLimits,
  SetDayResult,
  TeamWeek,
  TimeOffList,
  TimeOffSaved,
  WeeklyHours,
} from '@crm/contracts';

export type { DelegationTarget, DelegationView, SchedulingLevel, VisibleMember } from '@crm/contracts';

/** Which delegations a held list holds: the member's own both ways, or the whole workspace's. */
export type DelegationsScope = 'mine' | 'everyone';

/** One held list of delegations as a screen reads it. */
export type DelegationsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly delegations: readonly DelegationView[] };

/** One held list of delegations, read when a screen first holds it. */
export interface DelegationsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => DelegationsState;
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure). */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** A grant as a screen asks for it: See or Manage over a person (or everyone) for one delegate. */
export interface DelegationGrant {
  readonly delegateMemberId: string;
  readonly target: DelegationTarget;
  readonly level: SchedulingLevel;
}

/** The calls the store makes (the data layer adds the mutation ids and the read gate). */
export interface SchedulingAccessApi {
  readonly list: (input: { readonly workspace: string; readonly everyone?: true }) => Promise<DelegationsList>;
  readonly grant: (input: { readonly workspace: string } & DelegationGrant) => Promise<DelegationView>;
  readonly revoke: (input: { readonly workspace: string; readonly id: string }) => Promise<void>;
  readonly visible: (input: { readonly workspace: string }) => Promise<VisibleMembers>;
  /** Time off's calls (spec 0037): its store loads in this same chunk. Absent in tests that don't need it. */
  readonly timeOff?: TimeOffApi;
  /** The Team week's calls (spec 0037, job J6): its store loads in this same chunk. Absent in tests that don't need it. */
  readonly teamWeek?: TeamWeekApi;
  /** Meeting limits' calls (spec 0037, job J7): its store loads in this same chunk. Absent in tests that don't need it. */
  readonly limits?: LimitsApi;
  /** Calendar health's calls (spec 0037, job J8): its store loads in this same chunk. Absent in tests that don't need it. */
  readonly health?: CalendarHealthApi;
}

/**
 * The procedures the store calls, as the data layer's client has them, and how it calls them (`call`, with its
 * retries and refusals; `beforeRead`, the live head). Kept here, in the store's own chunk, not the first load.
 */
export interface SchedulingAccessWire<O> {
  readonly client: {
    readonly scheduling: {
      readonly delegations: {
        list(input: { readonly workspace: string; readonly everyone?: true }, options: O): Promise<DelegationsList>;
        grant(
          input: { readonly workspace: string; readonly mutationId: string } & DelegationGrant,
          options: O,
        ): Promise<DelegationView>;
        revoke(
          input: { readonly workspace: string; readonly id: string; readonly mutationId: string },
          options: O,
        ): Promise<void>;
      };
    };
    readonly members: { visible(input: { readonly workspace: string }, options: O): Promise<VisibleMembers> };
    readonly timeOff: {
      list(input: { readonly workspace: string; readonly memberId?: string }, options: O): Promise<TimeOffList>;
      create(
        input: {
          readonly workspace: string;
          readonly id: string;
          readonly memberId?: string;
          readonly mutationId: string;
        } & TimeOffDraft,
        options: O,
      ): Promise<TimeOffSaved>;
      update(
        input: {
          readonly workspace: string;
          readonly id: string;
          readonly updatedAt: string;
          readonly mutationId: string;
        } & TimeOffDraft,
        options: O,
      ): Promise<TimeOffSaved>;
      delete(
        input: { readonly workspace: string; readonly id: string; readonly mutationId: string },
        options: O,
      ): Promise<unknown>;
    };
    readonly calendar: {
      health(input: { readonly workspace: string; readonly memberIds: string[] }, options: O): Promise<CalendarHealth>;
      askReconnect(
        input: { readonly workspace: string; readonly memberId: string; readonly mutationId: string },
        options: O,
      ): Promise<unknown>;
    };
    readonly limits: {
      get(input: { readonly workspace: string; readonly memberId?: string }, options: O): Promise<MeetingLimits>;
      set(
        input: { readonly workspace: string; readonly memberId?: string; readonly mutationId: string } & LimitsDraft,
        options: O,
      ): Promise<MeetingLimits>;
    };
    readonly availability: {
      teamWeek(
        input: {
          readonly workspace: string;
          readonly weekStart: string;
          readonly search?: string;
          readonly cursor?: string;
        },
        options: O,
      ): Promise<TeamWeek>;
      setDay(
        input: {
          readonly workspace: string;
          readonly memberId: string;
          readonly date: string;
          readonly hours: DayHours;
          readonly updatedAt: string | null;
          readonly mutationId: string;
        },
        options: O,
      ): Promise<SetDayResult>;
      copyWeek(
        input: {
          readonly workspace: string;
          readonly memberIds: string[];
          readonly fromWeekStart: string;
          readonly toWeekStart: string;
          readonly mutationId: string;
        },
        options: O,
      ): Promise<BulkHoursResult>;
      setUsualHours(
        input: {
          readonly workspace: string;
          readonly memberIds: string[];
          readonly weekly: WeeklyHours;
          readonly mutationId: string;
        },
        options: O,
      ): Promise<BulkHoursResult>;
    };
  };
  readonly call: <T>(run: (options: O) => Promise<T>) => Promise<T>;
  readonly beforeRead: (workspace: string) => Promise<void>;
  readonly mintId: () => string;
  /**
   * This tab's writes whose echoes are due: a time off write's own `time_off` event is then skipped, since the store
   * already read again what it changed. Left out (tests), every echo is heard.
   */
  readonly mutations?: Pick<MutationLog, 'sent' | 'answered' | 'forget'>;
}

/** The store's calls over the data layer's client (each write with its own mutation id). */
export function wireApi<O>({
  client,
  call,
  beforeRead,
  mintId,
  mutations,
}: SchedulingAccessWire<O>): SchedulingAccessApi {
  const { delegations } = client.scheduling;
  /** A time off write under a mutation id this tab knows, so its one `time_off` echo is skipped. */
  const echoed = async <T>(send: (mutationId: string) => Promise<T>): Promise<T> => {
    const mutationId = mintId();
    mutations?.sent(mutationId);
    try {
      const answer = await send(mutationId);
      mutations?.answered(mutationId, 1);
      return answer;
    } catch (error) {
      mutations?.forget(mutationId);
      throw error;
    }
  };
  return {
    list: (input) => beforeRead(input.workspace).then(() => call((options) => delegations.list(input, options))),
    grant: (input) => call((options) => delegations.grant({ ...input, mutationId: mintId() }, options)),
    revoke: (input) => call((options) => delegations.revoke({ ...input, mutationId: mintId() }, options)),
    visible: (input) =>
      beforeRead(input.workspace).then(() => call((options) => client.members.visible(input, options))),
    timeOff: {
      list: (input) => beforeRead(input.workspace).then(() => call((options) => client.timeOff.list(input, options))),
      create: (input) =>
        echoed((mutationId) => call((options) => client.timeOff.create({ ...input, mutationId }, options))),
      update: (input) =>
        echoed((mutationId) => call((options) => client.timeOff.update({ ...input, mutationId }, options))),
      remove: (input) =>
        echoed((mutationId) => call((options) => client.timeOff.delete({ ...input, mutationId }, options))).then(
          () => undefined,
        ),
    },
    limits: {
      get: (input) => beforeRead(input.workspace).then(() => call((options) => client.limits.get(input, options))),
      // Its own `time_off` echo is skipped: the store already shows the answer.
      set: (input) => echoed((mutationId) => call((options) => client.limits.set({ ...input, mutationId }, options))),
    },
    // Calendar health (spec 0037, job J8): a colleague's status; Ask to reconnect stores no event, so no echo to skip.
    health: {
      read: (input) =>
        beforeRead(input.workspace).then(() =>
          call((options) =>
            client.calendar.health({ workspace: input.workspace, memberIds: [...input.memberIds] }, options),
          ),
        ),
      ask: (input) => call((options) => client.calendar.askReconnect({ ...input, mutationId: mintId() }, options)),
    },
    teamWeek: {
      read: (input) =>
        beforeRead(input.workspace).then(() => call((options) => client.availability.teamWeek(input, options))),
      setDay: (input) => call((options) => client.availability.setDay({ ...input, mutationId: mintId() }, options)),
      copyWeek: (input) =>
        call((options) =>
          client.availability.copyWeek({ ...input, memberIds: [...input.memberIds], mutationId: mintId() }, options),
        ),
      setUsualHours: (input) =>
        call((options) =>
          client.availability.setUsualHours(
            { ...input, memberIds: [...input.memberIds], mutationId: mintId() },
            options,
          ),
        ),
    },
  };
}

/** What the store is made with. */
export interface SchedulingAccessDeps {
  readonly api: SchedulingAccessApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  /** Watches a workspace's live events while a Team week or a time off list of it is held. */
  readonly watch?: (workspace: string) => () => void;
  /** Time off changed here (a write landed): Bookings' held reads, whose Host away flags it sets, read again. */
  readonly onTimeOffChanged?: (workspace: string) => void;
}

/** A read this recent serves a new holder as it is: the loader and the screen it opens hold it together. */
export const DELEGATIONS_FRESH_MS = 1_000;

/** Whether two targets name the same person, team or everyone. */
export function sameTarget(a: DelegationTarget, b: DelegationTarget): boolean {
  if (a.type === 'member' && b.type === 'member') return a.memberId === b.memberId;
  if (a.type === 'team' && b.type === 'team') return a.teamId === b.teamId;
  return a.type === 'everyone' && b.type === 'everyone';
}

/** Whether a delegation names `memberId` as its delegate or its member target (a `mine` list holds it). */
export function involves(delegation: Pick<DelegationView, 'delegateMemberId' | 'target'>, memberId: string): boolean {
  return (
    delegation.delegateMemberId === memberId ||
    (delegation.target.type === 'member' && delegation.target.memberId === memberId)
  );
}

/**
 * A grant laid over a list, as the server will answer it: the same delegate and target changes its level, else a
 * new row at the end (`id` stands in for the server's until it answers).
 */
export function withGrant(
  delegations: readonly DelegationView[],
  grant: DelegationGrant,
  id: string,
  grantedBy: string,
  at: string,
): readonly DelegationView[] {
  const index = delegations.findIndex(
    (each) => each.delegateMemberId === grant.delegateMemberId && sameTarget(each.target, grant.target),
  );
  if (index >= 0) {
    return delegations.map((each, at_) => (at_ === index ? { ...each, level: grant.level } : each));
  }
  const overSelf = grant.target.type === 'member' && grant.target.memberId === grantedBy;
  return [
    ...delegations,
    {
      id,
      delegateMemberId: grant.delegateMemberId,
      target: grant.target,
      level: grant.level,
      grantedBySelf: overSelf,
      grantedBy,
      createdAt: at,
    },
  ];
}

/** The workspace's delegations and the caller's See reach, held per workspace. */
export function createSchedulingAccessStore(deps: SchedulingAccessDeps) {
  const now = deps.now ?? Date.now;
  const lists = new Map<string, ReturnType<typeof make>>();
  const visibles = new Map<string, Promise<readonly VisibleMember[]>>();
  const keyOf = (workspace: string, scope: DelegationsScope) => `${workspace}\u0000${scope}`;
  // Time off (spec 0037), in this same chunk: Availability opens this store anyway for whose schedules show.
  const { timeOff: timeOffApi } = deps.api;
  const timeOff = createTimeOffStore({
    api: timeOffApi ?? {
      list: () => Promise.reject(new Error('time off is not wired')),
      create: () => Promise.reject(new Error('time off is not wired')),
      update: () => Promise.reject(new Error('time off is not wired')),
      remove: () => Promise.reject(new Error('time off is not wired')),
    },
    mintId: deps.mintId,
    notify: deps.notify,
    ...(deps.watch === undefined ? {} : { watch: deps.watch }),
    // The Team week draws Away from time off, and Bookings flags Host away by it: both read again at once.
    onChanged: (workspace) => {
      teamWeek.changed(workspace);
      deps.onTimeOffChanged?.(workspace);
    },
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  // The Team week (spec 0037, job J6), in this same chunk: Availability opens this store for whose rows show.
  const notWired = () => Promise.reject(new Error('the Team week is not wired'));
  const teamWeek = createTeamWeekStore({
    api: deps.api.teamWeek ?? { read: notWired, setDay: notWired, copyWeek: notWired, setUsualHours: notWired },
    notify: deps.notify,
    ...(deps.watch === undefined ? {} : { watch: deps.watch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  // Meeting limits (spec 0037, job J7), in this same chunk: Availability shows them beside time off.
  const limits = createLimitsStore({
    api: deps.api.limits ?? { get: notWired, set: notWired },
    notify: deps.notify,
    ...(deps.watch === undefined ? {} : { watch: deps.watch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  // Calendar health (spec 0037, job J8), in this same chunk: the Members page, the Team week and rotations chip it.
  const health = createCalendarHealthStore({
    api: deps.api.health ?? { read: notWired, ask: notWired },
    notify: deps.notify,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  // The counts beside each limit move as meetings are booked, and a colleague's calendar breaks, with no event: a tab
  // shown again reads both again.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        limits.shown();
        health.shown();
      }
    });
  }

  function make(workspace: string, scope: DelegationsScope) {
    let state: DelegationsState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    let readAt: number | undefined;
    // A read sent before a write landed would put its older answer over the write: each write bumps this, and an
    // answer from before it is read again instead of shown. While a write is out, an answer isn't shown at all (it
    // may or may not hold the write): it is read again once the last write settles.
    let version = 0;
    let writing = 0;
    let owed = false;
    const listeners = new Set<() => void>();
    const set = (next: DelegationsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<void> => {
      const sentAt = version;
      reading ??= deps.api.list({ workspace, ...(scope === 'everyone' ? { everyone: true as const } : {}) }).then(
        (answer) => {
          reading = undefined;
          if (writing > 0 && state.status === 'ready') {
            owed = true;
            return undefined;
          }
          if (sentAt !== version) return read();
          readAt = now();
          set({ status: 'ready', delegations: answer.delegations });
          return undefined;
        },
        (error: unknown) => {
          reading = undefined;
          const failure = toDataError(error);
          // A failed read keeps what is shown; only a first read shows the failure.
          if (state.status !== 'ready') set({ status: 'error', error: failure });
          throw failure;
        },
      );
      return reading;
    };
    return {
      held: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => state,
        retain() {
          if (readAt === undefined || now() - readAt >= DELEGATIONS_FRESH_MS) void read().catch(() => undefined);
          return () => undefined;
        },
        ready: () => (state.status === 'ready' ? Promise.resolve() : read()),
        reload: () => {
          if (state.status === 'error') set({ status: 'loading' });
          void read().catch(() => undefined);
        },
      } satisfies DelegationsHeld,
      /** Lays a change over what is shown (a write), and marks reads sent before it as stale. */
      change(next: (delegations: readonly DelegationView[]) => readonly DelegationView[]) {
        version += 1;
        if (state.status === 'ready') set({ status: 'ready', delegations: next(state.delegations) });
      },
      /** A write goes out: reads answering meanwhile wait for it. */
      begin() {
        writing += 1;
        version += 1;
      },
      /** A write settled: once none is out, a read held back meanwhile is asked again. */
      end() {
        writing = Math.max(0, writing - 1);
        version += 1;
        if (writing === 0 && owed) {
          owed = false;
          void read().catch(() => undefined);
        }
      },
      reread() {
        readAt = undefined;
        version += 1;
        void read().catch(() => undefined);
      },
    };
  }

  const of = (workspace: string, scope: DelegationsScope) => {
    const key = keyOf(workspace, scope);
    const found = lists.get(key);
    if (found !== undefined) return found;
    const made = make(workspace, scope);
    lists.set(key, made);
    return made;
  };
  /** The held lists of a workspace a delegation belongs in: `everyone`, and `mine` when it names `me`. */
  const heldFor = (workspace: string, me: string, delegation: Pick<DelegationView, 'delegateMemberId' | 'target'>) =>
    [
      lists.get(keyOf(workspace, 'everyone')),
      involves(delegation, me) ? lists.get(keyOf(workspace, 'mine')) : undefined,
    ].filter((each) => each !== undefined);
  const refused = (error: unknown) => {
    deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
    return false;
  };

  return {
    /** A member's time off (spec 0037, AC-1286): held per workspace and member, Availability's Time off section. */
    timeOff,
    /** A member's meeting limits (spec 0037, AC-1299): held per workspace and member, Availability's Limits section. */
    limits,
    /**
     * Colleagues' calendar health (spec 0037, AC-1307 to AC-1309): a status per member, read together per page, hidden
     * outside the reader's See reach; `ask` is Ask to reconnect.
     */
    health,
    /**
     * The Team week (spec 0037, AC-1289 to AC-1296): weeks of the roster held per workspace, week and search; a cell's
     * change shows at once and is put back if refused; Copy week and Set usual hours wait, then the weeks read again.
     */
    teamWeek,
    /**
     * What Availability › Team's loader needs, in this chunk so the first load carries none of it: the week (`date`'s
     * Monday, else this week's in `timeZone`), its first read settled (a failure shows in the screen), and the members
     * in the reader's See reach for "Set usual hours for…".
     */
    async openTeamWeek(workspace: string, date: string | undefined, search: string, timeZone: string) {
      const week = teamWeek.weekOf(date, timeZone);
      const [members] = await Promise.all([
        this.visible(workspace),
        teamWeek
          .held(workspace, week, search)
          .ready()
          .catch(() => undefined),
      ]);
      return { week, members };
    },
    /** A held list of delegations: the member's own both ways, or the workspace's (`members.manage`). */
    delegations: (workspace: string, scope: DelegationsScope): DelegationsHeld => of(workspace, scope).held,
    /**
     * The members in the caller's See reach, the caller first and then by name, each with `canManage` (AC-1261).
     * Read once and shared; an access change, or a write of the caller's, reads it again.
     */
    visible(workspace: string): Promise<readonly VisibleMember[]> {
      const found = visibles.get(workspace);
      if (found !== undefined) return found;
      const reading = deps.api.visible({ workspace }).then((answer) => answer.members);
      visibles.set(workspace, reading);
      reading.catch(() => {
        if (visibles.get(workspace) === reading) visibles.delete(workspace);
      });
      return reading;
    },
    /**
     * See or Manage over someone's scheduling (or everyone's) for one delegate, as `me`: shown at once in every
     * held list it belongs to, put back with a toast if refused. Answers whether it landed.
     */
    async grant(workspace: string, me: string, grant: DelegationGrant): Promise<boolean> {
      const stand = deps.mintId();
      const at = new Date(now()).toISOString();
      const touched = heldFor(workspace, me, grant);
      const before = touched.map((list) => {
        const snapshot = list.held.getSnapshot();
        return snapshot.status === 'ready'
          ? snapshot.delegations.find(
              (each) => each.delegateMemberId === grant.delegateMemberId && sameTarget(each.target, grant.target),
            )
          : undefined;
      });
      for (const list of touched) {
        list.begin();
        list.change((shown) => withGrant(shown, grant, stand, me, at));
      }
      try {
        const saved = await deps.api.grant({ workspace, ...grant });
        // In place, or again when a read meanwhile replaced the list: the saved row is always there.
        for (const list of touched) {
          list.change((shown) => {
            const kept = shown.filter(
              (each) =>
                each.id !== stand &&
                !(each.delegateMemberId === saved.delegateMemberId && sameTarget(each.target, saved.target)),
            );
            const place = shown.findIndex(
              (each) =>
                each.id === stand ||
                (each.delegateMemberId === saved.delegateMemberId && sameTarget(each.target, saved.target)),
            );
            return place < 0 ? [...kept, saved] : [...kept.slice(0, place), saved, ...kept.slice(place)];
          });
        }
        visibles.delete(workspace);
        return true;
      } catch (error) {
        touched.forEach((list, index) => {
          const was = before[index];
          list.change((shown) =>
            was === undefined
              ? shown.filter((each) => each.id !== stand)
              : shown.map((each) => (each.id === was.id ? was : each)),
          );
        });
        return refused(error);
      } finally {
        for (const list of touched) list.end();
      }
    },
    /** Takes a delegation back: gone at once, put back where it was with a toast if refused. */
    async revoke(workspace: string, me: string, delegation: DelegationView): Promise<boolean> {
      const touched = heldFor(workspace, me, delegation);
      const places = touched.map((list) => {
        const snapshot = list.held.getSnapshot();
        return snapshot.status === 'ready' ? snapshot.delegations.findIndex((each) => each.id === delegation.id) : -1;
      });
      for (const list of touched) {
        list.begin();
        list.change((shown) => shown.filter((each) => each.id !== delegation.id));
      }
      try {
        await deps.api.revoke({ workspace, id: delegation.id });
        // Gone, even when a read meanwhile brought it back.
        for (const list of touched) list.change((shown) => shown.filter((each) => each.id !== delegation.id));
        visibles.delete(workspace);
        return true;
      } catch (error) {
        touched.forEach((list, index) => {
          const place = places[index] ?? -1;
          if (place < 0) return;
          list.change((shown) =>
            shown.some((each) => each.id === delegation.id)
              ? shown
              : [...shown.slice(0, place), delegation, ...shown.slice(place)],
          );
        });
        return refused(error);
      } finally {
        for (const list of touched) list.end();
      }
    },
    /** Someone joined, left or changed role: whom the caller reaches is read again when next asked. */
    forgetReach(workspace: string): void {
      visibles.delete(workspace);
    },
    /** The member's reach changed (an `access` row naming them): every held list reads again, `visible` too. */
    reload(workspace: string): void {
      visibles.delete(workspace);
      teamWeek.changed(workspace);
      timeOff.changed(workspace);
      limits.changed(workspace);
      health.changed(workspace);
      for (const [key, list] of lists) if (key.startsWith(`${workspace}\u0000`)) list.reread();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      lists.clear();
      visibles.clear();
      timeOff.clear();
      teamWeek.clear();
      limits.clear();
      health.clear();
    },
  };
}

/** The scheduling access store. */
export type SchedulingAccessStore = ReturnType<typeof createSchedulingAccessStore>;
