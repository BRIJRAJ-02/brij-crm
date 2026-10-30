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
  yourName: 'Your name',
  nameMissing: 'Enter your name.',
  /** The photo on Your name (27 October 2026), uploaded from their device. */
  photoLabel: 'Photo (optional)',
  usePhoto: 'Upload photo',
  changePhoto: 'Change photo',
  photoUnreadable: 'That picture couldn’t be read. Try a JPEG or PNG.',

  handleTitle: 'Your link page',
  handleLabel: 'Your link',
  handleMissing: 'Pick a link.',
  claim: 'Continue',
  claiming: 'Saving',
  /** Over the phone beside the step, so the sketch reads as what it is. */
  handlePreview: 'Your link page',
  /** The optional links on Your link page (27 October 2026): a head start on a page with one booking page on it. */
  linksLabel: 'Links (optional)',
  /** Each row's name for screen readers: the rows share one visible label. */
  linkLabel: (n: number) => `Link ${String(n)}`,
  linkPlaceholder: 'yoursite.com',
  linkAdd: 'Add link',

  bookingTitle: 'Your booking page',
  bookingName: 'Meeting name',
  bookingNamePlaceholder: 'Intro call',
  bookingNameMissing: 'Name the meeting.',
  bookingLength: 'Length',
  /** Each length a first page may offer, in minutes; the page's editor offers the rest. */
  bookingLengths: [15, 30, 45, 60] as const,
  bookingLengthLabel: (minutes: number) => `${String(minutes)} min`,
  /** The sketch of the booking page beside the step: its own words, never a real page's. */
  previewChooseTime: 'Choose a time',
  createPage: 'Continue',
  creatingPage: 'Creating',
  /** Under the length: that nothing here is final. */
  bookingNote: 'You can change this later.',

  /** The end (27 October 2026): what first run made, before the workspace opens. */
  doneTitle: 'You’re live',
  doneDescription: 'Share your links and people can book you.',
  /** The two tiles (spec 0058, AC-7): the booking page and the link page, each with Copy link and Open. */
  doneBooking: 'Booking page',
  doneMinutes: (minutes: number) => `${String(minutes)} min`,
  doneLinkOnly: 'Link only',
  doneLinkPage: 'Your link page',
  doneLinkPageFacts: 'Your links and booking pages',
  doneOpenTip: 'Open in a new tab',
  doneOpen: (title: string) => `Open ${title} in a new tab`,
  doneGo: 'Go to dashboard',

  inviteTitle: 'Invite your team',
  inviteDescription: 'They’ll get an email to join.',
  noEmails: 'Add an email, or skip for now.',
  /** Calendar and Invite your team's secondary action, the same words on both (spec 0058, AC-25). */
  skipForNow: 'Skip for now',
  invited: (count: number) =>
    count === 0 ? 'No invites sent.' : count === 1 ? 'Invite sent.' : `${String(count)} invites sent.`,
  invitedText: 'Invite more any time from Settings.',
  inviteRefused: (emails: string) => `Already in the workspace: ${emails}`,
  inviteUnsent: (emails: string) => `Not sent yet, try again from Settings › Members: ${emails}`,

  workspaceTitle: 'Your workspace',
  workspaceDescription: 'Name it after your team or company.',
  anotherTitle: 'Create a workspace',
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
  calendarDescription: 'So people only book when you’re free.',
  connectGoogle: 'Connect Google Calendar',
  connectingGoogle: 'Opening Google',
  connectOutlook: 'Connect Outlook',
  outlookSoon: 'Outlook is coming soon.',
  opening: 'Opening your workspace',
  /** What a connect that came back with `?calendar=` says. */
  results: {
    connected: {
      tone: 'success',
      title: 'Google Calendar is connected.',
      text: 'Your meetings are syncing.',
    },
    denied: {
      tone: 'info',
      title: 'Calendar not connected',
      text: 'You didn’t give Timefix access.',
    },
    scope: {
      tone: 'warning',
      title: 'Calendar not connected',
      text: 'Leave both boxes ticked at Google, then connect again.',
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
      text: 'Couldn’t connect. Try again.',
    },
  } satisfies Record<ConnectResult, ConnectOutcome>,
} as const;
