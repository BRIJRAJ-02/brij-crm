// "New sign in to your Timefix account" (spec 0033, AC-897): sent when a
// browser, system and country the account hasn't used in 90 days signs in.
// It holds no link that changes anything (owner decision 5): it says where to
// go, and the person goes there signed in.
import type { Template } from '../template.ts';

/** The alert's subject. */
export const SIGN_IN_ALERT_SUBJECT = 'New sign in to your Timefix account';

/** The alert's params, already worded for the reader: when, on what, and roughly where (absent when unknown). */
export interface SignInAlertParams {
  readonly when: string;
  readonly device: string;
  readonly place?: string;
}

/** The alert's words. */
export const signInAlert: Template<SignInAlertParams> = ({ when, device, place }) => ({
  subject: SIGN_IN_ALERT_SUBJECT,
  preheader: `New sign in on ${when} from ${device}.`,
  heading: SIGN_IN_ALERT_SUBJECT,
  blocks: [
    {
      type: 'paragraph',
      text: `Someone signed in to your account on ${when} using ${device}${place === undefined ? '' : ` near ${place}`}.`,
    },
    {
      type: 'note',
      text: 'If this wasn’t you, open Settings › Account › Sign in and devices in Timefix and sign that device out. Then check that your email account is secure, and turn on two factor sign in if it’s off.',
    },
  ],
  why: 'You got this email because a device your account hasn’t used lately signed in.',
});
