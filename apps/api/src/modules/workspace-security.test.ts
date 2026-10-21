// A workspace's sign in rules (spec 0033, milestone 4: AC-885, AC-888,
// AC-893 to AC-895, AC-899): only owners read or change them; requiring two
// factor waits for the owner's own; a member without a second factor is
// refused TWO_FACTOR_REQUIRED in that workspace alone, and a passkey counts;
// a session older than the workspace allows, or from before "Sign out
// everyone", signs in again there while the owner who did it stays in; the
// last second factor stays on while a workspace requires it; a passkey only
// account's email code sign in waits for the passkey; owners and admins see
// the Members column.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import {
  authPost,
  codeFor,
  MAILPIT_URL,
  newIp,
  rpcClient,
  sendCode,
  signIn,
  signInApp,
  testConnections,
  turnOnTwoFactor,
  verifyCode,
} from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';

const { identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const sent: MailMessage[] = [];
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
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tokenIn = (message: MailMessage | undefined) =>
  /\/invite\/([A-Za-z0-9_-]{43})/.exec(message?.text ?? '')?.[1] ?? '';

type Owner = Awaited<ReturnType<typeof memberWithWorkspace>>;

/** A second person in `owner`'s workspace as `role`, invited and accepted through the app. */
async function teammate(owner: Owner, role: 'admin' | 'member') {
  const person = await signIn(app);
  await owner.client.invitations.create({
    workspace: owner.slug,
    emails: [person.email],
    role,
    mutationId: newId(),
  });
  const client = rpcClient(app, person.cookie);
  await client.invitations.accept({ token: tokenIn(sent.findLast((message) => message.to === person.email)) });
  return { ...person, client };
}

/** Gives the person signed in by `email` a passkey row, as the plugin would store one (the ceremony has its own tests). */
async function givePasskey(email: string): Promise<void> {
  await testQuery(
    identityUrl,
    `insert into auth.passkey (id, user_id, name, public_key, credential_id, counter, device_type, backed_up, transports, created_at)
     select gen_random_uuid(), id, 'Laptop', 'key', $2, 0, 'singleDevice', false, 'internal', now()
       from auth."user" where email = $1`,
    [email, `cred-${newId()}`],
  );
}

/** The workspace's audit actions, oldest first. */
async function auditActions(workspaceId: string): Promise<string[]> {
  const rows = await testQuery<{ action: string }>(
    ownerUrl,
    'select action from audit_events where workspace_id = $1 order by at, id',
    [workspaceId],
  );
  return rows.map((row) => row.action);
}

describe('workspace security settings (spec 0033, milestone 4)', () => {
  it('lets only owners read or change the rules, and asks the owner to set up their own two factor first', async () => {
    const owner = await memberWithWorkspace(app);
    const admin = await teammate(owner, 'admin');
    const member = await teammate(owner, 'member');
    for (const someone of [admin, member]) {
      expect(await failure(() => someone.client.workspaceSecurity.get({ workspace: owner.slug }))).toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(
        await failure(() => someone.client.workspaceSecurity.set({ workspace: owner.slug, sessionLengthDays: 1 })),
      ).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await owner.client.workspaceSecurity.get({ workspace: owner.slug })).toEqual({
      requireTwoFactor: false,
      membersWithout: 3,
      youHaveTwoFactor: false,
    });
    expect(
      await failure(() => owner.client.workspaceSecurity.set({ workspace: owner.slug, requireTwoFactor: true })),
    ).toMatchObject({ code: 'OWNER_NEEDS_TWO_FACTOR' });
    expect(await auditActions(owner.workspace.id)).not.toContain('workspace_security.changed');
  });

  it('refuses a member without a second factor in the requiring workspace alone, and lets a passkey count', async () => {
    const owner = await memberWithWorkspace(app);
    const member = await teammate(owner, 'member');
    const withPasskey = await teammate(owner, 'member');
    await givePasskey(withPasskey.email);
    // The member's own workspace, which requires nothing.
    const { workspace: theirs } = await member.client.workspaces.create({
      id: newId(),
      name: 'Theirs',
      slug: `theirs-${newId().slice(0, 8)}`,
      memberName: 'Bea',
    });
    const on = await turnOnTwoFactor(app, owner.cookie);
    const ownerClient = rpcClient(app, on.cookie);
    const rules = await ownerClient.workspaceSecurity.set({ workspace: owner.slug, requireTwoFactor: true });
    expect(rules).toMatchObject({ requireTwoFactor: true, membersWithout: 1, youHaveTwoFactor: true });
    expect(await auditActions(owner.workspace.id)).toContain('workspace_security.changed');

    expect(await failure(() => member.client.objects.list({ workspace: owner.slug }))).toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
      status: 403,
    });
    expect(await member.client.objects.list({ workspace: theirs.slug })).not.toHaveLength(0);
    expect(await withPasskey.client.objects.list({ workspace: owner.slug })).not.toHaveLength(0);
    expect(await ownerClient.objects.list({ workspace: owner.slug })).not.toHaveLength(0);
    // A stranger still learns nothing: the same NOT_FOUND as any workspace they aren't in.
    const stranger = rpcClient(app, (await signIn(app)).cookie);
    expect(await failure(() => stranger.objects.list({ workspace: owner.slug }))).toMatchObject({ code: 'NOT_FOUND' });

    // The Members column: owners and admins only (AC-895).
    const listed = (await ownerClient.members.list({ workspace: owner.slug })).members;
    expect(listed.map((each) => each.twoFactor).sort()).toEqual([false, true, true]);
    expect(
      (await withPasskey.client.members.list({ workspace: owner.slug })).members.every(
        (each) => each.twoFactor === undefined,
      ),
    ).toBe(true);
  });

  it('keeps the last second factor on while a workspace requires it (AC-885)', async () => {
    const owner = await memberWithWorkspace(app);
    const on = await turnOnTwoFactor(app, owner.cookie);
    const client = rpcClient(app, on.cookie);
    await client.workspaceSecurity.set({ workspace: owner.slug, requireTwoFactor: true });
    expect((await client.account.security.get()).requiredBy).toEqual(['Acme']);
    // Fresh with the second factor itself, as turning it off needs.
    await testQuery(
      identityUrl,
      `update auth.session set verified_with = 'second_factor', verified_at = now()
        where user_id = (select id from auth."user" where email = $1)`,
      [owner.email],
    );
    const off = await authPost(app, '/two-factor/disable', {}, { cookie: on.cookie });
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({
      code: 'WORKSPACE_REQUIRES_TWO_FACTOR',
      message: 'Acme requires two factor sign in.',
    });
    // With a passkey to stand in, the app may go.
    await givePasskey(owner.email);
    expect((await authPost(app, '/two-factor/disable', {}, { cookie: on.cookie })).status).toBe(200);
  });

  it('refuses to remove the last passkey while a workspace requires two factor', async () => {
    const owner = await memberWithWorkspace(app);
    await givePasskey(owner.email);
    await owner.client.workspaceSecurity.set({ workspace: owner.slug, requireTwoFactor: true });
    const [passkey] = (await owner.client.account.security.get()).passkeys;
    // Proven by the passkey itself, as removing one needs.
    await testQuery(
      identityUrl,
      `update auth.session set verified_with = 'second_factor', verified_at = now()
        where user_id = (select id from auth."user" where email = $1)`,
      [owner.email],
    );
    expect(await failure(() => owner.client.account.passkeys.remove({ id: passkey?.id ?? '' }))).toMatchObject({
      code: 'WORKSPACE_REQUIRES_TWO_FACTOR',
      message: 'Acme requires two factor sign in.',
    });
  });

  it('signs everyone out of the workspace, keeping the owner in, and holds sessions to its length', async () => {
    const owner = await memberWithWorkspace(app);
    const member = await teammate(owner, 'member');
    const before = await owner.client.workspaceSecurity.signOutEveryone({ workspace: owner.slug });
    expect(before.signedOutEveryoneAt).toEqual(expect.any(String));
    expect(await auditActions(owner.workspace.id)).toContain('workspace_security.signed_out_everyone');
    expect(await failure(() => member.client.objects.list({ workspace: owner.slug }))).toMatchObject({
      code: 'SIGN_IN_AGAIN',
    });
    expect(await owner.client.objects.list({ workspace: owner.slug })).not.toHaveLength(0);
    // Signing in again opens it.
    const again = await signIn(app, member.email);
    expect(await rpcClient(app, again.cookie).objects.list({ workspace: owner.slug })).not.toHaveLength(0);

    // A day's session length: a sign in two days old signs in again; the owner's fresh one doesn't.
    await owner.client.workspaceSecurity.set({ workspace: owner.slug, sessionLengthDays: 1 });
    await testQuery(
      identityUrl,
      `update auth.session set verified_at = now() - interval '2 days'
        where user_id = (select id from auth."user" where email = $1)`,
      [member.email],
    );
    expect(await failure(() => rpcClient(app, again.cookie).objects.list({ workspace: owner.slug }))).toMatchObject({
      code: 'SIGN_IN_AGAIN',
    });
    expect(await owner.client.objects.list({ workspace: owner.slug })).not.toHaveLength(0);
  });

  it('asks a passkey only account for its passkey after an email code (AC-888)', async () => {
    const owner = await memberWithWorkspace(app);
    await givePasskey(owner.email);
    const ip = newIp();
    expect((await sendCode(app, owner.email, ip)).status).toBe(200);
    const answer = await verifyCode(app, owner.email, await codeFor(owner.email), ip);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['passkey'] });
    expect(
      answer.headers
        .getSetCookie()
        .some((cookie) => cookie.includes('session_token=') && !cookie.includes('Max-Age=0')),
    ).toBe(false);
  });

  it('never lets an email code stand in for a passkey only account’s second factor (AC-888)', async () => {
    const owner = await memberWithWorkspace(app);
    await givePasskey(owner.email);
    expect(await failure(() => owner.client.account.stepUp.start({ method: 'email' }))).toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(await failure(() => owner.client.account.stepUp.verify({ method: 'email', code: '123456' }))).toMatchObject({
      code: 'INPUT_INVALID',
    });
  });
});
