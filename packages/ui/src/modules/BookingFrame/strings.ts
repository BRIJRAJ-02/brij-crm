/** BookingFrame's built in copy. */
export const strings = {
  about: 'About this meeting',
  loading: 'Loading…',
  product: 'Timefix',
  poweredBy: 'Powered by',
  claim: 'Claim your free page',
  retry: 'Try again',
  /** The host's social links, as a screen reader names the list. */
  socials: (name: string) => `${name}’s social links`,
} as const;
