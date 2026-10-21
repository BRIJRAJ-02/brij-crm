// The email task (the emails lane): `crm_email`, which `crm_enqueue_email`
// queues with a workspace and an email id only. It reads the email again as
// the system, draws it with `@crm/emails` and sends it through the api's
// mailer (Resend, or Mailpit on a laptop), outside every transaction, then
// records how it went. Idempotent: an email no longer queued is left alone,
// and the mail service gets the email's id as its idempotency key, so a try
// that sent but died before recording it never sends twice. A failed send is
// tried again after Graphile's backoff, up to the queue row's 11 tries (about
// ten hours); the last one, or a message the service will never take, records
// the email `failed`. The log names the email, its kind, the outcome and the
// service's error code, never an address or what it says.
import type { EmailLink, EmailLinkKey } from '@crm/core';
import { emailLinkToken, finishEmail, loadEmail, type systemScope } from '@crm/core/system';
import { renderEmail } from '@crm/emails';
import * as z from 'zod';
import { refusalOf, type Mailer, type MailRefusal } from '../mail/mailer.ts';

/** The task's name on Graphile's queue. */
export const EMAIL_TASK = 'crm_email';

/** Its payload: what `crm_enqueue_email` writes, ids only. */
export const EmailPayload = z.strictObject({ workspaceId: z.uuid(), emailId: z.uuid() });
/** Its payload. */
export type EmailPayload = z.infer<typeof EmailPayload>;

/** What the task needs: the system scope per workspace, the mailer (undefined: mail is off), and the links' parts. */
export interface EmailTaskDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly mailer: Mailer | undefined;
  /** The app's origin, for every link and the logo. */
  readonly appOrigin: string;
  /** The key preferences links are signed with (`emailLinkKey`, the api derives the same). */
  readonly linkKey: EmailLinkKey;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

/**
 * How a try ended: `finished` (sent, skipped, or failed for good, each
 * recorded), or `retry` (recorded and logged; the task throws for Graphile's
 * backoff).
 */
export type EmailRun = 'finished' | 'retry';

/** Where a try stands against the queue row's tries. */
export interface EmailTry {
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * The preferences page for an email's member reader and topic, its signed
 * token in the fragment: no request, server log or Referer ever holds it.
 */
export function preferencesUrl(
  deps: Pick<EmailTaskDeps, 'appOrigin' | 'linkKey'>,
  link: EmailLink,
  issuedAt: Date,
): string {
  const url = new URL('/email-preferences', deps.appOrigin);
  url.hash = new URLSearchParams({ t: emailLinkToken(deps.linkKey, link, issuedAt, 'page') }).toString();
  return url.toString();
}

/**
 * The one click unsubscribe address (RFC 8058) for the same link: a POST
 * there turns the topic off. A mail service posts to it as it is, with no
 * header of ours, so its token rides in the query, where request logs keep
 * it: a token signed for the one click only, which turns its own topic off
 * and opens nothing else.
 */
export function unsubscribeUrl(
  deps: Pick<EmailTaskDeps, 'appOrigin' | 'linkKey'>,
  link: EmailLink,
  issuedAt: Date,
): string {
  const url = new URL('/api/public/email-preferences/unsubscribe', deps.appOrigin);
  url.searchParams.set('t', emailLinkToken(deps.linkKey, link, issuedAt, 'unsubscribe'));
  return url.toString();
}

/** Sends one queued email, or records why not; `retry` when the send failed and tries remain. */
export async function runEmail(deps: EmailTaskDeps, payload: unknown, attempt: EmailTry): Promise<EmailRun> {
  const parsed = EmailPayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to send, and nothing to retry.
    deps.log.warn('email.payload_invalid', {});
    return 'finished';
  }
  const { workspaceId, emailId } = parsed.data;
  const scope = deps.systemScope(workspaceId);
  const loaded = await loadEmail(scope, emailId);
  if (loaded.kind === 'done') return 'finished';
  if (loaded.kind === 'skip') {
    await finishEmail(scope, emailId, { status: 'skipped', code: loaded.reason });
    deps.log.info('email.skipped', { emailId, reason: loaded.reason });
    return 'finished';
  }
  const { email } = loaded;
  if (deps.mailer === undefined) {
    await finishEmail(scope, emailId, { status: 'skipped', code: 'mail_off' });
    deps.log.warn('email.skipped', { emailId, kind: email.kind, reason: 'mail_off' });
    return 'finished';
  }
  const link =
    email.topic === undefined || email.memberId === undefined
      ? undefined
      : { workspaceId, memberId: email.memberId, topic: email.topic };
  let drawn: Awaited<ReturnType<typeof renderEmail>>;
  try {
    drawn = await renderEmail(email.kind, email.params, {
      appOrigin: deps.appOrigin,
      workspaceName: email.workspaceName,
      ...(link === undefined ? {} : { preferencesUrl: preferencesUrl(deps, link, email.createdAt) }),
    });
  } catch (error) {
    // Params its template can't draw: trying again draws them no better.
    await finishEmail(scope, emailId, { status: 'failed', code: 'params_invalid' });
    deps.log.error('email.failed', { emailId, kind: email.kind, code: 'params_invalid', error: errorName(error) });
    return 'finished';
  }
  // The error's class and the service's code only, never its message: a mail service's message can quote the address.
  let failure: { readonly error: string; readonly refusal: MailRefusal | undefined } | undefined;
  try {
    await deps.mailer.send({
      to: email.to,
      subject: drawn.subject,
      html: drawn.html,
      text: drawn.text,
      ...(email.replyTo === undefined ? {} : { replyTo: email.replyTo }),
      idempotencyKey: `email/${emailId}`,
      ...(link === undefined
        ? {}
        : {
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl(deps, link, email.createdAt)}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }),
    });
  } catch (error) {
    failure = { error: errorName(error), refusal: refusalOf(error) };
  }
  if (failure === undefined) {
    await finishEmail(scope, emailId, { status: 'sent' });
    deps.log.info('email.sent', { emailId, kind: email.kind, transport: deps.mailer.transport });
    return 'finished';
  }
  const { refusal } = failure;
  // A message the service will never take fails now; anything else (a limit, an outage, a timeout) is tried again
  // until the queue row's last try. The key used before with another message: whether that one went is unknown.
  const code =
    refusal?.code === 'invalid_idempotent_request'
      ? 'idempotent_conflict'
      : refusal?.permanent === true
        ? 'send_refused'
        : 'send_failed';
  const last = refusal?.permanent === true || attempt.attempt >= attempt.maxAttempts;
  await finishEmail(scope, emailId, last ? { status: 'failed', code } : { status: 'retry', code });
  const fields = {
    emailId,
    kind: email.kind,
    attempt: attempt.attempt,
    last,
    error: failure.error,
    ...(refusal === undefined ? {} : { code: refusal.code }),
  };
  if (last) {
    deps.log.error('email.send_failed', fields);
    return 'finished';
  }
  deps.log.warn('email.send_failed', fields);
  return 'retry';
}

/** An error's class, the one thing about it the log may hold. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
