// A member's name when they give none (spec 0036, AC-1211): one rule for first
// run on the web and for every server path that makes a member (an invite
// accepted, a link join, an approved request), so nobody is named after the
// raw local part of their address in one place and properly in another (QA Q83).

/**
 * A name made from an email: the part before the @ (and before any +tag),
 * split at dots, dashes and underscores, digits dropped, each word
 * capitalised. "ada.lovelace@acme.com" gives "Ada Lovelace". Empty when
 * nothing is left.
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
 * so nobody is ever nameless. At most 80 characters.
 */
export function memberNameFor(typed: string, accountName: string, email: string): string {
  const candidates = [typed, accountName, nameFromEmail(email), email.split('@')[0] ?? '', email];
  return (candidates.map((candidate) => candidate.trim()).find((candidate) => candidate !== '') ?? email).slice(0, 80);
}
