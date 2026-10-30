/** The currency field's built in copy. */
export const strings = {
  currencies: 'Currencies',
  searchCurrencies: 'Search currencies',
  /** Under the field, outside a cell. */
  hint: 'Pick the currency, then type the amount.',
  invalid: (example: string) => `Enter an amount like ${example}, with up to 4 decimals.`,
  /** A pasted symbol or code moved the picker: said once, so the switch is never silent. */
  changedTo: (code: string) => `Currency changed to ${code}.`,
} as const;
