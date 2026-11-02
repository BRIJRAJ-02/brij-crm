/** FileDrop's built in copy. */
export const strings = {
  dragOr: 'Drag files here, or',
  /** One file at a time (an import's CSV): the words say so. */
  dragOneOr: 'Drag a file here, or',
  browse: 'browse',
  /** While what was picked is on its way (`isPending` on the zone). */
  sending: 'uploading…',
  upTo: (size: string) => `up to ${size}`,
  wrongType: (name: string, types: string) => `${name} isn’t a file this takes. Choose ${types}.`,
  tooBig: (name: string, size: string) => `${name} is over ${size}. Choose a smaller file, or split it.`,
} as const;
