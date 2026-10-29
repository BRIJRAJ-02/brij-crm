// Settings › Account › Sign in and devices: the page's copy (spec 0033), apart from the other settings pages' own.

/** Settings › Account › Sign in and devices: the page's copy (spec 0033, AC-890, AC-891, AC-896). */
export const strings = {
  /** The page's title, and its entry in the settings navigation. */
  /** Not "Security": that is the workspace's page, and the sidebar showed it twice (the owner, 22 October 2026). */
  title: 'Sign in and devices',
  devices: 'Signed in devices',
  devicesDescription: 'Each browser and app signed in to your account.',
  /** Recent activity (AC-898): the last 90 days of the account's security events. */
  activity: {
    section: 'Recent activity',
    description: 'Sign ins and changes to how you sign in, from the last 90 days.',
    kinds: {
      sign_in: 'Signed in',
      sign_out: 'Signed out',
      session_revoked: 'Signed out a device',
      sessions_revoked: 'Signed out of other devices',
      two_factor_on: 'Turned on two factor sign in',
      two_factor_off: 'Turned off two factor sign in',
      backup_codes_made: 'Made new backup codes',
      backup_code_used: 'Used a backup code',
      // From before passkeys were taken out (22 October 2026): kept so older history still reads.
      passkey_added: 'Added a passkey',
      passkey_removed: 'Removed a passkey',
      alert_sent: 'Emailed you about a new device',
      google_linked: 'Added Google as a way to sign in',
    },
    methods: { email_code: 'with an email code', google: 'with Google', passkey: 'with a passkey' },
    empty: 'No activity in the last 90 days',
    failedTitle: 'Couldn’t load your recent activity',
    /** What screen readers hear while a failed read is tried again. */
    loading: 'Loading recent activity',
    failedMore: 'Couldn’t load older activity',
    showMore: 'Show more',
  },
  unknownDevice: 'Unknown device',
  thisDevice: 'This device',
  /** A device's line under its name: where, then when it was last used. */
  activeNow: 'Active now',
  active: 'Active',
  signOut: 'Sign out',
  signOutLabel: (device: string) => `Sign out ${device}`,
  signOutOthers: 'Sign out of all other devices',
  showMore: 'Show more',
  failedTitle: 'Couldn’t load your devices',
  noDevices: 'No devices signed in',
  /** The confirms. */
  signOutTitle: (device: string) => `Sign out ${device}?`,
  signOutText: (place: string | undefined) =>
    `${place === undefined ? '' : `Signed in from ${place}. `}That device has to sign in again. Anything unsaved there is lost.`,
  signOutOthersTitle: 'Sign out of all other devices?',
  signOutOthersText: 'Every other device has to sign in again. You stay signed in here.',
  signingOut: 'Signing out',
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
    description: 'Ask for a code from an app when you sign in.',
    app: 'Authenticator app',
    /** The Authenticator app row's InfoTip: why it is worth it (SettingsSection has no slot beside its heading). */
    appInfo: 'Even if someone gets into your email, they can’t sign in without your phone.',
    appOff: 'Off',
    appOn: 'On',
    /** On, and a workspace requires it (AC-885). */
    appRequired: (names: readonly string[]) =>
      `On. ${names.length === 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`} ${names.length === 1 ? 'requires' : 'require'} two factor sign in, so it stays on.`,
    setUp: 'Set up',
    turnOff: 'Turn off',
    backupCodes: 'Backup codes',
    codesLeft: (left: number) => (left === 1 ? '1 left. Each works once.' : `${String(left)} left. Each works once.`),
    newCodes: 'Make new codes',
    failedTitle: 'Couldn’t load two factor sign in',
    setupTitle: 'Set up two factor sign in',
    /** Beside the QR code, in order, with the setup key after the second; the code’s boxes sit under all of it. */
    steps: [
      '1. Open an authenticator app, like Google Authenticator, 1Password or Authy.',
      '2. Scan the code, or type the key.',
      '3. Enter the 6 digit code it shows.',
    ],
    qrLabel: 'QR code for your authenticator app',
    key: 'Setup key',
    copyKey: 'Copy the setup key',
    firstCode: 'Code from your authenticator app',
    turnOn: 'Turn on',
    turningOn: 'Turning on',
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
    turningOff: 'Turning off',
    turnedOff: 'Two factor sign in is off.',
    turnedOn: 'Two factor sign in is on.',
    newCodesTitle: 'Make new backup codes?',
    newCodesText: 'Your old codes stop working.',
    making: 'Making codes',
    fileName: 'timefix-backup-codes.txt',
  },
  /** Deleting the account (AC-902 to AC-907). */
  deletion: {
    /** On Profile, the page's last section, as General's Delete workspace sits (the owner, 22 October 2026). */
    section: 'Danger zone',
    row: 'Delete account',
    /** On the page of a deleted workspace that was the person's last, where Settings can't open. */
    pageAction: 'Delete your account',
    rowText: 'You leave every workspace. Records you made stay, credited to Deleted user.',
    action: 'Delete account',
    title: 'Delete your account?',
    blockedTitleOne: 'Can’t delete your account yet',
    checking: 'Checking your workspaces',
    blockedText: (names: readonly string[]) =>
      names.length === 1
        ? `You’re the last owner of ${names[0] ?? ''}. Make someone else an owner, or delete the workspace.`
        : `You’re the last owner of ${names.join(', ')}. Make someone else an owner of each, or delete them.`,
    openMembers: (name: string) => `Open ${name} members`,
    /** Its General settings, where Delete workspace is. */
    openGeneral: (name: string) => `Open ${name} settings`,
    /** Deleting the account from a deleted workspace's page: nobody it leaves behind can bring the person back. */
    lostWorkspace: (name: string) =>
      `You won’t be able to restore ${name} after this. To keep anything in it, restore it first.`,
    text: 'You’ll leave every workspace, and your sign in, devices and details are deleted. Your link page addresses stay reserved for 90 days, tied to nobody, so no one else is given them. This can’t be undone. Export anything you need from each workspace first.',
    emailLabel: (email: string) => `Type ${email} to confirm`,
    deleting: 'Deleting',
    close: 'Close',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    failed: 'Couldn’t check your workspaces.',
    deleteFailed: 'Couldn’t delete your account. Try again.',
  },
} as const;
