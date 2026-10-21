// The email task (the emails lane) with a fake mailer, never real mail: a
// queued email drawn and sent once with its idempotency key, an optional one
// with its preferences link (the token in the fragment) and RFC 8058's one
// click headers, replies to the form's owner, a failed send answered `retry`
// for Graphile's backoff until its last try records it failed, a message the
// service will never take failed at once, mail off recorded skipped, params
// its template can't draw recorded failed, and a payload that isn't ours
// ignored. Against the test database.
import {
  createWorkspace,
  newId,
  queueFormConfirmation,
  queueFormSubmissionNotice,
  readEmailLinkToken,
  type QueuedEmail,
} from '@crm/core';
import { systemScope } from '@crm/core/system';
import { createDatabase, type Database } from '@crm/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mailRefused, type Mailer, type MailMessage } from '../mail/mailer.ts';
import { runEmail, type EmailTaskDeps } from './email.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-email-task-tests' });
});
afterAll(async () => {
  await db.close();
});

const LINK_KEY = Buffer.alloc(32, 9);
const ORIGIN = 'https://app.example';

/** A mailer that keeps what it was given, failing the first `fail` sends (with `error`, else a plain one). */
function fakeMailer(fail = 0, error?: Error): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  let left = fail;
  return {
    transport: 'mailpit',
    sent,
    send(message) {
      if (left > 0) {
        left -= 1;
        return Promise.reject(error ?? new Error('refused ada@example.com'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}

/** A log that keeps every line, to check none holds an address or what an email says. */
function keptLog() {
  const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
  const keep =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, message, fields });
    };
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error') };
}

/** The id of an email the test queued: its queue calls always queue. */
function idOf(queued: QueuedEmail): string {
  if (queued.outcome === 'refused') throw new Error(`The test's email was refused: ${queued.code}.`);
  return queued.emailId;
}

const depsWith = (mailer: Mailer | undefined, log = keptLog()): EmailTaskDeps => ({
  systemScope: (workspaceId) => systemScope(db, workspaceId),
  mailer,
  appOrigin: ORIGIN,
  linkKey: LINK_KEY,
  log,
});

const FIRST = { attempt: 1, maxAttempts: 8 };

async function world() {
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `email-task-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const system = systemScope(db, created.workspaceId);
  const notice = async () => ({
    emailId: idOf(
      await db.withWorkspace(created.workspaceId, (tx) =>
        queueFormSubmissionNotice(tx, {
          submissionId: newId(),
          memberId: created.memberId,
          params: {
            formName: 'Contact us',
            submitter: { name: 'Grace' },
            answers: [{ label: 'Company', value: 'Northwind' }],
            submittedAt: '2026-10-21T13:05:00.000Z',
            submissionPath: '/w/acme/captures/forms/x',
          },
        }),
      ),
    ),
  });
  const status = async (emailId: string) =>
    (
      await db.withWorkspace(created.workspaceId, (tx) =>
        tx.execute<{ status: string; attempts: number; error_code: string | null }>(
          sql`select status, attempts, error_code from emails where id = ${emailId}::uuid`,
        ),
      )
    ).rows[0];
  return { ...created, system, notice, status };
}

describe('the email task', () => {
  it('sends a queued email once, with its key, its preferences link and the one click headers', async () => {
    const w = await world();
    const { emailId } = await w.notice();
    const mailer = fakeMailer();
    const log = keptLog();
    const payload = { workspaceId: w.workspaceId, emailId };
    expect(await runEmail(depsWith(mailer, log), payload, FIRST)).toBe('finished');
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message).toMatchObject({
      to: 'ada@example.com',
      subject: 'Grace filled in Contact us',
      idempotencyKey: `email/${emailId}`,
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    const unsubscribe = /^<(.+)>$/.exec(message?.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? '';
    expect(new URL(unsubscribe).pathname).toBe('/api/public/email-preferences/unsubscribe');
    const preferences = new URL(/Email preferences: (\S+)/.exec(message?.text ?? '')?.[1] ?? '');
    expect(preferences.pathname).toBe('/email-preferences');
    // The page's token rides in the fragment, which no request carries; the one click's in its query.
    expect(preferences.search).toBe('');
    const page = new URLSearchParams(preferences.hash.slice(1)).get('t') ?? '';
    const link = { workspaceId: w.workspaceId, memberId: w.memberId, topic: 'form_submissions' };
    expect(readEmailLinkToken(LINK_KEY, page, new Date(), 'page')).toEqual(link);
    // The one click's token, which request logs keep, is signed for the one click only.
    const oneClick = new URL(unsubscribe).searchParams.get('t') ?? '';
    expect(readEmailLinkToken(LINK_KEY, oneClick, new Date(), 'unsubscribe')).toEqual(link);
    expect(readEmailLinkToken(LINK_KEY, oneClick, new Date(), 'page')).toBeUndefined();
    expect(await w.status(emailId)).toEqual({ status: 'sent', attempts: 1, error_code: null });
    // Sent: the same queue row again sends nothing.
    await runEmail(depsWith(mailer), payload, { attempt: 2, maxAttempts: 8 });
    expect(mailer.sent).toHaveLength(1);
    // The log names the email and its kind, never an address or what it says.
    expect(log.lines).toEqual([
      { level: 'info', message: 'email.sent', fields: { emailId, kind: 'form_submission', transport: 'mailpit' } },
    ]);
  });

  it('sends a visitor’s confirmation with replies to the owner, and no preferences link', async () => {
    const w = await world();
    const emailId = idOf(
      await db.withWorkspace(w.workspaceId, (tx) =>
        queueFormConfirmation(tx, {
          submissionId: newId(),
          address: 'asha@northwind.example',
          replyToMemberId: w.memberId,
          params: { formName: 'Contact us', answers: [], submittedAt: '2026-10-21T13:05:00.000Z' },
        }),
      ),
    );
    const mailer = fakeMailer();
    await runEmail(depsWith(mailer), { workspaceId: w.workspaceId, emailId }, FIRST);
    expect(mailer.sent[0]).toMatchObject({ to: 'asha@northwind.example', replyTo: 'ada@example.com' });
    expect(mailer.sent[0]?.headers).toBeUndefined();
    expect(mailer.sent[0]?.text).not.toContain('Email preferences');
  });

  it('answers retry for a failed send, and records the email failed on its last try', async () => {
    const w = await world();
    const { emailId } = await w.notice();
    const log = keptLog();
    const payload = { workspaceId: w.workspaceId, emailId };
    expect(await runEmail(depsWith(fakeMailer(1), log), payload, FIRST)).toBe('retry');
    expect(await w.status(emailId)).toEqual({ status: 'queued', attempts: 1, error_code: 'send_failed' });
    expect(await runEmail(depsWith(fakeMailer(1), log), payload, { attempt: 8, maxAttempts: 8 })).toBe('finished');
    expect(await w.status(emailId)).toEqual({ status: 'failed', attempts: 2, error_code: 'send_failed' });
    // The mail service's message quoted the address; the log holds only its class, and the last try is an error.
    expect(JSON.stringify(log.lines)).not.toContain('ada@example.com');
    expect(log.lines.map((line) => [line.level, line.fields.error, line.fields.last])).toEqual([
      ['warn', 'Error', false],
      ['error', 'Error', true],
    ]);
  });

  it('fails at once a message the service will never take, and a key it saw with another message', async () => {
    const w = await world();
    const log = keptLog();
    const refused = await w.notice();
    const never = fakeMailer(1, mailRefused('Resend', { code: 'invalid_parameter', permanent: true }));
    expect(await runEmail(depsWith(never, log), { workspaceId: w.workspaceId, emailId: refused.emailId }, FIRST)).toBe(
      'finished',
    );
    expect(await w.status(refused.emailId)).toEqual({ status: 'failed', attempts: 1, error_code: 'send_refused' });

    const conflict = await w.notice();
    const seen = fakeMailer(1, mailRefused('Resend', { code: 'invalid_idempotent_request', permanent: true }));
    await runEmail(depsWith(seen, log), { workspaceId: w.workspaceId, emailId: conflict.emailId }, FIRST);
    expect(await w.status(conflict.emailId)).toMatchObject({ status: 'failed', error_code: 'idempotent_conflict' });

    // A limit is tried again, its code logged.
    const limited = await w.notice();
    const busy = fakeMailer(1, mailRefused('Resend', { code: 'rate_limit_exceeded', permanent: false }));
    expect(await runEmail(depsWith(busy, log), { workspaceId: w.workspaceId, emailId: limited.emailId }, FIRST)).toBe(
      'retry',
    );
    expect(log.lines.map((line) => [line.level, line.fields.code])).toEqual([
      ['error', 'invalid_parameter'],
      ['error', 'invalid_idempotent_request'],
      ['warn', 'rate_limit_exceeded'],
    ]);
  });

  it('records the email skipped when mail is off, failed for params it can’t draw, and ignores a payload not ours', async () => {
    const w = await world();
    const off = await w.notice();
    await runEmail(depsWith(undefined), { workspaceId: w.workspaceId, emailId: off.emailId }, FIRST);
    expect(await w.status(off.emailId)).toEqual({ status: 'skipped', attempts: 0, error_code: 'mail_off' });

    const broken = await w.notice();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update emails set params = '{"formName": 1}'::jsonb where id = ${broken.emailId}::uuid`),
    );
    const mailer = fakeMailer();
    await runEmail(depsWith(mailer), { workspaceId: w.workspaceId, emailId: broken.emailId }, FIRST);
    expect(await w.status(broken.emailId)).toEqual({ status: 'failed', attempts: 1, error_code: 'params_invalid' });
    expect(mailer.sent).toEqual([]);

    const log = keptLog();
    await runEmail(depsWith(mailer, log), { emailId: off.emailId, extra: 1 }, FIRST);
    expect(log.lines).toEqual([{ level: 'warn', message: 'email.payload_invalid', fields: {} }]);
  });
});
