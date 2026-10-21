/** RecordHeader's built in copy. */
export const strings = {
  loading: 'Loading record',
  /** Read before the avatars of who else has the record open. */
  viewing: 'Also viewing',
  /** The stat strip's name: "About Northwind Traders". */
  about: (name: string) => `About ${name}`,
} as const;
