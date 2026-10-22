// The home page's showcase: the product's four areas, each with one screen of the demo workspace. The screens are
// 1920 × 1200 windows at 2x (public/shots/<id>.webp, 3840 × 2400), dark, taken from a seeded workspace.
import type { Hue, IconName } from '@crm/ui';

/** One area in the showcase: its tab and its screen. */
export interface ShowcaseArea {
  readonly id: 'crm' | 'booking' | 'forms' | 'calendar';
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly hue: Hue;
  /** The address the window's bar shows. */
  readonly address: string;
  /** What the screen shows, for anyone who can't see it. */
  readonly alt: string;
}

export const SHOWCASE: readonly ShowcaseArea[] = [
  {
    id: 'crm',
    label: 'CRM',
    description: 'People, companies and deals.',
    icon: 'users',
    hue: 'green',
    address: 'app.timefix.ai/people',
    alt: 'The People table: names, companies, tags and owners.',
  },
  {
    id: 'booking',
    label: 'Booking pages',
    description: 'Your address. They pick a time.',
    icon: 'calendar-check',
    hue: 'sky',
    address: 'timefix.com/maya/intro-call',
    alt: 'A public booking page: a month with a day picked and its open times.',
  },
  {
    id: 'forms',
    label: 'Forms',
    description: 'Capture leads, send them to a booking.',
    icon: 'clipboard-list',
    hue: 'orange',
    address: 'app.timefix.ai/forms',
    alt: 'The form editor: its questions on the left, the live preview on the right.',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Every meeting beside your own.',
    icon: 'calendar-days',
    hue: 'blue',
    address: 'app.timefix.ai/bookings',
    alt: 'The Bookings week, full of meetings across five days.',
  },
];
