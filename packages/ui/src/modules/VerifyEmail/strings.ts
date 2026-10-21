/** VerifyEmail's built in copy. */
export const strings = {
  /**
   * The lines over the boxes, with the address in them: the words before the
   * address, the address as given, and the words after it, so a translation
   * can put the address anywhere. The address shows in the strong weight on a
   * line of its own, so a long one never splits partway along a line of words.
   */
  sentTo: <T>(email: T): readonly [before: string, email: T, after: string] => [
    'Enter the code we sent to ',
    email,
    '',
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
