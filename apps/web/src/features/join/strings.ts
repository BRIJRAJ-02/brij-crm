/** `/join`'s copy (spec 0031, AC-819). */
export const strings = {
  product: 'Timefix',
  title: 'Join your team',
  atDomain: (domain: string) => `Workspaces for @${domain}`,
  none: (domain: string) => `None for @${domain}. Ask for an invite.`,
  ask: (name: string) => `Ask to join ${name}`,
  askShort: 'Ask to join',
  pending: 'Request sent',
  pendingNote: 'An owner or admin will answer. You’ll get an email once you’re in.',
  asked: (name: string) => `Asked to join ${name}.`,
  goHome: 'Go to your workspaces',
  createOne: 'Create a workspace',
} as const;
