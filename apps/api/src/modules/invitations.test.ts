// Invitations through the real app (spec 0031, slice 2): an admin invites,
// the email carries the link, a new address off a closed allowlist signs up
// because it is invited and accepts, another person is refused, peek is the
// same for every bad token and limited per IP, and members can't invite.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { addressKey } from './invitations/public.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import {
  MAILPIT_URL,
  newEmail,
  newIp,
  rpcClient,
  sendCode,
  signIn,
  signInApp,
  testConnections,
} from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, refusal } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
/** Every invitation email the app sent, in order. */
const invitations: MailMessage[] = [];
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
          if (message.subject.includes(' invited you to ')) invitations.push(message);
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

describe('inviting and accepting (AC-803 to AC-806)', () => {
  it('mails a link, peeks it masked, and joins the invited person once', async () => {
    const owner = await memberWithWorkspace(app);
    const invitee = await signIn(app);
    const made = await owner.client.invitations.create({
      workspace: owner.slug,
      emails: [invitee.email, owner.email],
      role: 'admin',
      mutationId: newId(),
    });
    expect(made.refused).toEqual([{ email: owner.email, code: 'ALREADY_MEMBER', message: 'Already a member' }]);
    expect(made.unsent).toEqual([]);
    const mail = invitations.find((message) => message.to === invitee.email);
    expect(mail?.subject).toBe('Ada invited you to Acme on Timefix');
    expect(mail?.text).toContain('Accept invitation');
    const token = tokenIn(mail);
    const anonymous = rpcClient(app);
    expect(await anonymous.invitations.peek({ token })).toEqual({
      workspaceName: 'Acme',
      inviterName: 'Ada',
      role: 'admin',
      roleLabel: 'Admin',
      invitedEmailMasked: `${invitee.email.slice(0, 1)}***@${invitee.email.split('@')[1] ?? ''}`,
    });
    // Someone else, signed in, is refused and joins nothing.
    const stranger = await signIn(app);
    expect((await refusal(() => rpcClient(app, stranger.cookie).invitations.accept({ token }))).code).toBe(
      'INVITE_EMAIL_MISMATCH',
    );
    const client = rpcClient(app, invitee.cookie);
    expect(await client.invitations.accept({ token })).toEqual({ slug: owner.slug });
    expect((await client.me.get()).workspaces.map((workspace) => workspace.slug)).toEqual([owner.slug]);
    expect((await client.access.mine({ workspace: owner.slug })).role).toBe('admin');
    expect(await refusal(() => anonymous.invitations.peek({ token }))).toEqual({
      code: 'INVITE_INVALID',
      status: 404,
      message: 'This invitation is no longer valid. Ask for a new one.',
    });
  });

  it('names the joiner with the invite card’s Your name, made plain, and refuses one too long (QA N14)', async () => {
    const owner = await memberWithWorkspace(app);
    const invitee = await signIn(app);
    await owner.client.invitations.create({
      workspace: owner.slug,
      emails: [invitee.email],
      role: 'member',
      mutationId: newId(),
    });
    const token = tokenIn(invitations.findLast((message) => message.to === invitee.email));
    const client = rpcClient(app, invitee.cookie);
    // Too long is refused at the door, and nothing joins.
    expect((await refusal(() => client.invitations.accept({ token, memberName: 'x'.repeat(81) }))).code).toBe(
      'INPUT_INVALID',
    );
    expect((await client.me.get()).workspaces).toEqual([]);
    expect(await client.invitations.accept({ token, memberName: ' Joanna\n Smith ' })).toEqual({ slug: owner.slug });
    const listed = await owner.client.members.list({ workspace: owner.slug });
    expect(listed.members.map((each) => each.name).sort()).toEqual(['Ada', 'Joanna Smith']);
  });

  it('refuses a member who tries to invite, and a non member', async () => {
    const owner = await memberWithWorkspace(app);
    const outsider = await signIn(app);
    const call = () =>
      rpcClient(app, outsider.cookie).invitations.create({
        workspace: owner.slug,
        emails: ['x@example.com'],
        role: 'member',
        mutationId: newId(),
      });
    expect((await refusal(call)).code).toBe('NOT_FOUND');
  });
});

/** A second person in `owner`'s workspace as `role`: invited and accepted through the app, with their own client. */
async function teammate(owner: Awaited<ReturnType<typeof memberWithWorkspace>>, role: 'admin' | 'member') {
  const person = await signIn(app);
  await owner.client.invitations.create({ workspace: owner.slug, emails: [person.email], role, mutationId: newId() });
  const token = tokenIn(invitations.findLast((message) => message.to === person.email));
  const client = rpcClient(app, person.cookie);
  await client.invitations.accept({ token });
  return { ...person, client };
}

/** How many sends a limiter key has counted in its open window (0 when none). */
async function counted(key: string): Promise<number> {
  const rows = await testQuery<{ count: number }>(ownerUrl, 'select count from auth.rate_limit where key = $1', [key]);
  return rows[0]?.count ?? 0;
}

describe('who may invite, and the send limits (AC-808, AC-831)', () => {
  it('refuses a member before any send is counted, and holds an inviter to 20 sends an hour', async () => {
    const owner = await memberWithWorkspace(app);
    // The inviter's own limit is the person's, across every workspace they invite from.
    const ownerUserId = (await owner.client.me.get()).user.id;
    const mate = await teammate(owner, 'member');
    expect(await counted(`invites:inviter:${ownerUserId}`)).toBe(1);
    const workspaceKey = `invites:workspace:${owner.workspace.id}`;
    const spent = await counted(workspaceKey);
    expect(spent).toBe(1);
    for (const call of [
      () =>
        mate.client.invitations.create({
          workspace: owner.slug,
          emails: ['x@example.com'],
          role: 'member',
          mutationId: newId(),
        }),
      () => mate.client.invitations.list({ workspace: owner.slug }),
    ]) {
      expect(await refusal(call)).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }
    expect(await counted(workspaceKey)).toBe(spent);
    // 19 more make 20 this hour; the 21st is refused with the wait.
    const nineteen = Array.from({ length: 19 }, (_, index) => `limit-${String(index)}-${newEmail()}`);
    const made = await owner.client.invitations.create({
      workspace: owner.slug,
      emails: nineteen,
      role: 'member',
      mutationId: newId(),
    });
    expect(made.invited).toHaveLength(19);
    const refused = await refusal(() =>
      owner.client.invitations.resend({
        workspace: owner.slug,
        invitationId: made.invited[0]?.id ?? '',
        mutationId: newId(),
      }),
    );
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(refused.message).toMatch(/^Too many invitations went out in the last hour\. Try again in \d+ minutes\.$/);
  });

  it('asks for a session to accept, and answers a bad token the same signed in or not', async () => {
    const owner = await memberWithWorkspace(app);
    await owner.client.invitations.create({
      workspace: owner.slug,
      emails: [newEmail()],
      role: 'member',
      mutationId: newId(),
    });
    expect(await refusal(() => rpcClient(app).invitations.accept({ token: 'q'.repeat(43) }))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    const someone = await signIn(app);
    expect(await refusal(() => rpcClient(app, someone.cookie).invitations.accept({ token: 'q'.repeat(43) }))).toEqual({
      code: 'INVITE_INVALID',
      status: 404,
      message: 'This invitation is no longer valid. Ask for a new one.',
    });
  });
});

describe('sign up for an invited address (AC-807)', () => {
  it('opens a closed allowlist for an address an open invitation names, and for nobody else', async () => {
    // A closed list, as in production: nobody new but the one listed address, and invited ones.
    const listed = newEmail();
    const closed = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [listed] });
    const owner = await memberWithWorkspace(app);
    const invited = newEmail();
    await owner.client.invitations.create({
      workspace: owner.slug,
      emails: [invited],
      role: 'member',
      mutationId: newId(),
    });
    expect((await sendCode(closed.app, invited, newIp())).status).toBe(200);
    const stranger = await sendCode(closed.app, newEmail(), newIp());
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toMatchObject({ code: 'SIGNUP_CLOSED' });
    // The invited account joins the workspace that invited it, and starts none of its own while the list is closed.
    const joined = await signIn(closed.app, invited);
    const client = rpcClient(closed.app, joined.cookie);
    await client.invitations.accept({ token: tokenIn(invitations.findLast((message) => message.to === invited)) });
    expect((await client.me.get()).workspaces.map((workspace) => workspace.slug)).toEqual([owner.slug]);
    const start = (cookie: string) =>
      rpcClient(closed.app, cookie).workspaces.create({
        id: newId(),
        name: 'Mine',
        slug: `mine-${newId().slice(-8)}`,
        memberName: 'Bea',
      });
    expect(await refusal(() => start(joined.cookie))).toMatchObject({ code: 'SIGNUP_CLOSED', status: 403 });
    // A listed address still starts one.
    const allowed = await signIn(closed.app, listed);
    expect((await start(allowed.cookie)).workspace.name).toBe('Mine');
  });
});

describe('the peek limit’s key (AC-808)', () => {
  it('keys an IPv4 address whole, an IPv6 one by its /64, and anything else as unknown', () => {
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:DB8:0001:0002::9')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(addressKey('not an address')).toBe('unknown');
    expect(addressKey(undefined)).toBe('unknown');
  });
});

describe('peek (AC-805, AC-808)', () => {
  it('answers every bad token the same, and at most 20 a minute per IP', async () => {
    const anonymous = rpcClient(app);
    // Other tests here peek from the same address, so the 21st call at the latest is refused.
    const codes: string[] = [];
    for (let call = 0; call < 21; call += 1) {
      codes.push((await failure(() => anonymous.invitations.peek({ token: 'z'.repeat(43) }))).code);
    }
    expect(codes.at(-1)).toBe('RATE_LIMITED');
    expect(new Set(codes)).toEqual(new Set(['INVITE_INVALID', 'RATE_LIMITED']));
  });
});
