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
  /** A `/<handle>` nobody holds (25 Oct 2026): the quiet fact, then the offer, then the one action. */
  offerLead: 'Page not found',
  /** The accent word that ends the headline: "timefix.com/ada is free". */
  offerFree: 'is free',
  offerText: 'Make it the page where people book time with you.',
  /**
   * Names the step the button really takes. Signing up is all it can do today: nothing reads the address on the
   * other side yet, so a plain "Claim" would promise something the next screen doesn't do.
   */
  offerAction: (handle: string) => `Sign up and take /${handle}`,
  /** The same action for an address too long to quote on a button; the headline above already carries it whole. */
  offerActionLong: 'Sign up and take this address',
} as const;
