// Centrifugo itself, as docker-compose.yml runs it (and CI, as a service):
// the `workspace` namespace lets no client in without a subscription token
// signed for that channel, and no client publishes at all; the relay's
// publisher speaks the real `/api/batch`. Raw WebSocket and the JSON protocol,
// so nothing between the test and Centrifugo could be the one refusing.
import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCentrifugoPublisher } from './centrifugo.ts';

// The local stack's values (docker-compose.yml, .env.example), which CI's service uses too.
const WS_URL = 'ws://localhost:8000/connection/websocket';
const API_URL = 'http://localhost:9000';
const API_KEY = 'local-centrifugo-api-key';
const TOKEN_SECRET = 'local-centrifugo-token-secret';

/** An HS256 JWT, as the api will sign connection and subscription tokens. */
function token(claims: Record<string, unknown>, secret = TOKEN_SECRET): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ exp: Math.floor(Date.now() / 1000) + 600, ...claims })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

type Reply = Record<string, unknown> & { readonly id?: number; readonly error?: { code: number; message: string } };

interface Client {
  /** Sends one command and waits for its reply. */
  call(command: Record<string, unknown>): Promise<Reply>;
  /** Pushes received (publications and the like). */
  readonly pushes: Reply[];
  /** Settles when Centrifugo (or the test) closes the connection. */
  readonly closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

const open: Client[] = [];
afterEach(() => {
  for (const client of open.splice(0)) client.close();
});

async function connect(): Promise<Client> {
  const socket = new WebSocket(WS_URL);
  const waiting = new Map<number, (reply: Reply) => void>();
  const pushes: Reply[] = [];
  let next = 0;
  socket.addEventListener('message', (event) => {
    for (const line of String(event.data).split('\n').filter(Boolean)) {
      const reply = JSON.parse(line) as Reply;
      const resolve = reply.id === undefined ? undefined : waiting.get(reply.id);
      if (resolve === undefined) pushes.push(reply);
      else resolve(reply);
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })),
  );
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () =>
      reject(new Error(`Centrifugo isn't answering at ${WS_URL}: docker compose up -d centrifugo`)),
    );
  });
  const client: Client = {
    call(command) {
      next += 1;
      const id = next;
      const reply = new Promise<Reply>((resolve) => waiting.set(id, resolve));
      socket.send(JSON.stringify({ id, ...command }));
      return Promise.race([reply, closed.then((close) => ({ closed: close }))]);
    },
    pushes,
    closed,
    close: () => socket.close(),
  };
  open.push(client);
  return client;
}

/** A client connected as `userId` with a valid connection token. */
async function connected(userId = randomUUID()): Promise<Client> {
  const client = await connect();
  const reply = await client.call({ connect: { token: token({ sub: userId }) } });
  expect(reply).toHaveProperty('connect');
  return client;
}

describe("Centrifugo's workspace namespace (compose and CI)", () => {
  it('refuses a connection without a token', async () => {
    const client = await connect();
    await client.call({ connect: {} });
    expect(await client.closed).toMatchObject({ code: 3501 });
  });

  it('refuses a connected client without a subscription token both the channel and a publish', async () => {
    const client = await connected();
    const channel = `workspace:${randomUUID()}`;
    expect(await client.call({ subscribe: { channel } })).toMatchObject({ error: { code: 103 } });
    expect(await client.call({ publish: { channel, data: { seq: 1 } } })).toMatchObject({ error: { code: 103 } });
  });

  it("refuses a subscription token signed with another secret, or for another workspace's channel", async () => {
    const userId = randomUUID();
    const channel = `workspace:${randomUUID()}`;
    const forged = await connected(userId);
    expect(
      await forged.call({ subscribe: { channel, token: token({ sub: userId, channel }, 'not-the-secret') } }),
    ).toMatchObject({ error: { code: 103 } });

    const elsewhere = await connected(userId);
    const reply = await elsewhere.call({
      subscribe: { channel, token: token({ sub: userId, channel: `workspace:${randomUUID()}` }) },
    });
    expect(reply).not.toHaveProperty('subscribe');
    expect(await elsewhere.closed).toMatchObject({ code: 3500, reason: 'invalid token' });
  });

  it('lets a client with a valid subscription token listen, never publish, and hear what the relay publishes', async () => {
    const userId = randomUUID();
    const channel = `workspace:${randomUUID()}`;
    const client = await connected(userId);
    expect(await client.call({ subscribe: { channel, token: token({ sub: userId, channel }) } })).toMatchObject({
      subscribe: { recoverable: true },
    });
    expect(await client.call({ publish: { channel, data: { seq: 1 } } })).toMatchObject({ error: { code: 103 } });

    // The relay's publisher against the real /api/batch: a refused command (an unknown namespace) in the middle
    // counts only what came before it.
    const { publishBatch } = createCentrifugoPublisher({ apiUrl: API_URL, apiKey: API_KEY });
    const key = randomUUID();
    const outcome = await publishBatch([
      { channel, data: { seq: 1 }, idempotencyKey: `${key}:1` },
      { channel: `nowhere:${randomUUID()}`, data: { seq: 2 }, idempotencyKey: `${key}:2` },
      { channel, data: { seq: 3 }, idempotencyKey: `${key}:3` },
    ]);
    expect(outcome.published).toBe(1);
    expect(outcome.error).toMatchObject({ code: 'PUBLISH_FAILED' });
    expect(await publishBatch([{ channel, data: { seq: 4 }, idempotencyKey: `${key}:4` }])).toEqual({ published: 1 });
    // A repeated key is dropped.
    await publishBatch([{ channel, data: { seq: 1 }, idempotencyKey: `${key}:1` }]);

    const seqs = () =>
      client.pushes
        .map((push) => (push.push as { pub?: { data?: { seq?: number } } } | undefined)?.pub?.data?.seq)
        .filter((seq) => seq !== undefined);
    await expect.poll(seqs).toEqual([1, 3, 4]);
  });

  it('refuses the server API without its key', async () => {
    const { publishBatch } = createCentrifugoPublisher({ apiUrl: API_URL, apiKey: 'wrong' });
    const outcome = await publishBatch([
      { channel: `workspace:${randomUUID()}`, data: {}, idempotencyKey: randomUUID() },
    ]);
    expect(outcome).toMatchObject({ published: 0, error: { message: 'Centrifugo answered 401.' } });
  });
});
