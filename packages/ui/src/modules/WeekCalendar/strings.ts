/** WeekCalendar's built in copy. */
export const strings = {
  today: (day: string) => `${day}, today`,
  dayBlocks: (day: string, count: number) =>
    count === 0 ? `${day}, nothing on` : count === 1 ? `${day}, 1 item` : `${day}, ${String(count)} items`,
  blockName: (title: string, time: string) => `${title}, ${time}`,
  details: 'Details',
  drawHint: 'Press Enter to add time here, or drag across the day.',
} as const;
