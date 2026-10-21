/** `/join`'s copy (spec 0031, AC-819). */
export const strings = {
  product: 'Timefix',
  title: 'Join your team',
  atDomain: (domain: string) => `Workspaces people at @${domain} can ask to join.`,
  none: (domain: string) => `No workspace lets people at @${domain} ask to join yet. Ask a teammate to invite you.`,
  ask: (name: string) => `Ask to join ${name}`,
  askShort: 'Ask to join',
  pending: 'Request sent',
  pendingNote: 'An owner or admin will answer. You’ll get an email once you’re in.',
  asked: (name: string) => `Asked to join ${name}.`,
  goHome: 'Go to your workspaces',
  somethingWrong: 'Something went wrong. Try again in a moment.',
} as const;
