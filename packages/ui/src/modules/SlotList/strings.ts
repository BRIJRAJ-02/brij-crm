/** SlotList's built in copy. */
export const strings = {
  clock: 'Clock',
  hours12: '12h',
  hours24: '24h',
  loading: 'Loading times…',
  times: (day: string) => `Times on ${day}`,
  /** A group's list in the grouped variant: "Lunch times on Friday 6 November". */
  groupTimes: (group: string, day: string) => `${group} times on ${day}`,
  bestTag: 'Best',
  best: 'a best time for you both',
  busyTag: 'You’re busy',
  busy: 'your calendar is busy then',
  picked: 'picked',
} as const;
