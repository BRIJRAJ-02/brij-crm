/** The status screen's copy. */
export const strings = {
  /** The page's title, and so its tab's ("System status · CRM"). */
  title: 'System status',
  answering: 'The API and the database are answering.',
  healthy: 'Healthy',
  environment: 'Environment',
  postgres: 'Postgres',
  roundTrip: 'Database round trip',
  milliseconds: (ms: number) => `${String(ms)} ms`,
  checked: 'Checked',
  checking: 'Checking the API and the database…',
  failedTitle: 'The API or the database didn’t answer',
  failedText: 'Check that both are running, then try again.',
  notFoundTitle: 'Page not found',
  notFoundText: 'There’s nothing at this address.',
  notFoundHint: 'Check the address for a typo.',
  /** `/` opens the workspace when signed in and sign in when not, so the link names neither. */
  home: 'Back to the start',
} as const;
