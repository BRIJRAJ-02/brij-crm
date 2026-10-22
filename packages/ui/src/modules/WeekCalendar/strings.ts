/** WeekCalendar's built in copy. */
export const strings = {
  today: (day: string) => `${day}, today`,
  dayBlocks: (day: string, count: number) =>
    count === 0 ? `${day}, nothing on` : count === 1 ? `${day}, 1 item` : `${day}, ${String(count)} items`,
  dayLoading: (day: string) => `${day}, loading`,
  /** A block's name: its title and time, then who it is with and whether it was called off, when the screen says. */
  blockName: (title: string, time: string, detail?: string, isCancelled?: boolean) =>
    [title, time, ...(detail === undefined ? [] : [detail]), ...(isCancelled === true ? ['canceled'] : [])].join(', '),
  details: 'Details',
  more: (count: number) => `+${String(count)}`,
  moreName: (count: number, at: string) =>
    count === 1 ? `1 more item at ${at}` : `${String(count)} more items at ${at}`,
  moreList: 'More items at this time',
  allDay: 'All day',
  allDayOn: (day: string) => `all day ${day}`,
  allDayMore: (count: number) => `+${String(count)} more`,
  allDayMoreName: (count: number, day: string) =>
    count === 1 ? `1 more all day item on ${day}` : `${String(count)} more all day items on ${day}`,
  allDayList: (day: string) => `All day on ${day}`,
  drawHint: 'Press Enter to add time here, or drag across the day.',
} as const;
