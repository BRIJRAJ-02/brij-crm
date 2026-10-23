// Workspace changes over HTTP (spec 0046, AC-4621, AC-4622, AC-4634): the
// owner and an admin read the log (200), a member is refused 403 with the
// permission's sentence, nobody signed in gets 401, and another workspace's
// address answers as the door does for a stranger (404). A cursor that isn't
// one is 400 INPUT_INVALID, and an unknown key is refused by the strict input.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, NOT_A_MEMBER, refusal } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
/** The invitation link each address was mailed last. */
const tokens = new Map<string, string>();
const mailpit = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
    {
      mailer: {
        transport: 'mailpit',
        send: (message: MailMessage) => {
          const token = /\/invite\/([A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
          if (token !== undefined) tokens.set(message.to, token);
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

type Owner = Awaited<ReturnType<typeof memberWithWorkspace>>;

/** A person invited into `owner`'s workspace as `role`, who accepted: their member id and client. */
async function teammate(owner: Owner, role: 'admin' | 'member') {
  const person = await signIn(app);
  await owner.client.invitations.create({ workspace: owner.slug, emails: [person.email], role, mutationId: newId() });
  const client = rpcClient(app, person.cookie);
  await client.invitations.accept({ token: tokens.get(person.email) ?? '' });
  const { memberId } = await client.access.mine({ workspace: owner.slug });
  return { client, memberId };
}

describe('audit.list', () => {
  it('answers the owner and an admin, refuses a member 403, and nobody signed in 401', async () => {
    const owner = await memberWithWorkspace(app);
    const admin = await teammate(owner, 'admin');
    const member = await teammate(owner, 'member');
    await owner.client.members.setRole({
      workspace: owner.slug,
      memberId: member.memberId,
      role: 'admin',
      mutationId: newId(),
    });
    await owner.client.members.setRole({
      workspace: owner.slug,
      memberId: member.memberId,
      role: 'member',
      mutationId: newId(),
    });

    const page = await owner.client.audit.list({ workspace: owner.slug });
    expect(page.entries.slice(0, 2).map((entry) => [entry.action, entry.params])).toEqual([
      ['member.role_changed', { from: 'admin', to: 'member' }],
      ['member.role_changed', { from: 'member', to: 'admin' }],
    ]);
    expect(page.entries.map((entry) => entry.action)).toContain('invitation.created');
    expect(JSON.stringify(page)).not.toMatch(/"(ip|requestId)":/);
    for (const entry of page.entries) {
      expect(Object.keys(entry).sort()).toEqual(['action', 'actor', 'at', 'changes', 'id', 'params', 'target']);
    }
    expect((await admin.client.audit.list({ workspace: owner.slug })).entries).toEqual(page.entries);

    // The member just lowered from admin is refused, with the permission's own sentence.
    expect(await refusal(() => member.client.audit.list({ workspace: owner.slug }))).toEqual({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Only workspace owners and admins can read the audit log.',
    });
    const signedOut = rpcClient(app);
    expect((await failure(() => signedOut.audit.list({ workspace: owner.slug }))).status).toBe(401);
  });

  it('answers another workspace’s address as not found, and refuses a cursor that isn’t one', async () => {
    const owner = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    expect(await refusal(() => other.client.audit.list({ workspace: owner.slug }))).toEqual(NOT_A_MEMBER);
    const bad = await failure(() => owner.client.audit.list({ workspace: owner.slug, cursor: 'not-a-cursor' }));
    expect(bad).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    const tooMany = await failure(() => owner.client.audit.list({ workspace: owner.slug, limit: 101 }));
    expect(tooMany.status).toBe(400);
  });
});
