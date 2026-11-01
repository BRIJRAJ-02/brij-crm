// What is queued, what is cancelled, and what a rollback leaves behind (spec 0064, AC-6422, AC-6423), against a
// real Postgres. Three things are proved here:
//
// - **The enqueue sites.** The list is read out of the sources rather than assumed, so a new enqueue site added
//   anywhere in core fails this file until it is registered and covered. Each one must be awaited inside the write's
//   own transaction callback, which is what makes AC-6422 hold: the delivery row and its queue row are written by
//   `crm_enqueue_webhook_delivery` in that same transaction.
// - **Rollback.** A transaction that queues deliveries and then rolls back leaves no delivery row and, just as
//   importantly, no row on Graphile's queue, so nothing describes a change that never happened.
// - **Cancelling.** A delivery still owed a try is given up when the endpoint stops wanting it: switched off, turned
//   off by the 3 day failure rule, or an event unticked. A ping is never cancelled, and turning an endpoint back on
//   revives nothing, so the switch never flushes a backlog.
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database, type WorkspaceTx } from '@crm/db';
import type { WebhookEventType } from '@crm/contracts';
import { testQuery } from '@crm/db/testing';
import * as core from '../index.ts';
import { testScope } from '../testing.ts';
import { queueBookingWebhooks, queueFormWebhooks, queueWebhookEvent } from './queue.ts';
import { systemScope } from '../access/door.ts';
import { loadWebhookDelivery } from './deliver.ts';
import { decodeWebhookKey } from './signing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-webhook-queueing-tests' });
});
afterAll(async () => {
  await db.close();
});

const key = decodeWebhookKey(randomBytes(32).toString('base64'));
const deps = { key, checkHost: () => Promise.resolve(undefined) };

let made = 0;
/** A workspace with its owner's scope. */
async function workspace() {
  made += 1;
  const created = await core.createWorkspace(db, {
    name: 'Hooks',
    slug: `queueing-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const owner = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    role: 'owner',
  });
  return { workspaceId: created.workspaceId, owner };
}

/** A `form.submitted` event's data, as the form path reads it. */
const formData = () => ({
  submission_id: core.newId(),
  form: { id: core.newId(), name: 'Contact us' },
  answers: {},
  source: {},
});

/** Queues one event of `type` in `tx`, as the write it describes does. */
const queueIn = (tx: WorkspaceTx, type: 'form.submitted' | 'booking.created' = 'form.submitted') =>
  queueWebhookEvent(tx, type, () =>
    Promise.resolve(
      type === 'form.submitted'
        ? formData()
        : {
            booking_id: core.newId(),
            page: { id: core.newId(), title: 'Intro' },
            host: { name: 'Ada', email: 'ada@example.com' },
            start: '2026-11-02T10:00:00.000Z',
            end: '2026-11-02T10:30:00.000Z',
            time_zone: 'UTC',
            location_kind: 'none',
            status: 'confirmed',
            invitee: { name: 'Bea', email: 'bea@example.com' },
            answers: {},
          },
    ),
  );

const deliveriesIn = (workspaceId: string) =>
  testQuery<{ id: string; state: string; event_type: string; failure: string | null; next_attempt_at: Date | null }>(
    ownerUrl,
    `select id, state, event_type, failure, next_attempt_at from webhook_deliveries
     where workspace_id = $1 order by created_at, id`,
    [workspaceId],
  );

/** The rows this delivery has on Graphile's queue. */
const queueRowsFor = (deliveryId: string) =>
  testQuery<{ id: string }>(
    ownerUrl,
    `select j.id::text as id from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     where t.identifier = 'crm_webhook_deliver' and j.payload->>'deliveryId' = $1`,
    [deliveryId],
  );

/** An active endpoint subscribed to `events`. */
async function endpoint(
  owner: Awaited<ReturnType<typeof workspace>>['owner'],
  events: readonly WebhookEventType[] = ['form.submitted'],
  host = 'a.example.com',
) {
  const created = await core.createWebhook(owner, deps, {
    url: `https://${host}/hook`,
    description: '',
    events: [...events],
  });
  return created.endpoint.id;
}

describe('the enqueue sites, read out of the sources', () => {
  /**
   * Every call of an enqueue function in core, by file, as the sources hold them. Keep this equal to the code: a new
   * site goes in here with a rollback case in `a rolled back write leaves nothing queued` below. The count per file
   * is the point, so a second call added to a file that already has one is caught too.
   */
  const REGISTERED: Readonly<Record<string, number>> = {
    'booking/public.ts': 1,
    'booking/host.ts': 1,
    'booking/change.ts': 4,
    'calendar/apply.ts': 1,
    'forms/public.ts': 1,
    // Spec 0064 follow-up, 1 November: a submission that was never taken as received fires `form.submitted` when it
    // is, so a release from spam and a not_spam resolution each queue there.
    'forms/submissions.ts': 2,
  };

  /** Every `.ts` under `src/`, apart from tests and the webhook queue itself, which defines these functions. */
  async function sources(dir: string, at = ''): Promise<readonly { readonly path: string; readonly text: string }[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: { path: string; text: string }[] = [];
    for (const entry of entries) {
      const path = at === '' ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        found.push(...(await sources(join(dir, entry.name), path)));
      } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.') && path !== 'webhooks/queue.ts') {
        found.push({ path, text: await readFile(join(dir, entry.name), 'utf8') });
      }
    }
    return found;
  }

  const CALL = /\bqueue(?:BookingWebhooks?|FormWebhooks|WebhookEvent)\s*\(/g;

  it('has every enqueue site registered here, each awaited inside the write’s own transaction', async () => {
    const files = await sources(new URL('..', import.meta.url).pathname);
    const counted: Record<string, number> = {};
    for (const file of files) {
      // An import line names the function without calling it on the write path.
      const lines = file.text.split('\n').filter((line) => !line.trimStart().startsWith('import'));
      const calls = lines.join('\n').match(CALL) ?? [];
      if (calls.length > 0) counted[file.path] = calls.length;
      // Each call is awaited, and takes `tx` as its first argument: the write's own transaction, never a new one.
      for (const line of lines) {
        if (!CALL.test(line)) {
          CALL.lastIndex = 0;
          continue;
        }
        CALL.lastIndex = 0;
        expect(line, `${file.path}: an enqueue is awaited`).toMatch(/\bawait\s+queue/);
      }
    }
    expect(counted).toEqual(REGISTERED);
  });

  it('takes the write’s transaction, so the enqueue cannot open one of its own', async () => {
    // `queueWebhookEvent` and the three beside it all take a `WorkspaceTx` first. A site that opened its own
    // transaction (`db.withWorkspace(...)` inside the write) would commit a delivery for a change that rolled back,
    // so the signature is the guard: there is no overload that takes a database.
    const files = await sources(new URL('..', import.meta.url).pathname);
    for (const file of files) {
      // A call may be wrapped over several lines, so the import lines are dropped and the whitespace collapsed
      // before the first argument is read.
      const collapsed = file.text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('import'))
        .join(' ')
        .replaceAll(/\s+/g, ' ');
      for (const call of collapsed.matchAll(/\bqueue(?:BookingWebhooks?|FormWebhooks|WebhookEvent)\( ?([\w.]*)/g)) {
        expect([file.path, call[1]], `${file.path}: the enqueue takes tx`).toEqual([file.path, 'tx']);
      }
    }
  });
});

describe('a rolled back write leaves nothing queued (AC-6422)', () => {
  it('leaves no delivery row and no queue row when its transaction rolls back', async () => {
    const { workspaceId, owner } = await workspace();
    await endpoint(owner, ['form.submitted', 'booking.created']);
    // Committed first, so the test proves the rollback and not simply that nothing ever queues here.
    const committed = await db.withWorkspace(workspaceId, (tx) => queueIn(tx));
    expect(committed).toEqual({ deliveries: 1 });
    const [first] = await deliveriesIn(workspaceId);
    if (first === undefined) throw new Error('The committed event queued nothing.');
    expect(await queueRowsFor(first.id)).toHaveLength(1);

    // Now the same, in a transaction that throws. Every enqueue function is used, since each writes its own rows.
    const boom = new Error('The write failed after queueing.');
    await expect(
      db.withWorkspace(workspaceId, async (tx) => {
        await queueIn(tx, 'form.submitted');
        await queueIn(tx, 'booking.created');
        await queueBookingWebhooks(tx, 'booking.cancelled', [core.newId(), core.newId()]);
        await queueFormWebhooks(tx, {
          submissionId: core.newId(),
          formId: core.newId(),
          referrer: undefined,
        });
        throw boom;
      }),
    ).rejects.toThrow(boom);

    // Only the one committed delivery is there, and it still has exactly its own queue row.
    const after = await deliveriesIn(workspaceId);
    expect(after.map((row) => row.id)).toEqual([first.id]);
    expect(await queueRowsFor(first.id)).toHaveLength(1);
  });

  it('keeps the delivery and its queue row when the write commits', async () => {
    const { workspaceId, owner } = await workspace();
    await endpoint(owner);
    await db.withWorkspace(workspaceId, (tx) => queueIn(tx));
    const [row] = await deliveriesIn(workspaceId);
    if (row === undefined) throw new Error('Nothing was queued.');
    expect(row.state).toBe('pending');
    expect(await queueRowsFor(row.id)).toHaveLength(1);
  });
});

describe('cancelling queued deliveries (AC-6422, AC-6423)', () => {
  it('gives up what is waiting when the endpoint is switched off, and revives nothing when it is switched on', async () => {
    const { workspaceId, owner } = await workspace();
    const endpointId = await endpoint(owner);
    await db.withWorkspace(workspaceId, (tx) => queueIn(tx));
    const [waiting] = await deliveriesIn(workspaceId);
    if (waiting === undefined) throw new Error('Nothing was queued.');
    expect(waiting.state).toBe('pending');

    await core.updateWebhook(owner, deps, { endpointId, status: 'off' });
    const [cancelled] = await deliveriesIn(workspaceId);
    expect(cancelled).toMatchObject({ state: 'gave_up', failure: 'cancelled', next_attempt_at: null });

    // Turning it back on is one switch, and it sends no backlog.
    await core.updateWebhook(owner, deps, { endpointId, status: 'active' });
    const [still] = await deliveriesIn(workspaceId);
    expect(still).toMatchObject({ state: 'gave_up' });
    // Its queue row is still there and finds the delivery finished, so nothing reaches a receiver.
    const system = systemScope(db, workspaceId);
    expect(await loadWebhookDelivery(system, key, { deliveryId: waiting.id })).toEqual({
      kind: 'skip',
      reason: 'done',
    });
  });

  it('gives up only the events the endpoint no longer wants', async () => {
    const { workspaceId, owner } = await workspace();
    const endpointId = await endpoint(owner, ['form.submitted', 'booking.created']);
    await db.withWorkspace(workspaceId, async (tx) => {
      await queueIn(tx, 'form.submitted');
      await queueIn(tx, 'booking.created');
    });
    expect((await deliveriesIn(workspaceId)).map((row) => row.state)).toEqual(['pending', 'pending']);

    // Form submissions unticked: its waiting delivery is given up, the booking's is untouched.
    await core.updateWebhook(owner, deps, { endpointId, events: ['booking.created'] });
    const after = await deliveriesIn(workspaceId);
    expect(after.map((row) => ({ type: row.event_type, state: row.state }))).toEqual([
      { type: 'form.submitted', state: 'gave_up' },
      { type: 'booking.created', state: 'pending' },
    ]);
  });

  it('never cancels a ping: Send test event belongs to whoever pressed it', async () => {
    const { workspaceId, owner } = await workspace();
    const endpointId = await endpoint(owner);
    await core.prepareWebhookTest(owner, key, { endpointId });
    await core.updateWebhook(owner, deps, { endpointId, status: 'off' });
    const pings = (await deliveriesIn(workspaceId)).filter((row) => row.event_type === 'ping');
    expect(pings).toHaveLength(1);
    expect(pings[0]).toMatchObject({ state: 'pending' });
  });

  it('leaves another endpoint’s waiting deliveries alone', async () => {
    const { workspaceId, owner } = await workspace();
    const first = await endpoint(owner, ['form.submitted'], 'a.example.com');
    await endpoint(owner, ['form.submitted'], 'b.example.com');
    await db.withWorkspace(workspaceId, (tx) => queueIn(tx));
    expect(await deliveriesIn(workspaceId)).toHaveLength(2);
    await core.updateWebhook(owner, deps, { endpointId: first, status: 'off' });
    const states = (await deliveriesIn(workspaceId)).map((row) => row.state).sort();
    expect(states).toEqual(['gave_up', 'pending']);
  });
});

describe('queueing reads the workspace’s own endpoints only', () => {
  it('queues nothing while the workspace has no endpoint, so no key means no backlog', async () => {
    // This is what a server with no `WEBHOOK_SECRET_KEY` has: every write that would add an endpoint answers 503, so
    // the table stays empty, and the enqueue's one read finds nothing and stores nothing. See
    // `apps/api/src/modules/webhooks.test.ts` for the two states over HTTP.
    const { workspaceId } = await workspace();
    expect(await db.withWorkspace(workspaceId, (tx) => queueIn(tx))).toEqual({ deliveries: 0 });
    expect(await deliveriesIn(workspaceId)).toEqual([]);
  });

  it('queues nothing for an endpoint that is off, and nothing for an event it does not want', async () => {
    const { workspaceId, owner } = await workspace();
    const endpointId = await endpoint(owner, ['form.submitted']);
    await core.updateWebhook(owner, deps, { endpointId, status: 'off' });
    expect(await db.withWorkspace(workspaceId, (tx) => queueIn(tx))).toEqual({ deliveries: 0 });
    await core.updateWebhook(owner, deps, { endpointId, status: 'active' });
    expect(await db.withWorkspace(workspaceId, (tx) => queueIn(tx, 'booking.created'))).toEqual({ deliveries: 0 });
    expect(await db.withWorkspace(workspaceId, (tx) => queueIn(tx, 'form.submitted'))).toEqual({ deliveries: 1 });
  });

  it('never reads another workspace’s endpoints, even for the same event', async () => {
    const a = await workspace();
    const b = await workspace();
    await endpoint(a.owner);
    // B has no endpoint, so B's write queues nothing although A is subscribed to the same event.
    expect(await db.withWorkspace(b.workspaceId, (tx) => queueIn(tx))).toEqual({ deliveries: 0 });
    expect(await deliveriesIn(b.workspaceId)).toEqual([]);
    expect(await deliveriesIn(a.workspaceId)).toEqual([]);
  });
});
