// Currency symbols a pasted or imported amount may carry ("$1,200", "€900",
// "900 €", "₹500"), turned into the code the value holds. Pure.

/** The codes that write their amounts with "$": a default among them keeps "$" its own (CA$ for a Canadian workspace). */
const DOLLARS: ReadonlySet<string> = new Set(['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN']);

/** Each symbol's code when the attribute's default doesn't say otherwise. */
const SYMBOLS: Readonly<Record<string, string>> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
};

/**
 * Text with a leading or trailing currency symbol as "<CODE> <amount>", the
 * shape the currency type reads: "$1,200" is "USD 1,200", "900 €" is
 * "EUR 900". "$" takes the attribute's default when that is a dollar, and
 * "¥" takes CNY when that is the default. Anything else comes back as given.
 */
export function withCurrencyCode(text: string, defaultCode: string | undefined): string {
  const match = /^\s*(-?)\s*([$€£₹¥])\s*(.+?)\s*$/u.exec(text) ?? /^\s*(-?)\s*(.+?)\s*([$€£₹¥])\s*$/u.exec(text);
  if (match === null) return text;
  const [, sign = '', first = '', second = ''] = match;
  const isLeading = first in SYMBOLS;
  const symbol = isLeading ? first : second;
  const amount = isLeading ? second : first;
  const code =
    symbol === '$' && defaultCode !== undefined && DOLLARS.has(defaultCode)
      ? defaultCode
      : symbol === '¥' && defaultCode === 'CNY'
        ? 'CNY'
        : (SYMBOLS[symbol] ?? '');
  return `${code} ${sign}${amount}`;
}
