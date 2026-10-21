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
  preheader: `${device} signed in on ${when}.`,
  heading: SIGN_IN_ALERT_SUBJECT,
  blocks: [
    {
      type: 'paragraph',
      text: `Your account was signed in to on ${when}, from ${device}${place === undefined ? '' : ` near ${place}`}.`,
    },
    {
      type: 'note',
      text: 'If this wasn’t you, open Settings › Account › Security in Timefix to sign that device out and turn on two factor sign in.',
    },
  ],
  why: 'You got this email because a device your account hasn’t used lately signed in.',
});
