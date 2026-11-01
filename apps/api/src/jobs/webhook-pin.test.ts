// The pinned connection actually reaches the socket (spec 0064, AC-6424). `webhook-deliver.test.ts` proves
// `pinnedLookup` as a function and proves a rebinding host refused at send time; this file proves the one thing
// neither of those can: that the sender hands that lookup, and nothing else, to the connection it opens.
//
// It exists because the rebinding defence would disappear silently if someone added an `agent`, renamed the option,
// or a Node change stopped honouring `lookup`: every other test would still pass while a host that flips to
// 169.254.169.254 between the check and the connect became reachable (security review, 1 November). So
// `node:https` is replaced here and the options the sender passes are read directly. Nothing reaches the network.
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { EventEmitter } from 'node:events';
import type { WebhookSend } from '@crm/core';
import { describe, expect, it, vi } from 'vitest';

/** The options the sender passed to `https.request`, captured by the mock below. */
interface Captured {
  readonly host?: string;
  readonly servername?: string;
  readonly port?: number;
  readonly path?: string;
  readonly agent?: unknown;
  readonly lookup?: LookupFunction;
  readonly ca?: unknown;
  readonly headers?: Record<string, string>;
}

const captured: Captured[] = [];

vi.mock('node:https', () => ({
  request: (options: Captured) => {
    captured.push(options);
    // Enough of a request to end without answering: the sender's own timeout resolves it, which this test does not
    // wait on. Nothing is written anywhere.
    const outgoing = Object.assign(new EventEmitter(), { end: () => undefined, destroy: () => undefined });
    return outgoing;
  },
}));

const { createWebhookSender } = await import('./webhook-deliver.ts');

const send: WebhookSend = {
  deliveryId: '0193a000-0000-7000-8000-000000000001',
  endpointId: '0193a000-0000-7000-8000-000000000002',
  url: 'https://hooks.example.com/timefix?x=1',
  body: '{"id":"0193a000-0000-7000-8000-000000000003","type":"ping"}',
  secrets: ['whsec_one'],
  eventId: '0193a000-0000-7000-8000-000000000003',
  eventType: 'ping',
  attempt: 1,
};

/** A resolver answering one public IPv4 and one public IPv6, so the family filter has something to choose from. */
const lookup = () =>
  Promise.resolve<readonly LookupAddress[]>([
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]);

describe('the connection the sender opens (AC-6424)', () => {
  it('goes to the addresses it checked, through its own lookup, on 443 with the host kept for TLS', async () => {
    captured.length = 0;
    const sender = createWebhookSender({ lookup, timeoutMs: 1_000 });
    // The promise settles on the sender's own timeout; the options were captured the moment it opened.
    void sender(send);
    await vi.waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    const options = captured[0];
    if (options === undefined) throw new Error('No connection was opened.');
    expect(options.host).toBe('hooks.example.com');
    // Kept for TLS, so the certificate is checked against the name, not the address.
    expect(options.servername).toBe('hooks.example.com');
    expect(options.port).toBe(443);
    expect(options.path).toBe('/timefix?x=1');
    // A fresh connection each time: a pooled agent would reuse a socket opened to an address checked earlier.
    expect(options.agent).toBe(false);
    // Never a test certificate authority outside a test that asks for one.
    expect(options.ca).toBeUndefined();

    // The lookup is there, and it is pinned: whatever the connection asks, it only ever gets a checked address.
    const pinned = options.lookup;
    if (pinned === undefined) throw new Error('The connection was opened with no lookup, so a DNS change reaches it.');
    const asked = (family: 0 | 4 | 6, all: boolean) =>
      new Promise<unknown>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the resolver's callback is overloaded
        (pinned as any)('hooks.example.com', { family, all }, (error: unknown, ...rest: unknown[]) =>
          resolve(error ?? rest),
        );
      });
    expect(await asked(0, true)).toEqual([
      [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
    ]);
    expect(await asked(4, false)).toEqual(['93.184.216.34', 4]);
    expect(await asked(6, false)).toEqual(['2606:2800:220:1:248:1893:25c8:1946', 6]);
    // A family it holds no checked address for is an error, never the other family's address under a wrong label.
    expect(await asked(6, true)).toEqual([[{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]]);
  });

  it('opens no connection at all for a host that resolves to an inside address', async () => {
    captured.length = 0;
    const sender = createWebhookSender({
      lookup: () => Promise.resolve<readonly LookupAddress[]>([{ address: '169.254.169.254', family: 4 }]),
      timeoutMs: 1_000,
    });
    expect(await sender(send)).toMatchObject({ ok: false, failure: 'address' });
    expect(captured).toEqual([]);
  });

  it('opens no connection when the host resolves to nothing, so a dead resolver fails closed', async () => {
    captured.length = 0;
    const sender = createWebhookSender({ lookup: () => Promise.resolve([]), timeoutMs: 1_000 });
    expect(await sender(send)).toMatchObject({ ok: false, failure: 'address' });
    expect(captured).toEqual([]);
  });
});
