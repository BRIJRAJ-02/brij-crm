// The words of the toast a guest's new booking raises on an open Bookings screen (B-12, `useBookingArrivals.ts`).

/** The arrival toast's copy. */
export const arrivalStrings = {
  /** "Ada Lovelace booked Intro call for Thu 5 Nov, 10:00." */
  booked: (guest: string, page: string, when: string) => `${guest} booked ${page} for ${when}.`,
  /** Opens the booking on the List. */
  open: 'Open',
  /** It has an action, so it would stay; it goes after this long unless hovered or focused. */
  toastMs: 10_000,
} as const;
