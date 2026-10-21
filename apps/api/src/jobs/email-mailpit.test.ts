// The emails end to end (the emails lane): every queued kind queued as core
// queues it, taken off Graphile's queue by the real light runner, drawn and
// sent through the Mailpit transport, and read back from Mailpit: its
// subject, reader, reply address and one click headers, and Mailpit's HTML
// check of how well email clients support it. The emails sent from their
// request (a sign in code, an invitation), a booking's and the sign in alert's
// template go to Mailpit through the same transport for the same check. Only
// this run's own messages are read (each reader's address carries the run's
// tag), and they are deleted at the end. Needs Mailpit (TEST_MAILPIT_URL, else
// localhost:8025). With EMAIL_CHECK_REPORT set to a file path, the HTML check's
// findings are written there.
import { writeFileSync } from 'node:fs';
import { EMAIL_PARAMS, QUEUED_EMAIL_KINDS, type QueuedEmailKind } from '@crm/contracts/emails';
import {
  createRunner,
  createWorkspace,
  jobKinds,
  newId,
  NO_RULE_SOURCE,
  queueEmail,
  type QueueEmailInput,
} from '@crm/core';
import { enterAsActor, systemScope } from '@crm/core/system';
import { createDatabase, openQueueConnection, type Database, type QueueConnection } from '@crm/db';
import { CATALOG, renderBookingEmail, renderEmail, renderMemberInvite, renderSignInCode } from '@crm/emails';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import * as z from 'zod';
import { backgroundHooks } from '../hooks.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL } from '../../test/sign-in.ts';
import { runEmail } from './email.ts';
import { startJobRunners, type JobRunners, type JobsLog } from './graphile.ts';

const { appUrl, workerUrl } = inject('testDatabase');
const ORIGIN = 'https://app.test';
const FROM = 'Timefix <emails-e2e@crm.localhost>';
const RUN = newId().slice(-10);
const quiet: JobsLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

let db: Database;
let queue: QueueConnection;
let runners: JobRunners;
const mailer = createMailpitMailer({ url: MAILPIT_URL, from: FROM });

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-emails-e2e', maxConnections: 8 });
  queue = openQueueConnection({ url: workerUrl, applicationName: 'crm-emails-e2e-queue', max: 4 });
  runners = await startJobRunners({
    queue,
    runner: createRunner({
      db,
      registry: jobKinds({ environment: 'local' }),
      enterAsActor: (input) => enterAsActor({ db, rules: NO_RULE_SOURCE }, input),
      systemScope: (workspaceId) => systemScope(db, workspaceId),
      hooks: backgroundHooks,
      log: quiet,
    }),
    log: quiet,
    pollInterval: 200,
    email: (payload, attempt) =>
      runEmail(
        {
          systemScope: (workspaceId) => systemScope(db, workspaceId),
          mailer,
          appOrigin: ORIGIN,
          linkKey: Buffer.alloc(32, 3),
          log: quiet,
        },
        payload,
        attempt,
      ),
  });
});

const sentIds: string[] = [];
afterAll(async () => {
  await runners.stop();
  await queue.close();
  await db.close();
  // Only this run's own messages.
  if (sentIds.length > 0) {
    await fetch(new URL('/api/v1/messages', MAILPIT_URL), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: sentIds }),
    });
  }
});

/** This run's address for one email: the tag keeps every other run's and person's mail out of reach. */
const addressOf = (name: string) => `emails-e2e-${RUN}-${name}@example.test`;

const Found = z.object({ messages: z.array(z.object({ ID: z.string() })) });
const Message = z.object({
  Subject: z.string(),
  HTML: z.string(),
  Text: z.string(),
  ReplyTo: z.array(z.object({ Address: z.string() })).nullable(),
});
const Headers = z.record(z.string(), z.array(z.string()));
const HtmlCheck = z.object({
  Total: z.object({ Supported: z.number(), Partial: z.number(), Unsupported: z.number(), Tests: z.number() }),
  Warnings: z.array(
    z.object({
      Slug: z.string(),
      Title: z.string(),
      Score: z.object({ Unsupported: z.number(), Partial: z.number() }),
    }),
  ),
});

const mailpit = async (path: string): Promise<unknown> => (await fetch(new URL(path, MAILPIT_URL))).json();

/** The one message Mailpit holds for `address`, waiting up to 20 seconds for it to arrive. */
async function messageFor(address: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const found = Found.parse(await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`));
    const [first] = found.messages;
    if (first !== undefined) {
      expect(found.messages).toHaveLength(1);
      sentIds.push(first.ID);
      const [message, headers, check] = await Promise.all([
        mailpit(`/api/v1/message/${first.ID}`).then((body) => Message.parse(body)),
        mailpit(`/api/v1/message/${first.ID}/headers`).then((body) => Headers.parse(body)),
        mailpit(`/api/v1/message/${first.ID}/html-check`).then((body) => HtmlCheck.parse(body)),
      ]);
      return { message, headers, check };
    }
    if (Date.now() > deadline) throw new Error(`No email reached Mailpit for ${address}.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** What Mailpit's HTML check said about each email, for the report. */
const report: Record<string, z.infer<typeof HtmlCheck>> = {};

/** Every email holds up in the clients Mailpit checks: nothing it uses is unsupported in more than a few. */
function checkClients(name: string, check: z.infer<typeof HtmlCheck>) {
  report[name] = check;
  expect(check.Total.Unsupported, `${name}: ${JSON.stringify(check.Warnings.map((w) => w.Slug))}`).toBeLessThan(3);
}

describe('every email, end to end through Mailpit', () => {
  it('sends each queued kind off the queue, and reads it back as drawn', async () => {
    const created = await createWorkspace(db, {
      name: 'Acme',
      slug: `emails-e2e-${RUN}`,
      firstMember: { name: 'Ada', email: addressOf('owner') },
    });
    // One member per kind, so each email has its own reader to find it by.
    const memberFor = new Map<QueuedEmailKind, string>();
    await db.withWorkspace(created.workspaceId, async (tx) => {
      for (const kind of QUEUED_EMAIL_KINDS) {
        const id = newId();
        memberFor.set(kind, id);
        await tx.execute(sql`
          insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
          values (${created.workspaceId}, ${id}, ${kind}, ${addressOf(kind)}, 'member', 'system', 'system')
        `);
      }
    });
    const queued = await db.withWorkspace(created.workspaceId, async (tx) => {
      const ids: string[] = [];
      for (const kind of QUEUED_EMAIL_KINDS) {
        const input = {
          kind,
          ids: [newId()],
          to: kind === 'form_confirmation' ? { address: addressOf(kind) } : { memberId: memberFor.get(kind) ?? '' },
          ...(kind === 'form_confirmation' ? { replyToMemberId: created.memberId } : {}),
          params: EMAIL_PARAMS[kind].parse(CATALOG[kind].sample),
        } as QueueEmailInput<typeof kind>;
        const result = await queueEmail(tx, input);
        if (result.outcome === 'refused') throw new Error(`The ${kind} sample was refused: ${result.code}.`);
        ids.push(result.emailId);
      }
      return ids;
    });
    expect(queued).toHaveLength(QUEUED_EMAIL_KINDS.length);

    for (const kind of QUEUED_EMAIL_KINDS) {
      const { message, headers, check } = await messageFor(addressOf(kind));
      const drawn = await renderEmail(kind, CATALOG[kind].sample, {
        appOrigin: ORIGIN,
        workspaceName: 'Acme',
        preferencesUrl: `${ORIGIN}/email-preferences#t=x`,
      });
      expect(message.Subject, kind).toBe(drawn.subject);
      expect(message.HTML, kind).toContain('utm_campaign=powered_by');
      expect(message.Text, kind).toContain('You got this email because');
      const optional = kind === 'form_submission';
      expect(message.Text.includes(`Email preferences: ${ORIGIN}/email-preferences#t=`), kind).toBe(optional);
      expect(headers['List-Unsubscribe-Post'], kind).toEqual(optional ? ['List-Unsubscribe=One-Click'] : undefined);
      if (kind === 'form_confirmation') expect(message.ReplyTo).toEqual([{ Address: addressOf('owner') }]);
      checkClients(kind, check);
    }

    // Every email recorded sent, what it said blanked.
    const rows = await db.withWorkspace(
      created.workspaceId,
      async (tx) =>
        (await tx.execute<{ status: string; params: unknown }>(sql`select status, params from emails`)).rows,
    );
    expect(rows).toEqual(QUEUED_EMAIL_KINDS.map(() => ({ status: 'sent', params: {} })));
  });

  it('draws the request’s emails and the template only ones the same way, and they hold up in the same clients', async () => {
    const direct = {
      sign_in_code: await renderSignInCode('482913', { appOrigin: ORIGIN }),
      member_invite: await renderMemberInvite(CATALOG.member_invite.sample, {
        appOrigin: ORIGIN,
        workspaceName: 'Acme',
      }),
      sign_in_alert: await renderEmail('sign_in_alert', CATALOG.sign_in_alert.sample, { appOrigin: ORIGIN }),
      booking_confirmation: await renderBookingEmail(
        {
          subject: 'Booked: Intro call with Ada Host',
          preview: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (UTC)',
          heading: 'You’re booked',
          intro: 'Ada Host has been told. Here are the details.',
          rows: [{ label: 'When', value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (UTC)' }],
          button: { label: 'View your booking', url: `${ORIGIN}/b/intro/manage?t=token` },
          footnote: 'Need to change it? Move it to another time or cancel it from your booking page.',
          why: 'You got this email because this address was used to book Intro call with Ada Host.',
        },
        { appOrigin: ORIGIN, medium: 'email_booking' },
      ),
    };
    for (const [name, email] of Object.entries(direct)) {
      await mailer.send({ to: addressOf(name), ...email });
      const { message, check } = await messageFor(addressOf(name));
      expect(message.Subject, name).toBe(email.subject);
      checkClients(name, check);
    }
    const reportPath = process.env.EMAIL_CHECK_REPORT;
    if (reportPath !== undefined) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  });
});
