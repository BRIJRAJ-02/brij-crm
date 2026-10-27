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
  nameMissing: 'Enter your name.',

  handleTitle: 'Your link page',
  handleDescription: 'One address for everything you share. Your booking page is already on it.',
  handleLabel: 'Your link',
  handleHint: '3 to 40 lowercase letters, digits and dashes.',
  handleMissing: 'Pick a link.',
  claim: 'Claim your link page',
  claiming: 'Claiming your link page',
  /** Over the phone beside the step, so the sketch reads as what it is. */
  handlePreview: 'Your link page',

  bookingTitle: 'Your booking page',
  bookingDescription: 'A page people open to book time with you. It goes on your link page.',
  bookingName: 'What are you offering?',
  bookingNamePlaceholder: 'Intro call',
  bookingNameMissing: 'Name the meeting.',
  bookingLength: 'How long is it?',
  /** Each length a first page may offer, in minutes; the page's editor offers the rest. */
  bookingLengths: [15, 30, 45, 60] as const,
  bookingLengthLabel: (minutes: number) => `${String(minutes)} min`,
  /** The sketch of the booking page beside the step: its own words, never a real page's. */
  previewChooseTime: 'Choose a time',
  createPage: 'Create booking page',
  creatingPage: 'Creating booking page',
  /** Under the fields: where the page lands, so nothing about it is a surprise. */
  bookingNote: 'It opens straight away, and you can change its hours and questions afterwards.',

  /** The end (27 October 2026): what first run made, before the workspace opens. */
  doneTitle: 'You’re live',
  doneDescription: 'Your link page is up, with your booking page on it. Share the address and people can book you.',
  doneLink: 'Your link',
  doneCopy: 'Copy link',
  doneCopied: 'Link copied',
  doneOpen: 'Open your page',
  doneGo: 'Go to Timefix',

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
  /** The calendar step's way on without connecting: it isn't a skip, since nothing here can be forced. */
  calendarLater: 'Continue without a calendar',
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
