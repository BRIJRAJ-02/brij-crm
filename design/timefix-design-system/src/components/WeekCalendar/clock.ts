// The one time format for every scheduling surface: "9:30 AM" in 12h, "09:30" in 24h.

/** Formats minutes from midnight as "9:30 AM" (12h) or "09:30" (24h). 24:00 reads as midnight. */
export function formatClock(minutes: number, hour12 = true): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = String(minutes % 60).padStart(2, '0');
  return hour12 ? `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:${m}`;
}

/** Formats a range: "9:30 – 10:00 AM" when both halves share AM or PM, else "11:30 AM – 12:30 PM"; "09:30 – 10:00" in 24h. */
export function formatClockRange(start: number, end: number, hour12 = true): string {
  const a = formatClock(start, hour12);
  const b = formatClock(end, hour12);
  if (!hour12) return `${a} – ${b}`;
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/** Minutes from midnight of a Date, in its local time. */
export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
