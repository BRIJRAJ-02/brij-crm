// The disconnected calendar banner's copy (spec 0024, AC-619, AC-620).

/** The banner's copy. */
export const strings = {
  google: 'Google',
  outlook: 'Outlook',
  disconnected: (provider: string) =>
    `Your ${provider} calendar disconnected. Your meetings and busy times stop updating until you reconnect it.`,
  failed: (provider: string) =>
    `Your ${provider} calendar hasn’t synced for 6 hours. Timefix keeps trying; reconnecting it often helps.`,
  reconnect: 'Reconnect',
} as const;
