// Invitations (spec 0031, slice 2) against a real Postgres as the app role:
// who may invite, the one open invitation per address, the limits, only the
// hash stored, the uniform invalid answer, accepting by the invited verified
// email only, once, and an audit row for each.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { INVITE_INVALID_MESSAGE, OWNER_RULES_MESSAGE, PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { isInvitedEmail } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { acceptInvite, inviteMembers, listInvitations, peekInvite, resendInvite, revokeInvite } from './invitations.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-invitations-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-invitations-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => newId().slice(-12);

async function person(name = 'Bea') {
  const email = `${tag()}@example.com`;
  const id = await createTestUser(identityUrl, { email, name });
  return { id, name, email, emailVerified: true };
}

/** A workspace its owner made, with one more member of `role` (an admin by default). */
async function workspace(role: Role = 'admin') {
  const owner = await person('Ada');
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug: `acme-${tag()}`,
    firstMember: { userId: owner.id, name: 'Ada', email: owner.email },
  });
  const workspaceId = created.workspace.id;
  const otherId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${otherId}, 'Cy', ${`${otherId}@example.com`}, ${role}, 'system', 'system')`,
    ),
  );
  const as = (memberId: string, asRole: Role, limits?: { seats?: number; openInvitations?: number }) =>
    testScope({
      db,
      workspaceId,
      actor: { type: 'member', id: memberId },
      role: asRole,
      ...(limits === undefined ? {} : { limits }),
    });
  return {
    ...created,
    workspaceId,
    owner: as(created.memberId, 'owner'),
    ownerId: created.memberId,
    other: as(otherId, role),
    otherId,
    as,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const audit = (workspaceId: string) =>
  testQuery<{ action: string; target_type: string; actor_type: string; before: unknown; after: unknown }>(
    ownerUrl,
    'select action, target_type, actor_type::text, before, after from audit_events where workspace_id = $1 order by at, id',
    [workspaceId],
  );

describe('inviting (AC-803, AC-804)', () => {
  it('invites with one role, refuses members per address, and stores only the hash', async () => {
    const w = await workspace();
    const outcome = await inviteMembers(w.owner, {
      emails: [' Grace@Example.com ', 'grace@example.com', `${w.otherId}@example.com`, 'linus@example.com'],
      role: 'member',
    });
    expect(outcome.refused).toEqual([
      { email: `${w.otherId}@example.com`, code: 'ALREADY_MEMBER', message: 'Already a member' },
    ]);
    expect(outcome.sent.map((each) => each.invitation.email)).toEqual(
      expect.arrayContaining(['grace@example.com', 'linus@example.com']),
    );
    expect(outcome.sent).toHaveLength(2);
    const [first] = outcome.sent;
    expect(first?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first?.invitation).toMatchObject({ role: 'member', invitedBy: 'Ada', isExpired: false, kind: 'email' });
    const stored = await testQuery<{ token_hash: string; days: number }>(
      ownerUrl,
      `select token_hash, round(extract(epoch from expires_at - last_sent_at) / 86400)::int as days from invitations where workspace_id = $1 order by email`,
      [w.workspaceId],
    );
    const hashes = outcome.sent.map((each) => createHash('sha256').update(each.token).digest('hex'));
    expect(stored.map((row) => row.token_hash).sort()).toEqual([...hashes].sort());
    expect(stored.every((row) => row.days === 7)).toBe(true);
    // The token itself appears nowhere in the table or the audit log.
    const text = await testQuery<{ text: string }>(
      ownerUrl,
      `select (select string_agg(i::text, ' ') from invitations i where workspace_id = $1) || (select string_agg(a::text, ' ') from audit_events a where workspace_id = $1) as text`,
      [w.workspaceId],
    );
    for (const each of outcome.sent) expect(text[0]?.text).not.toContain(each.token);
    expect((await audit(w.workspaceId)).map((row) => row.action)).toEqual(['invitation.created', 'invitation.created']);
  });

  it('resends an open invitation to the same address: a new token, the old link dead', async () => {
    const w = await workspace();
    const first = await inviteMembers(w.owner, { emails: ['grace@example.com'], role: 'member' });
    const again = await inviteMembers(w.other, { emails: ['grace@example.com'], role: 'admin' });
    expect(again.sent[0]?.invitation.id).toBe(first.sent[0]?.invitation.id);
    expect(again.sent[0]?.sendCount).toBe(2);
    expect(again.sent[0]?.invitation.role).toBe('admin');
    expect(await refusalOf(peekInvite({ db }, first.sent[0]?.token ?? ''))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await peekInvite({ db }, again.sent[0]?.token ?? '')).toMatchObject({
      role: 'admin',
      workspaceName: 'Acme',
    });
    const resent = await resendInvite(w.owner, { invitationId: first.sent[0]?.invitation.id ?? '' });
    expect(resent.sendCount).toBe(3);
    expect(await refusalOf(peekInvite({ db }, again.sent[0]?.token ?? ''))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await listInvitations(w.owner)).toHaveLength(1);
  });

  it('lets only an owner invite an owner, and refuses a member', async () => {
    const w = await workspace('admin');
    expect(await refusalOf(inviteMembers(w.other, { emails: ['x@example.com'], role: 'owner' }))).toEqual({
      code: 'FORBIDDEN',
      message: OWNER_RULES_MESSAGE,
    });
    const m = await workspace('member');
    expect(await refusalOf(inviteMembers(m.other, { emails: ['x@example.com'], role: 'member' }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['members.invite'].message,
    });
    expect(await refusalOf(listInvitations(m.other))).toMatchObject({ code: 'FORBIDDEN' });
    const made = await inviteMembers(m.owner, { emails: ['owner@example.com'], role: 'owner' });
    expect(made.sent).toHaveLength(1);
  });

  it('acts with the role held now: an admin demoted since the request came in invites nothing', async () => {
    const w = await workspace('admin');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update members set role = 'member' where id = ${w.otherId}`),
    );
    expect(await refusalOf(inviteMembers(w.other, { emails: ['x@example.com'], role: 'member' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses past the open invitation cap, and past the seats (AC-808, AC-809)', async () => {
    const w = await workspace();
    const capped = w.as(w.ownerId, 'owner', { openInvitations: 2 });
    await inviteMembers(capped, { emails: ['a@example.com', 'b@example.com'], role: 'member' });
    expect(await refusalOf(inviteMembers(capped, { emails: ['c@example.com'], role: 'member' }))).toMatchObject({
      code: 'INVITES_LIMIT',
    });
    // A resend takes no new place.
    expect((await inviteMembers(capped, { emails: ['a@example.com'], role: 'member' })).sent).toHaveLength(1);
    // Two members and two open invitations hold four seats.
    const seats = w.as(w.ownerId, 'owner', { seats: 4 });
    expect(await refusalOf(inviteMembers(seats, { emails: ['c@example.com'], role: 'member' }))).toEqual({
      code: 'SEAT_LIMIT',
      message: 'Your plan has no free seats.',
    });
  });

  it('revokes: the link answers invalid, like any other bad token', async () => {
    const w = await workspace();
    const made = await inviteMembers(w.owner, { emails: ['grace@example.com'], role: 'member' });
    await revokeInvite(w.other, { invitationId: made.sent[0]?.invitation.id ?? '' });
    for (const token of [made.sent[0]?.token ?? '', 'x'.repeat(43), 'not-a-token']) {
      expect(await refusalOf(peekInvite({ db }, token))).toEqual({
        code: 'INVITE_INVALID',
        message: INVITE_INVALID_MESSAGE,
      });
    }
    expect(await listInvitations(w.owner)).toEqual([]);
    expect(await refusalOf(revokeInvite(w.owner, { invitationId: made.sent[0]?.invitation.id ?? '' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await audit(w.workspaceId)).map((row) => row.action)).toEqual(['invitation.created', 'invitation.revoked']);
  });
});

describe('who may resend and revoke, and the send limit (AC-804, AC-808)', () => {
  it('refuses a member, and an admin on an owner invitation, before anything is counted or written', async () => {
    const w = await workspace('member');
    const made = await inviteMembers(w.owner, { emails: ['grace@example.com'], role: 'member' });
    const invitationId = made.sent[0]?.invitation.id ?? '';
    const counted: number[] = [];
    const limit = (sends: number) => {
      counted.push(sends);
      return Promise.resolve();
    };
    for (const call of [
      resendInvite(w.other, { invitationId }, [], { limit }),
      revokeInvite(w.other, { invitationId }),
      inviteMembers(w.other, { emails: ['x@example.com'], role: 'member' }, [], { limit }),
    ]) {
      expect(await refusalOf(call)).toEqual({ code: 'FORBIDDEN', message: PERMISSIONS['members.invite'].message });
    }
    expect(counted).toEqual([]);
    const a = await workspace('admin');
    const owners = await inviteMembers(a.owner, { emails: ['boss@example.com'], role: 'owner' });
    const ownerInvite = owners.sent[0]?.invitation.id ?? '';
    expect(await refusalOf(revokeInvite(a.other, { invitationId: ownerInvite }))).toEqual({
      code: 'FORBIDDEN',
      message: OWNER_RULES_MESSAGE,
    });
    expect(await refusalOf(resendInvite(a.other, { invitationId: ownerInvite }, [], { limit }))).toEqual({
      code: 'FORBIDDEN',
      message: OWNER_RULES_MESSAGE,
    });
    // A resend of an invitation that isn't there counts nothing either.
    expect(await refusalOf(resendInvite(a.owner, { invitationId: newId() }, [], { limit }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await refusalOf(inviteMembers(a.other, { emails: ['x@example.com'], role: 'owner' }, [], { limit })),
    ).toEqual({
      code: 'FORBIDDEN',
      message: OWNER_RULES_MESSAGE,
    });
    expect(counted).toEqual([]);
    expect(await listInvitations(a.owner)).toHaveLength(1);
  });

  it('counts each distinct address once, before the write, and a refused count writes nothing', async () => {
    const w = await workspace();
    const counted: number[] = [];
    await inviteMembers(w.owner, { emails: ['A@example.com', 'a@example.com', 'b@example.com'], role: 'member' }, [], {
      limit: (sends) => {
        counted.push(sends);
        return Promise.resolve();
      },
    });
    expect(counted).toEqual([2]);
    const spent = () => Promise.reject(new Error('Too many invitations went out in the last hour.'));
    await expect(
      inviteMembers(w.owner, { emails: ['c@example.com'], role: 'member' }, [], { limit: spent }),
    ).rejects.toThrow('Too many invitations');
    expect((await listInvitations(w.owner)).map((each) => each.email).sort()).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    const [first] = await listInvitations(w.owner);
    await expect(resendInvite(w.owner, { invitationId: first?.id ?? '' }, [], { limit: spent })).rejects.toThrow(
      'Too many invitations',
    );
    expect((await audit(w.workspaceId)).map((row) => row.action)).toEqual(['invitation.created', 'invitation.created']);
  });

  it('answers an expired invitation as invalid everywhere, and a resend renews it with one audit row', async () => {
    const w = await workspace();
    const invitee = await person();
    const made = await inviteMembers(w.owner, { emails: [invitee.email], role: 'member' });
    const invitationId = made.sent[0]?.invitation.id ?? '';
    await testQuery(ownerUrl, `update invitations set expires_at = now() - interval '1 second' where id = $1`, [
      invitationId,
    ]);
    const token = made.sent[0]?.token ?? '';
    expect(await refusalOf(peekInvite({ db }, token))).toEqual({
      code: 'INVITE_INVALID',
      message: INVITE_INVALID_MESSAGE,
    });
    expect(await refusalOf(acceptInvite({ db }, invitee, token))).toEqual({
      code: 'INVITE_INVALID',
      message: INVITE_INVALID_MESSAGE,
    });
    expect(await isInvitedEmail({ db }, invitee.email)).toBe(false);
    expect((await listInvitations(w.owner))[0]).toMatchObject({ id: invitationId, isExpired: true });
    const renewed = await resendInvite(w.owner, { invitationId });
    expect(renewed.invitation.isExpired).toBe(false);
    expect(await isInvitedEmail({ db }, invitee.email)).toBe(true);
    expect((await acceptInvite({ db }, invitee, renewed.token)).slug).toBe(w.workspace.slug);
    expect((await audit(w.workspaceId)).map((row) => row.action)).toEqual([
      'invitation.created',
      'invitation.resent',
      'invitation.accepted',
    ]);
  });
});

describe('the owner rules and who vouches for an invitation (key invariants)', () => {
  it('refuses an admin who re-invites an address an owner invitation names, and changes nothing', async () => {
    const w = await workspace('admin');
    const made = await inviteMembers(w.owner, { emails: ['boss@example.com'], role: 'owner' });
    const before = await testQuery<{ role: string; token_hash: string }>(
      ownerUrl,
      'select role::text, token_hash from invitations where workspace_id = $1',
      [w.workspaceId],
    );
    for (const role of ['member', 'admin'] as const) {
      expect(
        await refusalOf(inviteMembers(w.other, { emails: ['Boss@example.com', 'new@example.com'], role })),
      ).toEqual({ code: 'FORBIDDEN', message: OWNER_RULES_MESSAGE });
    }
    expect(
      await testQuery(ownerUrl, 'select role::text, token_hash from invitations where workspace_id = $1', [
        w.workspaceId,
      ]),
    ).toEqual(before);
    expect(await peekInvite({ db }, made.sent[0]?.token ?? '')).toMatchObject({ role: 'owner' });
  });

  it('opens nothing once its sender is removed or loses the power to send it, until someone who may resends it', async () => {
    const w = await workspace('admin');
    const owner = await person();
    const member = await person();
    const byAdmin = await inviteMembers(w.other, { emails: [member.email], role: 'member' });
    const memberToken = byAdmin.sent[0]?.token ?? '';
    const ownerInvite = await inviteMembers(w.owner, { emails: [owner.email], role: 'owner' });
    const ownerToken = ownerInvite.sent[0]?.token ?? '';
    // The owner who sent the owner invitation becomes an admin: it opens nothing, the same as any bad link.
    const second = newId();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${second}, 'Eve', ${`${second}@example.com`}, 'owner', 'system', 'system')`,
      ),
    );
    await testQuery(ownerUrl, `update members set role = 'admin' where id = $1`, [w.ownerId]);
    expect(await refusalOf(peekInvite({ db }, ownerToken))).toEqual({
      code: 'INVITE_INVALID',
      message: INVITE_INVALID_MESSAGE,
    });
    expect(await refusalOf(acceptInvite({ db }, owner, ownerToken))).toMatchObject({ code: 'INVITE_INVALID' });
    // The admin who sent the member invitation is removed: theirs opens nothing either.
    await testQuery(ownerUrl, `update members set status = 'removed' where id = $1`, [w.otherId]);
    expect(await refusalOf(acceptInvite({ db }, member, memberToken))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await isInvitedEmail({ db }, member.email)).toBe(true);
    // An owner resends both: they stand again, and the Invitations tab names who sent them last.
    const asEve = w.as(second, 'owner');
    const listed = await listInvitations(asEve);
    expect(listed.map((each) => each.invitedBy)).toEqual(['Ada', 'Cy']);
    const renewed = await resendInvite(asEve, { invitationId: byAdmin.sent[0]?.invitation.id ?? '' });
    expect(renewed.invitation.invitedBy).toBe('Eve');
    expect((await acceptInvite({ db }, member, renewed.token)).slug).toBe(w.workspace.slug);
    const again = await resendInvite(asEve, { invitationId: ownerInvite.sent[0]?.invitation.id ?? '' });
    expect(await peekInvite({ db }, again.token)).toMatchObject({ role: 'owner', inviterName: 'Eve' });
  });

  it('answers another workspace’s invitation as not found, to resend and to revoke', async () => {
    const a = await workspace();
    const b = await workspace();
    const made = await inviteMembers(b.owner, { emails: ['grace@example.com'], role: 'member' });
    const invitationId = made.sent[0]?.invitation.id ?? '';
    expect(await refusalOf(resendInvite(a.owner, { invitationId }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(revokeInvite(a.owner, { invitationId }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await listInvitations(b.owner)).toHaveLength(1);
  });
});

describe('accepting (AC-805, AC-806, AC-807)', () => {
  it('peeks with the address masked, and opens sign up only for an invited address', async () => {
    const w = await workspace();
    const invitee = `${tag()}@example.com`;
    const made = await inviteMembers(w.owner, { emails: [invitee], role: 'admin' });
    expect(await peekInvite({ db }, made.sent[0]?.token ?? '')).toEqual({
      workspaceName: 'Acme',
      inviterName: 'Ada',
      role: 'admin',
      invitedEmailMasked: `${invitee.slice(0, 1)}***@example.com`,
    });
    expect(await isInvitedEmail({ db }, invitee.toUpperCase())).toBe(true);
    expect(await isInvitedEmail({ db }, `${tag()}@example.com`)).toBe(false);
  });

  it('joins the invited verified address once, as the role, with the directory row and an audit row', async () => {
    const w = await workspace();
    const invitee = await person('Grace Hopper');
    const made = await inviteMembers(w.owner, { emails: [invitee.email], role: 'admin' });
    const token = made.sent[0]?.token ?? '';
    // Two tabs at once: one joins, both land in the workspace.
    const [a, b] = await Promise.all([acceptInvite({ db }, invitee, token), acceptInvite({ db }, invitee, token)]);
    expect(a).toEqual(b);
    expect(a.slug).toBe(w.workspace.slug);
    const rows = await testQuery<{ role: string; name: string; email: string }>(
      ownerUrl,
      `select role::text, name, email from members where workspace_id = $1 and user_id = $2`,
      [w.workspaceId, invitee.id],
    );
    expect(rows).toEqual([{ role: 'admin', name: 'Grace Hopper', email: invitee.email }]);
    expect((await identity.workspacesOf(invitee.id)).map((each) => each.id)).toEqual([w.workspaceId]);
    expect(await refusalOf(peekInvite({ db }, token))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await isInvitedEmail({ db }, invitee.email)).toBe(false);
    const accepted = (await audit(w.workspaceId)).filter((row) => row.action === 'invitation.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ target_type: 'member', actor_type: 'member' });
  });

  it('names someone with no account name from their address, as first run does (QA Q83)', async () => {
    const w = await workspace();
    const email = `jo.smith+${tag()}@example.com`;
    const invitee = {
      id: await createTestUser(identityUrl, { email, name: '' }),
      name: '',
      email,
      emailVerified: true,
    };
    const made = await inviteMembers(w.owner, { emails: [email], role: 'member' });
    await acceptInvite({ db }, invitee, made.sent[0]?.token ?? '');
    const rows = await testQuery<{ name: string }>(
      ownerUrl,
      `select name from members where workspace_id = $1 and user_id = $2`,
      [w.workspaceId, invitee.id],
    );
    expect(rows).toEqual([{ name: 'Jo Smith' }]);
  });

  it('refuses anyone but the invited verified address, and joins nothing', async () => {
    const w = await workspace();
    const invitee = await person();
    const made = await inviteMembers(w.owner, { emails: [invitee.email], role: 'member' });
    const token = made.sent[0]?.token ?? '';
    const stranger = await person('Mallory');
    expect(await refusalOf(acceptInvite({ db }, stranger, token))).toEqual({
      code: 'INVITE_EMAIL_MISMATCH',
      message: `This invitation is for ${invitee.email.slice(0, 1)}***@example.com. Sign in with that address to accept.`,
    });
    expect(await refusalOf(acceptInvite({ db }, { ...invitee, emailVerified: false }, token))).toMatchObject({
      code: 'INVITE_EMAIL_MISMATCH',
    });
    expect(await identity.workspacesOf(stranger.id)).toEqual([]);
    expect(await refusalOf(acceptInvite({ db }, invitee, 'y'.repeat(43)))).toMatchObject({ code: 'INVITE_INVALID' });
    // Still open for the right person.
    expect((await acceptInvite({ db }, invitee, token)).slug).toBe(w.workspace.slug);
  });

  it('spends the invitation of someone already in by another way, with its audit row, and changes nothing else', async () => {
    const w = await workspace();
    const invitee = await person();
    const made = await inviteMembers(w.owner, { emails: [invitee.email], role: 'admin' });
    const memberId = newId();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${w.workspaceId}, ${memberId}, ${invitee.id}, 'Bea', ${invitee.email}, 'member', 'system', 'system')`,
      ),
    );
    expect(await acceptInvite({ db }, invitee, made.sent[0]?.token ?? '')).toMatchObject({ memberId });
    const [row] = await testQuery<{ role: string }>(ownerUrl, 'select role::text from members where id = $1', [
      memberId,
    ]);
    expect(row).toEqual({ role: 'member' });
    const accepted = (await audit(w.workspaceId)).filter((each) => each.action === 'invitation.accepted');
    expect(accepted).toEqual([
      {
        action: 'invitation.accepted',
        target_type: 'invitation',
        actor_type: 'member',
        before: { status: 'open' },
        after: { status: 'used', alreadyMember: true },
      },
    ]);
  });

  it('gives a returning removed person a new member row, and keeps the old one removed', async () => {
    const w = await workspace();
    const invitee = await person();
    const first = await inviteMembers(w.owner, { emails: [invitee.email], role: 'member' });
    const joined = await acceptInvite({ db }, invitee, first.sent[0]?.token ?? '');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${joined.memberId}`),
    );
    await identity.dropMembership(invitee.id, w.workspaceId);
    const again = await inviteMembers(w.owner, { emails: [invitee.email], role: 'admin' });
    const back = await acceptInvite({ db }, invitee, again.sent[0]?.token ?? '');
    expect(back.memberId).not.toBe(joined.memberId);
    const rows = await testQuery<{ status: string }>(
      ownerUrl,
      `select status::text from members where workspace_id = $1 and user_id = $2 order by created_at`,
      [w.workspaceId, invitee.id],
    );
    expect(rows.map((row) => row.status)).toEqual(['removed', 'active']);
    expect((await identity.workspacesOf(invitee.id)).map((each) => each.id)).toEqual([w.workspaceId]);
  });
});

describe('the audit log is append only (AC-830)', () => {
  it('refuses the app an update or a delete of a row', async () => {
    const w = await workspace();
    await inviteMembers(w.owner, { emails: ['grace@example.com'], role: 'member' });
    await expect(
      db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`update audit_events set action = 'member.removed'`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`delete from audit_events`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    // Not even the owner role gets past the trigger.
    await expect(
      testQuery(ownerUrl, 'delete from audit_events where workspace_id = $1', [w.workspaceId]),
    ).rejects.toMatchObject({ code: 'CRM02' });
  });
});
