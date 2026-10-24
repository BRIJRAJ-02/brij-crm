// The home page's showcase: the product's four areas, each with a few screens of the demo workspace that play in
// turn. The screens are 1920 × 1200 windows at 2x (public/shots/<area>-<n>.webp, 3840 × 2400) and, for phones, the
// same views at 390 × 844 at 3x (<area>-<n>-phone.webp), dark, taken from a seeded workspace (American names and
// companies, the owner's ask of 23 October 2026).
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
  readonly icon: IconName;
  readonly hue: Hue;
  readonly slides: readonly ShowcaseSlide[];
}

/** The file of a slide: the 3840 × 2400 screen, or its phone screen (390 × 844 at 3x, the app's own phone layout). */
export const slideSrc = (slide: ShowcaseSlide, form: 'desktop' | 'phone' = 'desktop') =>
  `/shots/${slide.id}${form === 'phone' ? '-phone' : ''}.webp`;

export const SHOWCASE: readonly ShowcaseArea[] = [
  {
    id: 'crm',
    label: 'CRM',
    icon: 'users',
    hue: 'green',
    slides: [
      {
        id: 'crm-1',
        address: 'app.timefix.com/w/lumen/objects/people',
        caption: 'People',
        alt: 'The People table: avatars, companies, owners and tags.',
      },
      {
        id: 'crm-2',
        address: 'app.timefix.com/w/lumen/objects/people/jessica-moore',
        caption: 'A record',
        alt: 'Jessica Moore’s record: her intro call, a note and the Vantafold deal in its activity.',
      },
      {
        id: 'crm-3',
        address: 'app.timefix.com/w/lumen/objects/deals',
        caption: 'Deals board',
        alt: 'The Deals board: cards by stage with their values and owners.',
      },
    ],
  },
  {
    id: 'booking',
    label: 'Booking pages',
    icon: 'calendar-check',
    hue: 'sky',
    slides: [
      {
        id: 'booking-1',
        address: 'timefix.com/maya/intro-call',
        caption: 'Pick a time',
        alt: 'Maya Collins’s booking page: October with the 27th picked and its open times.',
      },
      {
        id: 'booking-2',
        address: 'timefix.com/maya/intro-call',
        caption: 'Confirmed',
        alt: 'You’re booked: the time, the guests, and Google, Outlook or Apple to add it to.',
      },
      {
        id: 'booking-3',
        address: 'app.timefix.com/w/lumen/captures/links',
        caption: 'Your pages',
        alt: 'Six booking pages in the app, each with its length and a Copy link button.',
      },
    ],
  },
  {
    id: 'forms',
    label: 'Forms',
    icon: 'clipboard-list',
    hue: 'orange',
    slides: [
      {
        id: 'forms-1',
        address: 'app.timefix.com/w/lumen/captures/forms/strategy-call',
        caption: 'The editor',
        alt: 'The form editor: ten questions on the left, the live dark preview on the right.',
      },
      {
        id: 'forms-2',
        address: 'timefix.com/f/strategy-call',
        caption: 'The form',
        alt: 'The form as a visitor sees it: name, email and team size filled in.',
      },
      {
        id: 'forms-3',
        address: 'app.timefix.com/w/lumen/captures/forms/strategy-call?tab=submissions',
        caption: 'Submissions',
        alt: 'Eight submissions, each landed as a People record.',
      },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar-days',
    hue: 'blue',
    slides: [
      {
        id: 'calendar-1',
        address: 'app.timefix.com/w/lumen/bookings/calendar',
        caption: 'The week',
        alt: 'The Bookings week: bookings across five days beside Maya’s Google Calendar events.',
      },
      {
        id: 'calendar-2',
        address: 'app.timefix.com/w/lumen/bookings/calendar',
        caption: 'A booking',
        alt: 'Jessica Moore’s booking open on the week: Meet, Join, Reschedule.',
      },
      {
        id: 'calendar-3',
        address: 'app.timefix.com/w/lumen/settings/scheduling/calendars',
        caption: 'Google Calendar',
        alt: 'Settings: Google Calendar connected, conflict checks on.',
      },
    ],
  },
];
