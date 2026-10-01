/** FilterChip's built in copy. */
export const strings = {
  chooseValue: 'Choose a value',
  remove: 'Remove filter',
  filter: (attribute: string, operator: string) => `Filter: ${attribute} ${operator}`,
} as const;
