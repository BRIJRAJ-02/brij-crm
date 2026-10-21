/** BookingList's built in copy. */
export const strings = {
  join: (provider: string) => `Join ${provider}`,
  quoted: (note: string) => `“${note}”`,
  youAnd: 'You and',
  /** Who else is in it, as text, as the activity feed writes attendees it doesn't know: "a@x.com, b@x.com and 3 more". */
  attendeesLine: (names: readonly string[], more: number) =>
    more > 0 ? `${names.join(', ')} and ${String(more)} more` : names.join(', '),
} as const;
