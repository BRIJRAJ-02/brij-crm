// Domain join (spec 0031, slice 6, AC-819, AC-820) against a real Postgres as
// the app role: only an admin's own verified, non public domain goes on; a
// person at it sees the workspace on /join and asks once; owners and admins
// approve (they join) or decline (it reads as pending for 30 days); each
// change has its audit row, and another workspace's request is not found.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import {
  decideJoinRequest,
  getWorkspaceDomains,
  listJoinable,
  listJoinRequests,
  requestToJoin,
  setWorkspaceDomains,
} from './domain-join.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-domain-join-tests' });
});
afterAll(async () => {
  await db.close();
});

const tag = () => newId().slice(-12);

/** A signed in person at `domain` (a fresh account), verified unless told otherwise. */
async function person(domain: string, name = 'Bea', emailVerified = true) {
  const email = `${name.toLowerCase()}-${tag()}@${domain}`;
  const id = await createTestUser(identityUrl, { email, name });
  return { id, name, email, emailVerified };
}

/** A workspace whose owner is at `domain`, with a member of `role` too. */
async function workspace(domain: string, role: Role = 'member') {
  const owner = await person(domain, 'Ada');
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: `Acme ${tag()}`,
    slug: `acme-${tag()}`,
    firstMember: { userId: owner.id, name: 'Ada', email: owner.email },
  });
  const workspaceId = created.workspace.id;
  const otherId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${otherId}, 'Cy', ${`cy-${tag()}@${domain}`}, ${role}, 'system', 'system')`,
    ),
  );
  const as = (memberId: string, asRole: Role) =>
    testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: asRole });
  return {
    workspaceId,
    name: created.workspace.name,
    slug: created.workspace.slug,
    owner: as(created.memberId, 'owner'),
    ownerPerson: owner,
    other: as(otherId, role),
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

const actions = (workspaceId: string) =>
  testQuery<{ action: string }>(
    ownerUrl,
    `select action from audit_events where workspace_id = $1 and action like any(array['workspace.domains%', 'join_request.%']) order by at, id`,
    [workspaceId],
  ).then((rows) => rows.map((row) => row.action));

describe('email domains (AC-819)', () => {
  it('lets an admin add only their own verified, non public domain, and take it away', async () => {
    const domain = `acme-${tag()}.test`;
    const w = await workspace(domain);
    const ada = w.ownerPerson;
    expect(await getWorkspaceDomains(w.owner, ada)).toEqual({ domains: [], yourDomain: domain, isPublic: false });
    expect(await refusalOf(setWorkspaceDomains(w.owner, { domains: ['globex.test'] }, ada))).toMatchObject({
      code: 'DOMAIN_NOT_YOURS',
    });
    expect(await refusalOf(setWorkspaceDomains(w.owner, { domains: ['gmail.com'] }, ada))).toMatchObject({
      code: 'DOMAIN_PUBLIC',
    });
    // Unverified, their own domain isn't theirs to add.
    expect(
      await refusalOf(setWorkspaceDomains(w.owner, { domains: [domain] }, { ...ada, emailVerified: false })),
    ).toMatchObject({ code: 'DOMAIN_NOT_YOURS' });
    expect(await setWorkspaceDomains(w.owner, { domains: [domain.toUpperCase()] }, ada)).toMatchObject({
      domains: [domain],
    });
    expect((await setWorkspaceDomains(w.owner, { domains: [] }, ada)).domains).toEqual([]);
    expect(await actions(w.workspaceId)).toEqual(['workspace.domains_set', 'workspace.domains_set']);
    // A public address offers nothing to turn on.
    expect(await getWorkspaceDomains(w.owner, { email: 'ada@gmail.com', emailVerified: true })).toEqual({
      domains: [],
      isPublic: true,
    });
  });

  it('is for holders of workspace.manage only', async () => {
    const domain = `acme-${tag()}.test`;
    const w = await workspace(domain);
    expect(await refusalOf(getWorkspaceDomains(w.other, w.ownerPerson))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['workspace.manage'].message,
    });
  });
});

describe('asking to join and answering (AC-819, AC-820)', () => {
  it('shows a person at the domain the workspace, takes one request, and an approval joins them', async () => {
    const domain = `acme-${tag()}.test`;
    const w = await workspace(domain, 'admin');
    expect(await listJoinable({ db }, await person(domain))).toEqual([]);
    await setWorkspaceDomains(w.owner, { domains: [domain] }, w.ownerPerson);
    const bea = await person(domain);
    expect(await listJoinable({ db }, bea)).toEqual([{ workspaceId: w.workspaceId, name: w.name, state: 'none' }]);
    // Unverified or elsewhere: nothing.
    expect(await listJoinable({ db }, { ...bea, emailVerified: false })).toEqual([]);
    expect(await listJoinable({ db }, await person(`other-${tag()}.test`))).toEqual([]);

    const asked = await requestToJoin({ db }, bea, w.workspaceId);
    expect(asked.joinable.state).toBe('pending');
    // Both owner and admin hear of it.
    expect(asked.notice?.admins.map((admin) => admin.name).sort()).toEqual(['Ada', 'Cy']);
    expect(asked.notice?.requester).toEqual({ name: 'Bea', email: bea.email });
    // Asking again writes nothing and says pending.
    const again = await requestToJoin({ db }, bea, w.workspaceId);
    expect(again).toEqual({ joinable: { workspaceId: w.workspaceId, name: w.name, state: 'pending' } });
    const open = await listJoinRequests(w.other);
    expect(open).toEqual([expect.objectContaining({ name: 'Bea', email: bea.email })]);

    const decided = await decideJoinRequest(w.other, { requestId: open[0]?.id ?? '', approve: true });
    expect(decided).toMatchObject({ approved: true, email: bea.email, slug: w.slug });
    const joined = await testQuery<{ role: string }>(
      ownerUrl,
      `select role::text from members where workspace_id = $1 and user_id = $2 and status = 'active'`,
      [w.workspaceId, bea.id],
    );
    expect(joined).toEqual([{ role: 'member' }]);
    const directory = await testQuery<{ n: number }>(
      ownerUrl,
      'select count(*)::int as n from auth.workspace_membership where workspace_id = $1 and user_id = $2',
      [w.workspaceId, bea.id],
    );
    expect(directory[0]?.n).toBe(1);
    expect(await listJoinable({ db }, bea)).toEqual([]);
    expect(await listJoinRequests(w.owner)).toEqual([]);
    expect(await actions(w.workspaceId)).toEqual([
      'workspace.domains_set',
      'join_request.created',
      'join_request.approved',
    ]);
    // Answered once: again is not found.
    expect(await refusalOf(decideJoinRequest(w.owner, { requestId: open[0]?.id ?? '', approve: false }))).toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });

  it('keeps a decline quiet for 30 days, then lets them ask again', async () => {
    const domain = `acme-${tag()}.test`;
    const w = await workspace(domain);
    await setWorkspaceDomains(w.owner, { domains: [domain] }, w.ownerPerson);
    const bea = await person(domain);
    await requestToJoin({ db }, bea, w.workspaceId);
    const [request] = await listJoinRequests(w.owner);
    await decideJoinRequest(w.owner, { requestId: request?.id ?? '', approve: false });
    expect(await listJoinable({ db }, bea)).toEqual([{ workspaceId: w.workspaceId, name: w.name, state: 'pending' }]);
    expect((await requestToJoin({ db }, bea, w.workspaceId)).notice).toBeUndefined();
    await testQuery(ownerUrl, `update join_requests set decided_at = now() - interval '31 days' where id = $1`, [
      request?.id,
    ]);
    expect((await listJoinable({ db }, bea))[0]?.state).toBe('none');
    expect((await requestToJoin({ db }, bea, w.workspaceId)).notice).toBeDefined();
  });

  it('refuses a member deciding, another workspace, and a domain taken away', async () => {
    const domain = `acme-${tag()}.test`;
    const w = await workspace(domain);
    const elsewhere = await workspace(`globex-${tag()}.test`);
    await setWorkspaceDomains(w.owner, { domains: [domain] }, w.ownerPerson);
    const bea = await person(domain);
    expect(await refusalOf(requestToJoin({ db }, bea, elsewhere.workspaceId))).toMatchObject({ code: 'NOT_FOUND' });
    await requestToJoin({ db }, bea, w.workspaceId);
    const [request] = await listJoinRequests(w.owner);
    expect(await refusalOf(listJoinRequests(w.other))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(decideJoinRequest(w.other, { requestId: request?.id ?? '', approve: true }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await refusalOf(decideJoinRequest(elsewhere.owner, { requestId: request?.id ?? '', approve: true })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    await setWorkspaceDomains(w.owner, { domains: [] }, w.ownerPerson);
    expect(await listJoinable({ db }, await person(domain))).toEqual([]);
  });
});
