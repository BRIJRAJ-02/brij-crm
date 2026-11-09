// The sidebar's business switcher's words (spec 0065 H7), apart from the suite's strings so the first load carries
// only these.

/** What the switcher says. */
export const switchStrings = {
  business: 'Business',
  switchBusiness: 'Switch business',
  showingNow: (name: string) => `Showing ${name}`,
} as const;
