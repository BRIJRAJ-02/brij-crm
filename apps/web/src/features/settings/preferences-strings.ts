// Settings › Account › Preferences: the page's copy (spec 0026), apart from the other settings pages' own.

/** Settings › Account › Preferences: the page's copy (spec 0026, AC-684). */
export const strings = {
  title: 'Preferences',
  appearance: 'Appearance',
  theme: 'Theme',
  /** The theme that follows the device's light or dark setting. */
  system: 'Automatic',
  light: 'Light',
  dark: 'Dark',
  /** Dates (the member's own, in this workspace, on every device). */
  dates: 'Dates and time',
  timeZone: 'Time zone',
  dateFormat: 'Date format',
  weekStart: 'Week starts on',
  automatic: (example: string) => `Automatic (${example})`,
  monday: 'Monday',
  sunday: 'Sunday',
  saturday: 'Saturday',
  /** Where the workspace opens. */
  startPage: 'Start page',
  landing: 'Open on',
  home: 'Home',
  tasks: 'Tasks',
  /** The save toast and its Undo. */
  saved: 'Preferences saved',
  undo: 'Undo',
  undone: 'Change undone',
  /** A failed read. */
  failed: 'Your preferences didn’t load.',
  tryAgain: 'Try again',
  /** The sidebar (spec 0034): what it shows, kept for the person on every device. */
  sidebar: 'Sidebar',
  customise: 'Items in your sidebar',
  /** The row's button; its name for screen readers stays "Customise sidebar", the dialog it opens. */
  customiseAction: 'Customise',
} as const;
