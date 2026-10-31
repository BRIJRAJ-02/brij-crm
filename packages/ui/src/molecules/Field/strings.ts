/**
 * A sentence case name as it reads mid sentence: "Default value" becomes "default value", so a placeholder says
 * "Set default value…" (owner item 97). A one word name ("Twitter") or one whose second word is capitalised
 * ("LinkedIn URL", "New York") keeps its case, since it may be a name.
 */
export const inSentence = (name: string): string =>
  /^[A-Z][a-z]+ [a-z]/u.test(name) ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;

/** Field's built in copy. */
export const strings = {
  readOnly: 'Read only',
  counter: (length: string, max: string) => `${length}/${max}`,
  /** The placeholder an empty attribute field shows. */
  setAttribute: (name: string) => `Set ${inSentence(name)}…`,
} as const;
