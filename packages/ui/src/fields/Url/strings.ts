/** The url field's built in copy. */
export const strings = {
  /** A plain link's placeholder: an example, since a bare domain is taken. */
  placeholder: 'example.com',
  /** Under a plain link's field, outside a cell. */
  hint: 'A web address. You can leave out https://.',
  invalidLink: 'Enter a web address, such as example.com or https://example.com/about.',
  tooLong: 'A link has at most 2,048 characters.',
  /** Under a network's field, outside a cell, named as the field is: "A handle on LinkedIn, or a link to the profile." */
  socialHint: (label: string) => `A handle on ${label}, or a link to the profile.`,
  invalidSocial: (label: string, example: string) =>
    `Enter a handle on ${label}, such as ${example}, or a link to the profile.`,
  /** A link to one network typed into another's field. */
  otherNetwork: (network: string, label: string) =>
    `That is a link to ${network}. Enter a handle on ${label}, or a link to the profile.`,
} as const;
