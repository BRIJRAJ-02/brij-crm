/** Field's built in copy. */
export const strings = {
  readOnly: 'Read only',
  counter: (length: string, max: string) => `${length}/${max}`,
  /** The placeholder an empty attribute field shows. */
  setAttribute: (name: string) => `Set ${name}…`,
} as const;
