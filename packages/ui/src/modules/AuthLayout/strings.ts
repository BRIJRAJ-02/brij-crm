/** AuthLayout's built in copy. */
export const strings = {
  /** At the start of the footer, when the page says who is signed in (first run). */
  signedInAs: (email: string) => `Signed in as ${email}`,
} as const;
