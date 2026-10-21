// Deleting your own account (spec 0033, AC-902 to AC-907): refused on a
// stale session and on a mistyped email, refused while the person is the last
// owner of a workspace (named), and once confirmed nothing personal of theirs
// remains in `auth` or in their member row, while their workspace keeps going.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { totpCode } from '../auth/two-factor.ts';
import { MAILPIT_URL, rpcClient, signIn, signInApp, testConnections, turnOnTwoFactor } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';

const { identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const sent: MailMessage[] = [];
const cut: string[] = [];
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
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
      signedOut: (userId) => {
        cut.push(userId);
        return Promise.resolve();
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tokenIn = (message: MailMessage | undefined) =>
  /\/invite\/([A-Za-z0-9_-]{43})/.exec(message?.text ?? '')?.[1] ?? '';

/** A second person in `owner`'s workspace as `role`, invited and accepted through the app. */
async function teammate(owner: Awaited<ReturnType<typeof memberWithWorkspace>>, role: 'owner' | 'member') {
  const person = await signIn(app);
  await owner.client.invitations.create({
    workspace: owner.slug,
    emails: [person.email],
    role: role === 'owner' ? 'admin' : 'member',
    mutationId: newId(),
  });
  const token = tokenIn(sent.findLast((message) => message.to === person.email));
  const client = rpcClient(app, person.cookie);
  await client.invitations.accept({ token });
  if (role === 'owner') {
    // No procedure gives the owner role yet (the members lane's): the row says so directly.
    await testQuery(ownerUrl, `update members set role = 'owner' where email = $1`, [person.email]);
  }
  return { ...person, client };
}

describe('deleting your own account (spec 0033)', () => {
  it('refuses a session not checked lately, and a mistyped email', async () => {
    const owner = await memberWithWorkspace(app);
    const person = await teammate(owner, 'member');
    expect(await failure(() => person.client.account.deletion.confirm({ email: 'someone@else.dev' }))).toMatchObject({
      code: 'INPUT_INVALID',
    });
    await testQuery(
      identityUrl,
      `update auth.session set verified_at = now() - interval '11 minutes'
        where user_id = (select id from auth."user" where email = $1)`,
      [person.email],
    );
    expect(await failure(() => person.client.account.deletion.confirm({ email: person.email }))).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await expect(person.client.me.get()).resolves.toBeDefined();
  });

  it('with two factor on, takes only a second factor’s step up', async () => {
    const person = await signIn(app);
    const { cookie, secret } = await turnOnTwoFactor(app, person.cookie);
    const client = rpcClient(app, cookie);
    expect(await failure(() => client.account.deletion.confirm({ email: person.email }))).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
    });
    await client.account.stepUp.verify({ method: 'totp', code: totpCode(secret) });
    expect(await client.account.deletion.confirm({ email: person.email })).toEqual({ deleted: true });
    const rows = await testQuery(
      identityUrl,
      'select 1 from auth.two_factor t join auth."user" u on u.id = t.user_id where u.email = $1',
      [person.email],
    );
    expect(rows).toHaveLength(0);
  });

  it('names the workspaces the person is the last owner of, and refuses until each has another owner', async () => {
    const owner = await memberWithWorkspace(app);
    expect(await owner.client.account.deletion.check()).toEqual({ blockers: [{ slug: owner.slug, name: 'Acme' }] });
    expect(await failure(() => owner.client.account.deletion.confirm({ email: owner.email }))).toMatchObject({
      code: 'LAST_OWNER',
      status: 409,
    });
    await teammate(owner, 'owner');
    expect(await owner.client.account.deletion.check()).toEqual({ blockers: [] });
  });

  it('deletes the account: nothing personal remains, records stay with Deleted user', async () => {
    const owner = await memberWithWorkspace(app);
    const person = await teammate(owner, 'member');
    const userId = (await person.client.me.get()).user.id;
    const listed = await owner.client.members.list({ workspace: owner.slug });
    const memberId = listed.members.find((each) => each.email === person.email)?.id ?? '';
    expect(await person.client.account.deletion.confirm({ email: person.email.toUpperCase() })).toEqual({
      deleted: true,
    });
    // Signed out everywhere, and cut off live.
    await expect(person.client.me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(cut).toContain(userId);
    // Nothing of theirs left in auth.
    for (const [table, column] of [
      ['user', 'id'],
      ['session', 'user_id'],
      ['account', 'user_id'],
      ['security_event', 'user_id'],
      ['workspace_membership', 'user_id'],
      ['user_prefs', 'user_id'],
      ['two_factor', 'user_id'],
    ] as const) {
      const rows = await testQuery(identityUrl, `select 1 from auth."${table}" where ${column} = $1`, [userId]);
      expect(rows, table).toHaveLength(0);
    }
    const codes = await testQuery(
      identityUrl,
      `select 1 from auth.verification where value = $1 or identifier like '%' || $2`,
      [userId, person.email],
    );
    expect(codes).toHaveLength(0);
    // Their member row stays (their records name it) but names no one.
    const [row] = await testQuery<{ name: string; email: string; user_id: string | null; status: string }>(
      ownerUrl,
      'select name, email, user_id, status from members where id = $1',
      [memberId],
    );
    expect(row).toEqual({
      name: 'Deleted user',
      email: `deleted-${memberId}@deleted.invalid`,
      user_id: null,
      status: 'removed',
    });
    const audit = await testQuery<{ action: string }>(
      ownerUrl,
      `select action from audit_events where target_id = $1 and action = 'account.deleted'`,
      [memberId],
    );
    expect(audit).toHaveLength(1);
    // The workspace goes on, without them.
    const after = await owner.client.members.list({ workspace: owner.slug });
    expect(after.members.map((each) => each.email)).not.toContain(person.email);
    // The last email went to the old address.
    expect(sent.findLast((message) => message.to === person.email)?.subject).toBe('Your Timefix account was deleted');
  });
});
