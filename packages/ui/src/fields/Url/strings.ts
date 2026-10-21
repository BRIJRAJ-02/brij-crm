/** The url field's built in copy. */
export const strings = {
  /** A plain link's placeholder: an example, since a bare domain is taken. */
  placeholder: 'example.com',
  /** Under a plain link's field, outside a cell. */
  hint: 'A web address. You can leave out https://.',
  invalidLink: 'Enter a web address, such as example.com or https://example.com/about.',
  tooLong: 'A link has at most 2,048 characters.',
  /** Under a network's field, outside a cell: "A handle on LinkedIn, or a link to the profile." */
  socialHint: (network: string) => `A handle on ${network}, or a link to the profile.`,
  invalidSocial: (network: string, example: string) =>
    `Enter a handle on ${network}, such as ${example}, or a link to the profile.`,
} as const;
