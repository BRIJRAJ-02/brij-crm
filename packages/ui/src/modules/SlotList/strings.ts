/** SlotList's built in copy. */
export const strings = {
  clock: 'Clock',
  hours12: '12h',
  hours24: '24h',
  loading: 'Loading times…',
  times: (day: string) => `Times on ${day}`,
  bestTag: 'Best',
  best: 'a best time for you both',
  busyTag: 'You’re busy',
  busy: 'your calendar is busy then',
} as const;
