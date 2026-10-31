// The public API through the real app (parity #34): a key made in Settings › Developer reads and writes records over
// `/api/v1` as itself, a read key is refused a write, every failure to let a key in is the same 401, a revoked key
// stops at once and Undo brings it back, and a key never reaches another workspace.
import { keyToken, newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request to `/api/v1` with a key, as a server would send it: no cookie, no Origin. */
function v1(path: string, token: string | undefined, init: { method?: string; body?: unknown } = {}) {
  return app.request(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

type Owner = Awaited<ReturnType<typeof memberWithWorkspace>>;

async function keyOf(owner: Owner, access: 'read' | 'write') {
  return owner.client.apiKeys.create({
    workspace: owner.slug,
    id: newId(),
    name: access === 'read' ? 'Report' : 'Sync',
    access,
    mutationId: newId(),
  });
}

describe('/api/v1 with an API key', () => {
  it('reads and writes records as the key, and lists the key with its hint only', async () => {
    const owner = await memberWithWorkspace(app);
    const { key, token } = await keyOf(owner, 'write');
    expect(token.endsWith(key.hint)).toBe(true);
    const listed = await owner.client.apiKeys.list({ workspace: owner.slug });
    expect(listed.keys.map((each) => each.id)).toEqual([key.id]);
    expect(JSON.stringify(listed)).not.toContain(token.slice(-20));

    const objects = await v1('/objects', token);
    expect(objects.status).toBe(200);
    const made = await v1('/objects/people/records', token, {
      method: 'POST',
      body: { values: { [owner.attribute('name')]: { firstName: 'Ada' } } },
    });
    expect(made.status).toBe(201);
    const record = (await made.json()) as { id: string; objectId: string; createdBy?: { type: string; id: string } };
    expect(record.objectId).toBe(owner.people.id);
    expect(record.createdBy).toMatchObject({ type: 'api_key', id: key.id });
    expect((await v1(`/objects/people/records/${record.id}`, token)).status).toBe(200);
    expect((await v1(`/objects/${owner.people.id}/records?limit=5`, token)).status).toBe(200);
    const changed = await v1(`/objects/people/records/${record.id}`, token, {
      method: 'PATCH',
      body: { values: { [owner.attribute('job_title')]: 'CTO' } },
    });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { values: Record<string, unknown> }).values[owner.attribute('job_title')]).toBe(
      'CTO',
    );
    expect((await v1(`/objects/people/records/${record.id}`, token, { method: 'DELETE' })).status).toBe(200);
    expect((await v1(`/objects/people/records/${record.id}`, token)).status).toBe(404);
  });

  it('refuses a read key every write, 403', async () => {
    const owner = await memberWithWorkspace(app);
    const { token } = await keyOf(owner, 'read');
    expect((await v1('/objects/people/records', token)).status).toBe(200);
    const refused = await v1('/objects/people/records', token, { method: 'POST', body: {} });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('FORBIDDEN');
    const theirs = await owner.client.records.create({
      workspace: owner.slug,
      objectId: owner.people.id,
      id: newId(),
      values: { [owner.attribute('name')]: { firstName: 'Grace' } },
      mutationId: newId(),
    });
    const path = `/objects/people/records/${theirs.id}`;
    const values = { [owner.attribute('job_title')]: 'CTO' };
    expect((await v1(path, token, { method: 'PATCH', body: { values } })).status).toBe(403);
    expect((await v1(path, token, { method: 'DELETE' })).status).toBe(403);
    expect((await v1(path, token)).status).toBe(200);
  });

  it('answers the same 401 for no key, a malformed one, a wrong secret and an unknown key', async () => {
    const owner = await memberWithWorkspace(app);
    const { key, token } = await keyOf(owner, 'write');
    const wrongSecret = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    const unknown = keyToken({ workspaceId: owner.workspace.id, keyId: newId(), secret: token.slice(-43) });
    const bodies = await Promise.all(
      [undefined, 'nope', wrongSecret, unknown].map(async (each) => {
        const answer = await v1('/objects', each);
        return { status: answer.status, body: await answer.text() };
      }),
    );
    expect(new Set(bodies.map((each) => each.status))).toEqual(new Set([401]));
    expect(new Set(bodies.map((each) => each.body)).size).toBe(1);
    expect(key.id).toBeDefined();
  });

  it('stops a revoked key at once, and Undo within its window brings it back', async () => {
    const owner = await memberWithWorkspace(app);
    const { key, token } = await keyOf(owner, 'write');
    await owner.client.apiKeys.revoke({ workspace: owner.slug, keyId: key.id, mutationId: newId() });
    expect((await v1('/objects', token)).status).toBe(401);
    expect((await owner.client.apiKeys.list({ workspace: owner.slug })).keys).toEqual([]);
    await owner.client.apiKeys.restore({ workspace: owner.slug, keyId: key.id, mutationId: newId() });
    expect((await v1('/objects', token)).status).toBe(200);
  });

  it('never reaches another workspace: its records are not found, and its id in the key opens nothing', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const { key, token } = await keyOf(a, 'write');
    const theirs = await b.client.records.create({
      workspace: b.slug,
      objectId: b.people.id,
      id: newId(),
      values: { [b.attribute('name')]: { firstName: 'Grace' } },
      mutationId: newId(),
    });
    expect((await v1(`/objects/people/records/${theirs.id}`, token)).status).toBe(404);
    expect((await v1(`/objects/${b.people.id}/records`, token)).status).toBe(404);
    // A's key and secret under B's workspace id: the key row isn't B's, so nothing opens.
    const parts = { keyId: key.id, secret: token.slice(-43) };
    expect((await v1('/objects', keyToken({ workspaceId: b.workspace.id, ...parts }))).status).toBe(401);
  });
});
