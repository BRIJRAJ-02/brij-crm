// The disconnected calendar banner's copy (spec 0024, AC-619, AC-620): one line, one action, in Settings › Calendars'
// own words (Needs reconnecting), never "sync".

/** The banner's copy. */
export const strings = {
  google: 'Google',
  outlook: 'Outlook',
  stopped: (provider: string) => `Your ${provider} calendar needs reconnecting.`,
  reconnect: 'Reconnect',
  /** Where it can't reconnect from here (sync off, or that provider not offered): the page that can remove it. */
  openCalendars: 'Open calendars',
} as const;
