// Availability schedules' copy (spec 0035), apart from booking pages' strings so it loads with the screens only,
// never with the route loaders in the first load.
export const scheduleStrings = {
  schedule: 'Schedule',
  /** The page's Hours choice that follows whichever schedule is the owner's default (AC-965). */
  defaultSchedule: (name: string | undefined) =>
    name === undefined ? 'Default schedule' : `Default schedule (${name})`,
  editHours: 'Edit hours',
  hoursFromSchedule: 'The page books inside this schedule’s hours.',
  stale:
    'These hours were changed in another tab or by someone else. Save again to replace them with yours, or Discard to see theirs.',
  defaultHoursText: 'Your default schedule. Pages that follow it book inside these hours.',
} as const;
