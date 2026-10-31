// Access rules through the real app (spec 0032, milestones 1 and 3): an owner takes People away from the Member role
// and gives it back to a team, and what a member then sees follows (hidden means absent). A member can't read or set
// rules (403 `FORBIDDEN`), an object of another workspace is not found, and a rule can't name an owner or an admin.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/mailer.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { LOCAL_CENTRIFUGO_TOKEN_SECRET } from '../env.ts';
import { APP_RULES } from '../rules.ts';
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
    // Live updates on, so the subscription token answers each member's audience channel (spec 0007, milestone 4).
    { CENTRIFUGO_TOKEN_SECRET: LOCAL_CENTRIFUGO_TOKEN_SECRET },
    {
      // The app's own rules: the stored ones (the test server names none unless asked).
      rules: APP_RULES,
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
      {
        subject: MEMBER,
        level: 'write',
        records: 'all',
        defaultLevel: 'write',
        isDefault: true,
        fields: {},
        people: 1,
      },
      // Guests (spec 0031, slice 9) see nothing until a rule shares the object with them.
      {
        subject: { type: 'role', role: 'guest' },
        level: 'none',
        records: 'all',
        defaultLevel: 'none',
        isDefault: true,
        fields: {},
        people: 0,
      },
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
    expect(answer.access.subjects.map((each) => [each.level, each.records])).toEqual([
      ['none', 'all'],
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

  it('hides a field from the Member role over the wire, says who lost it, and previews the member’s view', async () => {
    const owner = await memberWithWorkspace(app);
    const other = await memberWithWorkspace(app);
    const workspace = owner.slug;
    const ada = await teammate(owner);
    const read = await owner.client.accessRules.get({ workspace, objectId: owner.people.id });
    const jobTitle = read.fields.find((field) => field.title === 'Job title')?.id ?? '';
    const name = read.fields.find((field) => field.isPrimary)?.id ?? '';
    expect(jobTitle).not.toBe('');
    const attributesFor = async () =>
      (await ada.client.attributes.list({ workspace, objectId: owner.people.id })).map((attribute) => attribute.id);
    expect(await attributesFor()).toContain(jobTitle);

    const answer = await owner.client.accessRules.set({
      workspace,
      objectId: owner.people.id,
      subject: MEMBER,
      rule: { level: 'write', records: 'all', fields: { [jobTitle]: 'hidden' } },
      mutationId: newId(),
    });
    expect(answer.impact).toMatchObject({ people: 1 });
    expect(answer.access.subjects[0]?.fields).toEqual({ [jobTitle]: 'hidden' });
    // Absent for the member, present for the owner; the record's name can't be hidden.
    expect(await attributesFor()).not.toContain(jobTitle);
    expect(
      (await owner.client.attributes.list({ workspace, objectId: owner.people.id })).map((attribute) => attribute.id),
    ).toContain(jobTitle);
    expect(
      await refusal(() =>
        owner.client.accessRules.set({
          workspace,
          objectId: owner.people.id,
          subject: MEMBER,
          rule: { level: 'write', records: 'all', fields: { [name]: 'hidden' } },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });

    // Preview as Ada: the owner sees her fields, without the hidden one; she cannot ask, and nobody previews
    // a person of another workspace.
    const preview = await owner.client.accessRules.preview({
      workspace,
      objectId: owner.people.id,
      as: { type: 'member', memberId: ada.memberId },
    });
    expect(preview.level).toBe('write');
    expect(preview.fields.map((field) => field.id)).not.toContain(jobTitle);
    expect(preview.fields.map((field) => field.id)).toContain(name);
    expect(
      await refusal(() =>
        ada.client.accessRules.preview({
          workspace,
          objectId: owner.people.id,
          as: { type: 'member', memberId: ada.memberId },
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(
      await refusal(() =>
        other.client.accessRules.preview({
          workspace: other.slug,
          objectId: other.people.id,
          as: { type: 'member', memberId: ada.memberId },
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

// Audience channels (spec 0007 milestone 4, spec 0009 milestone 3, AC-145): the subscription token signs the
// caller's own audience channel, taken from the policy the door sealed. With no rules everyone shares
// `workspace:<id>`; a rule that restricts the Member role moves members to `workspace:<id>.<key>`, and the owner
// stays on the open one. The browser names only the workspace, never a channel.
describe('audience channels (AC-145)', () => {
  it("signs each member's own audience channel, and moves it when a rule changes their policy", async () => {
    const owner = await memberWithWorkspace(app);
    const workspace = owner.slug;
    const ada = await teammate(owner);
    const open = `workspace:${owner.workspace.id}`;
    const channelOf = async (client: Owner['client']) =>
      (await client.realtime.subscriptionToken({ workspace })).channel;
    expect(await channelOf(owner.client)).toBe(open);
    expect(await channelOf(ada.client)).toBe(open);

    await owner.client.accessRules.set({
      workspace,
      objectId: owner.people.id,
      subject: MEMBER,
      rule: { level: 'none', records: 'all' },
      mutationId: newId(),
    });
    const restricted = await channelOf(ada.client);
    expect(restricted).toMatch(new RegExp(`^workspace:${owner.workspace.id}\\.[0-9a-f]{16}$`));
    // The owner's policy restricts nothing: still the one open channel.
    expect(await channelOf(owner.client)).toBe(open);

    // The rule given back: Ada's policy is open again, and so is her channel.
    await owner.client.accessRules.set({
      workspace,
      objectId: owner.people.id,
      subject: MEMBER,
      rule: { level: 'write', records: 'all' },
      mutationId: newId(),
    });
    expect(await channelOf(ada.client)).toBe(open);
  });
});
