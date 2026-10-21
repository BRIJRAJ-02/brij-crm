// Settings › Account › Security: the page's copy (spec 0033), apart from the other settings pages' own.

/** Settings › Account › Security: the page's copy (spec 0033, AC-890, AC-891, AC-896). */
export const strings = {
  /** The page's title, and its entry in the settings navigation. */
  title: 'Security',
  devices: 'Devices',
  devicesInfo:
    'Every browser signed in to your account. Signing one out sends it to sign in at once. Places come from the network, so they are rough.',
  unknownDevice: 'Unknown browser',
  thisDevice: 'This device',
  activeNow: 'Active now',
  active: (when: string) => `Active ${when}`,
  signOut: 'Sign out',
  signOutLabel: (device: string) => `Sign out ${device}`,
  signOutOthers: 'Sign out of all other devices',
  showMore: 'Show more',
  failedTitle: 'Couldn’t load your devices',
  /** The confirms. */
  signOutTitle: (device: string) => `Sign out ${device}?`,
  signOutText: 'It goes to sign in at once. Anything unsaved there is lost.',
  signOutOthersTitle: 'Sign out of all other devices?',
  signOutOthersText: 'Every other browser goes to sign in at once. You stay signed in here.',
  signingOut: 'Signing out…',
  cancel: 'Cancel',
  stepUpTitle: 'Sign in again first',
  stepUpText: (minutes: number) =>
    `For your safety this needs a sign in from the last ${String(minutes)} minutes. Sign out, sign back in, then try again.`,
  signedOutOthers: (count: number) =>
    count === 1 ? 'Signed out of 1 other device.' : `Signed out of ${String(count)} other devices.`,
} as const;
