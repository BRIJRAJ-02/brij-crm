// Calendar health for teams (spec 0037, AC-1307 to AC-1309, AC-1315): each colleague's calendar status as a chip,
// held per workspace and member, the one copy the Members page, the Team week and the rotations read. It loads in the
// scheduling access chunk (never the first load). A screen holds one member per chip; the store gathers every member
// asked for in the same task into one `calendar.health` read (50 at most a call), so a page of rows is one call. A
// member the server leaves out is outside the reader's See reach: `hidden`, never an error. Nothing in a status names
// an account, a calendar or an error (the server sends none). There is no live event for a colleague's calendar, so a
// held status reads again when a screen holds it after a minute, when the tab is shown again, and when the reader's
// reach changes. "Ask to reconnect" waits for the server (it sends an email, nothing to show early), says how it
// went in a toast, and marks the member asked for the rest of the tab's life so the action steps aside.
import type { CalendarHealth, MemberCalendarHealth } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

/** The most members one read asks about: the contract's `MAX_HEALTH_MEMBERS`, kept here so no schema loads. */
const READ_MAX = 50;

export type { CalendarHealthStatus, MemberCalendarHealth } from '@crm/contracts';

/** One member's calendar health as a chip reads it. */
export type CalendarHealthState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  /** Outside the reader's See reach: the chip says Hidden, or nothing. */
  | { readonly status: 'hidden' }
  | { readonly status: 'ready'; readonly health: MemberCalendarHealth; readonly asked: boolean };

/** One member's held health. */
export interface CalendarHealthHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CalendarHealthState;
  readonly retain: () => () => void;
}

/** The calls the store makes (the data layer adds the mutation id and the read gate). */
export interface CalendarHealthApi {
  readonly read: (input: {
    readonly workspace: string;
    readonly memberIds: readonly string[];
  }) => Promise<CalendarHealth>;
  readonly ask: (input: { readonly workspace: string; readonly memberId: string }) => Promise<unknown>;
}

/** What the store is made with. */
export interface CalendarHealthDeps {
  readonly api: CalendarHealthApi;
  readonly notify: (notice: Notice) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  /** Runs the gathered reads once the task that asked ends; tests pass their own. */
  readonly schedule?: (run: () => void) => void;
}

/** A status this recent serves a new holder as it is; older, it is read again behind what shows. */
export const HEALTH_FRESH_MS = 60_000;

/** Calendar health held per workspace and member. */
export function createCalendarHealthStore(deps: CalendarHealthDeps) {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((run: () => void) => queueMicrotask(run));
  const keyOf = (workspace: string, memberId: string) => `${workspace}\u0000${memberId}`;
  const held = new Map<string, ReturnType<typeof make>>();
  const asked = new Set<string>();
  // Members to read, per workspace, gathered until the asking task ends.
  const wanted = new Map<string, Set<string>>();
  let flushing = false;

  function make(workspace: string, memberId: string) {
    let state: CalendarHealthState = { status: 'loading' };
    let readAt: number | undefined;
    let holders = 0;
    const listeners = new Set<() => void>();
    const set = (next: CalendarHealthState) => {
      state = next;
      for (const listener of listeners) listener();
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
          if (readAt === undefined || now() - readAt >= HEALTH_FRESH_MS) want(workspace, memberId);
          return () => {
            holders -= 1;
          };
        },
      } satisfies CalendarHealthHeld,
      isHeld: () => holders > 0,
      answered(health: MemberCalendarHealth | undefined) {
        readAt = now();
        set(
          health === undefined
            ? { status: 'hidden' }
            : { status: 'ready', health, asked: asked.has(keyOf(workspace, memberId)) },
        );
      },
      failed(error: DataError) {
        // A failed read keeps what shows; only a first read shows the failure.
        if (state.status === 'loading') set({ status: 'error', error });
      },
      markAsked() {
        if (state.status === 'ready') set({ ...state, asked: true });
      },
      stale() {
        readAt = undefined;
        if (holders > 0) want(workspace, memberId);
      },
    };
  }

  const entry = (workspace: string, memberId: string) => {
    const key = keyOf(workspace, memberId);
    const found = held.get(key);
    if (found !== undefined) return found;
    const made = make(workspace, memberId);
    held.set(key, made);
    return made;
  };

  function want(workspace: string, memberId: string): void {
    const ids = wanted.get(workspace) ?? new Set<string>();
    ids.add(memberId);
    wanted.set(workspace, ids);
    if (flushing) return;
    flushing = true;
    schedule(flush);
  }

  function flush(): void {
    flushing = false;
    const batches = [...wanted];
    wanted.clear();
    for (const [workspace, ids] of batches) {
      const all = [...ids];
      for (let start = 0; start < all.length; start += READ_MAX) {
        const memberIds = all.slice(start, start + READ_MAX);
        deps.api.read({ workspace, memberIds }).then(
          (answer) => {
            const byMember = new Map(answer.members.map((each) => [each.memberId, each]));
            for (const memberId of memberIds) entry(workspace, memberId).answered(byMember.get(memberId));
          },
          (error: unknown) => {
            const failure = toDataError(error);
            for (const memberId of memberIds) entry(workspace, memberId).failed(failure);
          },
        );
      }
    }
  }

  return {
    /** One member's calendar health (AC-1307): a status and since when, or hidden outside the reader's reach. */
    held: (workspace: string, memberId: string): CalendarHealthHeld => entry(workspace, memberId).held,
    /**
     * Ask to reconnect (AC-1309): emails the member, naming the reader. Waits for the server; says how it went in a
     * toast (`asked` with the member's name, or the refusal: once a day, 429 with the wait). Answers whether it went.
     */
    async ask(workspace: string, memberId: string, words: { readonly asked: string }): Promise<boolean> {
      try {
        await deps.api.ask({ workspace, memberId });
        asked.add(keyOf(workspace, memberId));
        entry(workspace, memberId).markAsked();
        deps.notify({ tone: 'success', message: words.asked });
        return true;
      } catch (error) {
        const failure = toDataError(error);
        // Asked already today (by anyone): the action steps aside here too.
        if (failure.code === 'RATE_LIMITED') {
          asked.add(keyOf(workspace, memberId));
          entry(workspace, memberId).markAsked();
        }
        // Working again since it showed: the chip reads again.
        if (failure.code === 'STALE') entry(workspace, memberId).stale();
        deps.notify({ tone: 'danger', message: refusalSummary(failure) });
        return false;
      }
    },
    /** The reader's reach changed (an `access` event naming them): every held status of the workspace reads again. */
    changed(workspace: string): void {
      for (const [key, each] of held) if (key.startsWith(`${workspace}\u0000`)) each.stale();
    },
    /** The tab is shown again: what is held reads again, since no event says a colleague's calendar broke. */
    shown(): void {
      for (const each of held.values()) if (each.isHeld()) each.stale();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      held.clear();
      asked.clear();
      wanted.clear();
    },
  };
}

/** The calendar health store. */
export type CalendarHealthStore = ReturnType<typeof createCalendarHealthStore>;
