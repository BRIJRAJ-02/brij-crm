// A booking as an iCalendar (RFC 5545) file (spec 0025, AC-636, AC-674): the
// guest page's Add to calendar, and milestone 2's confirmation attachment.
// Pure. Adapted from an earlier scheduling build. Three details decide whether
// a calendar updates its copy or keeps a duplicate:
// - UID stays the booking's for its life (`<bookingId>@<domain>`), so a move
//   replaces the entry;
// - SEQUENCE only grows (0 first, epoch seconds after), or clients ignore it;
// - METHOD:REQUEST (CANCEL with STATUS:CANCELLED to remove it), not PUBLISH.
// ORGANIZER is our sending address, never the host's mailbox.
import { DateTime } from 'luxon';

/** What a booking's calendar entry says. */
export interface IcsInput {
  readonly bookingId: string;
  /** The domain after the UID's `@`: the app's host. */
  readonly uidDomain: string;
  readonly method: 'REQUEST' | 'CANCEL';
  readonly start: Date;
  readonly end: Date;
  readonly summary: string;
  readonly description: string;
  /** The video link, the address or the number; nothing for none. */
  readonly location?: string | null;
  /** The guest page. */
  readonly url: string;
  readonly organizerEmail: string;
  readonly organizerName: string;
  readonly attendees: readonly { readonly name: string; readonly email: string }[];
  /** 0 for the first confirmation; epoch seconds for anything after it. */
  readonly sequence: number;
  /** DTSTAMP, passed in so this stays pure. */
  readonly now: Date;
}

/** UTC as `yyyyMMddTHHmmssZ`. */
const utc = (date: Date): string => DateTime.fromJSDate(date).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

/** Escapes text: `\`, `;` and `,`, and a newline as a literal `\n` (a raw one ends the property). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets (continuations at 74 after their space), never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = out.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  if (current !== '') out.push(current);
  return out.join('\r\n ');
}

/** The booking's `.ics`, CRLF throughout with a trailing terminator. */
export function buildBookingIcs(input: IcsInput): string {
  const cancelled = input.method === 'CANCEL';
  const location = input.location?.trim() ?? '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CRM//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.bookingId}@${input.uidDomain}`,
    `SEQUENCE:${String(Math.max(0, Math.trunc(input.sequence)))}`,
    `DTSTAMP:${utc(input.now)}`,
    `DTSTART:${utc(input.start)}`,
    `DTEND:${utc(input.end)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    ...(location === '' ? [] : [`LOCATION:${escapeText(location)}`]),
    `URL:${escapeText(input.url)}`,
    `ORGANIZER;CN=${escapeText(input.organizerName)}:MAILTO:${input.organizerEmail}`,
    ...input.attendees.map(
      (attendee) =>
        `ATTENDEE;CN=${escapeText(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${cancelled ? 'DECLINED' : 'ACCEPTED'};RSVP=FALSE:MAILTO:${attendee.email}`,
    ),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
