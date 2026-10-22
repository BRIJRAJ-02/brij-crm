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
      ...(isCancelled === true ? ['canceled'] : []),
    ].join(', '),
  details: 'Details',
  more: (count: number) => `+${String(count)}`,
  moreName: (count: number, at: string) =>
    count === 1 ? `1 more item at ${at}` : `${String(count)} more items at ${at}`,
  moreList: 'More items at this time',
  drawHint: 'Press Enter to add time here, or drag across the day.',
} as const;
