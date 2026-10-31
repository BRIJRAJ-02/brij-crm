// Home's Today (spec 0041): one day's bookings the member hosts and their own
// calendar events, in start order, split into what has ended and what is still
// to come. Pure: the day's calendar read, the member and the clock come in.
import type { BookingsCalendarView } from '@crm/data';
import { addDays, dayStart } from '../bookings/week.ts';

/** One meeting on today's agenda: a booking the member hosts, or one of their own calendar events. */
export interface AgendaItem {
  readonly id: string;
  readonly kind: 'booking' | 'event';
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly title: string;
  /** A booking's visitor; an event has none. */
  readonly guestName?: string;
  /** A booking's person record, when the booking made or found one. */
  readonly personRecordId?: string;
  readonly videoUrl?: string;
}

/** The day's meetings for `memberId`, by start: their confirmed bookings and their events not cancelled. */
export function agendaOf(view: BookingsCalendarView, memberId: string | undefined): readonly AgendaItem[] {
  const bookings: AgendaItem[] = view.bookings
    .filter((booking) => booking.status === 'confirmed' && booking.hostMemberId === memberId)
    .map((booking) => ({
      id: booking.id,
      kind: 'booking',
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      allDay: false,
      title: booking.pageTitle,
      guestName: booking.visitorName,
      ...(booking.personRecordId === undefined ? {} : { personRecordId: booking.personRecordId }),
      ...(booking.videoUrl === undefined ? {} : { videoUrl: booking.videoUrl }),
    }));
  const events: AgendaItem[] = view.events
    .filter((event) => event.status !== 'cancelled')
    .map((event) => ({
      id: event.id,
      kind: 'event',
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      title: event.title,
      ...(event.videoUrl === undefined ? {} : { videoUrl: event.videoUrl }),
    }));
  // All day first (they hold the whole day), then by start, then by end.
  return [...bookings, ...events].sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      Date.parse(a.endsAt) - Date.parse(b.endsAt),
  );
}

/** The agenda split at `now`: what has ended, and what is on now or still to come. */
export function splitAgenda(
  items: readonly AgendaItem[],
  now: Date,
): { readonly earlier: readonly AgendaItem[]; readonly next: readonly AgendaItem[] } {
  const at = now.getTime();
  return {
    earlier: items.filter((item) => Date.parse(item.endsAt) <= at),
    next: items.filter((item) => Date.parse(item.endsAt) > at),
  };
}

/** How long a meeting runs, in whole minutes. */
export function minutesOf(item: Pick<AgendaItem, 'startsAt' | 'endsAt'>): number {
  return Math.max(0, Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000));
}

/** The day's range a calendar read takes: local midnight to the next. */
export function dayRange(today: string): { readonly from: string; readonly to: string } {
  return { from: dayStart(today).toISOString(), to: dayStart(addDays(today, 1)).toISOString() };
}

/** How many days ahead Today reads, so it can show the next meeting after today. */
export const AHEAD_DAYS = 7;

/** Today's range and the week after it: local midnight today to midnight `AHEAD_DAYS` days on. */
export function aheadRange(today: string): { readonly from: string; readonly to: string } {
  return { from: dayStart(today).toISOString(), to: dayStart(addDays(today, AHEAD_DAYS + 1)).toISOString() };
}

/** At most this many meetings fill Today: the day's, then the week's next ones, so the card reads the days ahead. */
export const AGENDA_ROWS = 5;

/**
 * The meetings after today that Today shows under the day's own: the first ones by start, enough to bring the card
 * to `rows` (always at least one), so a quiet day still shows what is next rather than an empty card.
 */
export function upcomingAfter(
  items: readonly AgendaItem[],
  today: string,
  todayCount: number,
  rows: number = AGENDA_ROWS,
): readonly AgendaItem[] {
  const end = dayStart(addDays(today, 1)).getTime();
  return items
    .filter((item) => Date.parse(item.startsAt) >= end)
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, Math.max(1, rows - todayCount));
}

/** The agenda split at the day's end: today's meetings, and the first one after today. */
export function todayAndNext(
  items: readonly AgendaItem[],
  today: string,
): { readonly today: readonly AgendaItem[]; readonly next: AgendaItem | undefined } {
  const end = dayStart(addDays(today, 1)).getTime();
  return {
    today: items.filter((item) => Date.parse(item.startsAt) < end),
    // By start alone: a later day's all day event doesn't jump ahead of an earlier meeting.
    next: items
      .filter((item) => Date.parse(item.startsAt) >= end)
      .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0],
  };
}
