// The day it is somewhere, as a date: Home's loader reads it in the first
// load, so it lives apart from `day.ts`, whose sections carry the tasks'
// words and load with the screens. Plain, so it tests in Node.

/** The day it is at `now` in `timeZone`, as `YYYY-MM-DD`. */
export function dayAt(now: number, timeZone: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
