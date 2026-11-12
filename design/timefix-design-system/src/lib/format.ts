// The one place dates are worded. Times come from WeekCalendar/clock.ts (formatClock, formatClockRange).

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** "13 Nov" (adds the year when it is not this year): dates in rows, chips and cards. */
export function formatDate(d: Date, now: Date = new Date()): string {
  const base = `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Wed 13 Nov": a day in lists, calendars and meeting cards. */
export function formatDay(d: Date): string {
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** "Wednesday 13 November": headings (a day group, the chosen day on a booking page). */
export function formatLongDay(d: Date): string {
  return `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
}

/** "Today", "Tomorrow", "Yesterday", else formatDay: the label beside a day heading. */
export function relativeDayLabel(d: Date, now: Date = new Date()): string {
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(d) - day(now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDay(d);
}

/** File sizes as people read them: "12 B", "820 KB", "2.4 MB", "24 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
