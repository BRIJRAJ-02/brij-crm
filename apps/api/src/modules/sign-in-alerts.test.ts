// Sign in alerts and Recent activity (spec 0033, milestone 4: AC-897,
// AC-898): no alert on an account's first sign in nor from a device it
// already uses; one email, once, for a new browser; Recent activity lists the
// sign ins and the alert, newest first, never an IP; and the sweep deletes a
// year old history.
import { sweepAccountHistory } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import {
  codeFor,
  cookieFrom,
  MAILPIT_URL,
  newEmail,
  newIp,
  rpcClient,
  sendCode,
  signInApp,
  testConnections,
  verifyCode,
} from '../../test/sign-in.ts';

const { identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let made: ReturnType<typeof signInApp>;
const sent: MailMessage[] = [];
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

beforeAll(() => {
  ({ db, identity } = testConnections());
  made = signInApp(
    { db, identity },
    {},
    {
      mailer: {
        transport: 'mailpit',
        send: (message) => {
          sent.push(message);
          return mailpit.send(message);
        },
      },
    },
  );
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** Signs `email` in by code from a browser saying `agent`, then waits for the work the sign in starts. */
async function signInWith(email: string, agent: string): Promise<string> {
  const ip = newIp();
  const headers = { 'user-agent': agent };
  expect((await sendCode(made.app, email, ip, headers)).status).toBe(200);
  const answer = await verifyCode(made.app, email, await codeFor(email), ip, headers);
  expect(answer.status).toBe(200);
  await made.services.auth.settled();
  return cookieFrom(answer);
}

const alertsTo = (email: string) =>
  sent.filter((message) => message.to === email && message.subject.includes('New sign in'));

describe('sign in alerts and recent activity (spec 0033)', () => {
  it('emails once for a new browser, never on the first sign in or a known one', async () => {
    const email = newEmail();
    await signInWith(email, CHROME_MAC);
    expect(alertsTo(email)).toEqual([]);
    await signInWith(email, CHROME_MAC);
    expect(alertsTo(email)).toEqual([]);
    const cookie = await signInWith(email, FIREFOX_WINDOWS);
    const [alert] = alertsTo(email);
    expect(alertsTo(email)).toHaveLength(1);
    expect(alert?.text).toContain('Firefox on Windows');
    expect(alert?.idempotencyKey).toMatch(/^sign-in-alert\//);
    // No link that changes anything.
    expect(alert?.text ?? '').not.toMatch(/https?:\/\/\S*(revoke|sign-out|disable)/);

    const page = await rpcClient(made.app, cookie).account.activity.list({});
    expect(page.items.map((item) => item.kind)).toEqual(['alert_sent', 'sign_in', 'sign_in', 'sign_in']);
    expect(page.items[1]).toMatchObject({ method: 'email_code', deviceLabel: 'Firefox on Windows' });
    expect(JSON.stringify(page)).not.toMatch(/"ip"/);
  });

  it('notes an account’s first device quietly when none is kept yet (no live session when 0079 ran)', async () => {
    const email = newEmail();
    await signInWith(email, CHROME_MAC);
    await testQuery(
      identityUrl,
      `delete from auth.known_device where user_id = (select id from auth."user" where email = $1)`,
      [email],
    );
    await signInWith(email, CHROME_MAC);
    expect(alertsTo(email)).toEqual([]);
    // Known from then on: another browser is new.
    await signInWith(email, FIREFOX_WINDOWS);
    expect(alertsTo(email)).toHaveLength(1);
  });

  it('keys a device in SQL as the alert does, so 0079’s backfill knows today’s devices', async () => {
    const email = newEmail();
    await signInWith(email, FIREFOX_WINDOWS);
    const rows = await testQuery<{ same: boolean }>(
      identityUrl,
      `select bool_and(exists (
          select 1 from auth.known_device d
          where d.user_id = s.user_id
            and d.device_key = encode(sha256(convert_to(coalesce(s.device_label, '') || '|' || coalesce(s.country, ''), 'UTF8')), 'hex')
        )) as same
        from auth.session s where s.user_id = (select id from auth."user" where email = $1)`,
      [email],
    );
    expect(rows).toEqual([{ same: true }]);
  });

  it('refuses a cursor that is not its own', async () => {
    const cookie = await signInWith(newEmail(), CHROME_MAC);
    await expect(rpcClient(made.app, cookie).account.activity.list({ cursor: 'nope' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('deletes security history a year old, and keeps the rest', async () => {
    const email = newEmail();
    await signInWith(email, CHROME_MAC);
    await signInWith(email, FIREFOX_WINDOWS);
    await testQuery(
      identityUrl,
      `update auth.security_event set at = now() - interval '400 days'
        where kind = 'alert_sent' and user_id = (select id from auth."user" where email = $1)`,
      [email],
    );
    expect(await sweepAccountHistory({ identity })).toBeGreaterThan(0);
    const left = await testQuery<{ kind: string }>(
      identityUrl,
      `select kind from auth.security_event where user_id = (select id from auth."user" where email = $1) order by at`,
      [email],
    );
    expect(left.map((row) => row.kind)).toEqual(['sign_in', 'sign_in']);
  });
});
