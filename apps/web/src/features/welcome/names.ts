// The welcome page's name suggestions (spec 0005, Value sourcing): a
// workspace name from your name, and a person's name from their email. Pure,
// so the rules are tested on their own. The web address ones live in
// features/address, which Settings › General shares.

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
 * A name made from an email, for someone who gives none (spec 0036,
 * AC-1211): the part before the @ (and before any +tag), split at dots,
 * dashes and underscores, digits dropped, each word capitalised.
 * "ada.lovelace@acme.com" gives "Ada Lovelace". Empty when nothing is left.
 */
export function nameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? '').split('+')[0] ?? '';
  return local
    .split(/[._-]+/)
    .map((word) => word.replaceAll(/\d+/g, ''))
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(' ')
    .slice(0, 80);
}

/**
 * The name a member is made with: the one typed, else the account's own (a
 * Google name), else one made from the email, else the email's first part,
 * so nobody is ever nameless.
 */
export function memberNameFor(typed: string, accountName: string, email: string): string {
  const candidates = [typed, accountName, nameFromEmail(email), email.split('@')[0] ?? '', email];
  return (candidates.map((candidate) => candidate.trim()).find((candidate) => candidate !== '') ?? email).slice(0, 80);
}
