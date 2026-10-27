import type { ConnectResult } from './steps.ts';

/** What a calendar connect that came back says on first run's calendar step. */
interface ConnectOutcome {
  readonly tone: 'success' | 'info' | 'warning' | 'danger';
  readonly title: string;
  readonly text: string;
}

/** First run's copy (spec 0036). */
export const strings = {
  somethingWrong: 'Something went wrong. Try again in a moment.',
  product: 'Timefix',
  /** The pending and failed pages' title, before the step is known. */
  title: 'Getting started',
  steps: 'Setting up',
  back: 'Back',
  continue: 'Continue',
  skip: 'Skip',
  signOut: 'Sign out',

  aboutTitle: 'Your name',
  aboutDescription: 'How your team sees you in Timefix.',
  yourName: 'Your name',
  nameMissing: 'Enter your name, or skip this step.',

  /**
   * The link page made with the workspace (26 Oct 2026), said on Invite your team. Live from the moment it exists
   * and unlisted until its owner says otherwise (27 Oct 2026).
   */
  linkPageReady: 'Your link page is live',
  linkPageAt: 'It is at',
  linkPageNext: 'Anyone with the address can open it. Search engines aren’t told about it until you say so.',
  linkPageEdit: 'Edit link page',

  inviteTitle: 'Invite your team',
  inviteDescription: 'They get an email with a link to join.',
  noEmails: 'Add an email address, or skip this step.',
  invited: (count: number) =>
    count === 0 ? 'No invites sent.' : count === 1 ? 'Invite sent.' : `${String(count)} invites sent.`,
  invitedText: 'You can invite more from Settings › Members.',
  inviteRefused: (emails: string) => `Already in the workspace: ${emails}`,
  inviteUnsent: (emails: string) => `Not sent yet, try again from Settings › Members: ${emails}`,

  workspaceTitle: 'Your workspace',
  workspaceDescription: 'Your records live here. Name it for your team or company.',
  anotherTitle: 'Create a workspace',
  anotherDescription: 'A new workspace starts empty, with you as its owner.',
  workspaceName: 'Workspace name',
  webAddress: 'Web address',
  /** Before the address in its field. */
  addressPrefix: '/w/',
  addressRule: 'Lowercase letters, digits and dashes.',
  addressChecking: 'Checking…',
  addressFree: 'Available',
  addressTaken: 'Taken',
  /** The free addresses offered under the field. */
  addressSuggestions: 'Free addresses',
  /** Announced once a check settles, naming the address, so a screen reader hears which one it was. */
  addressFreeSaid: (slug: string) => `${slug} is free.`,
  addressTakenSaid: (slug: string) => `${slug} is taken.`,
  addressOthers: (slugs: readonly string[]) => `Also free: ${slugs.join(', ')}.`,
  /** The check couldn't answer (offline, too many checks): Create still has the last word. */
  addressUnknown: 'Not checked. Create will check it.',
  possessive: (word: string) => `${word}’s workspace`,
  create: 'Create workspace',
  creating: 'Creating workspace',
  workspaceNameMissing: 'Name the workspace.',
  slugInvalid: 'Use 3 to 40 lowercase letters and digits, with single dashes.',

  calendarTitle: 'Connect your calendar',
  calendarDescription: 'Your meetings show on the people and companies you meet. Outlook is coming soon.',
  connectGoogle: 'Connect Google Calendar',
  connectingGoogle: 'Opening Google',
  connectOutlook: 'Connect Outlook',
  outlookSoon: 'Outlook is coming soon.',
  skipCalendar: 'Skip for now',
  opening: 'Opening your workspace',
  /** What a connect that came back with `?calendar=` says. */
  results: {
    connected: {
      tone: 'success',
      title: 'Google Calendar is connected.',
      text: 'Your meetings are syncing. They show on records within a few minutes.',
    },
    denied: {
      tone: 'info',
      title: 'Calendar not connected',
      text: 'You didn’t give Timefix access. Connect again, or skip for now.',
    },
    scope: {
      tone: 'warning',
      title: 'Calendar not connected',
      text: 'Timefix needs to see your events and when you’re busy. Connect again and leave both boxes ticked.',
    },
    limit: {
      tone: 'warning',
      title: 'Calendar not connected',
      text: 'You’ve connected the most calendars you can.',
    },
    off: {
      tone: 'info',
      title: 'Calendar sync isn’t set up',
      text: 'You can skip this step.',
    },
    failed: {
      tone: 'danger',
      title: 'Calendar not connected',
      text: 'Something went wrong on the way back from Google. Try again.',
    },
  } satisfies Record<ConnectResult, ConnectOutcome>,
} as const;
