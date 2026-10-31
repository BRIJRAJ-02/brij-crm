/** FileItem's built in copy. */
export const strings = {
  uploading: (name: string) => `Uploading ${name}`,
  remove: (name: string) => `Remove ${name}`,
  /** Between the size and who added it and when. */
  separator: ' · ',
} as const;
