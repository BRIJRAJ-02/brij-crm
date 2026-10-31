/** RecordPanel's built in copy. */
export const strings = {
  previous: 'Previous record',
  next: 'Next record',
  openPage: 'Open full page',
  loading: 'Loading record',
  /** The title while the panel says the record isn't available (`empty`). */
  unavailable: 'Record unavailable',
  /** The stat strip's name: "About Northwind Traders". */
  about: (name: string) => `About ${name}`,
  failed: 'This record didn’t load',
  noAccess: 'You can’t see this record',
  noAccessBody: 'Ask a workspace admin for access.',
} as const;
