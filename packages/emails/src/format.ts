// Times as emails state them, always in a named zone, since an email can't
// know where it is read: "Monday 2 November 2026, 9:00 AM (Europe/London)".
// The same wording as the booking emails' "When" line.

/** The parts of a moment in a zone, from the runtime's own calendar data. */
function parts(at: Date, zone: string, options: Intl.DateTimeFormatOptions, locale = 'en-GB') {
  const found = new Map<string, string>();
  for (const part of new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).formatToParts(at)) {
    found.set(part.type, part.value);
  }
  return found;
}

/** A zone as a reader sees it: `Europe/London`, `America/New York`, `UTC`. */
export function zoneName(zone: string): string {
  return zone.replaceAll('_', ' ');
}

/** "Monday 2 November 2026" in `zone`. */
export function formatDay(iso: string, zone = 'UTC'): string {
  const at = new Date(iso);
  const day = parts(at, zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${day.get('weekday') ?? ''} ${day.get('day') ?? ''} ${day.get('month') ?? ''} ${day.get('year') ?? ''}`;
}

/** "28 October" in `zone`: a date in a sentence, without the weekday or the year. */
export function formatShortDay(iso: string, zone = 'UTC'): string {
  const day = parts(new Date(iso), zone, { day: 'numeric', month: 'long' });
  return `${day.get('day') ?? ''} ${day.get('month') ?? ''}`;
}

/** "9:00 AM" in `zone`. */
export function formatTime(iso: string, zone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(iso));
}

/** "Monday 2 November 2026, 9:00 AM (Europe/London)": one moment. */
export function formatMoment(iso: string, zone = 'UTC'): string {
  return `${formatDay(iso, zone)}, ${formatTime(iso, zone)} (${zoneName(zone)})`;
}

/** "Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)": a span on one day, as a booking's When line. */
export function formatSpan(startIso: string, endIso: string, zone = 'UTC'): string {
  return `${formatDay(startIso, zone)}, ${formatTime(startIso, zone)} to ${formatTime(endIso, zone)} (${zoneName(zone)})`;
}

/** "1 person", "3 people": a count with its noun. */
export function plural(count: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('en-GB').format(count)} ${count === 1 ? one : many}`;
}
