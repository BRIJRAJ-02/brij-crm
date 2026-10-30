// The Team week (spec 0037, job J6, AC-1289 to AC-1296): the roster, held per workspace, week and search, the one copy
// Availability › Team reads. It loads in the scheduling access chunk (never the first load). A week's first page is
// read when a screen first holds it; "Show more" adds the next 50 rows.
//
// A cell's change is optimistic: the cell, its row's hours and the footer change at once in every held week showing
// that member and date, the server's answer puts the day and the schedule's version in place, and a refusal puts
// them back with a toast (a STALE one reads the week again). Copy week and Set usual hours wait for the server, then
// read the workspace's held weeks again. A `schedules` event (anyone's save, spec 0035) reads every held week of the
// workspace again; time off has no event of its own, so a week held again after a moment reads again too.
import type {
  BulkHoursResult,
  DayHours,
  SetDayResult,
  TeamWeek,
  TeamWeekDay,
  TeamWeekRow,
  WeeklyHours,
} from '@crm/contracts';
import { footerOf, mondayOf, weekDates, weekMinutesOf } from '@crm/contracts/roster';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

export type {
  DayHours,
  TeamWeek,
  TeamWeekDay,
  TeamWeekRow,
  TeamWeekSource,
  TeamWeekTotal,
  WeeklyHours,
} from '@crm/contracts';

/** One held week as a screen reads it. `more` is the next page's state while one was asked for. */
export type TeamWeekState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | {
      readonly status: 'ready';
      readonly week: TeamWeek;
      readonly more: 'idle' | 'loading' | 'failed';
    };

/** One held week, read when a screen first holds it. */
export interface TeamWeekHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TeamWeekState;
  readonly retain: () => () => void;
  /** For a route loader: settles once a first read did (rejecting with its failure). */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
  /** Reads the next 50 rows onto it ("Show more"). */
  readonly more: () => void;
}

/** The calls the store makes (the data layer adds the mutation ids and the read gate). */
export interface TeamWeekApi {
  readonly read: (input: {
    readonly workspace: string;
    readonly weekStart: string;
    readonly search?: string;
    readonly cursor?: string;
  }) => Promise<TeamWeek>;
  readonly setDay: (input: {
    readonly workspace: string;
    readonly memberId: string;
    readonly date: string;
    readonly hours: DayHours;
    readonly updatedAt: string | null;
  }) => Promise<SetDayResult>;
  readonly copyWeek: (input: {
    readonly workspace: string;
    readonly memberIds: readonly string[];
    readonly fromWeekStart: string;
    readonly toWeekStart: string;
  }) => Promise<BulkHoursResult>;
  readonly setUsualHours: (input: {
    readonly workspace: string;
    readonly memberIds: readonly string[];
    readonly weekly: WeeklyHours;
  }) => Promise<BulkHoursResult>;
}

/** What the store is made with. */
export interface TeamWeekDeps {
  readonly api: TeamWeekApi;
  readonly notify: (notice: Notice) => void;
  /** Watches a workspace's live events while a week of it is held (the `schedules` event reaches `changed`). */
  readonly watch?: (workspace: string) => () => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the loader and the screen it opens hold it together. */
export const TEAM_WEEK_FRESH_MS = 1_000;

/** A cell as one change leaves it (pure): its own ranges, Off, or its usual hours back. */
export function dayWith(day: TeamWeekDay, hours: DayHours): TeamWeekDay {
  if (hours === 'usual') return { ...day, ranges: day.usual, source: 'usual' };
  return { ...day, ranges: hours === 'off' ? [] : hours.map(([start, end]) => [start, end]), source: 'override' };
}

/** The week with `memberId`'s cell on `date` replaced (and that row's hours and the footer counted again). */
export function weekWith(
  week: TeamWeek,
  memberId: string,
  date: string,
  change: (day: TeamWeekDay) => TeamWeekDay,
  schedule?: TeamWeekRow['schedule'],
): TeamWeek {
  if (!week.rows.some((row) => row.memberId === memberId && row.days.some((day) => day.date === date))) return week;
  const rows = week.rows.map((row) => {
    if (row.memberId !== memberId) return row;
    const days = row.days.map((day) => (day.date === date ? change(day) : day));
    return { ...row, days, weekMinutes: weekMinutesOf(days), ...(schedule === undefined ? {} : { schedule }) };
  });
  return { ...week, rows, footer: footerOf(weekDates(week.weekStart), rows) };
}

/** The roster's weeks held per workspace, week and search. */
export function createTeamWeekStore(deps: TeamWeekDeps) {
  const now = deps.now ?? Date.now;
  const weeks = new Map<string, ReturnType<typeof make>>();
  const keyOf = (workspace: string, weekStart: string, search: string) =>
    `${workspace}\u0000${weekStart}\u0000${search}`;

  function make(workspace: string, weekStart: string, search: string) {
    let state: TeamWeekState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    let readAt: number | undefined;
    let holders = 0;
    let stopWatching: (() => void) | undefined;
    // A read sent before a write landed would put its older answer over the write: it is read again instead.
    let version = 0;
    // Rows held past the first page: a read again asks for as many pages as were shown.
    let pages = 1;
    const listeners = new Set<() => void>();
    const set = (next: TeamWeekState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const page = (cursor?: string) =>
      deps.api.read({
        workspace,
        weekStart,
        ...(search === '' ? {} : { search }),
        ...(cursor === undefined ? {} : { cursor }),
      });
    const read = (): Promise<void> => {
      const sentAt = version;
      reading ??= (async () => {
        let week = await page();
        // As many pages as were shown, so Show more's rows stay after a read again.
        for (let index = 1; index < pages && week.nextCursor !== undefined; index += 1) {
          const next = await page(week.nextCursor);
          const rows = [...week.rows, ...next.rows];
          week = { ...next, rows, footer: footerOf(weekDates(weekStart), rows) };
        }
        return week;
      })().then(
        (week) => {
          reading = undefined;
          if (sentAt !== version) return read();
          readAt = now();
          // A read is the server's truth: each member's next cell sends the version it carries.
          for (const each of week.rows) versions.delete(`${workspace}\u0000${each.memberId}`);
          set({ status: 'ready', week, more: 'idle' });
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
          if (readAt === undefined || now() - readAt >= TEAM_WEEK_FRESH_MS) void read().catch(() => undefined);
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
        more() {
          if (state.status !== 'ready' || state.more === 'loading') return;
          const cursor = state.week.nextCursor;
          if (cursor === undefined) return;
          const sentAt = version;
          set({ ...state, more: 'loading' });
          page(cursor).then(
            (next) => {
              if (state.status !== 'ready') return;
              if (sentAt !== version) {
                set({ ...state, more: 'idle' });
                return;
              }
              pages += 1;
              const rows = [...state.week.rows, ...next.rows];
              set({
                status: 'ready',
                more: 'idle',
                week: { ...next, rows, footer: footerOf(weekDates(weekStart), rows) },
              });
            },
            () => {
              if (state.status === 'ready') set({ ...state, more: 'failed' });
            },
          );
        },
      } satisfies TeamWeekHeld,
      isHeld: () => holders > 0,
      /** Lays a change over what is shown, and marks reads sent before it as stale. */
      change(next: (week: TeamWeek) => TeamWeek) {
        version += 1;
        if (state.status === 'ready') set({ ...state, week: next(state.week) });
      },
      /** Reads again now while held; else on the next hold. */
      stale() {
        version += 1;
        readAt = undefined;
        if (holders > 0) void read().catch(() => undefined);
      },
    };
  }

  const of = (workspace: string, weekStart: string, search: string) => {
    const key = keyOf(workspace, weekStart, search);
    const found = weeks.get(key);
    if (found !== undefined) return found;
    const made = make(workspace, weekStart, search);
    weeks.set(key, made);
    return made;
  };
  // Per member: the cell writes still going out (one after another) and the schedule version the last one answered.
  const chains = new Map<string, Promise<void>>();
  const versions = new Map<string, string | null>();
  const inWorkspace = (workspace: string) =>
    [...weeks].filter(([key]) => key.startsWith(`${workspace}\u0000`)).map(([, week]) => week);
  const shown = (week: ReturnType<typeof make>): TeamWeek | undefined => {
    const snapshot = week.held.getSnapshot();
    return snapshot.status === 'ready' ? snapshot.week : undefined;
  };

  return {
    /** The Monday of `date`'s week, or with none this week's in `timeZone` (the reader's): the week a screen opens. */
    weekOf(date: string | undefined, timeZone: string): string {
      if (date !== undefined) return mondayOf(date);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(now()));
      const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
      return mondayOf(`${part('year')}-${part('month')}-${part('day')}`);
    },
    /** One week of the roster (its Monday), searched by name ('' for everyone). */
    held: (workspace: string, weekStart: string, search = ''): TeamWeekHeld =>
      of(workspace, weekStart, search.trim()).held,
    /**
     * One cell's change (AC-1291): at once in every held week showing that member and date, then the answer's day and
     * version; put back with a toast if refused. Answers whether it landed.
     */
    async setDay(
      workspace: string,
      row: Pick<TeamWeekRow, 'memberId' | 'schedule'>,
      date: string,
      hours: DayHours,
    ): Promise<boolean> {
      const member = `${workspace}\u0000${row.memberId}`;
      const holding = (week: ReturnType<typeof make>) =>
        shown(week)?.rows.some((each) => each.memberId === row.memberId) === true;
      const touched = inWorkspace(workspace).filter(holding);
      const before = touched.map((week) =>
        shown(week)
          ?.rows.find((each) => each.memberId === row.memberId)
          ?.days.find((day) => day.date === date),
      );
      const mine = new Map<ReturnType<typeof make>, TeamWeekDay>();
      for (const week of touched) {
        week.change((held) => {
          const next = weekWith(held, row.memberId, date, (day) => dayWith(day, hours));
          const day = next.rows.find((each) => each.memberId === row.memberId)?.days.find((each) => each.date === date);
          if (day !== undefined) mine.set(week, day);
          return next;
        });
      }
      // One member's cells go out one after another, each with the version the last one answered, so a quick second
      // edit along a row is never refused as stale by the first.
      const previous = chains.get(member) ?? Promise.resolve();
      const sending = previous.then(async () => {
        // The version last answered, else the one the newest held row carries, else the screen's.
        const held = inWorkspace(workspace)
          .map((week) => shown(week)?.rows.find((each) => each.memberId === row.memberId))
          .find((each) => each !== undefined);
        const updatedAt = versions.has(member)
          ? (versions.get(member) ?? null)
          : (held?.schedule.updatedAt ?? row.schedule.updatedAt);
        return deps.api.setDay({ workspace, memberId: row.memberId, date, hours, updatedAt });
      });
      const settled = sending.then(
        () => undefined,
        () => undefined,
      );
      chains.set(member, settled);
      try {
        const saved = await sending;
        versions.set(member, saved.schedule.updatedAt);
        // Every held week showing the member takes the new version, so their next cell isn't stale.
        for (const week of inWorkspace(workspace).filter(holding)) {
          week.change((held) => {
            const placed = weekWith(held, row.memberId, date, () => saved.day);
            return {
              ...placed,
              rows: placed.rows.map((each) =>
                each.memberId === row.memberId ? { ...each, schedule: saved.schedule } : each,
              ),
            };
          });
        }
        return true;
      } catch (error) {
        const failure = toDataError(error);
        touched.forEach((week, index) => {
          const was = before[index];
          const shownNow = shown(week)
            ?.rows.find((each) => each.memberId === row.memberId)
            ?.days.find((day) => day.date === date);
          // Only while the cell still shows this change: a later edit of it stays.
          if (was !== undefined && shownNow === mine.get(week)) {
            week.change((held) => weekWith(held, row.memberId, date, () => was));
          }
        });
        // Someone changed their hours meanwhile: what is shown reads again, and the next edit sends what it reads.
        if (failure.code === 'STALE' || failure.code === 'NOT_FOUND') {
          versions.delete(member);
          for (const week of touched) week.stale();
        }
        deps.notify({ tone: 'danger', message: refusalSummary(failure) });
        return false;
      } finally {
        if (chains.get(member) === settled) chains.delete(member);
      }
    },
    /**
     * Copies a week's days onto another for each member (AC-1292). Waits for the server, then the workspace's held
     * weeks read again. Rejects with the refusal.
     */
    async copyWeek(
      workspace: string,
      input: { readonly memberIds: readonly string[]; readonly fromWeekStart: string; readonly toWeekStart: string },
    ): Promise<number> {
      try {
        const done = await deps.api.copyWeek({ workspace, ...input });
        for (const week of inWorkspace(workspace)) week.stale();
        return done.changed;
      } catch (error) {
        throw toDataError(error);
      }
    },
    /** One week of usual hours for each member (AC-1292). Waits for the server, then the held weeks read again. */
    async setUsualHours(
      workspace: string,
      input: { readonly memberIds: readonly string[]; readonly weekly: WeeklyHours },
    ): Promise<number> {
      try {
        const done = await deps.api.setUsualHours({ workspace, ...input });
        for (const week of inWorkspace(workspace)) week.stale();
        return done.changed;
      } catch (error) {
        throw toDataError(error);
      }
    },
    /** Someone's schedules or time off changed (a `schedules` event, a resync): the held weeks read again. */
    changed(workspace: string): void {
      for (const week of inWorkspace(workspace)) week.stale();
    },
    /** Signed out: forgets every workspace's. */
    clear(): void {
      weeks.clear();
      chains.clear();
      versions.clear();
    },
  };
}

/** The Team week store. */
export type TeamWeekStore = ReturnType<typeof createTeamWeekStore>;
