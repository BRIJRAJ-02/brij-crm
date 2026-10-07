// The cancel connection on its own (spec 0005, cancelling a read): it gives
// up on a connection that never answers instead of queueing every later
// cancel behind it, and cancels only a backend still carrying the tag.
import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from './client.ts';

const { appUrl } = inject('testDatabase');

describe('cancelTagged', () => {
  let silent: Server;
  const sockets: Socket[] = [];
  let port = 0;

  beforeAll(async () => {
    // Accepts a connection and never says a word, like a host that hangs mid handshake.
    silent = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const address = silent.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  it('gives up on a connection that never answers within about 2 seconds, and so does the next cancel', async () => {
    const db = createDatabase({
      url: `postgres://nobody:nothing@127.0.0.1:${String(port)}/none`,
      applicationName: 'crm-cancel-tests',
      onPoolError: () => undefined,
    });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const started = performance.now();
        await expect(db.cancelTagged(1, 'crm-query:nothing')).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(4_000);
      }
    } finally {
      await db.close();
    }
  });

  it('cancels nothing for a backend that does not carry the tag', async () => {
    const db = createDatabase({ url: appUrl, applicationName: 'crm-cancel-tests' });
    try {
      expect(await db.cancelTagged(2_147_483_647, 'crm-query:nobody')).toBe(false);
      // Its transaction ended cleanly: the one connection serves the next cancel.
      expect(await db.cancelTagged(2_147_483_647, 'crm-count:nobody')).toBe(false);
    } finally {
      await db.close();
    }
  });
});
