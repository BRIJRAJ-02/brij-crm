// A booking page in miniature (5 November 2026): the one drawing of a page that its card in Captures › Links and
// its embed card's made up site both show, so the two never draw it differently.
import type { BookingPageView } from '@crm/data';
import { BookingPagePicture, linkHue } from '@crm/ui';
import { strings } from './strings.ts';

/** The weekdays in a page's weekly hours, Monday first. */
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** The page's picture: its title and lengths over a month whose open days are the ones its weekly hours book. */
export function pagePicture(page: BookingPageView) {
  return (
    <BookingPagePicture
      title={page.title}
      lengths={page.durations.length === 0 ? '' : strings.minutesChoice(page.durations)}
      openDays={WEEK.map((day) => page.availability.weekly[day].length > 0)}
      hue={linkHue(page.id)}
    />
  );
}
