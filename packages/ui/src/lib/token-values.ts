// The few token numbers JavaScript needs (a virtual list's row height), read
// from tokens.json so they can never drift from the CSS. Only the size family
// is imported, so the rest of the file stays out of the bundle.
import { size } from '@crm/tokens/tokens.json';

/** A size token's value in pixels, such as `size-nav-item` (28). Throws for a name tokens.json doesn't have. */
export function sizeToken(name: string): number {
  const token = size.tokens.find((candidate) => candidate.name === name);
  if (token === undefined) throw new Error(`No size token called ${name} in tokens.json.`);
  return Number.parseFloat(token.value);
}
