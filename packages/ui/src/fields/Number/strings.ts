/** The number field's built in copy. */
export const strings = {
  hint: (example: string) => `A number like ${example}.`,
  invalid: (example: string) => `Enter a number like ${example}, with up to 4 decimals.`,
  /** A percent attribute's number, as typed, with its sign. */
  percent: (shown: string) => `${shown}%`,
  percentSign: '%',
} as const;
