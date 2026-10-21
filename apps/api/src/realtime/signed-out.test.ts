// The signed out notice (spec 0033, AC-891): the api tells the worker, with
// the wake secret and no body, whose live connections to cut; the worker takes
// it only with the secret and only for a user id, and answers once Centrifugo
// was asked. A failure is logged, never thrown into the revoke.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerListener } from '../worker-http.ts';
import { createSignedOutNotice, SIGNED_OUT, SIGNED_OUT_PATH, signedOutUser } from './signed-out.ts';
import { WAKE_HEADER } from './wake.ts';

const SECRET = 'a-wake-secret-of-at-least-32-characters!';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

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

function memoryLog() {
  const warnings: string[] = [];
  return { warnings, log: { warn: (message: string) => warnings.push(message) } };
}

describe('the signed out notice', () => {
  it('closes with the terminal signed out code', () => {
    expect(SIGNED_OUT).toEqual({ code: 4501, reason: 'signed out' });
  });

  it('reads a user id from its path, and nothing else', () => {
    const id = randomUUID();
    expect(signedOutUser(`${SIGNED_OUT_PATH}${id}`)).toBe(id);
    for (const path of [SIGNED_OUT_PATH, `${SIGNED_OUT_PATH}not-a-user`, `${SIGNED_OUT_PATH}${id}/more`, '/health']) {
      expect(signedOutUser(path)).toBeUndefined();
    }
  });

  it('carries the secret and no body to the worker, which cuts that user once, then answers', async () => {
    const cut: string[] = [];
    const worker = await listen(
      createWorkerListener({
        wakeSecret: SECRET,
        onWake: () => undefined,
        onSignedOut: async (userId) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          cut.push(userId);
        },
      }),
    );
    const { log, warnings } = memoryLog();
    const notice = createSignedOutNotice({ url: worker.url, secret: SECRET, log });
    const userId = randomUUID();
    await notice(userId);
    // Resolved only once the worker had asked Centrifugo.
    expect(cut).toEqual([userId]);
    expect(warnings).toEqual([]);
  });

  it('is refused by the worker without the secret, and logged, never thrown, by the api', async () => {
    const cut: string[] = [];
    const worker = await listen(
      createWorkerListener({
        wakeSecret: SECRET,
        onWake: () => undefined,
        onSignedOut: (userId) => {
          cut.push(userId);
          return Promise.resolve();
        },
      }),
    );
    const userId = randomUUID();
    const refused = await fetch(`${worker.url}${SIGNED_OUT_PATH}${userId}`, {
      method: 'POST',
      headers: { [WAKE_HEADER]: 'wrong' },
    });
    expect(refused.status).toBe(401);
    const { log, warnings } = memoryLog();
    await createSignedOutNotice({ url: worker.url, secret: 'not-the-secret', log })(userId);
    expect(warnings).toHaveLength(1);
    await createSignedOutNotice({ url: 'http://127.0.0.1:1', secret: SECRET, log, timeoutMs: 300 })(userId);
    expect(warnings).toHaveLength(2);
    expect(cut).toEqual([]);
  });

  it('takes the notice without cutting anything where the relay is off, and 404s a path with no user', async () => {
    const worker = await listen(createWorkerListener({ wakeSecret: SECRET, onWake: () => undefined }));
    const headers = { [WAKE_HEADER]: SECRET };
    expect((await fetch(`${worker.url}${SIGNED_OUT_PATH}${randomUUID()}`, { method: 'POST', headers })).status).toBe(
      204,
    );
    expect((await fetch(`${worker.url}${SIGNED_OUT_PATH}nobody`, { method: 'POST', headers })).status).toBe(404);
    expect((await fetch(`${worker.url}${SIGNED_OUT_PATH}${randomUUID()}`, { headers })).status).toBe(405);
  });
});
