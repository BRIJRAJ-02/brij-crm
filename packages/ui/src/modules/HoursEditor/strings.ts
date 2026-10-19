/** HoursEditor's built in copy. */
export const strings = {
  to: 'to',
  unavailable: 'Unavailable',
  from: (day: string) => `${day} from`,
  until: (day: string) => `${day} until`,
  addRange: (day: string) => `Add hours on ${day}`,
  removeRange: (day: string, start: string, end: string) => `Remove ${start} to ${end} on ${day}`,
  removeRow: (day: string) => `Remove ${day}`,
} as const;
