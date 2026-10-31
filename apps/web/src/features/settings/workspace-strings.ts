import { sharedStrings } from '@crm/ui';
import type { GooglePhotoResult } from './google-photo-result.ts';

/** Settings › Workspace › General and Account › Profile copy (spec 0031, slice 7). */
export const strings = {
  // Workspace › General.
  generalTitle: 'General',
  workspaceSection: 'Details',
  name: 'Workspace name',
  timeZone: 'Time zone',
  timeZoneInfo: 'Default for new pages and members.',
  copyAddress: 'Copy address',
  /** The address row: the whole link, read only; owners and admins change the part after /w/ in its dialog. */
  webAddress: 'Web address',
  addressPrefix: '/w/',
  addressRule: '3 to 40 lowercase letters and digits, with single dashes.',
  addressChecking: 'Checking',
  addressFree: 'Free',
  addressTaken: 'Taken',
  addressSuggestions: 'Free addresses',
  addressUnknown: 'Not checked. Change address will check it.',
  addressFreeSaid: (slug: string) => `${slug} is free.`,
  addressTakenSaid: (slug: string) => `${slug} is taken.`,
  addressOthers: (slugs: readonly string[]) => `Also free: ${slugs.join(', ')}.`,
  addressInvalid: 'Use 3 to 40 lowercase letters and digits, with single dashes.',
  // Changing the address: its own dialog, opened from the row's Change, with the address checked as typed.
  changeAddress: 'Change',
  changeAddressLabel: 'Change web address',
  moveTitle: 'Change the web address',
  /** The move as one line, once a new address is typed. */
  moveFromTo: (from: string, to: string) => `/w/${from} → /w/${to}`,
  /** Under it, always: links and bookmarks with the old address open the new one, and no one else can take it. */
  oldLinksWork: 'Old links still work.',
  moveAction: 'Change address',
  moved: (to: string) => `The workspace is now at /w/${to}.`,
  /** It moved, but the page couldn't open there. */
  movedReload: (to: string) => `The workspace is now at /w/${to}. Reload the page to open it there.`,
  /** On General's note after such a move: opens the page at the new address. */
  reload: 'Reload',
  /** A rename that didn't go through for a reason other than the name: the reason comes as a toast. */
  nameNotSaved: 'Not saved. Press Enter to try again.',
  nameMissing: 'Name the workspace.',
  nameChanged: 'Name changed.',
  yourNameMissing: 'Enter your name.',
  zoneChanged: (zone: string) => `Time zone is now ${zone}.`,
  undo: 'Undo',
  /** An Undo pressed after the name or time zone changed again (here or by another admin): the newer one stays. */
  undoStale: sharedStrings.undoStale,
  /** Said once, at the top of the page, to readers without `workspace.manage`; the fields keep their locks. */
  readOnly: sharedStrings.ownersAndAdminsOnly,
  failed: 'Couldn’t load the settings',
  failedText: 'Check your connection, then try again.',
  // The danger zone (owners only).
  danger: 'Danger zone',
  /** Profile's first section: the picture, name and sign in email. */
  detailsSection: 'Your details',
  deleteRow: 'Delete workspace',
  deleteRowText: 'Restorable for 30 days.',
  deleteAction: 'Delete workspace',
  deleteTitle: (name: string) => `Delete ${name}?`,
  deleteText: 'Everyone loses access. Restorable for 30 days.',
  /** A quiet line under the delete confirm's sentence (a link to export comes with export). */
  exportFirst: 'Export anything you want to keep first.',
  typeName: (name: string) => `Type “${name}” to confirm`,
  cancel: 'Cancel',
  /** The address dialog's Cancel, once the workspace moved and there is nothing left to cancel. */
  close: 'Close',
  deleted: (name: string) => `${name} was deleted.`,
  restore: 'Restore',
  restored: (name: string) => `${name} is back.`,
  // Account › Profile.
  profileTitle: 'Profile',
  /** The public profile on Profile (22 Oct 2026): the handle booking addresses start with, and a bio. */
  publicProfileSection: 'Public profile',
  publicProfileText: 'Your public address in this workspace.',
  handle: 'Handle',
  handleNew: 'Suggested. Claim it or change it.',
  handleKept: 'Your old address keeps working if you change it.',
  /** Under the claim note when they already have a link page in another workspace of theirs (spec 0056, AC-5618). */
  otherLinkPages: (names: readonly string[]) =>
    `You have link pages in ${new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names)}.`,
  handleFix: 'Fix your handle first.',
  claimHandle: 'Claim',
  bio: 'Bio',
  bioText: 'One line under your name on your page.',
  bioNeedsHandle: 'Claim a handle first: the bio shows on its page.',
  yourPage: 'Your page',
  /**
   * Under Your page while it is private (spec 0058, AC-23): the link page's own words for it (`homeStrings.privateLine`),
   * written out rather than imported, since this module rides in the first load and the link page's copy doesn't.
   */
  yourPagePrivate: 'Private. Only you can open it.',
  copyLink: 'Copy link',
  /** Under their name beside the picture, when the picture is the one their Google account gave. */
  fromGoogle: 'From Google',
  /** Sync Google photo (23 Oct 2026): fetches their Google account's current photo, linking Google first if need be. */
  syncGooglePhoto: 'Sync Google photo',
  /** Its fuller name while Google isn't linked, saying what else it does (it starts with the visible label). */
  syncGooglePhotoAndSignIn: 'Sync Google photo and add Google sign in',
  /** The button while the browser leaves for Google. */
  openingGoogle: 'Opening Google',
  /** Under their name when Google isn't linked yet: which account to choose, and that it becomes a way in. */
  googleUnlinked: (email: string) => `Choose the Google account for ${email}. It also becomes a way to sign in.`,
  /** Under their name when Google is linked but no photo came from it yet. */
  googleNoPhoto: 'Sync to use the photo on your Google account.',
  /** Under their name while the page has changes: leaving for Google would lose them. */
  saveBeforeSync: 'Save or discard your changes first.',
  /** Closes the note about how a sync went. */
  dismiss: 'Dismiss',
  /**
   * How a sync went, as `?google-photo=` names it on the way back from Google: `synced` is a toast (the owner's
   * words), every other one the page's note until dismissed.
   */
  googlePhoto: {
    synced: {
      tone: 'success',
      title: 'Google photo synced',
      text: () => 'Your Google photo is on your profile and booking pages.',
    },
    none: {
      tone: 'info',
      title: 'No photo at Google',
      text: () => 'Your Google account has no photo, so nothing changed.',
    },
    kept: {
      tone: 'info',
      title: 'Your photo stays',
      text: () => 'Your current photo isn’t from Google, so a Google photo doesn’t replace it.',
    },
    cancelled: {
      tone: 'info',
      title: 'Google photo not synced',
      text: () => 'You didn’t give Timefix access, so nothing changed.',
    },
    'other-email': {
      tone: 'danger',
      title: 'Google photo not synced',
      text: (email: string) => `That Google account uses a different email. Choose the one for ${email}.`,
    },
    'other-account': {
      tone: 'danger',
      title: 'Google photo not synced',
      text: () => 'That Google account signs in to another Timefix account, so it can’t be used here.',
    },
    unverified: {
      tone: 'danger',
      title: 'Google photo not synced',
      text: () => 'Google couldn’t be added to your account. Try again, or choose another Google account.',
    },
    failed: {
      tone: 'danger',
      title: 'Google photo not synced',
      text: () => 'Your Google photo couldn’t be synced. Try again.',
    },
  } as const satisfies Record<GooglePhotoResult, unknown>,
  yourName: 'Your name',
  email: 'Email',
  emailUse: 'Used to sign in',
  sameAsWorkspace: (zone: string) => `Same as the workspace (${zone})`,
  zoneFollows: 'Your time zone now follows the workspace.',
} as const;
