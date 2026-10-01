/** The number field's built in copy. */
export const strings = {
  hint: (example: string) => `A number like ${example}.`,
  invalid: (example: string) => `Enter a number like ${example}, with up to 4 decimals.`,
} as const;
