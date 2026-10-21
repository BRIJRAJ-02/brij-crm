/** The currency field's built in copy. */
export const strings = {
  currencies: 'Currencies',
  searchCurrencies: 'Search currencies',
  /** Under the field, outside a cell. */
  hint: 'Pick the currency, then type the amount.',
  invalid: (example: string) => `Enter an amount like ${example}, with up to 4 decimals.`,
} as const;
