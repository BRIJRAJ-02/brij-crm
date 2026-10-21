/** VerifyEmail's built in copy. */
export const strings = {
  /**
   * The line over the boxes, with the address in it: the words before the
   * address, the address as given, and the words after it, so a translation
   * can put the address anywhere in the sentence. The address shows in bold.
   */
  sentTo: <T>(email: T): readonly [before: string, email: T, after: string] => [
    'Enter the code we sent to ',
    email,
    '.',
  ],
  /** The boxes' name for screen readers: the line over them says it on screen. */
  code: 'Code',
  verifying: 'Checking the code',
  resend: 'Resend code',
  resending: 'Resending code',
  /** Announced once a new code has gone out, as focus moves back to the boxes. */
  resent: 'New code sent',
  /** Under a resend that is still waiting: `time` is "42 seconds" or "10 minutes". */
  resendWait: (time: string) => `You can resend the code in ${time}.`,
  /** The same line just after a new code went out. */
  resentWait: (time: string) => `New code sent. You can resend it in ${time}.`,
  useAnotherEmail: 'Use a different email',
} as const;
