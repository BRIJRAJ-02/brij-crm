// The home page's showcase: the product's four areas, each with a few screens of the demo workspace that play in
// turn. The screens are 1920 × 1200 windows at 2x (public/shots/<area>-<n>.webp, 3840 × 2400), dark, taken from a
// seeded workspace (American names and companies, the owner's ask of 23 October 2026).
import type { Hue, IconName } from '@crm/ui';

/** One screen of an area. */
export interface ShowcaseSlide {
  readonly id: string;
  /** The address the window's bar shows. */
  readonly address: string;
  /** Two or three words naming what it shows, the slide's segment. */
  readonly caption: string;
  /** What the screen shows, for anyone who can't see it. */
  readonly alt: string;
}

/** One area in the showcase: its tab and its screens. */
export interface ShowcaseArea {
  readonly id: 'crm' | 'booking' | 'forms' | 'calendar';
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly hue: Hue;
  readonly slides: readonly ShowcaseSlide[];
}

/** The file of a slide. */
export const slideSrc = (slide: ShowcaseSlide) => `/shots/${slide.id}.webp`;

export const SHOWCASE: readonly ShowcaseArea[] = [
  {
    id: 'crm',
    label: 'CRM',
    description: 'People, companies and deals.',
    icon: 'users',
    hue: 'green',
    slides: [
      {
        id: 'crm-1',
        address: 'app.timefix.ai/people',
        caption: 'People',
        alt: 'The People table: names, companies, tags and owners.',
      },
      {
        id: 'crm-2',
        address: 'app.timefix.ai/people/maya-collins',
        caption: 'A record',
        alt: 'One person’s record: her intro call in the timeline, her company and a deal beside it.',
      },
      {
        id: 'crm-3',
        address: 'app.timefix.ai/deals',
        caption: 'Deals board',
        alt: 'The Deals board: cards by stage with their values.',
      },
    ],
  },
  {
    id: 'booking',
    label: 'Booking pages',
    description: 'Your address. They pick a time.',
    icon: 'calendar-check',
    hue: 'sky',
    slides: [
      {
        id: 'booking-1',
        address: 'timefix.com/maya/intro-call',
        caption: 'Pick a time',
        alt: 'A public booking page: a month with a day picked and its open times.',
      },
      {
        id: 'booking-2',
        address: 'timefix.com/maya/intro-call',
        caption: 'Confirmed',
        alt: 'The booking confirmed: the guest’s name, the time, and a way to add it to a calendar.',
      },
      {
        id: 'booking-3',
        address: 'app.timefix.ai/booking-pages',
        caption: 'Your pages',
        alt: 'The host’s booking pages in the app, each with its length and link.',
      },
    ],
  },
  {
    id: 'forms',
    label: 'Forms',
    description: 'Capture leads, send them to a booking.',
    icon: 'clipboard-list',
    hue: 'orange',
    slides: [
      {
        id: 'forms-1',
        address: 'app.timefix.ai/forms',
        caption: 'The editor',
        alt: 'The form editor: its questions on the left, the live preview on the right.',
      },
      {
        id: 'forms-2',
        address: 'timefix.com/f/strategy-call',
        caption: 'The form',
        alt: 'The form as a visitor sees it, a couple of answers filled in.',
      },
      {
        id: 'forms-3',
        address: 'app.timefix.ai/captures',
        caption: 'Submissions',
        alt: 'Captures: every submission landed as a record.',
      },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Every meeting beside your own.',
    icon: 'calendar-days',
    hue: 'blue',
    slides: [
      {
        id: 'calendar-1',
        address: 'app.timefix.ai/bookings',
        caption: 'The week',
        alt: 'The Bookings week: meetings across five days beside the host’s own events.',
      },
      {
        id: 'calendar-2',
        address: 'app.timefix.ai/bookings',
        caption: 'A booking',
        alt: 'One booking open on the week: the guest, the time, the join link, reschedule and cancel.',
      },
      {
        id: 'calendar-3',
        address: 'app.timefix.ai/settings/calendars',
        caption: 'Google Calendar',
        alt: 'Settings: Google Calendar connected, with conflict checks per calendar.',
      },
    ],
  },
];
