// Meetings' one way of writing times, days and zones (the Bookings redesign, sweep §2.10, the owner's ruling of
// 9 November 2026): "9:30 am", "Mon 9 Nov", "India time (GMT+5:30)". Every line in Meetings that says a time, a day
// or a zone reads it from here, so the list, the popup, Reschedule, New meeting and the week never disagree.
import { memoIntl } from '@crm/ui';
import { offsetLabel, zoneName } from '../../public/booking/time.ts';

/** The admin's clock: always twelve hours, lower case, "9:30 am" (the ruling: 12h in admin, the now line too). */
const clockOf = (zone: string) =>
  memoIntl(
    `meetings-clock|${zone}`,
    () => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone }),
  );

/** "9:30 am" at an instant, on the zone's clock. */
export function clockTime(instant: string | number | Date, zone: string): string {
  return clockOf(zone)
    .format(new Date(instant))
    .replace(/\u202f/g, ' ');
}

/** A minute of the day (570) on the admin's clock: "9:30 am". */
export function clockOfMinute(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve)}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}

/** "11:00 – 11:45 am" (one am or pm when both ends share it), else "11:30 am – 12:30 pm". */
export function clockRange(startsAt: string, endsAt: string, zone: string): string {
  const start = clockTime(startsAt, zone);
  const end = clockTime(endsAt, zone);
  const [startTime, startHalf] = start.split(' ');
  const endHalf = end.split(' ')[1];
  return startHalf !== undefined && startHalf === endHalf ? `${startTime ?? start} – ${end}` : `${start} – ${end}`;
}

/** A day key (`yyyy-MM-dd`) read as a calendar date: noon UTC, so no zone moves it. */
const dateOfKey = (key: string) => new Date(`${key}T12:00:00Z`);

/** "Mon 9 Nov" for a day key; "Mon 9 Nov 2027" when it isn't this year (`today`, a day key). */
export function shortDay(key: string, today: string): string {
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return memoIntl(
    `meetings-short-day|${String(sameYear)}`,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        ...(sameYear ? {} : { year: 'numeric' }),
      }),
  )
    .format(dateOfKey(key))
    .replace(',', '');
}

/** "Monday 9 November" for a day key. */
export function longDay(key: string): string {
  return memoIntl(
    'meetings-long-day',
    () => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  )
    .format(dateOfKey(key))
    .replace(',', '');
}

/** The day key (`yyyy-MM-dd`) of an instant in the zone. */
export function dayKeyIn(instant: string | number | Date, zone: string): string {
  return memoIntl(
    `meetings-day-key|${zone}`,
    () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }),
  )
    .format(new Date(instant))
    .slice(0, 10);
}

/**
 * A zone as a person names it, "India time": the country where the zone is a whole country's (Intl's generic name,
 * "India Time"), else the city ("Dubai time", for Intl's "GST"). Never an abbreviation.
 */
export function zoneWords(zone: string, at: number): string {
  try {
    const generic =
      memoIntl(
        `meetings-zone-generic|${zone}`,
        () => new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortGeneric' }),
      )
        .formatToParts(new Date(at))
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (/^\p{Lu}[\p{L} .'-]* Time$/u.test(generic)) return `${generic.slice(0, -' Time'.length)} time`;
  } catch {
    // A zone this browser doesn't know: its own name, below.
  }
  return zoneName(zone);
}

/** "India time (GMT+5:30)": the zone in words and its offset at that instant (a daylight saving change moves it). */
export function zoneLabel(zone: string, at: number): string {
  const words = zoneWords(zone, at);
  // A zone with no city ("UTC") is its own offset.
  if (!zone.includes('/')) return words;
  const offset = offsetLabel(zone, at);
  return offset === '' ? words : `${words} (${offset})`;
}

/** "45 min". */
export function minutesLabel(minutes: number): string {
  return `${String(minutes)} min`;
}
