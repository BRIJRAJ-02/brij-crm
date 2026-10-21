// "Your sign in code" (spec 0005): the one email sent in its request rather
// than through the queue, since the code is a live secret (spec 0008's
// decision). The code stays out of the subject; the preview line carries it,
// so a phone's notification shows it without opening the email.
import type { Template } from '../template.ts';

/** The subject every code email carries. */
export const SIGN_IN_CODE_SUBJECT = 'Your sign in code';

/** How long a code works, as the email says it (the email OTP plugin's `expiresIn`). */
export const SIGN_IN_CODE_MINUTES = 10;

/** A sign in code email's params: the code, and how long it works. */
export interface SignInCodeParams {
  readonly code: string;
  readonly minutes: number;
}

/** The sign in code email's words. */
export const signInCode: Template<SignInCodeParams> = ({ code, minutes }) => ({
  subject: SIGN_IN_CODE_SUBJECT,
  preheader: `Your sign in code is ${code}. It works for ${String(minutes)} minutes.`,
  heading: SIGN_IN_CODE_SUBJECT,
  blocks: [
    { type: 'paragraph', text: `Enter this code to sign in to Timefix. It works for ${String(minutes)} minutes.` },
    { type: 'code', code, label: 'Your sign in code' },
    {
      type: 'note',
      text: 'If you didn’t ask for this code, you can ignore this email. Nobody can sign in without it.',
    },
  ],
  why: 'You got this email because someone asked to sign in to Timefix with this address.',
});
