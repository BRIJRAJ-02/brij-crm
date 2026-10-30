/** WeekCalendar's built in copy. */
export const strings = {
  today: (day: string) => `${day}, today`,
  dayBlocks: (day: string, count: number) =>
    count === 0 ? `${day}, nothing on` : count === 1 ? `${day}, 1 item` : `${day}, ${String(count)} items`,
  dayLoading: (day: string) => `${day}, loading`,
  /** A block's name: its title, its status when unusual, its time, who it is with and whether it was called off. */
  blockName: (title: string, time: string, detail?: string, isCancelled?: boolean, status?: string) =>
    [
      title,
      ...(status === undefined ? [] : [status]),
      time,
      ...(detail === undefined ? [] : [detail]),
      ...(isCancelled === true ? ['cancelled'] : []),
    ].join(', '),
  details: 'Details',
  more: (count: number) => `+${String(count)}`,
  moreName: (count: number, at: string) =>
    count === 1 ? `1 more item at ${at}` : `${String(count)} more items at ${at}`,
  moreList: 'More items at this time',
  drawHint: 'Press Enter to add time here, or drag across the day.',
  /** Read with a block that moves: its keys, and nothing the eyes don't also have (the grip, the cursor). */
  moveHint: 'Alt and arrow keys move it. Shift and Alt change its length.',
  /** A block held at a new place, said as the keys put it there: "Wednesday 4 November, 10:15 AM – 10:45 AM". */
  moveTo: (where: string) => `Moving to ${where}`,
  /** The place a held block is over can't take it. */
  moveRefused: (where: string) => `${where} isn’t free`,
  /** A held block let go of where it began. */
  moveCancelled: 'Put back',
} as const;
