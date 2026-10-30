// Currency symbols a pasted or imported amount may carry ("$1,200", "€900",
// "900 €", "₹500", "US$5"), turned into the code the value holds. Pure.

/** The codes that write their amounts with "$": a default among them keeps "$" its own (CA$ for a Canadian workspace). */
const DOLLARS: ReadonlySet<string> = new Set(['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN']);

/** Each symbol's code when the attribute's default doesn't say otherwise. Longer symbols first, so "US$" wins over "$". */
const SYMBOLS: Readonly<Record<string, string>> = {
  US$: 'USD',
  CA$: 'CAD',
  C$: 'CAD',
  AU$: 'AUD',
  A$: 'AUD',
  NZ$: 'NZD',
  S$: 'SGD',
  HK$: 'HKD',
  R$: 'BRL',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  '₩': 'KRW',
  '₪': 'ILS',
  '₺': 'TRY',
  '₱': 'PHP',
  '₫': 'VND',
  '₦': 'NGN',
};

/** Every symbol, the longest first, for a reader that strips one off either end of an amount. */
export const CURRENCY_SYMBOLS: readonly string[] = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);

/**
 * The code a symbol names: "$" takes the default when that is a dollar, and
 * "¥" takes CNY when that is the default; otherwise the symbol's own.
 */
export function codeOfSymbol(symbol: string, defaultCode: string | undefined): string | undefined {
  if (symbol === '$' && defaultCode !== undefined && DOLLARS.has(defaultCode)) return defaultCode;
  if (symbol === '¥' && defaultCode === 'CNY') return 'CNY';
  return SYMBOLS[symbol];
}

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
  return `${codeOfSymbol(symbol, defaultCode) ?? ''} ${sign}${amount}`;
}
