// Settings › Account › Security: the page's copy (spec 0033), apart from the other settings pages' own.

/** Settings › Account › Security: the page's copy (spec 0033, AC-890, AC-891, AC-896). */
export const strings = {
  /** The page's title, and its entry in the settings navigation. */
  title: 'Security',
  devices: 'Devices',
  columns: { device: 'Device', place: 'Location', lastActive: 'Last active', actions: 'Actions' },
  unknownDevice: 'Unknown device',
  unknownPlace: 'Unknown',
  thisDevice: 'This device',
  /** This device's last use, in RelativeTime's own word for the moment. */
  now: 'now',
  signOut: 'Sign out',
  signOutLabel: (device: string) => `Sign out ${device}`,
  signOutOthers: 'Sign out of all other devices',
  signOutOthersInfo: (minutes: number) =>
    `Every other device has to sign in again. It needs a sign in here in the last ${String(minutes)} minutes. Locations are approximate.`,
  showMore: 'Show more',
  failedTitle: 'Couldn’t load your devices',
  noDevices: 'No devices signed in',
  /** The confirms. */
  signOutTitle: (device: string) => `Sign out ${device}?`,
  signOutText: (place: string | undefined) =>
    `${place === undefined ? '' : `Signed in from ${place}. `}That device has to sign in again. Anything unsaved there is lost.`,
  signOutOthersTitle: 'Sign out of all other devices?',
  signOutOthersText: 'Every other device has to sign in again. You stay signed in here.',
  signingOut: 'Signing out…',
  cancel: 'Cancel',
  close: 'Close',
  stepUpTitle: 'Sign in again first',
  stepUpText: (minutes: number) =>
    `For your safety this needs a sign in from the last ${String(minutes)} minutes. Sign out, sign back in, then try again.`,
  signedOut: (device: string) => `Signed out ${device}.`,
  signedOutOthers: (count: number) =>
    count === 0
      ? 'No other devices were signed in.'
      : count === 1
        ? 'Signed out of 1 other device.'
        : `Signed out of ${String(count)} other devices.`,
} as const;
