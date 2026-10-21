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
    `Every other device has to sign in again. If you haven't confirmed it's you in the last ${String(minutes)} minutes, you'll be asked first. Locations are approximate.`,
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
  signedOut: (device: string) => `Signed out ${device}.`,
  signedOutOthers: (count: number) =>
    count === 0
      ? 'No other devices were signed in.'
      : count === 1
        ? 'Signed out of 1 other device.'
        : `Signed out of ${String(count)} other devices.`,
  /** The step up, asked inside a change's own dialog (AC-896). */
  stepUp: {
    title: 'Confirm it’s you',
    withApp: 'Enter the 6 digit code from your authenticator app.',
    withBackup: 'Enter one of your backup codes. It works once.',
    withEmail: 'First we’ll email you a 6 digit code.',
    secondFactorOnly: 'This needs your authenticator app or a backup code.',
    appLabel: 'Code from your authenticator app',
    backupLabel: 'Backup code',
    emailLabel: 'Code from the email',
    useBackup: 'Use a backup code',
    useApp: 'Use your authenticator app',
    send: 'Email me a code',
    sendAgain: 'Send a new code',
    sent: 'Code sent. Check your email.',
    missing: 'Enter the code first.',
  },
  /** Two factor sign in (AC-881, AC-883, AC-885). */
  twoFactor: {
    section: 'Two factor sign in',
    description: 'A code from an app after your email code.',
    info: 'After your email code or Google, you also enter a code from an authenticator app. Someone with your email alone can’t sign in.',
    app: 'Authenticator app',
    appOff: 'Off',
    appOn: 'On',
    setUp: 'Set up',
    turnOff: 'Turn off',
    backupCodes: 'Backup codes',
    codesLeft: (left: number) => (left === 1 ? '1 left. Each works once.' : `${String(left)} left. Each works once.`),
    newCodes: 'Make new codes',
    failedTitle: 'Couldn’t load two factor sign in',
    setupTitle: 'Set up two factor sign in',
    scan: 'Scan this with your authenticator app, then enter the code it shows.',
    qrLabel: 'QR code for your authenticator app',
    key: 'Can’t scan? Enter this key instead:',
    copyKey: 'Copy the setup key',
    firstCode: 'Code from your authenticator app',
    turnOn: 'Turn on',
    turningOn: 'Turning on…',
    codesTitle: 'Save your backup codes',
    codesText: 'Each code signs you in once if you lose your phone. They won’t be shown again.',
    copyCodes: 'Copy the backup codes',
    firstCodeMissing: 'Enter the 6 digit code from your app.',
    download: 'Download',
    saved: 'I’ve saved these',
    done: 'Done',
    continue: 'Continue',
    cancel: 'Cancel',
    turnOffTitle: 'Turn off two factor sign in?',
    turnOffText: 'Signing in will need only your email code or Google. Remembered devices are forgotten.',
    turningOff: 'Turning off…',
    turnedOff: 'Two factor sign in is off.',
    turnedOn: 'Two factor sign in is on.',
    newCodesTitle: 'Make new backup codes?',
    newCodesText: 'Your old codes stop working.',
    making: 'Making codes…',
    fileName: 'timefix-backup-codes.txt',
  },
  /** Deleting the account (AC-902 to AC-907). */
  deletion: {
    section: 'Delete account',
    description: 'Leave every workspace and close your account.',
    row: 'Records you made stay',
    rowText: 'They’re credited to Deleted user.',
    action: 'Delete account',
    title: 'Delete your account?',
    blockedTitleOne: 'Can’t delete your account yet',
    checking: 'Checking your workspaces…',
    blockedText: (names: readonly string[]) =>
      names.length === 1
        ? `You’re the last owner of ${names[0] ?? ''}. Make someone else an owner, or delete the workspace.`
        : `You’re the last owner of ${names.join(', ')}. Make someone else an owner of each, or delete them.`,
    openMembers: (name: string) => `Open ${name} members`,
    text: 'You’ll leave every workspace, and your sign in, devices and details are deleted. This can’t be undone. Export anything you need from each workspace first.',
    emailLabel: (email: string) => `Type ${email} to confirm`,
    deleting: 'Deleting…',
    close: 'Close',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    failed: 'Couldn’t check your workspaces.',
    deleteFailed: 'Couldn’t delete your account. Try again.',
  },
} as const;
