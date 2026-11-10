/** BookingChanges' built in copy. */
export const strings = {
  heading: 'Need a change?',
  pickNewTime: 'Pick a new time',
  move: 'Reschedule',
  addGuests: 'Add guests',
  /** The foot's Guests (the v5 mock): the count is in its panel. */
  guestsButton: 'Guests',
  /** The foot's quiet Cancel; the confirm's own button says Cancel booking. */
  cancelBooking: 'Cancel',
  /** Names the booking, as the host's confirm does: "Cancel Intro call with Ada Lovelace?" */
  cancelTitle: (title: string, host: string) => `Cancel ${title} with ${host}?`,
  cancelText: (host: string) => `${host} will be told, and it comes off both calendars.`,
  /** With no calendar event behind the booking (critic B-18): nothing about calendars. */
  cancelTextPlain: (host: string) => `${host} will be told, and the invite is withdrawn.`,
  reason: 'Reason',
  reasonHint: (host: string) => `Optional. ${host} sees it.`,
  confirmCancel: 'Cancel booking',
  cancelling: 'Cancelling',
  /** Cancel's dismiss: it can't be called Cancel too. */
  keep: 'Keep booking',
  guests: 'Guests',
  count: (count: number, max: number) => `${String(count)} of ${String(max)}`,
  invitedList: 'Invited guests',
  inviteMore: 'Invite more',
  upTo: (room: number) => `(up to ${String(room)})`,
  newGuestRow: (row: number) => `New guest ${String(row)} email`,
  addAnother: 'Add another guest',
  /** Invite, with how many once there are two or more: "Invite 2". */
  invite: (count: number) => (count > 1 ? `Invite ${String(count)}` : 'Invite'),
  adding: 'Inviting',
  remove: (email: string) => `Remove ${email}`,
  removeShort: 'Remove',
  invitedSome: (emails: readonly string[]) =>
    emails.length === 1 ? `Invited ${emails[0] ?? ''}.` : `Invited ${String(emails.length)} guests.`,
  alreadyOnAll: 'They’re already invited.',
  /** Under a row whose address is on the booking already. */
  alreadyOn: 'Already invited.',
  /** In place of Add another guest once the rows fill the room left: "One more guest fits." */
  roomLeft: (room: number) => (room === 1 ? 'One more guest fits.' : `${String(room)} more guests fit.`),
  removed: (email: string) => `Removed ${email}.`,
  removeTitle: (email: string) => `Remove ${email}?`,
  removeText: 'They come off the invite, and you can add them again afterwards.',
  confirmRemove: 'Remove guest',
  removing: 'Removing',
  dismiss: 'Cancel',
  full: (max: number) => `That’s the most guests a booking takes (${String(max)}).`,
  guestInvalid: 'Give an email address such as name@example.com.',
  guestsNote: 'Guests get the invite. Only you can move or cancel.',
} as const;
