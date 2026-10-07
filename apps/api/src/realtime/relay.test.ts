// The outbox relay (spec 0005, AC-38, AC-39) against a real Postgres and a
// fake Centrifugo (a local HTTP server that answers like its server API):
// ordered publishing, marking, retrying a failed publish without skipping,
// one relay at a time by the advisory lock, and letting Neon sleep: the poll
// backs off, a quiet spell or a lost connection sends it dormant with no
// connection at all, and a poke wakes it.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { createOutboxReader, openDirectConnection, type OutboxReader } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { createCentrifugoPublisher } from './centrifugo.ts';
import { createRelay, type Relay, type RelayDeps } from './relay.ts';

const { appUrl, ownerUrl, adminUrl } = inject('testDatabase');
const API_KEY = 'test-centrifugo-key';

interface Publication {
  readonly channel: string;
  readonly data: Record<string, unknown>;
  readonly idempotencyKey: string;
}

interface BatchBody {
  readonly commands: readonly {
    readonly publish: { channel: string; data: Record<string, unknown>; idempotency_key: string };
  }[];
  readonly parallel: boolean;
}

interface FakeOptions {
  /** Which publications Centrifugo refuses (with an error reply for that command). */
  readonly refuse?: (publication: Publication) => boolean;
  /** How long each call takes to answer. */
  readonly delayMs?: number;
}

/**
 * Answers like Centrifugo's `/api/batch` in sequential mode: every command
 * runs, each gets its own reply (an `error` for a refused one), and a repeated
 * idempotency key is answered but not published again.
 */
async function fakeCentrifugo(options: FakeOptions = {}) {
  const refuse = options.refuse ?? (() => false);
  const published: Publication[] = [];
  const refused: Publication[] = [];
  const seen = new Set<string>();
  /** Each call: its channel, and when it started and ended. */
  const calls: { channel: string | undefined; size: number; parallel: boolean; start: number; end: number }[] = [];
  const body = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BatchBody;
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== '/api/batch' || request.headers['x-api-key'] !== API_KEY) {
        response.writeHead(401).end();
        return;
      }
      const start = Date.now();
      const sent = await body(request);
      if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const replies = sent.commands.map(({ publish }) => {
        const publication = { channel: publish.channel, data: publish.data, idempotencyKey: publish.idempotency_key };
        if (refuse(publication)) {
          refused.push(publication);
          return { error: { code: 100, message: 'internal server error' } };
        }
        if (!seen.has(publication.idempotencyKey)) published.push(publication);
        seen.add(publication.idempotencyKey);
        return { publish: { offset: published.length, epoch: 'test' } };
      });
      calls.push({
        channel: sent.commands[0]?.publish.channel,
        size: sent.commands.length,
        parallel: sent.parallel,
        start,
        end: Date.now(),
      });
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ replies }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    published,
    refused,
    calls,
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

interface RelayOptions extends Partial<
  Pick<RelayDeps, 'pollScheduleMs' | 'dormantAfterMs' | 'pruneEveryMs' | 'batch' | 'concurrency'>
> {
  readonly applicationName?: string;
  /** Sees each reader the relay opens, to count or time its calls. */
  readonly wrap?: (reader: OutboxReader) => OutboxReader;
}

function relayTo(centrifugoUrl: string, options: RelayOptions = {}) {
  const applicationName = options.applicationName ?? 'crm-relay-tests';
  const lines: string[] = [];
  const relay = createRelay({
    connect: async () => {
      const reader = createOutboxReader(await openDirectConnection({ url: appUrl, applicationName }));
      return options.wrap?.(reader) ?? reader;
    },
    publishBatch: createCentrifugoPublisher({ apiUrl: centrifugoUrl, apiKey: API_KEY, timeoutMs: 2_000 }).publishBatch,
    log: { info: (message) => lines.push(message), warn: (message) => lines.push(message) },
    pollScheduleMs: options.pollScheduleMs ?? [100],
    dormantAfterMs: options.dormantAfterMs ?? 60_000,
    ...(options.pruneEveryMs === undefined ? {} : { pruneEveryMs: options.pruneEveryMs }),
    ...(options.batch === undefined ? {} : { batch: options.batch }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    backoffMs: 50,
  });
  started.push(relay);
  relay.start();
  return { relay, lines };
}

/** How many connections a relay named `applicationName` holds open. */
async function connections(applicationName: string): Promise<number> {
  const rows = await testQuery<{ open: number }>(
    adminUrl,
    'select count(*)::int as open from pg_stat_activity where application_name = $1',
    [applicationName],
  );
  return rows[0]?.open ?? 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    relayTo(centrifugo.url, { pollScheduleMs: [60_000] });
    const workspaceId = await workspace();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await events(workspaceId, [1]);
    await testQuery(ownerUrl, `select pg_notify('crm_outbox', $1)`, [workspaceId]);
    await expect.poll(() => centrifugo.seqs(workspaceId), { timeout: 3_000, interval: 25 }).toEqual([1]);
  });

  it('marks a batch only up to its first failed publish and retries from there, never skipping; other workspaces carry on', async () => {
    let failures = 0;
    const stuck = await workspace();
    const other = await workspace();
    const centrifugo = await fakeCentrifugo({
      refuse: (publication) => {
        if (publication.idempotencyKey !== `${stuck}:2` || failures >= 3) return false;
        failures += 1;
        return true;
      },
    });
    servers.push(centrifugo);
    await events(stuck, [1, 2, 3]);
    await events(other, [1]);
    const marked: number[] = [];
    const { lines } = relayTo(centrifugo.url, {
      wrap: (reader) => ({
        ...reader,
        mark: (workspaceId, upto) => {
          if (workspaceId === stuck) marked.push(upto);
          return reader.mark(workspaceId, upto);
        },
        advance: (workspaceId, upto, max) => {
          if (workspaceId === stuck) marked.push(upto);
          return reader.advance(workspaceId, upto, max);
        },
      }),
    });
    await expect.poll(() => unpublished(stuck), WAIT).toEqual([]);
    expect(centrifugo.refused.map((item) => item.idempotencyKey)).toEqual(Array(3).fill(`${stuck}:2`));
    // Only 1 was marked while 2 failed (3, sent after it in the same call, landed but stayed unmarked).
    expect(marked).toEqual([1, 3]);
    // Centrifugo runs every command, so 3 went out before 2; its repeat on the retry was dropped by its key.
    expect(centrifugo.seqs(stuck)).toEqual([1, 3, 2]);
    expect(centrifugo.seqs(other)).toEqual([1]);
    expect(lines).toContain('Publishing a change failed; retrying on the next tick');
  });

  it('publishes a workspace’s batch in one sequential call, and gives every workspace a turn each round', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const busy = await workspace();
    const quiet = await workspace();
    await events(
      busy,
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    await events(quiet, [1]);
    relayTo(centrifugo.url, { batch: 10 });
    await expect.poll(() => unpublished(busy), WAIT).toEqual([]);
    await expect.poll(() => unpublished(quiet), WAIT).toEqual([]);
    expect(centrifugo.seqs(busy)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    const busyCalls = centrifugo.calls.filter((call) => call.channel === `workspace:${busy}`);
    expect(busyCalls.map((call) => call.size)).toEqual([10, 10, 5]);
    expect(centrifugo.calls.every((call) => !call.parallel)).toBe(true);
    // The quiet workspace's one call came before the busy one's second batch.
    const quietCall = centrifugo.calls.findIndex((call) => call.channel === `workspace:${quiet}`);
    const secondBusy = busyCalls[1];
    expect(secondBusy).toBeDefined();
    expect(quietCall).toBeLessThan(secondBusy === undefined ? -1 : centrifugo.calls.indexOf(secondBusy));
  });

  it('runs up to 4 workspaces at once, and never two calls for one workspace', async () => {
    const centrifugo = await fakeCentrifugo({ delayMs: 150 });
    servers.push(centrifugo);
    const ids = await Promise.all(Array.from({ length: 6 }, () => workspace()));
    for (const id of ids) await events(id, [1, 2, 3]);
    relayTo(centrifugo.url, { batch: 2 });
    for (const id of ids) await expect.poll(() => unpublished(id), WAIT).toEqual([]);
    const mine = centrifugo.calls.filter((call) => ids.some((id) => call.channel === `workspace:${id}`));
    const overlapping = (at: number) => mine.filter((call) => call.start <= at && at < call.end);
    const most = Math.max(...mine.map((call) => overlapping(call.start).length));
    expect(most).toBeLessThanOrEqual(4);
    expect(most).toBeGreaterThan(1);
    for (const call of mine) {
      expect(overlapping(call.start).filter((other) => other.channel === call.channel)).toHaveLength(1);
    }
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

  it('backs its safety poll off over a quiet spell, and starts again at the first wait on a notification', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const polls: number[] = [];
    const counting = (reader: OutboxReader): OutboxReader => ({
      ...reader,
      workspaces: (max) => {
        polls.push(Date.now());
        return reader.workspaces(max);
      },
    });
    const lastGaps = (count: number) => {
      const tail = polls.slice(-count - 1);
      return tail.slice(1).map((at, index) => at - (tail[index] ?? at));
    };
    relayTo(centrifugo.url, { pollScheduleMs: [50, 100, 200, 400], wrap: counting });
    // A poll that finds another test's leftovers starts the schedule again, so wait for it to settle at the last.
    await expect
      .poll(() => polls.length >= 3 && lastGaps(2).every((gap) => gap >= 350), { timeout: 15_000, interval: 25 })
      .toBe(true);

    const workspaceId = await workspace();
    await events(workspaceId, [1]);
    await testQuery(ownerUrl, `select pg_notify('crm_outbox', $1)`, [workspaceId]);
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1]);
    // Back to the first waits: the next two polls come well inside the 400 ms the schedule had reached.
    const heard = Date.now();
    await expect.poll(() => polls.filter((at) => at >= heard).length, WAIT).toBeGreaterThanOrEqual(2);
    const [first = 0, second = 0] = polls.filter((at) => at >= heard);
    expect(second - first).toBeLessThan(300);
  });

  it('drains once at boot, then goes dormant after the quiet spell with no connection, and a poke wakes it', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const name = `crm-relay-dormant-${randomUUID().slice(0, 8)}`;
    const waiting = await workspace();
    await events(waiting, [1, 2]);
    const { relay, lines } = relayTo(centrifugo.url, {
      applicationName: name,
      pollScheduleMs: [50, 100],
      dormantAfterMs: 500,
    });
    await expect.poll(() => centrifugo.seqs(waiting), WAIT).toEqual([1, 2]);
    await expect.poll(() => relay.mode(), WAIT).toBe('dormant');
    expect(lines).toContain('Relay dormant: no database calls until a write wakes it');
    await expect.poll(() => connections(name), WAIT).toBe(0);

    // A write while dormant waits in the outbox: no poll, no notification heard.
    const later = await workspace();
    await events(later, [1]);
    await testQuery(ownerUrl, `select pg_notify('crm_outbox', $1)`, [later]);
    await sleep(400);
    expect(centrifugo.seqs(later)).toEqual([]);
    expect(await connections(name)).toBe(0);

    relay.wake();
    expect(relay.mode()).not.toBe('stopped');
    await expect.poll(() => centrifugo.seqs(later), WAIT).toEqual([1]);
    expect(lines).toContain('Relay woken');
    await expect.poll(() => unpublished(later), WAIT).toEqual([]);
    // And dormant again once the next quiet spell passes.
    await expect.poll(() => relay.mode(), WAIT).toBe('dormant');
    await expect.poll(() => connections(name), WAIT).toBe(0);
  });

  it('goes dormant when its connection is lost while waiting, rather than reconnecting, and a poke wakes it', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const name = `crm-relay-drop-${randomUUID().slice(0, 8)}`;
    const workspaceId = await workspace();
    const { relay, lines } = relayTo(centrifugo.url, { applicationName: name, pollScheduleMs: [60_000] });
    await events(workspaceId, [1]);
    await testQuery(ownerUrl, `select pg_notify('crm_outbox', $1)`, [workspaceId]);
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1]);

    // What Neon does when it suspends the compute: the connection simply goes.
    const dropped = await testQuery<{ dropped: boolean }>(
      adminUrl,
      'select pg_terminate_backend(pid) as dropped from pg_stat_activity where application_name = $1',
      [name],
    );
    expect(dropped).toEqual([{ dropped: true }]);
    await expect.poll(() => relay.mode(), WAIT).toBe('dormant');
    expect(lines).toContain('Relay lost its connection; dormant until a write wakes it');
    await events(workspaceId, [2]);
    await sleep(300);
    expect(await connections(name)).toBe(0);
    expect(centrifugo.seqs(workspaceId)).toEqual([1]);

    relay.wake();
    await expect.poll(() => centrifugo.seqs(workspaceId), WAIT).toEqual([1, 2]);
    await expect.poll(() => unpublished(workspaceId), WAIT).toEqual([]);
  });

  it('prunes rows published more than a day ago while active, and never while dormant', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const workspaceId = await workspace();
    await events(workspaceId, [1, 2]);
    await testQuery(
      ownerUrl,
      `update outbox set published_at = now() - interval '25 hours' where workspace_id = $1 and seq = 1`,
      [workspaceId],
    );
    const prunes: number[] = [];
    const counting = (reader: OutboxReader): OutboxReader => ({
      ...reader,
      prune: (max) => {
        prunes.push(Date.now());
        return reader.prune(max);
      },
    });
    const { relay } = relayTo(centrifugo.url, {
      pollScheduleMs: [50],
      dormantAfterMs: 500,
      pruneEveryMs: 100,
      wrap: counting,
    });
    const left = async () =>
      (
        await testQuery<{ seq: number }>(ownerUrl, 'select seq::int as seq from outbox where workspace_id = $1', [
          workspaceId,
        ])
      ).map((row) => row.seq);
    await expect.poll(left, WAIT).toEqual([2]);
    expect(centrifugo.seqs(workspaceId)).toEqual([2]);
    await expect.poll(() => relay.mode(), WAIT).toBe('dormant');
    const whileActive = prunes.length;
    expect(whileActive).toBeGreaterThanOrEqual(2);
    await sleep(400);
    expect(prunes).toHaveLength(whileActive);
  });

  it('stops from dormant at once', async () => {
    const centrifugo = await fakeCentrifugo();
    servers.push(centrifugo);
    const { relay } = relayTo(centrifugo.url, { pollScheduleMs: [50], dormantAfterMs: 200 });
    await expect.poll(() => relay.mode(), WAIT).toBe('dormant');
    await relay.stop();
    expect(relay.mode()).toBe('stopped');
    // A poke after stop does nothing.
    relay.wake();
    expect(relay.mode()).toBe('stopped');
  });
});
