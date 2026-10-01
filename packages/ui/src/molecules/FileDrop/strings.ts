/** FileDrop's built in copy. */
export const strings = {
  dragOr: 'Drag files here, or',
  browse: 'browse',
  upTo: (size: string) => `up to ${size}`,
  wrongType: (name: string, types: string) => `${name} isn’t a file this takes. Choose ${types}.`,
  tooBig: (name: string, size: string) => `${name} is over ${size}. Choose a smaller file, or split it.`,
} as const;
