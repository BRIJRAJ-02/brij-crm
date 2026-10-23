/** Settings › Workspace › General and Account › Profile copy (spec 0031, slice 7). */
export const strings = {
  // Workspace › General.
  generalTitle: 'General',
  workspaceSection: 'Details',
  name: 'Workspace name',
  /** The name saves on its own once it changed (Enter, or leaving the field), said with Undo. */
  nameChanged: 'Name changed.',
  timeZone: 'Time zone',
  timeZoneInfo: 'New booking pages and members start in this time zone. Each person can pick their own.',
  copyAddress: 'Copy address',
  /** The address row: the whole link, Copy, and for owners and admins Change, which opens the address dialog. */
  webAddress: 'Web address',
  changeAddress: 'Change',
  addressPrefix: '/w/',
  addressRule: '3 to 40 lowercase letters and digits, with single dashes.',
  addressChecking: 'Checking',
  addressFree: 'Free',
  addressTaken: 'Taken',
  addressSuggestions: 'Free addresses',
  addressUnknown: 'Couldn’t check this address. Try again in a moment.',
  addressFreeSaid: (slug: string) => `${slug} is free.`,
  addressTakenSaid: (slug: string) => `${slug} is taken.`,
  addressOthers: (slugs: readonly string[]) => `Also free: ${slugs.join(', ')}.`,
  addressInvalid: 'Use 3 to 40 lowercase letters and digits, with single dashes.',
  // Changing the address: its own dialog, with the address field and what happens to old links.
  moveTitle: 'Change the web address?',
  moveText: (from: string, to: string) =>
    `The workspace moves from /w/${from} to /w/${to}. Links and bookmarks with /w/${from} keep working and open the new address, and no other workspace can take /w/${from}.`,
  /** Before a new address is typed: what happens to the old one. */
  moveKept: (from: string) =>
    `Links and bookmarks with /w/${from} keep working and open the new address, and no other workspace can take /w/${from}.`,
  moveAction: 'Change address',
  moved: (to: string) => `The workspace is now at /w/${to}.`,
  nameMissing: 'Name the workspace.',
  yourNameMissing: 'Enter your name.',
  zoneChanged: (zone: string) => `Time zone is now ${zone}.`,
  undo: 'Undo',
  readOnly: 'Only owners and admins can change this.',
  failed: 'Couldn’t load the settings',
  failedText: 'Check your connection, then try again.',
  somethingWrong: 'Something went wrong. Try again in a moment.',
  // The danger zone (owners only).
  danger: 'Danger zone',
  /** Profile's first section: the picture, name and sign in email. */
  detailsSection: 'Your details',
  deleteRow: 'Delete workspace',
  deleteRowText: 'Everyone loses access. Any owner can restore it for 30 days.',
  deleteAction: 'Delete workspace',
  deleteTitle: (name: string) => `Delete ${name}?`,
  deleteText:
    'Everyone loses access now and gets an email. Any owner can restore it for 30 days, then it’s gone for good.',
  /** A quiet line under the typed name. */
  exportFirst: 'Export anything you want to keep first.',
  typeName: (name: string) => `Type “${name}” to confirm`,
  cancel: 'Cancel',
  deleted: (name: string) => `${name} was deleted.`,
  restore: 'Restore',
  restored: (name: string) => `${name} is back.`,
  // Account › Profile.
  profileTitle: 'Profile',
  /** The public profile on Profile (22 Oct 2026): the handle booking addresses start with, and a bio. */
  publicProfileSection: 'Public profile',
  publicProfileText: 'Your booking pages live at your handle, and so does a page listing your public ones.',
  handle: 'Handle',
  handleNew: 'Suggested from your name. Claim it, or change it and save. Your pages keep their /b/ links until then.',
  handleKept: 'The same in every workspace. If you change it, your old address keeps working.',
  handleFix: 'Fix your handle first.',
  claimHandle: 'Claim',
  bio: 'Bio',
  bioText: 'One line under your name on your page.',
  bioNeedsHandle: 'Claim a handle first: the bio shows on its page.',
  yourPage: 'Your page',
  copyLink: 'Copy link',
  /** Under their name beside the picture, when the picture is the one their Google account gave. */
  fromGoogle: 'From Google',
  yourName: 'Your name',
  email: 'Email',
  emailUse: 'Used to sign in',
  leaveConfirm: 'Leave without saving your change?',
  sameAsWorkspace: (zone: string) => `Same as the workspace (${zone})`,
  zoneFollows: 'Your time zone now follows the workspace.',
} as const;
