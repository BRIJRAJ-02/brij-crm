// `@crm/emails`: every email the product sends, drawn from the design tokens
// (spec 0001's `packages/emails`). Templates turn params into words, one
// layout draws the words as HTML and plain text, and nothing here sends: the
// api's mailer does, from the request (a sign in code, an invitation) or the
// worker (a booking's emails).
import { JoinApprovedEmail, JoinRequestEmail, MemberInviteEmail } from '@crm/contracts/emails';
import { appUrl, type EmailMedium } from './links.ts';
import { renderDocument, type RenderedEmail } from './render.ts';
import { bookingDocument, type BookingWords } from './templates/booking.ts';
import { memberInvite } from './templates/invite.ts';
import { joinApproved, joinRequest } from './templates/join.ts';
import { SIGN_IN_CODE_MINUTES, signInCode } from './templates/sign-in-code.ts';

export type { DocumentRow, EmailBlock, EmailDocument } from './document.ts';
export {
  appOrigin,
  appUrl,
  EMAIL_MEDIUMS,
  onAppOrigin,
  poweredByUrl,
  TIMEFIX_SITE,
  wordmarkUrls,
  type EmailMedium,
} from './links.ts';
export { documentText, headerText, renderDocument, type RenderedEmail, type RenderOptions } from './render.ts';
export { emailStylesheet, paint, ROLE_NAMES, type Role } from './theme.ts';
export type { Template, TemplateContext } from './template.ts';
export { SIGN_IN_CODE_MINUTES, SIGN_IN_CODE_SUBJECT } from './templates/sign-in-code.ts';
export type { BookingWords } from './templates/booking.ts';
export type { JoinApprovedEmail, JoinRequestEmail, MemberInviteEmail } from '@crm/contracts/emails';

/** The sign in code email (spec 0005), sent in its request: the code, how long it works, and the shared footer. */
export async function renderSignInCode(code: string, context: { readonly appOrigin: string }): Promise<RenderedEmail> {
  if (!/^[0-9A-Za-z]{4,12}$/.test(code)) throw new Error('A sign in code is 4 to 12 letters and digits.');
  return renderDocument(
    signInCode({ code, minutes: SIGN_IN_CODE_MINUTES }, { link: (path) => appUrl(context.appOrigin, path) }),
    { appOrigin: context.appOrigin, medium: 'email_sign_in' },
  );
}

/**
 * A booking's email (spec 0025), from the words core chose: the design
 * system's layout and the shared footer, tagged `email_booking`, or
 * `email_reminder` for a reminder.
 */
export function renderBookingEmail(
  words: BookingWords,
  context: { readonly appOrigin: string; readonly medium: Extract<EmailMedium, 'email_booking' | 'email_reminder'> },
): Promise<RenderedEmail> {
  return renderDocument(bookingDocument(words, context.appOrigin), {
    appOrigin: context.appOrigin,
    medium: context.medium,
  });
}

/**
 * An invitation to join a workspace (spec 0031), sent from the inviting
 * request: its params checked by `MemberInviteEmail` (the accept link an app
 * path carrying the raw token, which is drawn here and never stored), drawn
 * on the shared layout and tagged `email_invite`.
 */
export async function renderMemberInvite(
  params: MemberInviteEmail,
  context: { readonly appOrigin: string; readonly workspaceName: string },
): Promise<RenderedEmail> {
  const parsed = MemberInviteEmail.parse(params);
  return renderDocument(
    memberInvite(parsed, {
      workspaceName: context.workspaceName,
      link: (path) => appUrl(context.appOrigin, path),
    }),
    { appOrigin: context.appOrigin, medium: 'email_invite' },
  );
}

/**
 * A request to join through the workspace's email domain (spec 0031,
 * AC-819), to one of its owners or admins: its params checked by
 * `JoinRequestEmail`, drawn on the shared layout and tagged `email_invite`.
 */
export async function renderJoinRequest(
  params: JoinRequestEmail,
  context: { readonly appOrigin: string; readonly workspaceName: string },
): Promise<RenderedEmail> {
  const parsed = JoinRequestEmail.parse(params);
  return renderDocument(
    joinRequest(parsed, { workspaceName: context.workspaceName, link: (path) => appUrl(context.appOrigin, path) }),
    { appOrigin: context.appOrigin, medium: 'email_invite' },
  );
}

/** An approved request to join (spec 0031, AC-820), to the person who asked, tagged `email_invite`. */
export async function renderJoinApproved(
  params: JoinApprovedEmail,
  context: { readonly appOrigin: string; readonly workspaceName: string },
): Promise<RenderedEmail> {
  const parsed = JoinApprovedEmail.parse(params);
  return renderDocument(
    joinApproved(parsed, { workspaceName: context.workspaceName, link: (path) => appUrl(context.appOrigin, path) }),
    { appOrigin: context.appOrigin, medium: 'email_invite' },
  );
}
