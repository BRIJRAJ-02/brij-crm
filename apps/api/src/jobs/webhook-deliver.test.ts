// The webhook sender's bounds (spec 0064, AC-6421, AC-6424), with a fake resolver: nothing here reaches the
// network. Every refused address is refused before a connection is opened, and a host that resolved public when it
// was added but resolves private at send time (DNS rebinding) is refused at send time.
import type { LookupAddress } from 'node:dns';
import { verifySignature, type WebhookSend } from '@crm/core';
import { describe, expect, it } from 'vitest';
import {
  createHostCheck,
  createWebhookSender,
  pinnedLookup,
  WEBHOOK_AGENT,
  webhookHeaders,
  type WebhookLookup,
} from './webhook-deliver.ts';

const send: WebhookSend = {
  deliveryId: '0193a000-0000-7000-8000-000000000001',
  endpointId: '0193a000-0000-7000-8000-000000000002',
  url: 'https://hooks.example.com/timefix',
  body: '{"id":"0193a000-0000-7000-8000-000000000003","type":"ping"}',
  secrets: ['whsec_one'],
  eventId: '0193a000-0000-7000-8000-000000000003',
  eventType: 'ping',
  attempt: 2,
};

const answering = (...answers: (readonly string[])[]): WebhookLookup & { readonly calls: string[] } => {
  const calls: string[] = [];
  let call = 0;
  const lookup = (hostname: string) => {
    calls.push(hostname);
    const addresses = answers[Math.min(call, answers.length - 1)] ?? [];
    call += 1;
    return Promise.resolve(
      addresses.map((address): LookupAddress => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
  return Object.assign(lookup, { calls });
};

describe('the webhook sender (AC-6424)', () => {
  it.each([
    ['http://hooks.example.com/x'],
    ['https://hooks.example.com:8443/x'],
    ['https://10.0.0.5/x'],
    ['https://[::1]/x'],
  ])('refuses %s before resolving anything', async (url) => {
    const lookup = answering(['93.184.216.34']);
    const result = await createWebhookSender({ lookup })({ ...send, url });
    expect(result).toMatchObject({ ok: false, failure: 'address' });
    expect(lookup.calls).toEqual([]);
  });

  it.each([[['169.254.169.254']], [['10.0.0.5']], [['::ffff:127.0.0.1']], [['93.184.216.34', '192.168.0.1']], [[]]])(
    'refuses a host resolving to %j',
    async (addresses) => {
      const result = await createWebhookSender({ lookup: answering(addresses) })(send);
      expect(result).toMatchObject({ ok: false, failure: 'address' });
    },
  );

  it('refuses at send time a host that resolved public when added and private now (rebinding)', async () => {
    const lookup = answering(['93.184.216.34'], ['169.254.169.254']);
    expect(await createHostCheck(lookup)(new URL(send.url))).toBeUndefined();
    const result = await createWebhookSender({ lookup })(send);
    expect(result).toMatchObject({ ok: false, failure: 'address' });
    expect(lookup.calls).toEqual(['hooks.example.com', 'hooks.example.com']);
  });

  it('connects only to the address it checked, whatever the connection asks the resolver', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    const one: unknown[] = [];
    lookup('hooks.example.com', {}, (...args: unknown[]) => one.push(args));
    lookup('hooks.example.com', { all: true }, (...args: unknown[]) => one.push(args));
    expect(one).toEqual([
      [null, '93.184.216.34', 4],
      [null, [{ address: '93.184.216.34', family: 4 }]],
    ]);
  });
});

describe('the headers (AC-6421)', () => {
  it('carry the event id, type and try, our agent, and a signature the receiver verifies', () => {
    const headers = webhookHeaders(send, 1_730_000_000);
    expect(headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': WEBHOOK_AGENT,
      'timefix-event-id': send.eventId,
      'timefix-event-type': 'ping',
      'timefix-delivery-attempt': '2',
    });
    expect(WEBHOOK_AGENT).toBe('Timefix-Webhooks/1');
    expect(verifySignature(headers['timefix-signature'] ?? '', 'whsec_one', send.body, 1_730_000_000)).toBe(true);
  });
});
