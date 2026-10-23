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

/** A name made from an email, and the name a member is made with: shared with the server (QA Q83). */
export { memberNameFor, nameFromEmail } from '@crm/contracts/member-names';
