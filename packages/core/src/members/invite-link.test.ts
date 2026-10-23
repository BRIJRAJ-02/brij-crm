// The invite link (spec 0031, slice 6, AC-818) against a real Postgres as the
// app role: off by default, on with a token an admin can copy again, changed
// in place, reset to a new token, off revoking it; joining through it with a
// verified email, up to its most uses and before its expiry; only holders of
// `members.invite`; never opening sign up; an audit row for each change.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { isInvitedEmail } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { acceptInvite, getInviteLink, peekInvite, revokeInvite, setInviteLink } from './invitations.ts';
import { setMemberRole } from './members.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-invite-link-tests' });
});
afterAll(async () => {
  await db.close();
});

const tag = () => newId().slice(-12);

async function person(name = 'Bea', emailVerified = true) {
  const email = `${tag()}@example.com`;
  const id = await createTestUser(identityUrl, { email, name });
  return { id, name, email, emailVerified };
}

/** A workspace its owner made, with an admin and a member. */
async function workspace() {
  const owner = await person('Ada');
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug: `acme-${tag()}`,
    firstMember: { userId: owner.id, name: 'Ada', email: owner.email },
  });
  const workspaceId = created.workspace.id;
  const ids = { admin: newId(), member: newId() };
  await db.withWorkspace(workspaceId, async (tx) => {
    for (const [role, id] of Object.entries(ids)) {
      await tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${role}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      );
    }
  });
  const as = (memberId: string, role: Role, limits?: { seats?: number; openInvitations?: number }) =>
    testScope({
      db,
      workspaceId,
      actor: { type: 'member', id: memberId },
      role,
      ...(limits === undefined ? {} : { limits }),
    });
  return {
    workspaceId,
    slug: created.workspace.slug,
    owner: as(created.memberId, 'owner'),
    admin: as(ids.admin, 'admin'),
    adminId: ids.admin,
    member: as(ids.member, 'member'),
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

const roleOf = (workspaceId: string, userId: string) =>
  testQuery<{ role: string }>(
    ownerUrl,
    `select role::text from members where workspace_id = $1 and user_id = $2 and status = 'active'`,
    [workspaceId, userId],
  );

describe('the invite link (AC-818)', () => {
  it('is off by default; on, an admin copies it again; anyone verified joins as a member, once each', async () => {
    const w = await workspace();
    expect(await getInviteLink(w.admin)).toEqual({ enabled: false, uses: 0, isSpent: false });
    const on = await setInviteLink(w.admin, { enabled: true });
    expect(on).toMatchObject({ enabled: true, role: 'member', uses: 0, isSpent: false });
    expect(on.expiresAt).toBeUndefined();
    expect(on.maxUses).toBeUndefined();
    const token = on.token ?? '';
    expect(await getInviteLink(w.admin)).toEqual(on);
    // The peek names nobody, and the link opens no sign up (owner decision 3).
    expect(await peekInvite({ db }, token)).toEqual({ workspaceName: 'Acme', inviterName: 'admin', role: 'member' });
    const bea = await person('Bea');
    expect(await isInvitedEmail({ db }, bea.email)).toBe(false);
    const joined = await acceptInvite({ db }, bea, token);
    expect(joined.slug).toBe(w.slug);
    expect(await roleOf(w.workspaceId, bea.id)).toEqual([{ role: 'member' }]);
    // Again: already in, the link spends nothing.
    expect((await acceptInvite({ db }, bea, token)).memberId).toBe(joined.memberId);
    const cy = await person('Cy');
    await acceptInvite({ db }, cy, token);
    expect(await getInviteLink(w.owner)).toMatchObject({ enabled: true, uses: 2 });
  });

  it('names a link joiner with what they typed on the invite card, made plain (QA N14)', async () => {
    const w = await workspace();
    const token = (await setInviteLink(w.admin, { enabled: true })).token ?? '';
    const bea = await person('Bea');
    await acceptInvite({ db }, { ...bea, typedName: ' Beatrice\u2028Webb ' }, token);
    const rows = await testQuery<{ name: string }>(
      ownerUrl,
      `select name from members where workspace_id = $1 and user_id = $2`,
      [w.workspaceId, bea.id],
    );
    expect(rows).toEqual([{ name: 'Beatrice Webb' }]);
  });

  it('stops at its most uses and at its expiry, and a change in place keeps its token', async () => {
    const w = await workspace();
    const on = await setInviteLink(w.admin, { enabled: true, maxUses: 1, expiresInDays: 7 });
    expect(on).toMatchObject({ maxUses: 1 });
    expect(Date.parse(on.expiresAt ?? '') - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const token = on.token ?? '';
    await acceptInvite({ db }, await person('Bea'), token);
    expect(await getInviteLink(w.admin)).toMatchObject({ uses: 1, isSpent: true });
    expect(await refusalOf(acceptInvite({ db }, await person('Cy'), token))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await refusalOf(peekInvite({ db }, token))).toMatchObject({ code: 'INVITE_INVALID' });
    // Lifting the cap in place lets the same link work again.
    const lifted = await setInviteLink(w.admin, { enabled: true, maxUses: null });
    expect(lifted).toMatchObject({ token, isSpent: false });
    expect(lifted.maxUses).toBeUndefined();
    await acceptInvite({ db }, await person('Di'), token);
    // Past its expiry it opens nothing.
    await testQuery(
      ownerUrl,
      `update invitations set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    expect(await getInviteLink(w.admin)).toMatchObject({ isSpent: true });
    expect(await refusalOf(acceptInvite({ db }, await person('Ed'), token))).toMatchObject({ code: 'INVITE_INVALID' });
  });

  it('resets to a new token, the old one dead; off revokes it; each change has its audit row, never the token', async () => {
    const w = await workspace();
    const first = await setInviteLink(w.admin, { enabled: true, maxUses: 5 });
    const reset = await setInviteLink(w.admin, { enabled: true, reset: true });
    expect(reset.token).not.toBe(first.token);
    expect(reset).toMatchObject({ maxUses: 5, uses: 0 });
    expect(await refusalOf(peekInvite({ db }, first.token ?? ''))).toMatchObject({ code: 'INVITE_INVALID' });
    expect(await setInviteLink(w.admin, { enabled: false })).toEqual({ enabled: false, uses: 0, isSpent: false });
    expect(await refusalOf(acceptInvite({ db }, await person(), reset.token ?? ''))).toMatchObject({
      code: 'INVITE_INVALID',
    });
    // Off again changes nothing.
    await setInviteLink(w.admin, { enabled: false });
    const rows = await testQuery<{ action: string; after: Record<string, unknown> | null }>(
      ownerUrl,
      'select action, after from audit_events where workspace_id = $1 order by at, id',
      [w.workspaceId],
    );
    expect(rows.map((row) => row.action)).toEqual([
      'invitation.link_set',
      'invitation.link_set',
      'invitation.link_revoked',
    ]);
    expect(JSON.stringify(rows)).not.toContain(reset.token ?? 'none');
    // Revoke on the Invitations tab doesn't reach a link.
    const [link] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id from invitations where workspace_id = $1 and kind = 'link' limit 1`,
      [w.workspaceId],
    );
    expect(await refusalOf(revokeInvite(w.admin, { invitationId: link?.id ?? '' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is for holders of members.invite only, and opens nothing once its admin no longer may invite', async () => {
    const w = await workspace();
    expect(await refusalOf(getInviteLink(w.member))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['members.invite'].message,
    });
    expect(await refusalOf(setInviteLink(w.member, { enabled: true }))).toMatchObject({ code: 'FORBIDDEN' });
    const { token = '' } = await setInviteLink(w.admin, { enabled: true });
    await setMemberRole(w.owner, { memberId: w.adminId, role: 'member' });
    expect(await refusalOf(peekInvite({ db }, token))).toMatchObject({ code: 'INVITE_INVALID' });
  });

  it('refuses an unverified email, and an address someone here already holds', async () => {
    const w = await workspace();
    const { token = '' } = await setInviteLink(w.admin, { enabled: true });
    expect(await refusalOf(acceptInvite({ db }, await person('Bea', false), token))).toMatchObject({
      code: 'INVITE_EMAIL_MISMATCH',
    });
    // The seat check (AC-809) is the one email invitations use, shown with the plan's limit in invitations.test.ts.
    const taken = await person('Cy');
    await testQuery(ownerUrl, `update members set email = $2 where workspace_id = $1 and role = 'member'`, [
      w.workspaceId,
      taken.email,
    ]);
    expect(await refusalOf(acceptInvite({ db }, taken, token))).toMatchObject({ code: 'INVITE_INVALID' });
  });
});
