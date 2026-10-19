/** BookingList's built in copy. */
export const strings = {
  join: (provider: string) => `Join ${provider}`,
  quoted: (note: string) => `“${note}”`,
  youAnd: 'You and',
} as const;
