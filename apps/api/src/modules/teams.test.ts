// Teams through the real app (spec 0031, slice 8, AC-824 to AC-827): an owner makes, renames, fills and deletes a
// team; a member reads the list and changes nothing; a team id from another workspace is not found; and
// `access.mine` carries the caller's teams.
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

/** A person in `owner`'s workspace, invited and accepted through the app. */
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
  const { memberId } = await client.access.mine({ workspace: owner.slug });
  return { client, memberId };
}

describe('teams (AC-824 to AC-827)', () => {
  it('lets an owner make, rename, fill and delete a team, and a member read it and change nothing', async () => {
    const owner = await memberWithWorkspace(app);
    const ada = await teammate(owner);
    const workspace = owner.slug;
    const ownerId = (await owner.client.access.mine({ workspace })).memberId;
    const made = await owner.client.teams.create({
      workspace,
      name: 'Sales',
      memberIds: [ada.memberId],
      mutationId: newId(),
    });
    expect(made).toMatchObject({ name: 'Sales', memberIds: [ada.memberId] });
    const renamed = await owner.client.teams.rename({
      workspace,
      teamId: made.id,
      name: 'Revenue',
      mutationId: newId(),
    });
    expect(renamed.name).toBe('Revenue');
    const filled = await owner.client.teams.changeMembers({
      workspace,
      teamId: made.id,
      add: [ownerId],
      remove: [ada.memberId],
      mutationId: newId(),
    });
    expect(filled.memberIds).toEqual([ownerId]);
    // A member reads the list, their own teams ride on access.mine, and every change is refused.
    expect((await ada.client.teams.list({ workspace })).teams).toEqual([filled]);
    expect((await ada.client.access.mine({ workspace })).teamIds).toEqual([]);
    expect(await refusal(() => ada.client.teams.create({ workspace, name: 'Ops', mutationId: newId() }))).toMatchObject(
      {
        code: 'FORBIDDEN',
        status: 403,
      },
    );
    expect(
      await refusal(() => ada.client.teams.delete({ workspace, teamId: made.id, mutationId: newId() })),
    ).toMatchObject({ code: 'FORBIDDEN' });
    await owner.client.teams.changeMembers({ workspace, teamId: made.id, add: [ada.memberId], mutationId: newId() });
    expect((await ada.client.access.mine({ workspace })).teamIds).toEqual([made.id]);
    await owner.client.teams.delete({ workspace, teamId: made.id, mutationId: newId() });
    expect((await owner.client.teams.list({ workspace })).teams).toEqual([]);
  });

  it('refuses a name another team has with NAME_TAKEN, and a team of another workspace as not found', async () => {
    const owner = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    await owner.client.teams.create({ workspace: owner.slug, name: 'Sales', mutationId: newId() });
    expect(
      await refusal(() => owner.client.teams.create({ workspace: owner.slug, name: 'sales', mutationId: newId() })),
    ).toMatchObject({ code: 'NAME_TAKEN', status: 409 });
    const theirs = await other.client.teams.create({ workspace: other.slug, name: 'Sales', mutationId: newId() });
    expect(
      await refusal(() =>
        owner.client.teams.rename({ workspace: owner.slug, teamId: theirs.id, name: 'Mine', mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
