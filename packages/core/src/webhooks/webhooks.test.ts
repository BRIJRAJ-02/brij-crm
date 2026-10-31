// Webhooks against a real Postgres (spec 0064): who may manage them (AC-6419), the secret shown once and rotated
// with overlap (AC-6420), an event queued exactly when its write commits and once per endpoint (AC-6422), the
// backoff, giving up and turning an endpoint off with its email (AC-6423), the log (AC-6425), and isolation.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import * as core from '../index.ts';
import { systemScope } from '../access/door.ts';
import { testScope } from '../testing.ts';
import { finishWebhookDelivery, loadWebhookDelivery } from './deliver.ts';
import { queueWebhookEvent } from './queue.ts';
import { decodeWebhookKey, verifySignature, signatureHeader } from './signing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-webhooks-tests' });
});
afterAll(async () => {
  await db.close();
});

const key = decodeWebhookKey(randomBytes(32).toString('base64'));
const deps = { key, checkHost: () => Promise.resolve(undefined) };

let made = 0;
/** A workspace (its owner made it) with a second member of `role`, and both scopes. */
async function workspace(role: 'admin' | 'member' = 'member') {
  made += 1;
  const created = await core.createWorkspace(db, {
    name: 'Hooks',
    slug: `hooks-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = core.newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', ${role}, 'system', 'system')`,
    ),
  );
  const owner = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    role: 'owner',
  });
  const other = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId }, role });
  return { workspaceId: created.workspaceId, ownerId: created.memberId, owner, other };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (core.isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const queued = (deliveryId: string) =>
  testQuery<{ run_at: Date; queue_name: string }>(
    ownerUrl,
    `select j.run_at, q.queue_name from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
     where t.identifier = 'crm_webhook_deliver' and j.payload->>'deliveryId' = $1`,
    [deliveryId],
  );

describe('managing endpoints (AC-6419, AC-6420)', () => {
  it('refuses a member without webhooks.manage every call', async () => {
    const { other } = await workspace('member');
    const forbidden = { code: 'FORBIDDEN', message: 'Only workspace owners and admins can manage webhooks.' };
    const id = core.newId();
    expect(await refusalOf(core.listWebhooks(other, true))).toEqual(forbidden);
    expect(
      await refusalOf(
        core.createWebhook(other, deps, { url: 'https://h.example.com', description: '', events: ['booking.created'] }),
      ),
    ).toEqual(forbidden);
    expect(await refusalOf(core.updateWebhook(other, deps, { endpointId: id }))).toEqual(forbidden);
    expect(await refusalOf(core.rotateWebhookSecret(other, deps, { endpointId: id }))).toEqual(forbidden);
    expect(await refusalOf(core.deleteWebhook(other, { endpointId: id }))).toEqual(forbidden);
    expect(await refusalOf(core.listWebhookDeliveries(other, { endpointId: id }))).toEqual(forbidden);
    expect(await refusalOf(core.prepareWebhookTest(other, key, { endpointId: id }))).toEqual(forbidden);
    expect(await refusalOf(core.prepareWebhookResend(other, key, { deliveryId: id }))).toEqual(forbidden);
  });

  it('lets an admin add one, answers the secret once, and lists it by its last 4 characters only', async () => {
    const { other: admin } = await workspace('admin');
    const made = await core.createWebhook(admin, deps, {
      url: 'https://hooks.example.com/timefix',
      description: 'Zapier',
      events: ['booking.created', 'form.submitted'],
    });
    expect(made.secret).toMatch(/^whsec_/);
    expect(made.endpoint).toMatchObject({ status: 'active', secretHint: made.secret.slice(-4), description: 'Zapier' });
    const listed = await core.listWebhooks(admin, true);
    expect(JSON.stringify(listed)).not.toContain(made.secret);
    expect(listed.endpoints.map((each) => each.id)).toEqual([made.endpoint.id]);
  });

  it('refuses an eleventh endpoint, and an address that is not allowed, as CONFIG_INVALID', async () => {
    const { owner } = await workspace();
    for (let index = 0; index < 10; index += 1) {
      await core.createWebhook(owner, deps, {
        url: `https://h${String(index)}.example.com`,
        description: '',
        events: ['booking.created'],
      });
    }
    expect(
      await refusalOf(
        core.createWebhook(owner, deps, {
          url: 'https://h10.example.com',
          description: '',
          events: ['booking.created'],
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    const { owner: second } = await workspace();
    expect(
      await refusalOf(
        core.createWebhook(second, deps, { url: 'http://h.example.com', description: '', events: ['booking.created'] }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'url' });
    expect(
      await refusalOf(
        core.createWebhook(second, deps, { url: 'https://10.0.0.5/x', description: '', events: ['booking.created'] }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'url' });
    const privateDns = { key, checkHost: () => Promise.resolve('address' as const) };
    expect(
      await refusalOf(
        core.createWebhook(second, privateDns, {
          url: 'https://inside.example.com',
          description: '',
          events: ['booking.created'],
        }),
      ),
    ).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'url',
      message: 'That address points to a private network. Use a public one.',
    });
  });

  it('rotates with 24 hours of overlap: both secrets sign, and each verifies', async () => {
    const { owner, workspaceId } = await workspace();
    const made = await core.createWebhook(owner, deps, {
      url: 'https://hooks.example.com',
      description: '',
      events: ['booking.created'],
    });
    const rotated = await core.rotateWebhookSecret(owner, deps, { endpointId: made.endpoint.id });
    expect(rotated.secret).not.toBe(made.secret);
    expect(rotated.endpoint.previousSecretUntil).toBeDefined();
    const send = await core.prepareWebhookTest(owner, key, { endpointId: made.endpoint.id });
    expect(send.secrets).toEqual([rotated.secret, made.secret]);
    const header = signatureHeader(send.secrets, 1_730_000_000, send.body);
    expect(verifySignature(header, rotated.secret, send.body, 1_730_000_000)).toBe(true);
    expect(verifySignature(header, made.secret, send.body, 1_730_000_000)).toBe(true);
    // Past the overlap, only the new one signs.
    await testQuery(
      ownerUrl,
      `update webhook_endpoints set previous_secret_until = now() - interval '1 second' where workspace_id = $1`,
      [workspaceId],
    );
    const later = await core.prepareWebhookTest(owner, key, { endpointId: made.endpoint.id });
    expect(later.secrets).toEqual([rotated.secret]);
  });
});

describe('queueing an event (AC-6422)', () => {
  it('queues nothing when the write rolls back, and one delivery per subscribed endpoint, once, when it commits', async () => {
    const { owner, workspaceId } = await workspace();
    const a = await core.createWebhook(owner, deps, {
      url: 'https://a.example.com',
      description: '',
      events: ['form.submitted'],
    });
    const b = await core.createWebhook(owner, deps, {
      url: 'https://b.example.com',
      description: '',
      events: ['form.submitted', 'booking.created'],
    });
    await core.createWebhook(owner, deps, {
      url: 'https://c.example.com',
      description: '',
      events: ['booking.created'],
    });
    const data = { submission_id: core.newId(), form: { id: core.newId(), name: 'Contact' }, answers: {}, source: {} };
    await expect(
      db.withWorkspace(workspaceId, async (tx) => {
        await queueWebhookEvent(tx, 'form.submitted', () => Promise.resolve(data));
        throw new Error('The write failed.');
      }),
    ).rejects.toThrow('The write failed.');
    const none = await testQuery(ownerUrl, `select 1 from webhook_deliveries where workspace_id = $1`, [workspaceId]);
    expect(none).toHaveLength(0);

    const result = await db.withWorkspace(workspaceId, (tx) =>
      queueWebhookEvent(tx, 'form.submitted', () => Promise.resolve(data)),
    );
    expect(result.deliveries).toBe(2);
    const rows = await testQuery<{ id: string; endpoint_id: string; event_id: string }>(
      ownerUrl,
      `select id, endpoint_id, event_id from webhook_deliveries where workspace_id = $1 order by endpoint_id`,
      [workspaceId],
    );
    expect(rows.map((row) => row.endpoint_id).sort()).toEqual([a.endpoint.id, b.endpoint.id].sort());
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(1);
    for (const row of rows) {
      const job = await queued(row.id);
      expect(job).toHaveLength(1);
      expect(job[0]?.queue_name).toBe(`webhook:${workspaceId}:${row.endpoint_id}`);
    }
  });

  it('reads nothing at all when no endpoint wants the event', async () => {
    const { owner, workspaceId } = await workspace();
    await core.createWebhook(owner, deps, {
      url: 'https://a.example.com',
      description: '',
      events: ['booking.created'],
    });
    let read = 0;
    const result = await db.withWorkspace(workspaceId, (tx) =>
      queueWebhookEvent(tx, 'form.submitted', () => {
        read += 1;
        return Promise.resolve({});
      }),
    );
    expect(result.deliveries).toBe(0);
    expect(read).toBe(0);
  });

  it('reads none of another workspace’s endpoints or deliveries, even with no filter', async () => {
    const one = await workspace();
    const two = await workspace();
    await core.createWebhook(one.owner, deps, {
      url: 'https://a.example.com',
      description: '',
      events: ['form.submitted'],
    });
    await db.withWorkspace(one.workspaceId, (tx) =>
      queueWebhookEvent(tx, 'form.submitted', () =>
        Promise.resolve({
          submission_id: core.newId(),
          form: { id: core.newId(), name: 'x' },
          answers: {},
          source: {},
        }),
      ),
    );
    const seen = await db.withWorkspace(two.workspaceId, async (tx) => ({
      endpoints: (await tx.execute(sql`select id from webhook_endpoints`)).rows,
      deliveries: (await tx.execute(sql`select id from webhook_deliveries`)).rows,
    }));
    expect(seen).toEqual({ endpoints: [], deliveries: [] });
    expect((await core.listWebhooks(two.owner, true)).endpoints).toEqual([]);
  });
});

describe('delivering (AC-6423, AC-6425)', () => {
  async function oneDelivery() {
    const ws = await workspace();
    const made = await core.createWebhook(ws.owner, deps, {
      url: 'https://a.example.com',
      description: '',
      events: ['form.submitted'],
    });
    await db.withWorkspace(ws.workspaceId, (tx) =>
      queueWebhookEvent(tx, 'form.submitted', () =>
        Promise.resolve({
          submission_id: core.newId(),
          form: { id: core.newId(), name: 'x' },
          answers: {},
          source: {},
        }),
      ),
    );
    const [row] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id from webhook_deliveries where workspace_id = $1`,
      [ws.workspaceId],
    );
    if (row === undefined) throw new Error('No delivery was queued.');
    return { ...ws, endpointId: made.endpoint.id, deliveryId: row.id, system: systemScope(db, ws.workspaceId) };
  }

  const failed = { ok: false, status: 500, ms: 12, excerpt: 'Internal error', failure: 'status' as const };

  it('retries a 500 at each backoff step, then gives up after the eighth try', async () => {
    const { system, deliveryId } = await oneDelivery();
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const loaded = await loadWebhookDelivery(system, key, { deliveryId });
      if (loaded.kind !== 'send') throw new Error(`Try ${String(attempt)} was skipped.`);
      expect(loaded.send.attempt).toBe(attempt);
      const finished = await finishWebhookDelivery(system, loaded.send, failed, () => 0.5);
      if (attempt < 8) {
        expect(finished.delivery.state).toBe('failed');
        const due = (await queued(deliveryId))[0]?.run_at;
        const wait = ((due?.getTime() ?? 0) - Date.now()) / 1000;
        expect(wait).toBeGreaterThan((core.WEBHOOK_BACKOFF_SECONDS[attempt - 1] ?? 0) - 30);
      } else {
        expect(finished.delivery.state).toBe('gave_up');
      }
    }
    expect(await loadWebhookDelivery(system, key, { deliveryId })).toEqual({ kind: 'skip', reason: 'done' });
  });

  it('records a delivered one with its status, time and the first 1 KB of the answer', async () => {
    const { system, deliveryId, owner, endpointId } = await oneDelivery();
    const loaded = await loadWebhookDelivery(system, key, { deliveryId });
    if (loaded.kind !== 'send') throw new Error('It was skipped.');
    expect(JSON.parse(loaded.send.body)).toMatchObject({ id: loaded.send.eventId, type: 'form.submitted' });
    await finishWebhookDelivery(system, loaded.send, { ok: true, status: 204, ms: 80, excerpt: 'x'.repeat(5000) });
    const page = await core.listWebhookDeliveries(owner, { endpointId });
    expect(page.deliveries[0]).toMatchObject({ state: 'sent', responseStatus: 204, responseMs: 80, attempt: 1 });
    expect(page.deliveries[0]?.responseExcerpt).toHaveLength(1024);
    expect((await core.listWebhooks(owner, true)).endpoints[0]?.lastDelivery).toMatchObject({
      state: 'sent',
      responseStatus: 204,
    });
  });

  it('turns an endpoint off after 3 days of failures, emails its owners and admins, and one switch turns it on', async () => {
    const { system, deliveryId, owner, endpointId, workspaceId } = await oneDelivery();
    await testQuery(
      ownerUrl,
      `update webhook_endpoints set failing_since = now() - interval '3 days 1 minute' where id = $1`,
      [endpointId],
    );
    const loaded = await loadWebhookDelivery(system, key, { deliveryId });
    if (loaded.kind !== 'send') throw new Error('It was skipped.');
    const finished = await finishWebhookDelivery(system, loaded.send, failed);
    expect(finished.endpointOff).toBe(true);
    const listed = await core.listWebhooks(owner, true);
    expect(listed.endpoints[0]).toMatchObject({ status: 'off', offReason: 'failing' });
    const emails = await testQuery<{ kind: string }>(
      ownerUrl,
      `select kind from emails where workspace_id = $1 and kind = 'webhook_endpoint_off'`,
      [workspaceId],
    );
    expect(emails).toHaveLength(1);
    // Its waiting try finds it off and gives up.
    expect(await loadWebhookDelivery(system, key, { deliveryId })).toEqual({ kind: 'skip', reason: 'off' });
    const on = await core.updateWebhook(owner, deps, { endpointId, status: 'active' });
    expect(on).toMatchObject({ status: 'active' });
    expect(on.offReason).toBeUndefined();
  });

  it('sends a test event as a ping and records it with no retry', async () => {
    const { owner, endpointId } = await oneDelivery();
    const send = await core.prepareWebhookTest(owner, key, { endpointId });
    expect(JSON.parse(send.body)).toMatchObject({ type: 'ping', data: { message: 'A test event from Timefix.' } });
    const recorded = await core.recordWebhookSend(owner, send, failed);
    expect(recorded).toMatchObject({ eventType: 'ping', state: 'failed', responseStatus: 500 });
    expect(recorded.nextAttemptAt).toBeUndefined();
    expect(await queued(send.deliveryId)).toHaveLength(0);
  });
});

describe('across workspaces and in the audit log', () => {
  it('answers NOT_FOUND to another workspace’s admin for every endpoint and delivery id of this one', async () => {
    const a = await workspace();
    const b = await workspace();
    const made = await core.createWebhook(a.owner, deps, {
      url: 'https://a.example.com',
      description: '',
      events: ['booking.created'],
    });
    const ping = await core.prepareWebhookTest(a.owner, key, { endpointId: made.endpoint.id });
    const endpointId = made.endpoint.id;
    // Thunks, so each refusal is awaited as it is made and none goes unhandled.
    for (const call of [
      () => core.updateWebhook(b.owner, deps, { endpointId, description: 'mine now' }),
      () => core.rotateWebhookSecret(b.owner, deps, { endpointId }),
      () => core.deleteWebhook(b.owner, { endpointId }),
      () => core.listWebhookDeliveries(b.owner, { endpointId }),
      () => core.prepareWebhookTest(b.owner, key, { endpointId }),
      () => core.prepareWebhookResend(b.owner, key, { deliveryId: ping.deliveryId }),
    ]) {
      expect(await refusalOf(call())).toMatchObject({ code: 'NOT_FOUND' });
    }
    // The queue function reads under the caller's workspace, and with none set it reads nothing.
    const queuedFromB = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute<{ queued: boolean }>(sql`select crm_enqueue_webhook_delivery(${ping.deliveryId}::uuid) as queued`),
    );
    expect(queuedFromB.rows[0]?.queued).toBe(false);
    const handles = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(sql`select handle from crm_webhook_form_handles(${core.newId()}::uuid)`),
    );
    expect(handles.rows).toEqual([]);
  });

  it('keeps an audit row for each change, naming the endpoint by its host only', async () => {
    const { owner, workspaceId } = await workspace();
    const made = await core.createWebhook(owner, deps, {
      url: 'https://hooks.zapier.example/hooks/catch/123/secretpath/',
      description: '',
      events: ['booking.created'],
    });
    const endpointId = made.endpoint.id;
    await core.updateWebhook(owner, deps, { endpointId, status: 'off' });
    await core.rotateWebhookSecret(owner, deps, { endpointId });
    await core.deleteWebhook(owner, { endpointId });
    const rows = await testQuery<{ action: string; after: unknown }>(
      ownerUrl,
      `select action, after from audit_events where workspace_id = $1 and action like 'webhook.%' order by at, action`,
      [workspaceId],
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      'webhook.created',
      'webhook.deleted',
      'webhook.secret_rotated',
      'webhook.updated',
    ]);
    for (const row of rows) expect(row.after).toEqual({ host: 'hooks.zapier.example' });
  });
});
