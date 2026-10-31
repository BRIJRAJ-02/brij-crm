// Brief
// Purpose: moving and resizing a booking by hand on the week and day (spec 0025, AC-640): the WeekCalendar's `move`.
// Main task: tell the grid which bookings can move, where they may land, and send the move with an Undo.
// Leaves out: the grid's pointer and keys (the library's WeekCalendar), a move to another week, calendar events.
import { isDataError, type BookingListItem } from '@crm/data';
import type { WeekCalendarMove, WeekCalendarSpan } from '@crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HostBookingActions } from './BookingActions.tsx';
import { bookingIdOfBlock, canUndoMove, mayLand, MOVES_MOST, stepOfStarts } from './move-slots.ts';
import { strings } from './strings.ts';
import { dayKeyOf, instantAt } from './week.ts';

/** How long the page's times, once read, answer a drag before they are read again: someone may book meanwhile. */
const KEEP_MS = 30_000;
/** A new length is read this long after the edge stops on it, not for every step it passes. */
const LENGTH_WAIT_MS = 150;
/** Refusals that mean the page will not take this booking there at all, not that the read failed. */
const REFUSED = new Set(['CONFIG_INVALID', 'FORBIDDEN', 'NOT_FOUND', 'BOOKING_CLOSED', 'LIMIT_REACHED']);

/** What the page offers a booking at one length: being read, read, refused outright, or the read failed. */
type Offered =
  | { readonly status: 'reading'; readonly at: number }
  | { readonly status: 'ready'; readonly at: number; readonly starts: ReadonlySet<number>; readonly step?: number }
  | { readonly status: 'refused' | 'failed'; readonly at: number };

const minutesOf = (booking: BookingListItem) =>
  Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000);

/** A refusal's sentence for the member. */
function messageOf(error: unknown): string {
  if (!isDataError(error)) return strings.changeFailed;
  if (error.code === 'SLOT_TAKEN') return strings.timeGone;
  return error.message === '' ? strings.changeFailed : error.message;
}

/** What the hook needs from its screen. */
export interface BookingMoveOptions {
  /** The host's changes; without them nothing moves. */
  readonly actions: HostBookingActions | undefined;
  /** The bookings the week shows. */
  readonly bookings: readonly BookingListItem[];
  /** The week on screen as instants: the range the page's times are read for. */
  readonly range: { readonly from: string; readonly to: string };
  /** The member's zone, the one the grid is drawn in. */
  readonly zone: string;
  readonly now: Date;
  /** A booking was sent to a new place: where focus should go once it shows there. */
  readonly onMoved: (landed: { readonly dayKey: string; readonly blockId: string }) => void;
}

/**
 * The week's `move`: which bookings can be taken, the step and the places they may land (read once from the page's
 * times for the booking's length, so a drag asks the server nothing as it goes), and the move itself, which the data
 * layer shows at once and puts back on a refusal, with a toast whose Undo moves it back.
 */
export function useBookingMove({ actions, bookings, range, zone, now, onMoved }: BookingMoveOptions): WeekCalendarMove {
  const [, setReads] = useState(0);
  const offered = useRef(new Map<string, Offered>());
  const lengthWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(lengthWait.current);
    },
    [],
  );
  const byId = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const minute = Math.floor(now.getTime() / 60_000);
  // Confirmed, still ahead, moved fewer than five times, and on one day of the grid (a long one is two blocks).
  const movable = useMemo(
    () =>
      new Set(
        actions === undefined
          ? []
          : bookings
              .filter(
                (booking) =>
                  booking.status === 'confirmed' &&
                  Date.parse(booking.startsAt) > minute * 60_000 &&
                  booking.reschedules < MOVES_MOST &&
                  dayKeyOf(new Date(booking.startsAt), zone) ===
                    dayKeyOf(new Date(Date.parse(booking.endsAt) - 1), zone),
              )
              .map((booking) => booking.id),
      ),
    [actions, bookings, minute, zone],
  );
  const keyOf = (bookingId: string, minutes: number) => `${bookingId}|${String(minutes)}|${range.from}`;
  /** Reads the page's times for a booking at a length, unless they are held and fresh. */
  const read = (booking: BookingListItem, minutes: number) => {
    if (actions === undefined) return;
    const key = keyOf(booking.id, minutes);
    const held = offered.current.get(key);
    if (held !== undefined && (held.status === 'reading' || Date.now() - held.at < KEEP_MS)) return;
    offered.current.set(key, { status: 'reading', at: Date.now() });
    actions.moveSlots(booking.id, range.from, range.to, minutes === minutesOf(booking) ? undefined : minutes).then(
      (answer) => {
        const starts = answer.slots.map((slot) => Date.parse(slot.start));
        const step = stepOfStarts(starts);
        offered.current.set(key, {
          status: 'ready',
          at: Date.now(),
          starts: new Set(starts),
          ...(step === undefined ? {} : { step }),
        });
        setReads((count) => count + 1);
      },
      (error: unknown) => {
        offered.current.set(key, {
          status: isDataError(error) && REFUSED.has(error.code) ? 'refused' : 'failed',
          at: Date.now(),
        });
        setReads((count) => count + 1);
      },
    );
  };
  const bookingOf = (blockId: string) => byId.get(bookingIdOfBlock(blockId));
  const send = (booking: BookingListItem, to: WeekCalendarSpan) => {
    if (actions === undefined) return;
    const minutes = to.endMinute - to.startMinute;
    const own = minutesOf(booking);
    const start = instantAt(to.dayKey, to.startMinute, zone).toISOString();
    const isOnlyLength = minutes !== own && start === new Date(booking.startsAt).toISOString();
    const back = { start: new Date(booking.startsAt).toISOString(), minutes: own };
    onMoved({ dayKey: to.dayKey, blockId: `${booking.id}:${to.dayKey}` });
    actions.move(booking.id, start, minutes === own ? undefined : minutes).then(
      () => {
        actions.notify(
          'success',
          isOnlyLength ? strings.resizedToast(booking.visitorName) : strings.movedToast(booking.visitorName),
          // Another move undoes it, and counts as one of the five: past the fifth there is nothing to offer.
          canUndoMove(booking.reschedules)
            ? {
                label: strings.undo,
                onAction: () => {
                  actions.move(booking.id, back.start, minutes === own ? undefined : back.minutes).then(
                    () => actions.notify('success', strings.putBackToast(booking.visitorName)),
                    (error: unknown) => actions.notify('danger', messageOf(error)),
                  );
                },
              }
            : undefined,
        );
      },
      (error: unknown) => actions.notify('danger', messageOf(error)),
    );
  };
  return {
    isMovable: (blockId) => movable.has(bookingIdOfBlock(blockId)),
    stepOf: (blockId) => {
      const booking = bookingOf(blockId);
      const held = booking === undefined ? undefined : offered.current.get(keyOf(booking.id, minutesOf(booking)));
      return held?.status === 'ready' ? held.step : undefined;
    },
    canLand: (blockId, to) => {
      const booking = bookingOf(blockId);
      if (booking === undefined) return false;
      const minutes = to.endMinute - to.startMinute;
      const own = { startMs: Date.parse(booking.startsAt), minutes: minutesOf(booking) };
      const target = { startMs: instantAt(to.dayKey, to.startMinute, zone).getTime(), minutes };
      const held = offered.current.get(keyOf(booking.id, minutes));
      // The page refuses this length outright (a round robin booking keeps its own): only where it is can it stay.
      if (held?.status === 'refused') return target.startMs === own.startMs && target.minutes === own.minutes;
      return mayLand(own, target, held?.status === 'ready' ? held.starts : undefined);
    },
    onPrepare: (blockId) => {
      const booking = bookingOf(blockId);
      if (booking !== undefined) read(booking, minutesOf(booking));
    },
    onHold: (blockId, to) => {
      const booking = bookingOf(blockId);
      if (booking === undefined) return;
      const minutes = to.endMinute - to.startMinute;
      // Its own length is read as it is picked up; another waits a moment for the edge to settle on it.
      read(booking, minutesOf(booking));
      clearTimeout(lengthWait.current);
      if (minutes !== minutesOf(booking)) {
        lengthWait.current = setTimeout(() => {
          read(booking, minutes);
        }, LENGTH_WAIT_MS);
      }
    },
    onMove: (blockId, to) => {
      const booking = bookingOf(blockId);
      if (booking !== undefined) send(booking, to);
    },
  };
}
