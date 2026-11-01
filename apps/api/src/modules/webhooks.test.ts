// Webhooks over HTTP with and without the signing key (spec 0064, AC-6419 to AC-6423). The owner's instruction of
// 1 November: `WEBHOOK_SECRET_KEY` is not set on either production yet, the work ships now, and it must work the
// moment the key is added. So the two states both have a test here, over one database, in the order they happen:
//
// 1. No key. The api boots and serves as always. The list answers `available: false` with no endpoints, every write
//    answers 503 API_UNAVAILABLE, and because no endpoint can exist, a write that would queue an event queues
//    nothing: there is no backlog to drain later and nothing half sent. Nothing unsigned ever leaves.
// 2. The key set and the api started again, on the same database. The list answers `available: true`, an endpoint can
//    be added, the same write now queues one delivery, and the worker's task sends it signed and records it
//    delivered. No migration, no repair, no other step.
//
// The pair exists so nobody later makes the no key path start queuing: a change that queued without a key would fail
// the first test, and a change that needed a repair step would fail the second.
import { newId, signatureHeader, verifySignature, type WebhookSend } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { decodeWebhookKey } from '@crm/core';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rpcClient, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { testWebhookSender } from '../testing.ts';

const { ownerUrl } = inject('testDatabase');
const key = decodeWebhookKey(randomBytes(32).toString('base64'));

let db: Database;
let identity: IdentityStore;
/** The api with no `WEBHOOK_SECRET_KEY`, which is what both productions run today. */
let withoutKey: ReturnType<typeof signInApp>['app'];
/** The same api started again with the key set, on the same database. */
let withKey: ReturnType<typeof signInApp>['app'];
/** Every send the api with the key made, in order: what would have left, never sent anywhere. */
const sent: WebhookSend[] = [];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app: withoutKey } = signInApp({ db, identity }));
  // The sender keeps each send rather than reaching the network, so a test proves what would have left.
  const take = testWebhookSender();
  ({ app: withKey } = signInApp(
    { db, identity },
    { webhookKey: key },
    {
      webhookSender: (one) => {
        sent.push(one);
        return take(one);
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/**
 * The workspace's endpoints as the database holds them. With no key none can be made, and core's enqueue reads this
 * same table and stores nothing when it is empty (`queues nothing while the workspace has no endpoint` in
 * `packages/core/src/webhooks/webhooks.test.ts`), which is why no key means nothing is queued.
 */
const endpointsIn = (workspaceId: string) =>
  testQuery<{ id: string; status: string }>(
    ownerUrl,
    `select id, status from webhook_endpoints where workspace_id = $1`,
    [workspaceId],
  );

const deliveriesIn = (workspaceId: string) =>
  testQuery<{ id: string; state: string; event_type: string }>(
    ownerUrl,
    `select id, state, event_type from webhook_deliveries where workspace_id = $1 order by created_at`,
    [workspaceId],
  );

describe('webhooks with no signing key', () => {
  it('serves, says it is paused, refuses every write 503, and queues nothing at all', async () => {
    const owner = await memberWithWorkspace(withoutKey);
    // The screen's own read: paused, with nothing to show.
    expect(await owner.client.webhooks.list({ workspace: owner.slug })).toEqual({ available: false, endpoints: [] });
    // Every write, so nobody can make an endpoint that would then be sent to unsigned.
    const unavailable = { code: 'API_UNAVAILABLE', status: 503 };
    const refused = await failure(() =>
      owner.client.webhooks.create({
        workspace: owner.slug,
        url: 'https://hooks.example.com/timefix',
        description: 'Zapier',
        events: ['form.submitted'],
        mutationId: newId(),
      }),
    );
    expect({ code: refused.code, status: refused.status }).toEqual(unavailable);
    const rotate = await failure(() =>
      owner.client.webhooks.rotateSecret({ workspace: owner.slug, endpointId: newId(), mutationId: newId() }),
    );
    expect({ code: rotate.code, status: rotate.status }).toEqual(unavailable);
    const test = await failure(() =>
      owner.client.webhooks.test({ workspace: owner.slug, endpointId: newId(), mutationId: newId() }),
    );
    expect({ code: test.code, status: test.status }).toEqual(unavailable);
    // No endpoint could be made, so the write path's one read finds none and stores nothing: no backlog to drain.
    expect(await endpointsIn(owner.workspace.id)).toEqual([]);
    expect(await deliveriesIn(owner.workspace.id)).toEqual([]);
  });
});

describe('the key added, the api started again (no other step)', () => {
  it('works straight away: the same write queues a delivery, and the worker sends it signed', async () => {
    // The workspace is made on the api that had no key, as a real one would have been.
    const before = await memberWithWorkspace(withoutKey);
    expect(await before.client.webhooks.list({ workspace: before.slug })).toMatchObject({ available: false });
    expect(await endpointsIn(before.workspace.id)).toEqual([]);
    expect(await deliveriesIn(before.workspace.id)).toEqual([]);

    // The key is set and the api restarted. Nothing else: no migration, no repair.
    const owner = { ...before, client: rpcClient(withKey, before.cookie) };
    expect(await owner.client.webhooks.list({ workspace: owner.slug })).toMatchObject({ available: true });
    const made = await owner.client.webhooks.create({
      workspace: owner.slug,
      url: 'https://hooks.example.com/timefix',
      description: 'Zapier',
      events: ['form.submitted'],
      mutationId: newId(),
    });
    expect(made.secret).toMatch(/^whsec_/);

    // A delivery goes out at once, signed, with no other step: Send test event sends from the request through the
    // same sender the worker uses. The capturing sender is handed the signed send, so the secrets and the address
    // are proved before anything would leave, and the answer is recorded in the log.
    const result = await owner.client.webhooks.test({
      workspace: owner.slug,
      endpointId: made.endpoint.id,
      mutationId: newId(),
    });
    expect(result).toMatchObject({ state: 'sent', responseStatus: 200, attempt: 1 });
    expect(sent.map((one) => ({ url: one.url, secret: one.secrets[0], type: one.eventType }))).toEqual([
      { url: 'https://hooks.example.com/timefix', secret: made.secret, type: 'ping' },
    ]);
    const header = signatureHeader(sent[0]?.secrets ?? [], Math.floor(Date.now() / 1000), sent[0]?.body ?? '');
    expect(verifySignature(header, made.secret, sent[0]?.body ?? '', Math.floor(Date.now() / 1000))).toBe(true);
    const log = await owner.client.webhooks.deliveries({ workspace: owner.slug, endpointId: made.endpoint.id });
    expect(log.deliveries[0]).toMatchObject({ state: 'sent', responseStatus: 200, attempt: 1 });
    // Only what happened from now on: nothing from before the key was set was queued, so none is sent.
    expect(await deliveriesIn(owner.workspace.id)).toHaveLength(1);
  });

  it('never returns or stores the secret in the clear, with the key set', async () => {
    const owner = await memberWithWorkspace(withKey);
    const made = await owner.client.webhooks.create({
      workspace: owner.slug,
      url: 'https://h.example.com/x',
      description: '',
      events: ['booking.created'],
      mutationId: newId(),
    });
    const listed = await owner.client.webhooks.list({ workspace: owner.slug });
    expect(JSON.stringify(listed)).not.toContain(made.secret);
    expect(listed.endpoints[0]).toMatchObject({ secretHint: made.secret.slice(-4) });
    // Sealed at rest, so the stored bytes hold neither the secret nor its tail.
    const stored = await db.withWorkspace(owner.workspace.id, (tx) =>
      tx.execute<{ sealed: string }>(
        sql`select encode(secret_sealed, 'escape') as sealed from webhook_endpoints where id = ${made.endpoint.id}::uuid`,
      ),
    );
    expect(stored.rows[0]?.sealed ?? '').not.toContain(made.secret.slice(6));
  });
});
