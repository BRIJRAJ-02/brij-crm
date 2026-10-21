// `@crm/emails`: every email the product sends, drawn from the design tokens
// (spec 0001's `packages/emails`). Templates turn params into words, one
// layout draws the words as HTML and plain text, and nothing here sends: the
// api's mailer does, from the request (a sign in code, an invitation) or the
// worker (a booking's emails, and the queued kinds through `crm_email`).
import {
  EMAIL_PARAMS,
  JoinApprovedEmail,
  JoinRequestEmail,
  MemberInviteEmail,
  NotificationsEmail,
  WorkspaceDeletedEmail,
  type EmailKind,
} from '@crm/contracts/emails';
import { CATALOG, topicOf } from './catalog.ts';
import { appUrl, type EmailMedium } from './links.ts';
import { renderDocument, type RenderedEmail } from './render.ts';
import type { Template, TemplateContext } from './template.ts';
import { bookingDocument, type BookingWords } from './templates/booking.ts';
import { memberInvite } from './templates/invite.ts';
import { notifications } from './templates/notifications.ts';
import { joinApproved, joinRequest } from './templates/join.ts';
import { workspaceDeleted } from './templates/workspace.ts';
import { SIGN_IN_CODE_MINUTES, signInCode } from './templates/sign-in-code.ts';

export { CATALOG, topicOf, type Catalog, type CatalogEntry } from './catalog.ts';
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
export type {
  JoinApprovedEmail,
  JoinRequestEmail,
  MemberInviteEmail,
  NotificationsEmail,
  WorkspaceDeletedEmail,
} from '@crm/contracts/emails';

/** What drawing an email needs besides its params, filled in by its sender at send time. */
export interface EmailContext {
  /** The app's origin: every link in the email, and the logo, point here. */
  readonly appOrigin: string;
  /** The workspace the email is about, by name. */
  readonly workspaceName?: string;
  /** The reader's email preferences page: required for an optional kind (one with a topic), ignored otherwise. */
  readonly preferencesUrl?: string;
}

/** A template's context from an email's: the workspace, and app paths joined to the app's origin. */
function templateContext(context: EmailContext): TemplateContext {
  return {
    ...(context.workspaceName === undefined ? {} : { workspaceName: context.workspaceName }),
    link: (path) => appUrl(context.appOrigin, path),
  };
}

/**
 * Draws one email of a kind with a template: its params parsed again by the
 * kind's schema (a shape the template doesn't know throws), then its words
 * drawn as HTML and plain text. An optional kind must have the reader's
 * preferences link, so its footer can always offer it.
 */
export async function renderEmail(kind: EmailKind, params: unknown, context: EmailContext): Promise<RenderedEmail> {
  const entry = CATALOG[kind];
  // Parsed by this kind's own schema, so the params are exactly what its template takes.
  const parsed: unknown = EMAIL_PARAMS[kind].parse(params);
  const optional = topicOf(kind) !== undefined;
  if (optional && context.preferencesUrl === undefined) {
    throw new Error(`A ${kind} email is optional, so it needs the reader's preferences link.`);
  }
  const template = entry.template as Template<unknown>;
  return renderDocument(template(parsed, templateContext(context)), {
    appOrigin: context.appOrigin,
    medium: entry.medium,
    ...(optional && context.preferencesUrl !== undefined ? { preferencesUrl: context.preferencesUrl } : {}),
  });
}

/** The sign in code email (spec 0005), sent in its request: the code, how long it works, and the shared footer. */
export async function renderSignInCode(code: string, context: { readonly appOrigin: string }): Promise<RenderedEmail> {
  if (!/^[0-9A-Za-z]{4,12}$/.test(code)) throw new Error('A sign in code is 4 to 12 letters and digits.');
  return renderDocument(signInCode({ code, minutes: SIGN_IN_CODE_MINUTES }, templateContext(context)), {
    appOrigin: context.appOrigin,
    medium: 'email_sign_in',
  });
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
 * The notifications email (spec 0038), from the worker's email task: its
 * params checked by `NotificationsEmail` (every link an app path), drawn on the
 * shared layout with the member's notification settings in the footer, and
 * tagged `email_mention`.
 */
export async function renderNotificationsEmail(
  params: NotificationsEmail,
  context: { readonly appOrigin: string; readonly workspaceName: string },
): Promise<RenderedEmail> {
  const parsed = NotificationsEmail.parse(params);
  const link = (path: string) => appUrl(context.appOrigin, path);
  return renderDocument(notifications(parsed, { workspaceName: context.workspaceName, link }), {
    appOrigin: context.appOrigin,
    medium: 'email_mention',
    preferencesUrl: link(parsed.settingsPath),
  });
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

/** A deleted workspace (spec 0031, AC-823), to one of its active members, tagged `email_invite`. */
export async function renderWorkspaceDeleted(
  params: WorkspaceDeletedEmail,
  context: { readonly appOrigin: string; readonly workspaceName: string },
): Promise<RenderedEmail> {
  const parsed = WorkspaceDeletedEmail.parse(params);
  return renderDocument(
    workspaceDeleted(parsed, { workspaceName: context.workspaceName, link: (path) => appUrl(context.appOrigin, path) }),
    { appOrigin: context.appOrigin, medium: 'email_invite' },
  );
}
