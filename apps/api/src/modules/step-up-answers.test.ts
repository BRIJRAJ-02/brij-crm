// What a step up by email answers when it can't go ahead (spec 0033, AC-896;
// the owner's bug, 22 Oct): a code email that didn't send says so (503
// API_UNAVAILABLE with a plain sentence, logged without the address), never
// "Something went wrong"; too many codes or tries say how many minutes to
// wait; a code that ran out or was used up says to send a new one.
import { ORPCError } from '@orpc/client';
import { EMAIL_CODE_EXPIRED_MESSAGE, EMAIL_CODE_INVALID_MESSAGE } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { captureLogs } from '../testing.ts';
import { MAILPIT_URL, newEmail, rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { CODE_NOT_SENT_MESSAGE, waitFor } from './account/router.ts';

const { identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
/** Addresses whose mail fails from now on, as Resend refusing would. */
const failing = new Set<string>();
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
    {
      mailer: {
        transport: 'resend',
        send: (message) =>
          failing.has(message.to)
            ? Promise.reject(new Error(`Resend refused ${message.to} (validation_error).`))
            : mailpit.send(message),
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

/** A signed in person whose session last checked 11 minutes ago, so a sensitive change needs a step up. */
async function stale() {
  const { email, cookie } = await signIn(app, newEmail());
  await testQuery(
    identityUrl,
    `update auth.session set verified_at = now() - interval '11 minutes'
      where user_id = (select id from auth."user" where email = $1)`,
    [email],
  );
  return { email, client: rpcClient(app, cookie) };
}

describe('a step up that can’t go ahead', () => {
  it('says the code couldn’t be sent when the mail fails, and logs it without the address', async () => {
    const { email, client } = await stale();
    failing.add(email);
    const logs = captureLogs();
    try {
      const error = await failure(() => client.account.stepUp.start({ method: 'email' }));
      expect(error).toMatchObject({ code: 'API_UNAVAILABLE', status: 503, message: CODE_NOT_SENT_MESSAGE });
      const line = logs.lines().find((each) => each.message === 'Step up code not sent');
      expect(line).toMatchObject({ mail: 'resend' });
      expect(JSON.stringify(logs.lines())).not.toContain(email);
    } finally {
      logs.restore();
      failing.delete(email);
    }
    // Once mail works again, the next try sends.
    await expect(client.account.stepUp.start({ method: 'email' })).resolves.toEqual({ sent: true });
  });

  it('says how many minutes to wait after too many codes', async () => {
    const { client } = await stale();
    for (let sent = 0; sent < 3; sent += 1) await client.account.stepUp.start({ method: 'email' });
    const error = await failure(() => client.account.stepUp.start({ method: 'email' }));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toMatch(/^Too many codes sent\. Wait (10 minutes|[1-9] minutes?), then try again\.$/);
  });

  it('says a code ran out (none sent, or used up), and a wrong one didn’t work', async () => {
    const { client } = await stale();
    expect(await failure(() => client.account.stepUp.verify({ method: 'email', code: '123456' }))).toMatchObject({
      code: 'CODE_INVALID',
      message: EMAIL_CODE_EXPIRED_MESSAGE,
    });
    await client.account.stepUp.start({ method: 'email' });
    // Codes are random, so "000000" is wrong but once in a million; either answer then names a code.
    const wrong = await failure(() => client.account.stepUp.verify({ method: 'email', code: '000000' }));
    expect(wrong.code).toBe('CODE_INVALID');
    expect([EMAIL_CODE_INVALID_MESSAGE, EMAIL_CODE_EXPIRED_MESSAGE]).toContain(wrong.message);
  });

  it('says how many minutes to wait after too many tries', async () => {
    const { client } = await stale();
    await client.account.stepUp.start({ method: 'email' });
    for (let tried = 0; tried < 5; tried += 1) {
      await failure(() => client.account.stepUp.verify({ method: 'email', code: '000000' }));
    }
    const error = await failure(() => client.account.stepUp.verify({ method: 'email', code: '000000' }));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toMatch(/^Too many tries\. Wait [1-5] minutes?, then try again\.$/);
  });

  it('counts the wait in whole minutes, at least one', () => {
    expect(waitFor(1)).toBe('1 minute');
    expect(waitFor(60)).toBe('1 minute');
    expect(waitFor(61)).toBe('2 minutes');
    expect(waitFor(undefined)).toBe('1 minute');
  });
});
