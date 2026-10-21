/** BookingList's built in copy. */
export const strings = {
  join: (provider: string) => `Join ${provider}`,
  quoted: (note: string) => `“${note}”`,
  youAnd: 'You and',
  /** Someone else's booking (a colleague hosts it): "Sam Lee and". */
  hostAnd: (host: string) => `${host} and`,
} as const;
