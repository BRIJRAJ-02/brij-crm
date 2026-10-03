/** The welcome screen's copy. */
export const strings = {
  product: 'CRM',
  title: 'Name your workspace',
  description: 'Your records live in a workspace.',
  yourName: 'Your name',
  workspaceName: 'Workspace name',
  webAddress: 'Web address',
  webAddressHint: (slug: string) => (slug === '' ? 'Lowercase letters, digits and dashes.' : `Opens at /w/${slug}`),
  possessive: (word: string) => `${word}’s workspace`,
  create: 'Create workspace',
  creating: 'Creating workspace',
  signOut: 'Sign out',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
  nameMissing: 'Enter your name.',
  workspaceNameMissing: 'Name the workspace.',
  slugInvalid: 'Use 3 to 40 lowercase letters and digits, with single dashes.',
} as const;
