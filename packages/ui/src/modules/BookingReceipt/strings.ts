/** BookingReceipt's built in copy. */
export const strings = {
  welcome: 'You’re booked',
  /** Under "You're booked", right after booking: warm, short, and true whatever the meeting is (AC-21). */
  welcomeLine: (host: string) => `${host} will see you then.`,
  /** Under it, right after booking: where the details went. */
  sentTo: (email: string) => `We sent the details to ${email}.`,
  confirmed: 'Your booking',
  cancelled: 'This booking was cancelled',
  past: 'This booking has passed',
  /** A request waiting for its host (spec 0062, AC-6203), and one turned down. */
  requestSent: 'Request sent',
  requested: 'Your request',
  requestedLine: (host: string) => `${host} will confirm it. You’ll get an email either way.`,
  declined: 'This request was declined',
  marks: {
    confirmed: 'Confirmed',
    requested: 'Requested',
    declined: 'Declined',
    cancelled: 'Cancelled',
    past: 'Finished',
  },
  join: 'Join the call',
  product: 'Timefix',
  addToCalendar: 'Add to calendar',
  google: 'Google',
  outlook: 'Outlook',
  apple: 'Apple / .ics',
  googleCalendar: 'Google Calendar',
  appleIcs: 'Apple Calendar (.ics)',
  shareHeading: 'Share this meeting',
  share: 'Share',
  shareVia: 'Share via…',
  copyDetails: 'Copy details',
  copiedDetails: 'Details copied',
  addLine: (url: string) => `Add it to your calendar: ${url}`,
  cancelledNext: 'Nothing more to do here.',
  pastNext: 'This one has already happened.',
} as const;
