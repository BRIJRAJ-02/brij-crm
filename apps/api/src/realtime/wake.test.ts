// The relay's wake up call (spec 0005): the api's poke never slows a write,
// carries the secret and nothing else, and coalesces a burst; the worker takes
// a poke only with the secret.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerListener, createWorkerServer } from '../worker-http.ts';
import { createRelayWake, WAKE_HEADER, WAKE_PATH } from './wake.ts';

const SECRET = 'a-wake-secret-of-at-least-32-characters!';

interface Received {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly secret: string | string[] | undefined;
  readonly body: string;
}

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

/** A local server; `respond` decides each answer (and may hold it). */
async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const handle = {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(handle);
  return handle;
}

/** A worker stand in that records each poke and answers after `delayMs`. */
async function fakeWorker(delayMs = 0, status = 204) {
  const received: Received[] = [];
  const server = await listen((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        secret: request.headers[WAKE_HEADER],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      setTimeout(() => response.writeHead(status).end(), delayMs);
    });
  });
  return { ...server, received };
}

function memoryLog() {
  const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
  return {
    warnings,
    log: { warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, fields }) },
  };
}

describe("the api's poke", () => {
  it('POSTs to the wake path with the secret and no body', async () => {
    const worker = await fakeWorker();
    const { log, warnings } = memoryLog();
    createRelayWake({ url: `${worker.url}/`, secret: SECRET, log })();
    await expect.poll(() => worker.received).toHaveLength(1);
    expect(worker.received[0]).toEqual({ method: 'POST', path: WAKE_PATH, secret: SECRET, body: '' });
    expect(warnings).toEqual([]);
  });

  it('returns at once, and turns a burst into one call in flight and one queued', async () => {
    const worker = await fakeWorker(200);
    const { log } = memoryLog();
    const wake = createRelayWake({ url: worker.url, secret: SECRET, log });
    const started = performance.now();
    for (let poke = 0; poke < 20; poke += 1) wake();
    expect(performance.now() - started).toBeLessThan(50);
    await expect.poll(() => worker.received).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(worker.received).toHaveLength(2);
  });

  it('gives up fast on a worker that hangs, and warns at most once a minute with the count', async () => {
    const hanging = await listen(() => undefined);
    const { log, warnings } = memoryLog();
    const wake = createRelayWake({ url: hanging.url, secret: SECRET, log, timeoutMs: 100 });
    wake();
    await expect.poll(() => warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      message: 'Waking the relay failed; changes publish on the next poke that gets through',
      fields: { failures: 1 },
    });
    // Later failures inside the minute are counted, not logged.
    wake();
    await new Promise((resolve) => setTimeout(resolve, 300));
    wake();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(warnings).toHaveLength(1);
  });

  it('counts an answer other than 2xx as a failure, and never throws for an unreachable worker', async () => {
    const refusing = await fakeWorker(0, 401);
    const { log, warnings } = memoryLog();
    createRelayWake({ url: refusing.url, secret: 'wrong', log })();
    await expect.poll(() => warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0]?.fields)).toContain('401');
    expect(JSON.stringify(warnings[0]?.fields)).not.toContain('wrong');

    const nowhere = memoryLog();
    expect(() => createRelayWake({ url: 'http://127.0.0.1:1', secret: SECRET, log: nowhere.log })()).not.toThrow();
    await expect.poll(() => nowhere.warnings).toHaveLength(1);
  });
});

describe("the worker's wake endpoint", () => {
  async function worker(wakeSecret: string | undefined) {
    let wakes = 0;
    const server = await listen(createWorkerListener({ wakeSecret, onWake: () => (wakes += 1) }));
    const call = (path: string, init: RequestInit = {}) => fetch(`${server.url}${path}`, init);
    return { call, wakes: () => wakes };
  }

  it('wakes the relay for a POST with the secret, answering 204', async () => {
    const { call, wakes } = await worker(SECRET);
    const response = await call(WAKE_PATH, { method: 'POST', headers: { [WAKE_HEADER]: SECRET } });
    expect(response.status).toBe(204);
    expect(wakes()).toBe(1);
  });

  it('refuses a poke without the secret, or with the wrong one, and never wakes the relay for it', async () => {
    const { call, wakes } = await worker(SECRET);
    for (const headers of [{}, { [WAKE_HEADER]: 'wrong' }, { [WAKE_HEADER]: SECRET.slice(1) }]) {
      const response = await call(WAKE_PATH, { method: 'POST', headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect((await call(WAKE_PATH, { headers: { [WAKE_HEADER]: SECRET } })).status).toBe(405);
    expect((await call('/internal/other', { method: 'POST', headers: { [WAKE_HEADER]: SECRET } })).status).toBe(404);
    expect(wakes()).toBe(0);
  });

  it('answers a malformed request target 400 and keeps serving, rather than crashing', async () => {
    const wakeSecret = SECRET;
    let wakes = 0;
    const server = await listen(createWorkerListener({ wakeSecret, onWake: () => (wakes += 1) }));
    const { port } = new URL(server.url);
    const raw = (request: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () => socket.end(request));
        let reply = '';
        socket.on('data', (chunk: Buffer) => (reply += chunk.toString('utf8')));
        socket.on('end', () => resolve(reply));
        socket.on('error', reject);
      });
    for (const target of ['http://[/', 'http://worker/internal/outbox-wake', '*']) {
      const reply = await raw(
        `POST ${target} HTTP/1.1\r\nHost: worker\r\n${WAKE_HEADER}: ${SECRET}\r\nConnection: close\r\n\r\n`,
      );
      expect(reply.split('\r\n')[0], target).toMatch(/^HTTP\/1\.1 400 /);
    }
    expect(wakes).toBe(0);
    expect((await fetch(`${server.url}/health`)).status).toBe(200);
    const query = await fetch(`${server.url}${WAKE_PATH}?x=1`, { method: 'POST', headers: { [WAKE_HEADER]: SECRET } });
    expect(query.status).toBe(204);
  });

  it('refuses any body, unread, and closes the connection; and cuts a slow request off after 5 seconds', async () => {
    let wakes = 0;
    const server = createWorkerServer({ wakeSecret: SECRET, onWake: () => (wakes += 1) });
    expect(server.requestTimeout).toBe(5_000);
    expect(server.headersTimeout).toBe(5_000);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    servers.push({
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    });
    const raw = (request: string) =>
      new Promise<string>((resolve, reject) => {
        // Never ends its side: only the worker closing the connection settles this.
        const socket = connect(port, '127.0.0.1', () => socket.write(request));
        let reply = '';
        socket.on('data', (chunk: Buffer) => (reply += chunk.toString('utf8')));
        socket.on('close', () => resolve(reply));
        socket.on('error', reject);
      });
    const head = `POST ${WAKE_PATH} HTTP/1.1\r\nHost: worker\r\n${WAKE_HEADER}: ${SECRET}\r\n`;
    for (const request of [
      `${head}Content-Length: 5\r\n\r\nhello`,
      `${head}Content-Length: 1000000\r\n\r\nhel`,
      `${head}Transfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n`,
    ]) {
      const reply = await raw(request);
      expect(reply.split('\r\n')[0]).toMatch(/^HTTP\/1\.1 413 /);
      expect(reply.toLowerCase()).toContain('connection: close');
    }
    expect(wakes).toBe(0);
    // An empty body is no body.
    const ok = await fetch(`http://127.0.0.1:${String(port)}${WAKE_PATH}`, {
      method: 'POST',
      headers: { [WAKE_HEADER]: SECRET, 'content-length': '0' },
    });
    expect(ok.status).toBe(204);
  });

  it('answers the health check', async () => {
    const { call } = await worker(SECRET);
    const response = await call('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('adds the relay’s numbers to the health check, from memory (spec 0007, AC-77)', async () => {
    const server = await listen(
      createWorkerListener({
        wakeSecret: SECRET,
        onWake: () => undefined,
        health: () => ({ relay: { mode: 'dormant', published: 3, pending: 0 } }),
      }),
    );
    const response = await fetch(`${server.url}/health`);
    expect(await response.json()).toEqual({ status: 'ok', relay: { mode: 'dormant', published: 3, pending: 0 } });
  });

  it('takes any poke on a laptop with no secret set', async () => {
    const { call, wakes } = await worker(undefined);
    expect((await call(WAKE_PATH, { method: 'POST' })).status).toBe(204);
    expect(wakes()).toBe(1);
  });
});
