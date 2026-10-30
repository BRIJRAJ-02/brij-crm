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

/** Whether two answers say the same: a read that changed nothing keeps the shown object, so nothing re-renders. */
function sameHealth(a: MemberCalendarHealth, b: MemberCalendarHealth): boolean {
  return a.memberId === b.memberId && a.status === b.status && a.since === b.since;
}

/** Calendar health held per workspace and member. */
export function createCalendarHealthStore(deps: CalendarHealthDeps) {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((run: () => void) => queueMicrotask(run));
  const keyOf = (workspace: string, memberId: string) => `${workspace}\u0000${memberId}`;
  const held = new Map<string, ReturnType<typeof make>>();
  // Members asked to reconnect in this tab, or found asked today: the action steps aside.
  const asked = new Set<string>();
  // Members to read, per workspace, gathered until the asking task ends.
  const wanted = new Map<string, Set<string>>();
  let flushing = false;
  // Bumped by a sign out: an answer to a read sent before it lands nowhere.
  let generation = 0;

  function make(workspace: string, memberId: string) {
    let state: CalendarHealthState = { status: 'loading' };
    let readAt: number | undefined;
    let holders = 0;
    // The latest read asked for; an older read's answer is dropped. A read out is never asked for twice.
    let turn = 0;
    let reading = false;
    // Marked stale while a read was out (a reach change): that answer may predate it, so one more read follows.
    let owed = false;
    const listeners = new Set<() => void>();
    const set = (next: CalendarHealthState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const isAsked = () => asked.has(keyOf(workspace, memberId));
    const self = {
      held: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => state,
        retain() {
          holders += 1;
          if (!reading && (readAt === undefined || now() - readAt >= HEALTH_FRESH_MS)) self.want();
          return () => {
            holders -= 1;
          };
        },
      } satisfies CalendarHealthHeld,
      isHeld: () => holders > 0,
      /** Asks for a read; answers the turn it will carry. */
      want() {
        turn += 1;
        reading = true;
        want(workspace, memberId);
      },
      turn: () => turn,
      answered(health: MemberCalendarHealth | undefined, of: number) {
        if (of !== turn) return;
        reading = false;
        readAt = now();
        if (owed) {
          owed = false;
          self.want();
        }
        if (health === undefined) {
          if (state.status !== 'hidden') set({ status: 'hidden' });
          return;
        }
        if (state.status === 'ready' && sameHealth(state.health, health) && state.asked === isAsked()) return;
        set({ status: 'ready', health, asked: isAsked() });
      },
      failed(error: DataError, of: number) {
        if (of !== turn) return;
        reading = false;
        if (owed) {
          owed = false;
          self.want();
        }
        // A failed read keeps what shows; only a first read shows the failure.
        if (state.status === 'loading') set({ status: 'error', error });
      },
      /** Shows whether the member is asked, as `asked` now holds it. */
      showAsked() {
        if (state.status === 'ready' && state.asked !== isAsked()) set({ ...state, asked: isAsked() });
      },
      stale() {
        readAt = undefined;
        if (holders === 0) return;
        if (reading) owed = true;
        else self.want();
      },
    };
    return self;
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
    const sentIn = generation;
    for (const [workspace, ids] of batches) {
      const all = [...ids];
      for (let start = 0; start < all.length; start += READ_MAX) {
        const memberIds = all.slice(start, start + READ_MAX);
        // Each member's turn as it was sent, so a read sent before a newer one never lands over it.
        const turns = new Map(memberIds.map((memberId) => [memberId, entry(workspace, memberId).turn()]));
        const each = (memberId: string) => (sentIn === generation ? held.get(keyOf(workspace, memberId)) : undefined);
        deps.api.read({ workspace, memberIds }).then(
          (answer) => {
            const byMember = new Map(answer.members.map((one) => [one.memberId, one]));
            for (const memberId of memberIds) {
              each(memberId)?.answered(byMember.get(memberId), turns.get(memberId) ?? 0);
            }
          },
          (error: unknown) => {
            const failure = toDataError(error);
            for (const memberId of memberIds) each(memberId)?.failed(failure, turns.get(memberId) ?? 0);
          },
        );
      }
    }
  }

  return {
    /** One member's calendar health (AC-1307): a status and since when, or hidden outside the reader's reach. */
    held: (workspace: string, memberId: string): CalendarHealthHeld => entry(workspace, memberId).held,
    /**
     * Ask to reconnect (AC-1309): emails the member, naming the reader. The action steps aside at once, so a second
     * press sends nothing; it comes back if the server refuses for any reason but "asked already today". Says how it
     * went in a toast: `asked` with the member's name, the server's wait when someone asked today (not an error: what
     * the reader wanted has happened), or the refusal. Answers whether this press sent it.
     */
    async ask(workspace: string, memberId: string, words: { readonly asked: string }): Promise<boolean> {
      const key = keyOf(workspace, memberId);
      if (asked.has(key)) return false;
      asked.add(key);
      entry(workspace, memberId).showAsked();
      try {
        await deps.api.ask({ workspace, memberId });
        deps.notify({ tone: 'success', message: words.asked });
        return true;
      } catch (error) {
        const failure = toDataError(error);
        if (failure.code === 'RATE_LIMITED') {
          deps.notify({ tone: 'success', message: refusalSummary(failure) });
          return false;
        }
        asked.delete(key);
        held.get(key)?.showAsked();
        // Working again since it showed: the chip reads again.
        if (failure.code === 'STALE') held.get(key)?.stale();
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
    /** Signed out: forgets every workspace's, and drops any answer still on its way. */
    clear(): void {
      generation += 1;
      held.clear();
      asked.clear();
      wanted.clear();
    },
  };
}

/** The calendar health store. */
export type CalendarHealthStore = ReturnType<typeof createCalendarHealthStore>;
