/** VerifyEmail's built in copy. */
export const strings = {
  /**
   * The line over the boxes, with the address in it: the words before the
   * address, the address as given, and the words after it, so a translation
   * can put the address anywhere in the sentence. The address shows in bold.
   */
  sentTo: <T>(email: T): readonly [before: string, email: T, after: string] => ['Enter the code sent to ', email, '.'],
  code: 'Code',
  verifying: 'Checking the code',
  resend: 'Send a new code',
  resending: 'Sending a new code',
  /** Announced once a new code has gone out, as focus moves back to the boxes. */
  resent: 'New code sent',
  /** Under a resend that is still waiting: `time` is "42 seconds". */
  resendWait: (time: string) => `You can send another in ${time}.`,
  useAnotherEmail: 'Use another email',
} as const;
