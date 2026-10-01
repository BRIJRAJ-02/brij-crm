/** Meter's built in copy. */
export const strings = {
  usage: (value: string, max: string) => `${value} of ${max}`,
  over: 'Over the limit',
} as const;
