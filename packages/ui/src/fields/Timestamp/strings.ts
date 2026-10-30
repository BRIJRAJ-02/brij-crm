/** The date and time field's built in copy. */
export const strings = {
  /** The time of day beside the day, named with the field, so two date and time fields never read alike. */
  time: (field: string) => `${field} time`,
  /** The time while no day is chosen. */
  noTime: 'Time',
  /** Under the day, outside a cell. */
  hint: 'Type a date, such as “next fri”, or pick one, then a time.',
  /** A paste that names no moment. */
  notAMoment: (text: string) => `“${text}” isn’t a date and time. Use 2026-10-08 14:30.`,
} as const;
