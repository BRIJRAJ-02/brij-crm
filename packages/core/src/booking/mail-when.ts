// How a booking email writes a time (bookings redesign step 1): in the reader's own clock, not one forced on everyone.
// A booking keeps neither the visitor's language nor their 12 or 24 hour choice, only the zone they booked in, so the
// zone stands in for both: its country decides the date's order and its hour cycle (a zone in the United States reads
// "Monday, November 2, 2026, 9:00 AM"; one in Germany "Monday, 2 November 2026, 09:00"). The words stay English, as
// every email's are. A zone with no single country (UTC, Etc/GMT+4) keeps the old wording. Pure.
import { DateTime } from 'luxon';
import { zoneCountry } from '@crm/contracts';
import { zoneDisplay } from '@crm/contracts/zones';

/** The English locale and the hour cycle a zone reads in, or undefined when it names no single country. */
export interface MailClock {
  readonly locale: string;
  readonly hour12: boolean;
}

/** The clock a zone's country reads: English words in its date order, and its own language's hour cycle. */
export function mailClock(zone: string): MailClock | undefined {
  const country = zoneCountry(zone);
  if (country === undefined) return undefined;
  try {
    const native = new Intl.Locale(`und-${country}`).maximize();
    const cycle = new Intl.DateTimeFormat(`${native.language}-${country}`, { hour: 'numeric' }).resolvedOptions()
      .hourCycle;
    return { locale: `en-${country}`, hour12: cycle === 'h11' || cycle === 'h12' };
  } catch {
    return undefined;
  }
}

/** ICU writes a narrow no break space (U+202F) before AM; an email keeps a plain one, as it always has. */
const NARROW_SPACE = String.fromCharCode(0x202f);
const plain = (text: string): string => text.replaceAll(NARROW_SPACE, ' ');

/** The day, as "Monday, November 2, 2026" in the clock's order, else the old "Monday 2 November 2026". */
function dayOf(at: DateTime, clock: MailClock | undefined): string {
  if (clock === undefined) return at.setLocale('en-GB').toFormat('cccc d LLLL yyyy');
  return plain(
    at.setLocale(clock.locale).toLocaleString({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  );
}

/** The time, as "9:00 AM" or "09:00" by the clock, else the old 12 hour "9:00 AM". */
function timeOf(at: DateTime, clock: MailClock | undefined): string {
  if (clock === undefined) return at.setLocale('en-US').toFormat('h:mm a');
  return plain(
    at
      .setLocale(clock.locale)
      .toLocaleString(
        clock.hour12
          ? { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }
          : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      ),
  );
}

/** "Monday, 2 November 2026, 09:00, Berlin time (GMT+1)", in `zone` and its clock: one moment, as a request's deadline. */
export function atLine(at: Date, zone: string): string {
  const local = DateTime.fromJSDate(at, { zone });
  const clock = mailClock(zone);
  return `${dayOf(local, clock)}, ${timeOf(local, clock)}, ${zoneDisplay(zone, at.getTime())}`;
}

/**
 * A meeting's time in two parts, as a booking email draws it (bookings redesign, 10 November 2026): the line the eye
 * goes to ("Monday, November 2, 2026, 4:00 AM to 4:30 AM") and its zone quietly under it ("New York time (GMT-5)").
 */
export function whenParts(start: Date, end: Date, zone: string): { readonly line: string; readonly zone: string } {
  const from = DateTime.fromJSDate(start, { zone });
  const to = DateTime.fromJSDate(end, { zone });
  const clock = mailClock(zone);
  return {
    line: `${dayOf(from, clock)}, ${timeOf(from, clock)} to ${timeOf(to, clock)}`,
    zone: zoneDisplay(zone, start.getTime()),
  };
}

/** "Monday, November 2, 2026, 4:00 AM to 4:30 AM, New York time (GMT-5)", in `zone` and its clock. */
export function whenLine(start: Date, end: Date, zone: string): string {
  const { line, zone: display } = whenParts(start, end, zone);
  return `${line}, ${display}`;
}
