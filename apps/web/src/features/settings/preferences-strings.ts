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
  dateFormat: 'Date format',
  weekStart: 'Week starts on',
  automatic: (example: string) => `Automatic (${example})`,
  monday: 'Monday',
  sunday: 'Sunday',
  saturday: 'Saturday',
  /** Where the workspace opens. */
  startPage: 'Start page',
  landing: 'Open on',
  landingDescription: 'The page this workspace opens on.',
  homeSetup: 'Setup checklist on Home',
  homeSetupDescription: 'Shows the steps left to set up this workspace at the top of Home.',
  /** Becomes "Home" once the Home page lands (the home lane): the workspace opens on its first object until then. */
  home: 'First object in the sidebar',
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
  sidebarDescription: 'Kept for you on every device.',
  customise: 'Items in your sidebar',
  customiseDescription: 'Show or hide each object and Scheduling page, or put the default back.',
} as const;
