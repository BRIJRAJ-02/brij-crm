// Where the site's links go. The app (app.timefix.com) is the dashboard: its root opens your last workspace, or
// sign in. Sign in is also how a new person starts: the server decides whether an email signs in or signs up, so
// "Get started" and "Sign in" share one address. Booking addresses live on the public booking origin
// (timefix.com), which the same deployment serves (apps/web/middleware.ts).

/** The app: the dashboard behind sign in. */
export const APP_ORIGIN = 'https://app.timefix.com';

/** The public booking origin, where `/<handle>` and `/<handle>/<slug>` are served. */
export const BOOKING_ORIGIN = 'https://timefix.com';

/** Every link out of the site, in one place. */
export const LINKS = {
  dashboard: `${APP_ORIGIN}/`,
  signIn: `${APP_ORIGIN}/sign-in`,
  getStarted: `${APP_ORIGIN}/sign-in`,
} as const;

/** The booking address the hero shows, as a person's own would read. */
export const SAMPLE_BOOKING_ADDRESS = { host: 'timefix.com', path: '/you' } as const;
