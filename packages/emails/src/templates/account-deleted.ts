// "Your Timefix account was deleted" (spec 0033, AC-906): the last email to a
// deleted account's address, sent in its request. It holds no link that
// changes anything: there is nothing left to change.
import type { Template } from '../template.ts';

/** The subject of the last email. */
export const ACCOUNT_DELETED_SUBJECT = 'Your Timefix account was deleted';

/** The last email's params: when it was deleted, already worded for the reader ("21 October 2026, 18:42 UTC"). */
export interface AccountDeletedParams {
  readonly when: string;
}

/** The last email's words. */
export const accountDeleted: Template<AccountDeletedParams> = ({ when }) => ({
  subject: ACCOUNT_DELETED_SUBJECT,
  preheader: `Your account and your sign in were deleted on ${when}.`,
  heading: ACCOUNT_DELETED_SUBJECT,
  blocks: [
    {
      type: 'paragraph',
      text: `Your account was deleted on ${when}. You left every workspace you were in, and your sign in, devices and personal details are gone. Records you made stay in their workspaces, credited to Deleted user.`,
    },
    {
      type: 'note',
      text: 'If you didn’t do this, reply to this email so we can look into it.',
    },
  ],
  why: 'You got this email because the Timefix account for this address was deleted.',
});
