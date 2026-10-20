// My tasks' days (spec 0019, AC-436, AC-437): which group an open task falls
// in, by its due date against today in the browser's time zone, and when
// today ends. Plain functions with no React, so they test in Node; the hook
// beside them sets one timer for the next local midnight and calls no server.
import type { TaskEntry, TaskSection } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** A group of My tasks' open list, in its order. */
export type DayGroup = 'overdue' | 'today' | 'upcoming' | 'none';

/** The day it is at `now` in `timeZone`, as `YYYY-MM-DD`. */
export function dayAt(now: number, timeZone: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** One hour, the most a daylight saving change moves a midnight. */
const HOUR_MS = 3_600_000;

/**
 * Milliseconds from `now` until the day changes in `timeZone`, at least one
 * second: the wall clock's time left in the day, then checked, stepping an
 * hour at a time over a daylight saving change, so the timer never fires
 * early and is at most an hour late in the rarest case.
 */
export function msToNextDay(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? '0');
  const elapsed = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + (now % 1000);
  let wait = Math.max(1000, 24 * HOUR_MS - elapsed);
  const today = dayAt(now, timeZone);
  // A day 23 hours long ends before the estimate; one 25 hours long after it.
  while (wait > HOUR_MS && dayAt(now + wait - HOUR_MS, timeZone) !== today) wait -= HOUR_MS;
  while (dayAt(now + wait, timeZone) === today) wait += HOUR_MS / 4;
  return wait;
}

/** Which group an open task falls in: before today is Overdue, today is Today, later Upcoming, none No date. */
export function dayGroup(dueOn: string | undefined, today: string): DayGroup {
  if (dueOn === undefined) return 'none';
  if (dueOn < today) return 'overdue';
  return dueOn === today ? 'today' : 'upcoming';
}

const SECTIONS: Readonly<Record<DayGroup, TaskSection>> = {
  overdue: { id: 'overdue', title: strings.overdue },
  today: { id: 'today', title: strings.today },
  upcoming: { id: 'upcoming', title: strings.upcoming },
  none: { id: 'none', title: strings.noDate },
};

/** TaskList's `sectionOf` for the open list on `today`. */
export function daySections(today: string): (task: TaskEntry) => TaskSection {
  return (task) => SECTIONS[dayGroup(task.dueOn, today)];
}

/**
 * Today in the browser's time zone, moving at local midnight by a timer set
 * for it (and checked again when the tab is shown, as a sleeping laptop's
 * timers run late). No server call (AC-437).
 */
export function useToday(timeZone: string, now: () => number = Date.now): string {
  const [today, setToday] = useState(() => dayAt(now(), timeZone));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      const at = now();
      setToday(dayAt(at, timeZone));
      timer = setTimeout(check, msToNextDay(at, timeZone));
    };
    check();
    const onShown = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, [timeZone, now]);
  return today;
}
