// A member's calendar connections (spec 0024, Settings › Calendar): one held
// list per workspace, read while a screen retains it. Changing the sharing
// level or the default shows at once and is sent; a refusal puts it back with
// a toast. A disconnect leaves the list at once the same way. A connection
// still `syncing` its first window has no change event of its own to say when
// it is done, so while one is syncing and a screen shows the list, the list is
// read again every 5 seconds, for at most 5 minutes (a first sync takes at
// most 2, AC-601). Connecting itself is the browser going to the API's start
// address (`connectUrl`), never a call from here.
//
// Milestone 2 adds the workspace's calendar settings (one held value per
// workspace: making people for unknown attendees, changed at once and put
// back with a toast when refused) and Add as person, which waits for the
// server (it makes a record whose id the server chooses) and lets the
// `meetings` event bring the timelines up to date.
import type {
  AddedMeetingAttendee,
  CalendarConnections,
  CalendarConnectionView,
  CalendarSettingsView,
  CalendarSharing,
  RemovedCalendarConnection,
} from '@crm/contracts';
import { refusalSummary, toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

/** The calls the store makes. */
export interface CalendarApi {
  readonly list: (input: { readonly workspace: string }) => Promise<CalendarConnections>;
  readonly update: (input: {
    readonly workspace: string;
    readonly connectionId: string;
    readonly sharing?: CalendarSharing;
    readonly isDefault?: true;
    readonly mutationId: string;
  }) => Promise<CalendarConnectionView>;
  readonly remove: (input: {
    readonly workspace: string;
    readonly connectionId: string;
    readonly mutationId: string;
  }) => Promise<RemovedCalendarConnection>;
  readonly settings: (input: { readonly workspace: string }) => Promise<CalendarSettingsView>;
  readonly updateSettings: (input: {
    readonly workspace: string;
    readonly createUnknownPeople: boolean;
    readonly mutationId: string;
  }) => Promise<CalendarSettingsView>;
  readonly addAttendee: (input: {
    readonly workspace: string;
    readonly recordId: string;
    readonly meetingId: string;
    readonly email: string;
    readonly mutationId: string;
  }) => Promise<AddedMeetingAttendee>;
}

/** What the store needs. */
export interface CalendarDeps {
  readonly api: CalendarApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** Timers, for tests. */
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly now?: () => number;
}

/** Settings › Calendar's state: loading, failed, or the member's connections as the server last said. */
export type CalendarState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & CalendarConnections);

/** One workspace's list, as a screen retains it. */
export interface CalendarView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CalendarState;
  /** Held while a screen shows it: read when first held, and again while a connection syncs. */
  readonly retain: () => () => void;
  /** Settles once the first read did. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again, or a sync that just ended). */
  readonly reload: () => void;
}

/** The workspace's calendar settings as a screen holds them. */
export type CalendarSettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & CalendarSettingsView);

/** One workspace's calendar settings, read when first held. */
export interface CalendarSettingsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CalendarSettingsState;
  readonly retain: () => () => void;
}

/** Whether a connection has stopped until its member acts (AC-619, AC-620): the disconnected banner's test. */
export function needsReconnect(connection: Pick<CalendarConnectionView, 'status'>): boolean {
  return connection.status === 'expired' || connection.status === 'failed' || connection.status === 'revoked';
}

/** How often a list with a syncing connection is read again, and for how long at most. */
export const SYNC_POLL_MS = 5_000;
export const SYNC_POLL_FOR_MS = 5 * 60_000;

/** The address that starts connecting a Google calendar: the browser goes there, the API sends it on to Google. */
export function connectUrl(workspace: string): string {
  return `/api/calendar/google/start?workspace=${encodeURIComponent(workspace)}`;
}

/** The calendar store: every workspace's list, and the member's changes to it. */
export function createCalendarStore(deps: CalendarDeps) {
  const later = deps.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const cancel = deps.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => Date.now());
  const views = new Map<string, ReturnType<typeof makeView>>();

  function makeView(workspace: string) {
    let state: CalendarState = { status: 'loading' };
    let held = 0;
    let reading: Promise<void> | undefined;
    let poll: unknown;
    let pollingSince: number | undefined;
    let settled: Promise<void> | undefined;
    const listeners = new Set<() => void>();
    const tell = () => {
      for (const listener of listeners) listener();
    };
    const set = (next: CalendarState) => {
      state = next;
      tell();
    };

    /** Reads the list again while a connection syncs and a screen shows it, for at most `SYNC_POLL_FOR_MS`. */
    const schedule = () => {
      if (poll !== undefined) cancel(poll);
      poll = undefined;
      const syncing = state.status === 'ready' && state.connections.some((each) => each.status === 'syncing');
      if (!syncing || held === 0) {
        pollingSince = undefined;
        return;
      }
      pollingSince ??= now();
      if (now() - pollingSince > SYNC_POLL_FOR_MS) return;
      poll = later(() => {
        poll = undefined;
        void read();
      }, SYNC_POLL_MS);
    };

    const read = (): Promise<void> => {
      reading ??= deps.api
        .list({ workspace })
        .then(
          (answer) => {
            set({ status: 'ready', ...answer });
          },
          (error: unknown) => {
            // A list already shown stays; only a first read shows the failure.
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = undefined;
          schedule();
        });
      return reading;
    };

    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        held += 1;
        if (state.status !== 'ready' || held === 1) void read();
        return () => {
          held -= 1;
          if (held === 0) schedule();
        };
      },
      ready() {
        settled ??= read();
        return settled;
      },
      reload() {
        void read();
      },
      /** Shows `change` at once on one connection; answers how to put it back. */
      patch(connectionId: string, change: (connection: CalendarConnectionView) => readonly CalendarConnectionView[]) {
        if (state.status !== 'ready') return undefined;
        const before = state;
        set({
          ...state,
          connections: state.connections.flatMap((each) => (each.id === connectionId ? change(each) : [each])),
        });
        return () => {
          set(before);
        };
      },
      /** Shows the default moving to `connectionId`. */
      moveDefault(connectionId: string) {
        if (state.status !== 'ready') return undefined;
        const before = state;
        set({
          ...state,
          connections: state.connections.map((each) => ({ ...each, isDefault: each.id === connectionId })),
        });
        return () => {
          set(before);
        };
      },
      /** Puts the server's answer for one connection in place. */
      landed(view: CalendarConnectionView) {
        if (state.status !== 'ready') return;
        set({ ...state, connections: state.connections.map((each) => (each.id === view.id ? view : each)) });
      },
    };
  }

  const settingsHeld = new Map<string, ReturnType<typeof makeSettings>>();

  function makeSettings(workspace: string) {
    let state: CalendarSettingsState = { status: 'loading' };
    let reading: Promise<void> | undefined;
    const listeners = new Set<() => void>();
    const set = (next: CalendarSettingsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      reading ??= deps.api
        .settings({ workspace })
        .then(
          (answer) => set({ status: 'ready', ...answer }),
          (error: unknown) => {
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        void read();
        return () => undefined;
      },
      set,
    };
  }

  const settingsOf = (workspace: string) => {
    const found = settingsHeld.get(workspace);
    if (found !== undefined) return found;
    const made = makeSettings(workspace);
    settingsHeld.set(workspace, made);
    return made;
  };

  const viewOf = (workspace: string) => {
    const found = views.get(workspace);
    if (found !== undefined) return found;
    const made = makeView(workspace);
    views.set(workspace, made);
    return made;
  };

  /** Tells the person why a change didn't land. */
  const refused = (error: unknown) => {
    deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
  };

  return {
    view: (workspace: string): CalendarView => viewOf(workspace),
    /** The workspace's calendar settings, read when a screen first holds them. */
    settings: (workspace: string): CalendarSettingsHeld => settingsOf(workspace),
    /** Makes people for unknown attendees, or stops (owners and admins): at once, put back with a toast if refused. */
    async setCreateUnknownPeople(workspace: string, createUnknownPeople: boolean): Promise<boolean> {
      const held = settingsOf(workspace);
      const before = held.getSnapshot();
      if (before.status === 'ready') held.set({ ...before, createUnknownPeople });
      try {
        const answer = await deps.api.updateSettings({ workspace, createUnknownPeople, mutationId: deps.mintId() });
        held.set({ status: 'ready', ...answer });
        return true;
      } catch (error) {
        held.set(before);
        refused(error);
        return false;
      }
    },
    /**
     * Adds a meeting's unknown attendee as a person (AC-609). It waits for the
     * server, which makes the record; the `meetings` event then brings every
     * timeline showing the meeting up to date. A refusal is said in a toast.
     * Answers the new person's id, or undefined when it didn't land.
     */
    async addAttendee(
      workspace: string,
      input: { readonly recordId: string; readonly meetingId: string; readonly email: string },
    ): Promise<string | undefined> {
      try {
        const added = await deps.api.addAttendee({ workspace, ...input, mutationId: deps.mintId() });
        return added.recordId;
      } catch (error) {
        refused(error);
        return undefined;
      }
    },
    /** Sets who sees a connection's meetings (AC-611): at once, put back with a toast if refused. */
    async setSharing(workspace: string, connectionId: string, sharing: CalendarSharing): Promise<boolean> {
      const view = viewOf(workspace);
      const undo = view.patch(connectionId, (each) => [{ ...each, sharing }]);
      try {
        view.landed(await deps.api.update({ workspace, connectionId, sharing, mutationId: deps.mintId() }));
        return true;
      } catch (error) {
        undo?.();
        refused(error);
        return false;
      }
    },
    /** Makes a connection the member's default (where booking writes events): at once, put back if refused. */
    async makeDefault(workspace: string, connectionId: string): Promise<boolean> {
      const view = viewOf(workspace);
      const undo = view.moveDefault(connectionId);
      try {
        view.landed(await deps.api.update({ workspace, connectionId, isDefault: true, mutationId: deps.mintId() }));
        view.reload();
        return true;
      } catch (error) {
        undo?.();
        refused(error);
        return false;
      }
    },
    /** Disconnects a connection (AC-599): gone from the list at once, back with a toast if refused. */
    async remove(workspace: string, connectionId: string): Promise<boolean> {
      const view = viewOf(workspace);
      const undo = view.patch(connectionId, () => []);
      try {
        await deps.api.remove({ workspace, connectionId, mutationId: deps.mintId() });
        // The default may have moved to another connection.
        view.reload();
        return true;
      } catch (error) {
        undo?.();
        refused(error);
        return false;
      }
    },
  };
}

/** The calendar store. */
export type CalendarStore = ReturnType<typeof createCalendarStore>;
