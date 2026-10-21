// Each calendar of a member's accounts (spec 0024 milestone 5): one held list
// per workspace (the accounts, their calendars with three switches and a hue,
// and where new bookings go), and one held "Add events to" per booking page.
// Read while a screen retains them. A switch, a colour, the destination and a
// page's own destination show at once and are sent; a refusal puts them back
// with a toast. Showing or hiding a calendar on the week asks the week to be
// read again once it lands (`onShownChange`), since only shown calendars'
// events come back.
import type {
  CalendarDestination,
  CalendarList,
  CalendarView as CalendarItem,
  Hue,
  PageDestinationView,
} from '@crm/contracts';
import { refusalSummary, toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

/** The calls the store makes. */
export interface CalendarsApi {
  readonly list: (input: { readonly workspace: string }) => Promise<CalendarList>;
  readonly update: (
    input: { readonly workspace: string; readonly calendarId: string; readonly mutationId: string } & CalendarChange,
  ) => Promise<CalendarItem>;
  readonly setDestination: (input: {
    readonly workspace: string;
    readonly calendarId: string;
    readonly mutationId: string;
  }) => Promise<CalendarDestination>;
  readonly dismissNotice: (input: {
    readonly workspace: string;
    readonly mutationId: string;
  }) => Promise<CalendarDestination>;
  readonly pageDestination: (input: {
    readonly workspace: string;
    readonly pageId: string;
  }) => Promise<PageDestinationView>;
  readonly setPageDestination: (input: {
    readonly workspace: string;
    readonly pageId: string;
    readonly calendarId: string | null;
    readonly mutationId: string;
  }) => Promise<PageDestinationView>;
}

/** A change to one calendar: any of its three switches, and its colour (`null` goes back to the provider's). */
export interface CalendarChange {
  readonly checkConflicts?: boolean;
  readonly showInWeek?: boolean;
  readonly sync?: boolean;
  readonly colourOverride?: Hue | null;
}

/** What the store needs. */
export interface CalendarsDeps {
  readonly api: CalendarsApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** A calendar was shown on or hidden from the week, and the server has it: the week reads again. */
  readonly onShownChange?: (workspace: string) => void;
}

/** A held read's state: loading, failed, or what the server last said. */
export type CalendarsHeldState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | ({ readonly status: 'ready' } & T);

/** The member's accounts and calendars, as a screen holds them. */
export type CalendarListState = CalendarsHeldState<CalendarList>;

/** A booking page's own "Add events to", as a screen holds it (under `destination`: it has a `status` of its own). */
export type PageDestinationState = CalendarsHeldState<{ readonly destination: PageDestinationView }>;

/** A held read, as a screen retains it: read when first held. */
export interface CalendarsHeld<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** The calendars store: each workspace's calendar list, each page's destination, and the member's changes. */
export function createCalendarsStore(deps: CalendarsDeps) {
  function makeHeld<T extends object>(load: () => Promise<T>) {
    let state: CalendarsHeldState<T> = { status: 'loading' };
    let reading: Promise<void> | undefined;
    const listeners = new Set<() => void>();
    const set = (next: CalendarsHeldState<T>) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      reading ??= load()
        .then(
          (answer) => set({ status: 'ready', ...answer }),
          (error: unknown) => {
            // A list already shown stays; only a first read shows the failure.
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
      reload() {
        void read();
      },
      /** Shows `edit` at once (a ready state only); answers how to put it back while nothing newer landed. */
      patch(edit: (shown: T) => T): () => void {
        if (state.status !== 'ready') return () => undefined;
        const before = state;
        // `edit` answers the whole value (a key it leaves out goes: the fallback notice put away).
        const patched: CalendarsHeldState<T> = { ...edit(before), status: 'ready' };
        set(patched);
        return () => {
          if (state === patched) set(before);
        };
      },
    };
  }

  const lists = new Map<string, ReturnType<typeof makeHeld<CalendarList>>>();
  const pages = new Map<string, ReturnType<typeof makeHeld<{ readonly destination: PageDestinationView }>>>();

  const listOf = (workspace: string) => {
    const found = lists.get(workspace);
    if (found !== undefined) return found;
    const made = makeHeld(() => deps.api.list({ workspace }));
    lists.set(workspace, made);
    return made;
  };

  const pageOf = (workspace: string, pageId: string) => {
    const key = `${workspace}:${pageId}`;
    const found = pages.get(key);
    if (found !== undefined) return found;
    const made = makeHeld(async () => ({ destination: await deps.api.pageDestination({ workspace, pageId }) }));
    pages.set(key, made);
    return made;
  };

  /** Every calendar of the list, changed by `edit` where `calendarId` matches. */
  const mapCalendars = (list: CalendarList, edit: (calendar: CalendarItem) => CalendarItem): CalendarList => ({
    ...list,
    accounts: list.accounts.map((account) => ({ ...account, calendars: account.calendars.map(edit) })),
  });

  /** Tells the person why a change didn't land. */
  const refused = (error: unknown) => {
    deps.notify({ tone: 'danger', message: refusalSummary(toDataError(error)) });
  };

  return {
    /** Forgets every list and page destination (signed out): the next person's start from nothing. */
    clear(): void {
      lists.clear();
      pages.clear();
    },
    /** The member's accounts and calendars in a workspace, read when a screen first holds them. */
    list: (workspace: string): CalendarsHeld<CalendarListState> => listOf(workspace),
    /** A booking page's own "Add events to", read when a screen first holds it. */
    pageDestination: (workspace: string, pageId: string): CalendarsHeld<PageDestinationState> =>
      pageOf(workspace, pageId),
    /** Changes one calendar's switches or colour: at once, put back with a toast if refused. Answers whether it landed. */
    async update(workspace: string, calendarId: string, change: CalendarChange): Promise<boolean> {
      const held = listOf(workspace);
      const undo = held.patch((list) =>
        mapCalendars(list, (calendar) => {
          if (calendar.id !== calendarId) return calendar;
          const { colourOverride, ...switches } = change;
          if (colourOverride === undefined) return { ...calendar, ...switches };
          if (colourOverride === null) {
            const { colourOverride: _dropped, ...rest } = calendar;
            return { ...rest, ...switches };
          }
          return { ...calendar, ...switches, colourOverride, hue: colourOverride };
        }),
      );
      try {
        const landed = await deps.api.update({ workspace, calendarId, ...change, mutationId: deps.mintId() });
        held.patch((list) => mapCalendars(list, (calendar) => (calendar.id === landed.id ? landed : calendar)));
        if (change.showInWeek !== undefined) deps.onShownChange?.(workspace);
        return true;
      } catch (error) {
        undo();
        refused(error);
        return false;
      }
    },
    /** Makes a calendar where the member's new bookings go: at once, put back with a toast if refused. */
    async setDestination(workspace: string, calendarId: string): Promise<boolean> {
      const held = listOf(workspace);
      const undo = held.patch((list) => ({
        ...mapCalendars(list, (calendar) => ({ ...calendar, isDestination: calendar.id === calendarId })),
        destinationId: calendarId,
      }));
      try {
        await deps.api.setDestination({ workspace, calendarId, mutationId: deps.mintId() });
        return true;
      } catch (error) {
        undo();
        refused(error);
        return false;
      }
    },
    /** Puts away the notice that new bookings moved to another calendar (AC-1005): at once, back if refused. */
    async dismissNotice(workspace: string): Promise<boolean> {
      const held = listOf(workspace);
      const undo = held.patch((list) => {
        const { fellBack: _gone, ...rest } = list;
        return rest;
      });
      try {
        await deps.api.dismissNotice({ workspace, mutationId: deps.mintId() });
        return true;
      } catch (error) {
        undo();
        refused(error);
        return false;
      }
    },
    /** Sets a booking page's own "Add events to" (`null`: the owner's default): at once, put back if refused. */
    async setPageDestination(workspace: string, pageId: string, calendarId: string | null): Promise<boolean> {
      const held = pageOf(workspace, pageId);
      const undo = held.patch(({ destination }) => {
        const { calendarId: _was, ...rest } = destination;
        return {
          destination: calendarId === null ? { ...rest, status: 'default' } : { ...rest, calendarId, status: 'page' },
        };
      });
      try {
        const landed = await deps.api.setPageDestination({
          workspace,
          pageId,
          calendarId,
          mutationId: deps.mintId(),
        });
        held.patch(() => ({ destination: landed }));
        return true;
      } catch (error) {
        undo();
        refused(error);
        return false;
      }
    },
  };
}

/** The calendars store. */
export type CalendarsStore = ReturnType<typeof createCalendarsStore>;
