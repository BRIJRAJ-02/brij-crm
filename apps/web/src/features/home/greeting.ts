// Home's greeting (spec 0041): "Good morning, Ada" by the hour in the member's
// own time zone (Preferences), and today's date. Pure: the clock and zone come in.

/** The part of the day: before noon, before six in the evening, then evening. */
export type DayPart = 'morning' | 'afternoon' | 'evening';

/** The hour (0 to 23) at `now` in `timeZone`. */
export function hourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour);
}

/** The part of the day an hour falls in. */
export function dayPartOf(hour: number): DayPart {
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}

/** A member's first name: the first word of their name, or undefined for a blank name. */
export function firstNameOf(name: string | undefined): string | undefined {
  const first = name?.trim().split(/\s+/u)[0];
  return first === undefined || first === '' ? undefined : first;
}
