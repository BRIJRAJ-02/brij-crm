/** BookingReceipt's built in copy. */
export const strings = {
  welcome: 'You’re booked',
  /** Under "You're booked", right after booking: warm, short, and true whatever the meeting is (AC-21). */
  welcomeLine: (host: string) => `${host} will see you then.`,
  confirmed: 'Your booking',
  cancelled: 'This booking was cancelled',
  past: 'This booking has passed',
  marks: { confirmed: 'Confirmed', cancelled: 'Cancelled', past: 'Finished' },
  join: 'Join the call',
  product: 'Timefix',
  addToCalendar: 'Add to calendar',
  google: 'Google',
  outlook: 'Outlook',
  apple: 'Apple / .ics',
  cancelledNext: 'Nothing more to do here.',
  pastNext: 'This one has already happened.',
} as const;
