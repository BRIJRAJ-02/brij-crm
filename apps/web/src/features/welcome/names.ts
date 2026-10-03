// The welcome page's suggestions (spec 0005, Value sourcing): a workspace
// name from your name, and a web address from the workspace name. Pure, so
// the rules are tested on their own.

/** A workspace's address: 3 to 40 lowercase letters and digits in single dash runs. The server checks the same rule. */
export const SLUG_RULE = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest address the server takes. */
export const SLUG_MAX = 40;

/** The first word of a name, or empty. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** "<first word>’s workspace" from your name, or empty while there is no name. */
export function suggestedWorkspaceName(yourName: string, possessive: (word: string) => string): string {
  const word = firstWord(yourName);
  return word === '' ? '' : possessive(word);
}

/**
 * A web address from a workspace name: accents dropped, apostrophes removed,
 * every other run of characters that aren't letters or digits turned into one
 * dash, lowercase, at most 40 characters, with no dash at either end.
 */
export function slugFrom(text: string): string {
  const plain = text
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/['’]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return plain.slice(0, SLUG_MAX).replace(/-+$/, '');
}

/** A web address as it is typed: lowercase, each run of spaces a dash, so a space never has to be refused. */
export function addressAsTyped(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/g, '-');
}
