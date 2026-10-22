/** The email preferences page's copy, and the one click unsubscribe's (the emails lane). */
export const strings = {
  product: 'Timefix',
  title: 'Email preferences',
  description: (workspace: string) => `Choose which emails you get from ${workspace}.`,
  topics: {
    form_submissions: {
      label: 'New form submissions',
      description: 'An email for each new submission to a form you’re told about.',
      stopped: (workspace: string) => `You won’t get an email for each new form submission in ${workspace} any more.`,
    },
    mentions: {
      label: 'Mentions',
      description: 'An email when someone mentions you in a comment or a note.',
      stopped: (workspace: string) => `You won’t get an email when someone mentions you in ${workspace} any more.`,
    },
  },
  always: 'Emails about signing in, your account and your bookings always come.',
  refused: 'That change didn’t save, so it’s back as it was.',
  goneTitle: 'This link has expired',
  goneText:
    'Links in emails stop working after a year, or once you leave the workspace. The next email you get has a new one.',
  unsubscribeTitle: 'Unsubscribe',
  unsubscribeAsk: 'Stop getting emails like the one this link came in?',
  unsubscribe: 'Unsubscribe',
  unsubscribing: 'Unsubscribing',
  unsubscribeFailed: 'That didn’t go through',
  unsubscribedTitle: 'You’re unsubscribed',
  otherChoices:
    'Your other email choices stay as they are. To change them, use the Email preferences link at the bottom of any of these emails.',
} as const;
