/** VerifyEmail's built in copy. */
export const strings = {
  /** Before the address, which follows in bold, then a full stop. */
  sentTo: 'Enter the code sent to',
  code: 'Code',
  verifying: 'Checking the code',
  resend: 'Send a new code',
  resending: 'Sending a new code',
  /** Under a resend that is still waiting: `time` is "42 seconds". */
  resendWait: (time: string) => `You can send another in ${time}.`,
  useAnotherEmail: 'Use another email',
} as const;
