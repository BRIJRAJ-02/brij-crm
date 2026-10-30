// Time off (spec 0037, AC-1281 to AC-1288): a member's whole days away, held per workspace and member, the one copy
// Availability's Time off section reads. It loads in the scheduling access chunk (never the first load). Add and
// change wait for the server, since its answer carries the meetings already booked inside (the dialog shows them);
// each lands in every held list of that member at once. Delete is optimistic: gone at once, put back with a toast if
// refused. A time off write anywhere stores a coarse `schedules` event (spec 0037), which reads every held list of the
// workspace again (`changed`); a list nobody holds reads when held again. A held list watches its workspace, so the
// Time off section open on its own is live. A list also reads again when a screen holds it and the last read is more
// than a moment old, and on Try again. Each landed write here runs `onChanged`, so this tab's Team week and Bookings
// read again at once (its own event is skipped as an echo).
import type { TimeOffEntry, TimeOffList, TimeOffReason, TimeOffSaved } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

export type { TimeOffBooking, TimeOffEntry, TimeOffList, TimeOffReason, TimeOffSaved } from '@crm/contracts';

/** One member's held time off as a screen reads it. */
export type TimeOffState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly list: TimeOffList };

/** One member's held time off, read when a screen first holds it. */
export interface TimeOffHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TimeOffState;
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure). */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** An entry as the dialog draws it. */
export interface TimeOffDraft {
  readonly fromDate: string;
  readonly toDate: string;
  readonly reason: TimeOffReason;
  readonly note?: string | undefined;
  readonly standinMemberId?: string | undefined;
}

/** The calls the store makes (the data layer adds the mutation ids and the read gate). */
export interface TimeOffApi {
  readonly list: (input: { readonly workspace: string; readonly memberId?: string }) => Promise<TimeOffList>;
  readonly create: (
    input: { readonly workspace: string; readonly id: string; readonly memberId?: string } & TimeOffDraft,
  ) => Promise<TimeOffSaved>;
  readonly update: (
    input: { readonly workspace: string; readonly id: string; readonly updatedAt: string } & TimeOffDraft,
  ) => Promise<TimeOffSaved>;
  readonly remove: (input: { readonly workspace: string; readonly id: string }) => Promise<void>;
}

/** What the store is made with. */
export interface TimeOffDeps {
  readonly api: TimeOffApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** Watches a workspace's live events while a list of it is held (the `schedules` event reaches `changed`). */
  readonly watch?: (workspace: string) => () => void;
  /** A write here landed: what else shows time off (the Team week, Bookings' Host away) reads again. */
  readonly onChanged?: (workspace: string) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the loader and the screen it opens hold it together. */
export const TIME_OFF_FRESH_MS = 1_000;

/** The list with `entry` in place (or added, or with `removedId` gone), upcoming soonest first, past latest first. */
export function withEntry(
  list: TimeOffList,
  entry: TimeOffEntry | undefined,
  removedId: string,
  at: number,
): TimeOffList {
  const all = [...list.upcoming, ...list.past].filter((each) => each.id !== removedId);
  const next = entry === undefined ? all : [...all, entry];
  const ended = (each: TimeOffEntry) => Date.parse(each.endsAt) <= at;
  return {
    ...list,
    upcoming: next
      .filter((each) => !ended(each))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
    past: next.filter(ended).sort((a, b) => b.endsAt.localeCompare(a.endsAt) || a.id.localeCompare(b.id)),
  };
}

/** Time off held per workspace and member. */
export function createTimeOffStore(deps: TimeOffDeps) {
  const now = deps.now ?? Date.now;
  const lists = new Map<string, ReturnType<typeof make>>();
  const keyOf = (workspace: string, memberId: string | undefined) => `${workspace}\u0000${memberId ?? ''}`;

  function make(workspace: string, memberId: string | undefined) {
    let state: TimeOffState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    let readAt: number | undefined;
    let holders = 0;
    let stopWatching: (() => void) | undefined;
    // A read sent before a write landed would put its older answer over the write: it is read again instead.
    let version = 0;
    const listeners = new Set<() => void>();
    const set = (next: TimeOffState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = (): Promise<void> => {
      const sentAt = version;
      reading ??= deps.api.list({ workspace, ...(memberId === undefined ? {} : { memberId }) }).then(
        (list) => {
          reading = undefined;
          if (sentAt !== version) return read();
          readAt = now();
          set({ status: 'ready', list });
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
          if (readAt === undefined || now() - readAt >= TIME_OFF_FRESH_MS) void read().catch(() => undefined);
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
      } satisfies TimeOffHeld,
      /** The member whose time off this holds, once read. */
      memberOf: () => (state.status === 'ready' ? state.list.memberId : undefined),
      /** Lays a change over what is shown, and marks reads sent before it as stale. */
      change(next: (list: TimeOffList) => TimeOffList) {
        version += 1;
        if (state.status === 'ready') set({ status: 'ready', list: next(state.list) });
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
    const found = lists.get(key);
    if (found !== undefined) return found;
    const made = make(workspace, memberId);
    lists.set(key, made);
    return made;
  };
  /** Every held list of the workspace showing `memberId`'s time off (theirs as "mine", or as a colleague's). */
  const heldFor = (workspace: string, memberId: string) =>
    [...lists].filter(([key, list]) => key.startsWith(`${workspace}\u0000`) && list.memberOf() === memberId);
  /** The workspace's lists still on their first read: a write marks them stale, so that read is asked again. */
  const unread = (workspace: string) =>
    [...lists].filter(([key, list]) => key.startsWith(`${workspace}\u0000`) && list.memberOf() === undefined);
  const land = (workspace: string, entry: TimeOffEntry) => {
    for (const [, list] of [...heldFor(workspace, entry.memberId), ...unread(workspace)]) {
      list.change((shown) => withEntry(shown, entry, entry.id, now()));
    }
  };

  return {
    /** A new entry's id: mint it once per Add time off, and send the same one again on a retry. */
    newId: (): string => deps.mintId(),
    /** One member's time off (the caller's own when `memberId` is absent). */
    held: (workspace: string, memberId?: string): TimeOffHeld => of(workspace, memberId).held,
    /**
     * Adds whole days away (the caller's, or `memberId`'s). Waits for the server, whose answer lists the meetings
     * already booked inside; then it is in every held list of that member. Rejects with the refusal.
     */
    async create(
      workspace: string,
      input: { readonly id: string; readonly memberId?: string | undefined } & TimeOffDraft,
    ): Promise<TimeOffSaved> {
      try {
        const saved = await deps.api.create({
          workspace,
          id: input.id,
          ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
          ...draftOf(input),
        });
        land(workspace, saved.entry);
        deps.onChanged?.(workspace);
        return saved;
      } catch (error) {
        throw toDataError(error);
      }
    },
    /** Changes an entry, checked against the version shown (409 STALE when someone changed it meanwhile). */
    async update(workspace: string, entry: TimeOffEntry, draft: TimeOffDraft): Promise<TimeOffSaved> {
      try {
        const saved = await deps.api.update({ workspace, id: entry.id, updatedAt: entry.updatedAt, ...draftOf(draft) });
        land(workspace, saved.entry);
        deps.onChanged?.(workspace);
        return saved;
      } catch (error) {
        const failure = toDataError(error);
        // Someone changed or removed it meanwhile: what is shown reads again.
        if (failure.code === 'STALE' || failure.code === 'NOT_FOUND') {
          for (const [key, list] of lists) if (key.startsWith(`${workspace}\u0000`)) list.held.reload();
        }
        throw failure;
      }
    },
    /** Removes an entry: gone at once, put back where it was with a toast if refused. Answers whether it landed. */
    async remove(workspace: string, entry: TimeOffEntry): Promise<boolean> {
      const touched = [...heldFor(workspace, entry.memberId), ...unread(workspace)].map(([, list]) => list);
      for (const list of touched) list.change((shown) => withEntry(shown, undefined, entry.id, now()));
      try {
        await deps.api.remove({ workspace, id: entry.id });
        deps.onChanged?.(workspace);
        return true;
      } catch (error) {
        for (const list of touched) list.change((shown) => withEntry(shown, entry, entry.id, now()));
        deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
        return false;
      }
    },
    /** Someone's time off changed (a `schedules` event, a resync): every held list of the workspace reads again. */
    changed(workspace: string): void {
      for (const [key, list] of lists) if (key.startsWith(`${workspace}\u0000`)) list.stale();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      lists.clear();
    },
  };
}

/** The draft's fields as the API takes them: a blank note and no stand in are left out. */
function draftOf(draft: TimeOffDraft): TimeOffDraft {
  const note = draft.note?.trim() ?? '';
  return {
    fromDate: draft.fromDate,
    toDate: draft.toDate,
    reason: draft.reason,
    ...(note === '' ? {} : { note }),
    ...(draft.standinMemberId === undefined ? {} : { standinMemberId: draft.standinMemberId }),
  };
}

/** The time off store. */
export type TimeOffStore = ReturnType<typeof createTimeOffStore>;
