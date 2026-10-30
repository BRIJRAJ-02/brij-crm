// Meeting limits (spec 0037, AC-1297 to AC-1299): at most N meetings a day and a week for one member, held per
// workspace and member, the one copy Availability's Limits section reads. It loads in the scheduling access chunk
// (never the first load). A change is optimistic: shown at once, sent, the server's answer put in place (with the
// counts it read), and put back with a toast if refused. Only the latest change's answer lands, so two quick changes
// never end on the older one. A limits write anywhere stores one `time_off` event (limits share time off's, naming
// nothing), which reads every held limits of the workspace again (`changed`). A held one watches its workspace, so the
// section open on its own is live; it also reads again when a screen holds it and the last read is more than a moment
// old (the counts move as meetings are booked, which no event says), and on Try again.
import type { MeetingLimits } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

export type { MeetingLimits } from '@crm/contracts';

/** One member's held limits as a screen reads them. */
export type LimitsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly limits: MeetingLimits };

/** One member's held limits, read when a screen first holds them. */
export interface LimitsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LimitsState;
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure). */
  readonly ready: () => Promise<void>;
  /** Reads them again (Try again). */
  readonly reload: () => void;
}

/** Both limits as they should be; absent is no limit. */
export interface LimitsDraft {
  readonly perDay?: number | undefined;
  readonly perWeek?: number | undefined;
}

/** The calls the store makes (the data layer adds the mutation ids and the read gate). */
export interface LimitsApi {
  readonly get: (input: { readonly workspace: string; readonly memberId?: string }) => Promise<MeetingLimits>;
  readonly set: (
    input: { readonly workspace: string; readonly memberId?: string } & LimitsDraft,
  ) => Promise<MeetingLimits>;
}

/** What the store is made with. */
export interface LimitsDeps {
  readonly api: LimitsApi;
  readonly notify: (notice: Notice) => void;
  /** Watches a workspace's live events while limits of it are held. */
  readonly watch?: (workspace: string) => () => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the loader and the screen it opens hold it together. */
export const LIMITS_FRESH_MS = 1_000;

/** The limits with `draft` laid over them (both replaced: absent is no limit). */
export function withDraft(limits: MeetingLimits, draft: LimitsDraft): MeetingLimits {
  return {
    memberId: limits.memberId,
    today: limits.today,
    thisWeek: limits.thisWeek,
    timeZone: limits.timeZone,
    canChange: limits.canChange,
    ...(limits.changedBy === undefined ? {} : { changedBy: limits.changedBy }),
    ...(draft.perDay === undefined ? {} : { perDay: draft.perDay }),
    ...(draft.perWeek === undefined ? {} : { perWeek: draft.perWeek }),
  };
}

/** Meeting limits held per workspace and member. */
export function createLimitsStore(deps: LimitsDeps) {
  const now = deps.now ?? Date.now;
  const held = new Map<string, ReturnType<typeof make>>();
  const keyOf = (workspace: string, memberId: string | undefined) => `${workspace}\u0000${memberId ?? ''}`;

  function make(workspace: string, memberId: string | undefined) {
    let state: LimitsState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    let readAt: number | undefined;
    let holders = 0;
    let stopWatching: (() => void) | undefined;
    // A read sent before a change would put its older answer over it: it is read again instead. While a change is
    // out, a read's answer waits for it (it may or may not hold the change).
    let version = 0;
    let writing = 0;
    let owed = false;
    const listeners = new Set<() => void>();
    const set = (next: LimitsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<void> => {
      const sentAt = version;
      reading ??= deps.api.get({ workspace, ...(memberId === undefined ? {} : { memberId }) }).then(
        (limits) => {
          reading = undefined;
          if (writing > 0 && state.status === 'ready') {
            owed = true;
            return undefined;
          }
          if (sentAt !== version) return read();
          readAt = now();
          set({ status: 'ready', limits });
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
          holders += 1;
          if (holders === 1) stopWatching = deps.watch?.(workspace);
          if (readAt === undefined || now() - readAt >= LIMITS_FRESH_MS) void read().catch(() => undefined);
          return () => {
            holders -= 1;
            if (holders === 0) {
              stopWatching?.();
              stopWatching = undefined;
            }
          };
        },
        ready: () => (state.status === 'ready' ? Promise.resolve() : read()),
        reload: () => {
          if (state.status === 'error') set({ status: 'loading' });
          void read().catch(() => undefined);
        },
      } satisfies LimitsHeld,
      snapshot: () => state,
      /** Shows `limits` (a change, its answer, or a rollback), and marks reads sent before it as stale. */
      show(limits: MeetingLimits) {
        version += 1;
        set({ status: 'ready', limits });
      },
      begin() {
        writing += 1;
        version += 1;
      },
      end() {
        writing = Math.max(0, writing - 1);
        if (writing === 0 && owed) {
          owed = false;
          void read().catch(() => undefined);
        }
      },
      /** Reads again now while held; else on the next hold. */
      stale() {
        version += 1;
        readAt = undefined;
        if (holders > 0) void read().catch(() => undefined);
      },
    };
  }

  const of = (workspace: string, memberId: string | undefined) => {
    const key = keyOf(workspace, memberId);
    const found = held.get(key);
    if (found !== undefined) return found;
    const made = make(workspace, memberId);
    held.set(key, made);
    return made;
  };
  // Each change's turn per held entry: only the latest one's answer or rollback is shown.
  const turns = new Map<string, number>();

  return {
    /** One member's limits (the caller's own when `memberId` is absent). */
    held: (workspace: string, memberId?: string): LimitsHeld => of(workspace, memberId).held,
    /**
     * Sets both limits (absent is no limit): shown at once, the answer put in place, put back with a toast if refused.
     * Answers whether it landed.
     */
    async set(workspace: string, memberId: string | undefined, draft: LimitsDraft): Promise<boolean> {
      const entry = of(workspace, memberId);
      const key = keyOf(workspace, memberId);
      const shown = entry.snapshot();
      const before = shown.status === 'ready' ? shown.limits : undefined;
      const turn = (turns.get(key) ?? 0) + 1;
      turns.set(key, turn);
      const isLatest = () => turns.get(key) === turn;
      entry.begin();
      if (before !== undefined) entry.show(withDraft(before, draft));
      try {
        const saved = await deps.api.set({
          workspace,
          ...(memberId === undefined ? {} : { memberId }),
          ...(draft.perDay === undefined ? {} : { perDay: draft.perDay }),
          ...(draft.perWeek === undefined ? {} : { perWeek: draft.perWeek }),
        });
        if (isLatest()) entry.show(saved);
        return true;
      } catch (error) {
        if (isLatest() && before !== undefined) entry.show(before);
        deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
        return false;
      } finally {
        entry.end();
      }
    },
    /** Someone's limits changed (a `time_off` event, a resync): every held limits of the workspace read again. */
    changed(workspace: string): void {
      for (const [key, entry] of held) if (key.startsWith(`${workspace}\u0000`)) entry.stale();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      held.clear();
      turns.clear();
    },
  };
}

/** The meeting limits store. */
export type LimitsStore = ReturnType<typeof createLimitsStore>;
