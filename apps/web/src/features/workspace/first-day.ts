// The first day of the week (0 Sunday to 6 Saturday): the member's week start
// (Settings › Account › Preferences), else the language's. Week views and week
// pickers start their weeks here.
import type { WeekStart } from '@crm/data';
import { firstDayOfWeek, useFormatSettings } from '@crm/ui';

/** The first day of the week for screens inside a workspace. */
export function useFirstDay(): number {
  const { locale, weekStart } = useFormatSettings();
  return firstDayOfWeek(locale, weekStart);
}

/** The same for a route loader, which has no provider: the browser's language (as UiProvider's) and the member's week start. */
export function firstDayFor(weekStart: WeekStart | undefined): number {
  return firstDayOfWeek(navigator.languages[0] ?? 'en-US', weekStart);
}
