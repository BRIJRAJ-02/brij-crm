// The outbox relay (spec 0005, AC-38, AC-39) against a real Postgres and a
// fake Centrifugo (a local HTTP server that answers like its server API):
// ordered publishing, marking, retrying a failed publish without skipping,
// one relay at a time by the advisory lock, and reconnecting after a drop.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { createOutboxReader, openDirectConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { createCentrifugoPublisher } from './centrifugo.ts';
import { createRelay, type Relay } from './relay.ts';

const { appUrl, ownerUrl, adminUrl } = inject('testDatabase');
const API_KEY = 'test-centrifugo-key';

interface Publication {
  readonly channel: string;
  readonly data: Record<string, unknown>;
  readonly idempotencyKey: string;
}

/** Answers like Centrifugo's `/api/publish`; `refuse` decides which publications fail (with a 503). */
async function fakeCentrifugo(refuse: (publication: Publication) => boolean = () => false) {
  const published: Publication[] = [];
  const refused: Publication[] = [];
  const body = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      channel: string;
      data: Record<string, unknown>;
      idempotency_key: string;
    };
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== '/api/publish' || request.headers['x-api-key'] !== API_KEY) {
        response.writeHead(401).end();
        return;
      }
      const sent = await body(request);
      const publication = { channel: sent.channel, data: sent.data, idempotencyKey: sent.idempotency_key };
      if (refuse(publication)) {
        refused.push(publication);
        response.writeHead(503).end();
        return;
      }
      published.push(publication);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: {} }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    published,
    refused,
    /** The `seq`s published to one workspace's channel, in order. */
    seqs: (workspaceId: string) =>
      published.filter((item) => item.channel === `workspace:${workspaceId}`).map((item) => item.data.seq),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const started: Relay[] = [];
const servers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const relay of started.splice(0)) await relay.stop();
  for (const server of servers.splice(0)) await server.close();
});

function relayTo(centrifugoUrl: string, applicationName = 'crm-relay-tests', pollMs = 100) {
  const lines: string[] = [];
  const relay = createRelay({
    connect: async () => createOutboxReader(await openDirectConnection({ url: appUrl, applicationName })),
    publish: createCentrifugoPublisher({ apiUrl: centrifugoUrl, apiKey: API_KEY, timeoutMs: 2_000 }).publish,
    log: { info: (message) => lines.push(message), warn: (message) => lines.push(message) },
    pollMs,
    backoffMs: 50,
  });
  started.push(relay);
  relay.start();
  return { relay, lines };
}

async function workspace(): Promise<string> {
  const id = randomUUID();
  await testQuery(
    ownerUrl,
    `insert into workspaces (id, name, slug, created_by_type, updated_by_type) values ($1, 'Relay', $2, 'system', 'system')`,
    [id, `relay-${id}`],
  );
  return id;
}

/** Outbox rows, inserted as the owner (who bypasses row level security), as writes would have stored them. */
async function events(workspaceId: string, seqs: readonly number[], mutationId?: string): Promise<void> {
  for (const seq of seqs) {
    await testQuery(
      ownerUrl,
      `insert into outbox (workspace_id, seq, kind, object_id, record_ids, attribute_ids, mutation_id)
       values ($1, $2, 'records', $3, array[$4]::uuid[], '{}', $5)`,
      [workspaceId, seq, randomUUID(), randomUUID(), mutationId ?? null],
    );
  }
}

async function unpublished(workspaceId: string): Promise<number[]> {
  const rows = await testQuery<{ seq: number }>(
    ownerUrl,
    'select seq::int as seq from outbox where workspace_id = $1 and published_at is null order by seq',
    [workspaceId],
  );
  return rows.map((row) => row.seq);
}

const WAIT = { timeout: 10_000, interval: 25 };

describe('the relay', () => {
  it('publishes each workspace’s rows in order to its channel, with the event and idempotency key, then marks them', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const workspaceId = await workspace();
    const mutationId = randomUUID();
    await events(workspaceId, [3, 1, 2], mutationId);
    await testQuery(
      ownerUrl,
      `update outbox set coarse = true, record_ids = '{}' where workspace_id = $1 and seq = 3`,
      [workspaceId],
    );
    relayTo(centrifugo.url);
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1, 2, 3]);
    await expect.poll(() => unpublished(workspaceId), WAIT).toEqual([]);

    const mine = centrifugo.published.filter((item) => item.channel === `workspace:${workspaceId}`);
    expect(mine.map((item) => item.idempotencyKey)).toEqual([1, 2, 3].map((seq) => `${workspaceId}:${String(seq)}`));
    expect(mine[0]?.data).toEqual({
      seq: 1,
      kind: 'records',
      objectId: expect.any(String) as string,
      recordIds: [expect.any(String) as string],
      attributeIds: [],
      mutationId,
    });
    expect(mine[2]?.data).toMatchObject({ seq: 3, recordIds: [], coarse: true });
    expect(mine[0]?.data).not.toHaveProperty('coarse');
  });

  it('publishes a notified workspace at once, without waiting for the poll', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    // A poll every minute: only the NOTIFY can bring this one out in time.
    relayTo(centrifugo.url, 'crm-relay-tests', 60_000);
    const workspaceId = await workspace();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await events(workspaceId, [1]);
    await testQuery(ownerUrl, `select pg_notify('crm_outbox', $1)`, [workspaceId]);
    await expect.poll(() => centrifugo.seqs(workspaceId), { timeout: 3_000, interval: 25 }).toEqual([1]);
  });

  it('stops a workspace at a failed publish and retries it on a later tick, never skipping; other workspaces carry on', async () => {
    let failures = 0;
    const stuck = await workspace();
    const other = await workspace();
    const centrifugo = await fakeCentrifugo((publication) => {
      if (publication.idempotencyKey !== `${stuck}:2` || failures >= 3) return false;
      failures += 1;
      return true;
    });
    servers.push(centrifugo);
    await events(stuck, [1, 2, 3]);
    await events(other, [1]);
    const { lines } = relayTo(centrifugo.url);
    await expect.poll(() => centrifugo.seqs(stuck), WAIT).toEqual([1, 2, 3]);
    expect(centrifugo.refused.map((item) => item.idempotencyKey)).toEqual(Array(3).fill(`${stuck}:2`));
    expect(centrifugo.seqs(other)).toEqual([1]);
    expect(lines).toContain('Publishing a change failed; retrying on the next tick');
    await expect.poll(() => unpublished(stuck), WAIT).toEqual([]);
  });

  it('lets one relay publish while a second waits on the lock, and hands over when the first stops', async () => {
    const first = await fakeCentrifugo();
    const second = await fakeCentrifugo();
    servers.push(first, second);
    const workspaceId = await workspace();
    const a = relayTo(first.url);
    await events(workspaceId, [1]);
    await expect.poll(() => first.seqs(workspaceId), WAIT).toEqual([1]);
    relayTo(second.url);
    await events(workspaceId, [2]);
    await expect.poll(() => first.seqs(workspaceId), WAIT).toEqual([1, 2]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(second.published).toEqual([]);

    await a.relay.stop();
    await events(workspaceId, [3]);
    await expect.poll(() => second.seqs(workspaceId), WAIT).toEqual([3]);
    expect(first.seqs(workspaceId)).toEqual([1, 2]);
  });

  it('reconnects after its connection drops, and carries on from where it was', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const name = `crm-relay-drop-${randomUUID().slice(0, 8)}`;
    const workspaceId = await workspace();
    const { lines } = relayTo(centrifugo.url, name);
    await events(workspaceId, [1]);
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1]);

    const dropped = await testQuery<{ dropped: boolean }>(
      adminUrl,
      'select pg_terminate_backend(pid) as dropped from pg_stat_activity where application_name = $1',
      [name],
    );
    expect(dropped).toEqual([{ dropped: true }]);
    await events(workspaceId, [2]);
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1, 2]);
    // Dropped while idle (lost), or under a query (failed): either way it reconnects.
    expect(lines.filter((line) => /^Relay (lost its connection|failed); reconnecting$/.test(line))).toHaveLength(1);
    await expect.poll(() => unpublished(workspaceId), WAIT).toEqual([]);
  });
});
