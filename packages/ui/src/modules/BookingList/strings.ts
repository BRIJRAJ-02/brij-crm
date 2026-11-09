/** BookingList's built in copy. */
export const strings = {
  join: (provider: string) => `Join ${provider}`,
  /** The Join button's word on a Meetings row (its name says the provider). */
  joinShort: 'Join',
  quoted: (note: string) => `“${note}”`,
  youAnd: 'You and',
  /** Who else is in it, as text, as the activity feed writes attendees it doesn't know: "a@x.com, b@x.com and 3 more". */
  attendeesLine: (names: readonly string[], more: number) =>
    more > 0 ? `${names.join(', ')} and ${String(more)} more` : names.join(', '),
  /** Someone else's booking (a colleague hosts it): "Sam Lee and". */
  hostAnd: (host: string) => `${host} and`,
} as const;
