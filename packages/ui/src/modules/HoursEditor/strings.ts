/** HoursEditor's built in copy. */
export const strings = {
  to: 'to',
  unavailable: 'Unavailable',
  midnight: 'Midnight',
  mixed: 'Mixed',
  allStart: 'All days start',
  allEnd: 'All days end',
  copyTitle: 'Copy times to',
  selectAll: 'Select all',
  apply: 'Apply',
  copyTo: (day: string) => `Copy ${day}’s times to`,
  from: (day: string) => `${day} from`,
  until: (day: string) => `${day} until`,
  addRange: (day: string) => `Add hours on ${day}`,
  removeRange: (day: string, start: string, end: string) => `Remove ${start} to ${end} on ${day}`,
} as const;
