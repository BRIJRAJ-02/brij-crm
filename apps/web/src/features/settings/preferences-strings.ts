// Settings › Account › Preferences: the page's copy (spec 0026), apart from the other settings pages' own.

/** Settings › Account › Preferences: the page's copy (spec 0026, AC-684). */
export const strings = {
  title: 'Preferences',
  appearance: 'Appearance',
  theme: 'Theme',
  themeDescription: 'Saved on this browser.',
  system: 'System preference',
  light: 'Light',
  dark: 'Dark',
  /** Dates (the member's own, in this workspace, on every device). */
  dates: 'Dates and time',
  timeZone: 'Time zone',
  timeZoneDescription: 'Dates and times across the app show in this zone.',
  browserZone: (zone: string) => `This browser’s (${zone})`,
  dateFormat: 'Date format',
  weekStart: 'Week starts on',
  automatic: (example: string) => `Automatic (${example})`,
  monday: 'Monday',
  sunday: 'Sunday',
  saturday: 'Saturday',
  /** Where the workspace opens. */
  startPage: 'Start page',
  landing: 'Open the workspace on',
  landingDescription: 'Where you land after signing in.',
  home: 'Home',
  tasks: 'Tasks',
  /** The save toast and its Undo. */
  saved: 'Preferences saved',
  undo: 'Undo',
} as const;
