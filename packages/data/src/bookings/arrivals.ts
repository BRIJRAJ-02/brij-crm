// New bookings as they arrive (bookings fix lane O, B-12): what the Bookings screens' "New booking" toast hears. A
// guest's booking writes a `booking` notification for each host in the booking's own write (migration 0179), and that
// write's `notifications` change event names the host, so this needs no event of its own: on each such event naming
// the member (and on each `bookings` event), it reads the member's unread booking notices
// and hands on each one made after the newest it already knew (a watermark on `createdAt`, with the ids made at that
// very moment, so a tie is never told twice). The first read after a listener starts only learns the watermark, so
// opening Bookings never toasts old news, and an older notice coming into view (a newer one marked read elsewhere)
// is never taken for a new one (state review). Only while a screen listens; the reads are coalesced
// (one per `ARRIVAL_COALESCE_MS`), never more than one out at a time. Plain, no React; the timer comes in for tests.
import type { NotificationView } from '@crm/contracts';

/** How long a burst of events waits before one read. */
export const ARRIVAL_COALESCE_MS = 400;

/** One booking that arrived: who booked which page, and when it starts. */
export interface BookingArrival {
  readonly notificationId: string;
  readonly bookingId: string;
  readonly guestName: string;
  readonly pageTitle: string;
  /** ISO 8601. */
  readonly startsAt: string;
}

/** What arrivals need from the layer. */
export interface ArrivalsDeps {
  /** The member's newest unread booking notices (`notifications.list`, kind `booking`, unread only). */
  readonly read: (workspace: string) => Promise<readonly NotificationView[]>;
  /** Listens to the workspace's change events while someone listens here; the answer stops. */
  readonly watch: (workspace: string) => () => void;
  /**
   * Bookings' held reads read again, so the lists show the new booking with the toast. Left out where the `bookings`
   * change event already reads them in place (`bookings/live.ts`), so a new booking never reads them twice.
   */
  readonly refresh?: (workspace: string) => void;
  /** The timer, for tests. */
  readonly later?: (work: () => void, ms: number) => () => void;
}

/** New bookings per workspace. */
export interface BookingArrivals {
  /** Hears each booking that arrives while the listener is on; the answer stops. */
  readonly listen: (workspace: string, listener: (arrival: BookingArrival) => void) => () => void;
  /** Something may have arrived (an event naming the member): read soon, if anyone listens. */
  readonly changed: (workspace: string) => void;
  /** Forgets everything (signed out). */
  readonly clear: () => void;
}

interface Entry {
  readonly listeners: Set<(arrival: BookingArrival) => void>;
  /** The newest `createdAt` known (ms), and the notices made at that moment; undefined until the first read. */
  mark: { readonly at: number; readonly ids: ReadonlySet<string> } | undefined;
  reading: boolean;
  again: boolean;
  stopWatch: (() => void) | undefined;
  cancel: (() => void) | undefined;
}

const defaultLater = (work: () => void, ms: number) => {
  const timer = setTimeout(work, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** A booking notice as an arrival, or undefined for one that doesn't say enough. */
function arrivalOf(view: NotificationView): BookingArrival | undefined {
  if (view.kind !== 'booking' || view.bookingId === undefined || view.booking === undefined) return undefined;
  if (view.booking.status !== 'confirmed') return undefined;
  return {
    notificationId: view.id,
    bookingId: view.bookingId,
    guestName: view.booking.guestName,
    pageTitle: view.booking.pageTitle,
    startsAt: view.booking.startsAt,
  };
}

/** New bookings, read on the events that may bring one. */
export function createBookingArrivals(deps: ArrivalsDeps): BookingArrivals {
  const later = deps.later ?? defaultLater;
  const entries = new Map<string, Entry>();

  const read = (workspace: string, entry: Entry) => {
    if (entry.reading) {
      entry.again = true;
      return;
    }
    entry.reading = true;
    void deps
      .read(workspace)
      .then(
        (views) => {
          if (entries.get(workspace) !== entry) return;
          const first = entry.mark === undefined;
          const mark = entry.mark ?? { at: Number.NEGATIVE_INFINITY, ids: new Set<string>() };
          const atOf = (view: NotificationView) => Date.parse(view.createdAt);
          const fresh = first
            ? []
            : views.filter((view) => atOf(view) > mark.at || (atOf(view) === mark.at && !mark.ids.has(view.id)));
          const newest = Math.max(mark.at, ...views.map(atOf));
          entry.mark = {
            at: newest,
            ids: new Set([
              ...(newest === mark.at ? mark.ids : []),
              ...views.filter((view) => atOf(view) === newest).map((view) => view.id),
            ]),
          };
          if (first || fresh.length === 0) return;
          deps.refresh?.(workspace);
          // Oldest first, so two that came together toast in the order they were made.
          for (const view of [...fresh].reverse()) {
            const arrival = arrivalOf(view);
            if (arrival === undefined) continue;
            for (const listener of entry.listeners) listener(arrival);
          }
        },
        () => undefined,
      )
      .finally(() => {
        entry.reading = false;
        if (entry.again && entries.get(workspace) === entry) {
          entry.again = false;
          read(workspace, entry);
        }
      });
  };

  return {
    listen(workspace, listener) {
      let entry = entries.get(workspace);
      if (entry === undefined) {
        entry = {
          listeners: new Set(),
          mark: undefined,
          reading: false,
          again: false,
          stopWatch: undefined,
          cancel: undefined,
        };
        entries.set(workspace, entry);
      }
      const held = entry;
      held.listeners.add(listener);
      if (held.listeners.size === 1) {
        held.stopWatch = deps.watch(workspace);
        if (held.mark === undefined) read(workspace, held);
      }
      return () => {
        held.listeners.delete(listener);
        if (held.listeners.size > 0) return;
        held.stopWatch?.();
        held.cancel?.();
        if (entries.get(workspace) === held) entries.delete(workspace);
      };
    },
    changed(workspace) {
      const entry = entries.get(workspace);
      if (entry === undefined || entry.cancel !== undefined) return;
      entry.cancel = later(() => {
        entry.cancel = undefined;
        read(workspace, entry);
      }, ARRIVAL_COALESCE_MS);
    },
    clear() {
      for (const entry of entries.values()) {
        entry.stopWatch?.();
        entry.cancel?.();
      }
      entries.clear();
    },
  };
}
