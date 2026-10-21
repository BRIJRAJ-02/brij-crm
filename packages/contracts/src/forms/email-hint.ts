// The email typo hint (spec 0023, 0023-form-design.md, The field checker): an
// address whose domain looks like a common provider misspelt ("gmial.com")
// gets a suggestion. A hint, never an error: the address may be right. Plain
// TypeScript, no Zod: the hosted page loads it.

/** Providers whose names are long enough that a near miss is a typo, not another company: matched loosely. */
const FUZZY = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'icloud.com',
  'protonmail.com',
  'rediffmail.com',
] as const;

/** Every provider we know, so an exact one is never "corrected"; the short ones (me.com, aol.com) only match exactly. */
const PROVIDERS: readonly string[] = [
  ...FUZZY,
  'live.com',
  'msn.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'gmx.com',
  'gmx.de',
  'web.de',
  'mail.com',
  'zoho.com',
];

/** Edits between two strings, a swap of neighbours counting as one (optimal string alignment). */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const cost: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  );
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const above = cost[row - 1] ?? [];
      const here = cost[row] ?? [];
      const change = a[row - 1] === b[column - 1] ? 0 : 1;
      let best = Math.min((above[column] ?? 0) + 1, (here[column - 1] ?? 0) + 1, (above[column - 1] ?? 0) + change);
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        best = Math.min(best, (cost[row - 2]?.[column - 2] ?? 0) + 1);
      }
      here[column] = best;
    }
  }
  return cost[a.length]?.[b.length] ?? 0;
}

/**
 * The address the visitor probably meant, when its domain is one or two
 * keystrokes from a common provider's ("ada@gmial.com" → "ada@gmail.com");
 * undefined when it is a provider's, nothing close, or not an address yet.
 * Only long provider names are matched loosely, from the same first letter,
 * one edit away (two for the longest), so a company's own domain (ge.com,
 * aon.com, cloud.com) is never "corrected" into a provider's.
 */
export function suggestEmail(typed: string): string | undefined {
  const value = typed.trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return undefined;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (PROVIDERS.includes(domain) || domain.length < 6) return undefined;
  let best: { readonly provider: string; readonly edits: number } | undefined;
  for (const provider of FUZZY) {
    if (provider[0] !== domain[0]) continue;
    const allowed = provider.length >= 13 ? 2 : 1;
    const edits = distance(domain, provider);
    if (edits <= allowed && (best === undefined || edits < best.edits)) best = { provider, edits };
  }
  return best === undefined ? undefined : `${local}@${best.provider}`;
}
