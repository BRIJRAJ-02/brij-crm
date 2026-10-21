// Members through the real app (spec 0031, slice 3): removing someone and
// leaving drop the person's switcher entry and answer their next call as
// not found; a member id from another workspace is not found; a member
// changes no role, not even their own; the page pages and searches.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
/** The invitation link each address was mailed last. */
const tokens = new Map<string, string>();
/** Every subject each address was mailed, in order. */
const subjects = new Map<string, string[]>();
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
          subjects.set(message.to, [...(subjects.get(message.to) ?? []), message.subject]);
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

/** A person in `owner`'s workspace, invited and accepted through the app: their id, user id and client. */
async function teammate(owner: Owner) {
  const person = await signIn(app);
  await owner.client.invitations.create({
    workspace: owner.slug,
    emails: [person.email],
    role: 'member',
    mutationId: newId(),
  });
  const client = rpcClient(app, person.cookie);
  await client.invitations.accept({ token: tokens.get(person.email) ?? '' });
  const me = await client.me.get();
  const { memberId } = await client.access.mine({ workspace: owner.slug });
  return { client, memberId, userId: me.user.id };
}

const NOT_FOUND = { code: 'NOT_FOUND', status: 404 };

describe('removing and leaving (AC-811, AC-812)', () => {
  it('drops the person’s switcher entry and answers their next call as not found', async () => {
    const owner = await memberWithWorkspace(app);
    const gone = await teammate(owner);
    const leaving = await teammate(owner);
    expect((await identity.workspacesOf(gone.userId)).map((each) => each.id)).toEqual([owner.workspace.id]);
    await owner.client.members.remove({ workspace: owner.slug, memberId: gone.memberId, mutationId: newId() });
    await leaving.client.members.leave({ workspace: owner.slug, mutationId: newId() });
    for (const person of [gone, leaving]) {
      expect(await identity.workspacesOf(person.userId)).toEqual([]);
      expect((await person.client.me.get()).workspaces).toEqual([]);
      expect(await refusal(() => person.client.members.list({ workspace: owner.slug }))).toMatchObject(NOT_FOUND);
    }
    expect((await owner.client.members.list({ workspace: owner.slug })).members.map((each) => each.id)).toEqual([
      (await owner.client.access.mine({ workspace: owner.slug })).memberId,
    ]);
  });

  it('answers a member id from another workspace as not found, to a role change and a removal', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const theirs = await teammate(b);
    expect(
      await refusal(() =>
        a.client.members.setRole({ workspace: a.slug, memberId: theirs.memberId, role: 'admin', mutationId: newId() }),
      ),
    ).toMatchObject(NOT_FOUND);
    expect(
      await refusal(() =>
        a.client.members.remove({ workspace: a.slug, memberId: theirs.memberId, mutationId: newId() }),
      ),
    ).toMatchObject(NOT_FOUND);
    expect(
      await refusal(() =>
        a.client.members.transferOwnership({ workspace: a.slug, memberId: theirs.memberId, mutationId: newId() }),
      ),
    ).toMatchObject(NOT_FOUND);
    expect((await b.client.members.list({ workspace: b.slug })).total).toBe(2);
  });

  it('refuses an admin handing the workspace on, and changes no role', async () => {
    const owner = await memberWithWorkspace(app);
    const admin = await teammate(owner);
    await owner.client.members.setRole({
      workspace: owner.slug,
      memberId: admin.memberId,
      role: 'admin',
      mutationId: newId(),
    });
    const mate = await teammate(owner);
    expect(
      await refusal(() =>
        admin.client.members.transferOwnership({ workspace: owner.slug, memberId: mate.memberId, mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const roles = (await owner.client.members.list({ workspace: owner.slug })).members.map((each) => each.role).sort();
    expect(roles).toEqual(['admin', 'member', 'owner']);
  });

  it('lets a member change no role, not even their own, and refuses the only owner leaving', async () => {
    const owner = await memberWithWorkspace(app);
    const mate = await teammate(owner);
    expect(
      await refusal(() =>
        mate.client.members.setRole({
          workspace: owner.slug,
          memberId: mate.memberId,
          role: 'admin',
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(
      await refusal(() => owner.client.members.leave({ workspace: owner.slug, mutationId: newId() })),
    ).toMatchObject({ code: 'LAST_OWNER', status: 409 });
  });
});

describe('the invite link (AC-818)', () => {
  it('lets anyone signed in join through it as a member, and refuses a member managing it', async () => {
    const owner = await memberWithWorkspace(app);
    expect(await owner.client.invitations.link({ workspace: owner.slug })).toEqual({
      enabled: false,
      uses: 0,
      isSpent: false,
    });
    const on = await owner.client.invitations.setLink({ workspace: owner.slug, enabled: true, mutationId: newId() });
    expect(on).toMatchObject({ enabled: true, role: 'member', uses: 0 });
    const person = await signIn(app);
    const client = rpcClient(app, person.cookie);
    expect(await client.invitations.peek({ token: on.token ?? '' })).not.toHaveProperty('invitedEmailMasked');
    expect(await client.invitations.accept({ token: on.token ?? '' })).toEqual({ slug: owner.slug });
    expect((await client.access.mine({ workspace: owner.slug })).role).toBe('member');
    expect(
      await refusal(() => client.invitations.setLink({ workspace: owner.slug, enabled: false, mutationId: newId() })),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect((await owner.client.invitations.link({ workspace: owner.slug })).uses).toBe(1);
  });
});

describe('domain join (AC-819, AC-820)', () => {
  it('lets a person at the domain ask, mails the owner, and an approval joins and mails them', async () => {
    const owner = await memberWithWorkspace(app);
    const domains = await owner.client.joinRequests.setDomains({
      workspace: owner.slug,
      domains: ['example.com'],
      mutationId: newId(),
    });
    expect(domains).toMatchObject({ domains: ['example.com'], yourDomain: 'example.com' });
    const asker = await signIn(app);
    const client = rpcClient(app, asker.cookie);
    const joinable = await client.join.list();
    const mine = joinable.find((each) => each.workspaceId === owner.workspace.id);
    expect(mine).toMatchObject({ state: 'none' });
    expect(await client.join.request({ workspaceId: owner.workspace.id })).toMatchObject({ state: 'pending' });
    expect(subjects.get(owner.email)?.at(-1)).toMatch(/asked to join/);
    // Asking is no way in: the workspace still answers not found.
    expect(await refusal(() => client.members.list({ workspace: owner.slug }))).toMatchObject(NOT_FOUND);
    const [request] = await owner.client.joinRequests.list({ workspace: owner.slug });
    await owner.client.joinRequests.decide({
      workspace: owner.slug,
      requestId: request?.id ?? '',
      approve: true,
      mutationId: newId(),
    });
    expect(subjects.get(asker.email)?.at(-1)).toMatch(/You’ve joined/);
    expect((await client.access.mine({ workspace: owner.slug })).role).toBe('member');
  });

  it('refuses a public domain, and a member managing domains or requests', async () => {
    const owner = await memberWithWorkspace(app);
    expect(
      await refusal(() =>
        owner.client.joinRequests.setDomains({ workspace: owner.slug, domains: ['gmail.com'], mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'DOMAIN_PUBLIC', status: 422 });
    const mate = await teammate(owner);
    expect(await refusal(() => mate.client.joinRequests.list({ workspace: owner.slug }))).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(await refusal(() => mate.client.joinRequests.domains({ workspace: owner.slug }))).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});

describe('the remove dialog (AC-816)', () => {
  it('counts what a removal will do, and hands their work on as a job', async () => {
    const owner = await memberWithWorkspace(app);
    const gone = await teammate(owner);
    const heir = await teammate(owner);
    expect(await owner.client.members.removalPreview({ workspace: owner.slug, memberId: gone.memberId })).toEqual({
      pausedPages: 0,
      calendars: 0,
      openTasks: 0,
      records: 0,
    });
    // A member asks about nobody but themself.
    expect(
      await refusal(() => heir.client.members.removalPreview({ workspace: owner.slug, memberId: gone.memberId })),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const removed = await owner.client.members.remove({
      workspace: owner.slug,
      memberId: gone.memberId,
      reassignTo: heir.memberId,
      mutationId: newId(),
    });
    expect(removed.jobId).toEqual(expect.any(String));
    // Without anyone chosen, no job.
    const other = await teammate(owner);
    expect(
      await owner.client.members.remove({ workspace: owner.slug, memberId: other.memberId, mutationId: newId() }),
    ).toEqual({});
  });
});

describe('the Members page’s list (AC-810)', () => {
  it('pages with a cursor and searches by name or email', async () => {
    const owner = await memberWithWorkspace(app);
    await teammate(owner);
    const first = await owner.client.members.list({ workspace: owner.slug, limit: 1 });
    expect(first.members).toHaveLength(1);
    expect(first.total).toBe(2);
    const second = await owner.client.members.list({
      workspace: owner.slug,
      limit: 1,
      cursor: first.nextCursor ?? '',
    });
    expect(second.members).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect((await owner.client.members.list({ workspace: owner.slug, search: 'EXAMPLE.COM' })).total).toBe(2);
    expect((await owner.client.members.list({ workspace: owner.slug, search: 'Ada' })).total).toBe(1);
    expect(await refusal(() => owner.client.members.list({ workspace: owner.slug, cursor: 'nonsense' }))).toMatchObject(
      { code: 'INPUT_INVALID' },
    );
  });
});
