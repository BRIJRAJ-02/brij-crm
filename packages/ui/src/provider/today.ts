// Today, read from the provider's clock in its time zone. Its own module, apart
// from context.ts, so only the date displays and the grid that read it carry
// it: every page loads context.ts, the hosted form and the booking page among them.
import { useContext, useSyncExternalStore } from 'react';
import { memoIntl } from '../lib/intl-memo.ts';
import { ClockContext, useFormatSettings } from './context.ts';

/** Today (`YYYY-MM-DD`) in the zone at `now`: Swedish writes a date as YYYY-MM-DD, with no date library in the first load. */
function dayKeyIn(now: number, timeZone: string): string {
  return memoIntl(
    `dayKey:${timeZone}`,
    () => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
  ).format(now);
}

/**
 * Reads "today" (`YYYY-MM-DD`, in the provider's time zone) when called, without re-rendering on each tick: a
 * paste or an import reads "tomorrow" against it once, so a grid of thousands of cells never redraws for the clock.
 */
export function useTodayReader(): () => string {
  const clock = useContext(ClockContext);
  const { timeZone } = useFormatSettings();
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to read today.');
  return () => dayKeyIn(clock.now(), timeZone);
}

/**
 * Today (`YYYY-MM-DD`, in the provider's time zone), re-rendering only when the day changes: the snapshot is the
 * day's text, so the clock's 30 second ticks leave a grid of dates alone until midnight.
 */
export function useToday(): string {
  const clock = useContext(ClockContext);
  const { timeZone } = useFormatSettings();
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to read today.');
  return useSyncExternalStore(clock.subscribe, () => dayKeyIn(clock.now(), timeZone));
}
