// The first day of the week (0 Sunday to 6 Saturday): the member's week start
// (Settings › Account › Preferences); Automatic is Monday, as every week was in
// round 6 (the owner, 22 October 2026). Week views and week pickers start here.
import type { WeekStart } from '@crm/data';
import { firstDayOfWeek, useFormatSettings } from '@crm/ui';

/** The week start the workspace's pages use: the member's choice, with Automatic (or none yet) as Monday. */
export function weekStartOf(choice: WeekStart | undefined): Exclude<WeekStart, 'auto'> {
  return choice === undefined || choice === 'auto' ? 'monday' : choice;
}

/** The first day of the week for screens inside a workspace. */
export function useFirstDay(): number {
  const { locale, weekStart } = useFormatSettings();
  return firstDayOfWeek(locale, weekStartOf(weekStart));
}

/** The same for a route loader, which has no provider: the browser's language (as UiProvider's) and the member's week start. */
export function firstDayFor(weekStart: WeekStart | undefined): number {
  return firstDayOfWeek(navigator.languages[0] ?? 'en-US', weekStartOf(weekStart));
}
