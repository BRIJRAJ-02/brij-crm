// Access rules through the real app (spec 0032, milestones 1 and 3): an owner takes People away from the Member role
// and gives it back to a team, and what a member then sees follows (hidden means absent). A member can't read or set
// rules (403 `FORBIDDEN`), an object of another workspace is not found, and a rule can't name an owner or an admin.
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

const MEMBER = { type: 'role', role: 'member' } as const;

describe('access rules (AC-843, AC-844, AC-851, AC-854)', () => {
  it('takes People from the Member role, gives it to a team, and what a member sees follows', async () => {
    const owner = await memberWithWorkspace(app);
    const workspace = owner.slug;
    const ada = await teammate(owner);
    const seesPeople = async () =>
      (await ada.client.objects.list({ workspace })).some((object) => object.id === owner.people.id);
    expect(await seesPeople()).toBe(true);

    const read = await owner.client.accessRules.get({ workspace, objectId: owner.people.id });
    expect(read.ownerAttribute?.title).toBe('Owner');
    expect(read.subjects).toEqual([
      { subject: MEMBER, level: 'write', records: 'all', defaultLevel: 'write', isDefault: true, people: 1 },
    ]);

    // Members lose People: it is absent from the member's objects, not shown locked.
    await owner.client.accessRules.set({
      workspace,
      objectId: owner.people.id,
      subject: MEMBER,
      rule: { level: 'none', records: 'all' },
      mutationId: newId(),
    });
    expect(await seesPeople()).toBe(false);

    // A team gets it back: Ada, in Sales, sees People again; an owner always did.
    const sales = await owner.client.teams.create({
      workspace,
      name: 'Sales',
      memberIds: [ada.memberId],
      mutationId: newId(),
    });
    const answer = await owner.client.accessRules.set({
      workspace,
      objectId: owner.people.id,
      subject: { type: 'team', teamId: sales.id },
      rule: { level: 'write', records: 'own' },
      mutationId: newId(),
    });
    expect(answer.subjects.map((each) => [each.level, each.records])).toEqual([
      ['none', 'all'],
      ['write', 'own'],
    ]);
    expect(await seesPeople()).toBe(true);
    // A rule that names a team can't be left dangling: the team stays while it is named.
    expect(
      await refusal(() => owner.client.teams.delete({ workspace, teamId: sales.id, mutationId: newId() })),
    ).toMatchObject({ code: 'IN_USE', status: 409 });
  });

  it('refuses a member, an owner or admin as a subject, and an object or team of another workspace', async () => {
    const owner = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    const workspace = owner.slug;
    const ada = await teammate(owner);
    const rule = { level: 'none', records: 'all' } as const;
    expect(await refusal(() => ada.client.accessRules.get({ workspace, objectId: owner.people.id }))).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(
      await refusal(() =>
        ada.client.accessRules.set({
          workspace,
          objectId: owner.people.id,
          subject: MEMBER,
          rule,
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // The contract only knows the Member role: an owner or admin as a subject never reaches the engine.
    for (const role of ['owner', 'admin']) {
      expect(
        await refusal(() =>
          owner.client.accessRules.set({
            workspace,
            objectId: owner.people.id,
            subject: { type: 'role', role } as never,
            rule,
            mutationId: newId(),
          }),
        ),
      ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    }
    expect(await refusal(() => owner.client.accessRules.get({ workspace, objectId: other.people.id }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const theirTeam = await other.client.teams.create({ workspace: other.slug, name: 'Sales', mutationId: newId() });
    expect(
      await refusal(() =>
        owner.client.accessRules.set({
          workspace,
          objectId: owner.people.id,
          subject: { type: 'team', teamId: theirTeam.id },
          rule: { level: 'write', records: 'all' },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
