// The pure halves of webhooks (spec 0064): where one may go (AC-6424), how it is signed (AC-6420, AC-6421), what it
// may say (AC-6426), and when it is tried again (AC-6423).
import {
  WEBHOOK_BODY_MAX_BYTES,
  WEBHOOK_DATA,
  WebhookBookingData,
  WebhookCreateInput,
  WebhookFormData,
  WebhookSignupData,
  isWebhookEnvelope,
} from '@crm/contracts';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolvedProblem, webhookUrlProblem } from './addresses.ts';
import { retryDelaySeconds, WEBHOOK_BACKOFF_SECONDS } from './deliver.ts';
import { webhookAnswer, webhookEnvelope } from './payloads.ts';
import {
  decodeWebhookKey,
  newWebhookSecret,
  openSecret,
  sealSecret,
  secretHint,
  signatureHeader,
  signatureOf,
  verifySignature,
} from './signing.ts';

describe('where a webhook may go (AC-6424)', () => {
  it.each([
    ['http://hooks.example.com/x', 'https'],
    ['ftp://hooks.example.com/x', 'https'],
    ['https://hooks.example.com:8443/x', 'port'],
    ['https://hooks.example.com:80/x', 'port'],
    ['https://user:secret@hooks.example.com/x', 'credentials'],
    ['https://10.0.0.5/x', 'host'],
    ['https://127.0.0.1/x', 'host'],
    ['https://169.254.169.254/latest/meta-data', 'host'],
    ['https://[::1]/x', 'host'],
    ['https://[fd00::1]/x', 'host'],
    ['https://localhost/x', 'host'],
    ['https://hooks.example.com./x', 'host'],
    ['not a url', 'url'],
    [`https://hooks.example.com/${'a'.repeat(2100)}`, 'url'],
  ])('refuses %s (%s)', (url, problem) => {
    expect(webhookUrlProblem(url)).toBe(problem);
  });

  it.each(['https://hooks.example.com/timefix', 'https://hooks.example.com:443/x?token=1', 'https://a.b.example/x'])(
    'takes %s',
    (url) => {
      expect(webhookUrlProblem(url)).toBeUndefined();
    },
  );

  it.each([
    [['10.0.0.5'], 'private'],
    [['172.16.3.4'], 'private, the /12'],
    [['192.168.1.1'], 'private'],
    [['127.0.0.1'], 'loopback'],
    [['169.254.169.254'], 'the cloud metadata address'],
    [['100.64.0.1'], 'carrier grade NAT'],
    [['224.0.0.1'], 'multicast'],
    [['::1'], 'loopback, v6'],
    [['fe80::1'], 'link local, v6'],
    [['fc00::1'], 'unique local'],
    [['::ffff:169.254.169.254'], 'metadata, written as mapped v6'],
    [['93.184.216.34', '10.0.0.5'], 'one public and one private answer'],
    [[], 'no answer at all'],
  ])('refuses a host resolving to %j (%s)', (addresses) => {
    expect(resolvedProblem(addresses)).toBe('address');
  });

  it('takes a host whose every answer is public', () => {
    expect(resolvedProblem(['93.184.216.34', '2606:4700:4700::1111'])).toBeUndefined();
  });
});

describe('the signature (AC-6421) and the secret (AC-6420)', () => {
  const secret = 'whsec_test_secret';
  const body = '{"id":"0193","type":"ping"}';

  it('signs "<t>.<raw body>" with HMAC SHA256 in hex, as a known value', () => {
    // openssl: printf '1730000000.{"id":"0193","type":"ping"}' | openssl dgst -sha256 -hmac whsec_test_secret
    const known = '9cc37817ae993929d46c1fb78c5561f90c7fcf33215c4393ca5682ee39a2b89e';
    expect(signatureOf(secret, 1_730_000_000, body)).toBe(known);
    expect(signatureHeader([secret], 1_730_000_000, body)).toBe(`t=1730000000,v1=${known}`);
  });

  it('is verified by a receiver holding the secret, and by no other secret, body or stale time', () => {
    const header = signatureHeader([secret], 1_730_000_000, body);
    expect(verifySignature(header, secret, body, 1_730_000_010)).toBe(true);
    expect(verifySignature(header, 'whsec_other', body, 1_730_000_010)).toBe(false);
    expect(verifySignature(header, secret, `${body} `, 1_730_000_010)).toBe(false);
    expect(verifySignature(header, secret, body, 1_730_001_000)).toBe(false);
  });

  it('carries both v1 values while a rotation overlaps, and each secret verifies', () => {
    const header = signatureHeader(['whsec_new', 'whsec_old'], 1_730_000_000, body);
    expect(header.split(',')).toHaveLength(3);
    expect(verifySignature(header, 'whsec_new', body, 1_730_000_000)).toBe(true);
    expect(verifySignature(header, 'whsec_old', body, 1_730_000_000)).toBe(true);
  });

  it('makes a whsec_ secret of 32 random bytes, shown afterwards as its last 4 characters', () => {
    const made = newWebhookSecret();
    expect(made).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(made);
    expect(secretHint(made)).toBe(made.slice(-4));
  });

  it('seals a secret to its endpoint: it opens there, and not on another endpoint or under another key', () => {
    const key = decodeWebhookKey(randomBytes(32).toString('base64'));
    const binding = {
      workspaceId: '0193a000-0000-7000-8000-000000000001',
      endpointId: '0193a000-0000-7000-8000-000000000002',
    };
    const sealed = sealSecret(key, 'whsec_abc', binding);
    expect(sealed.toString('utf8')).not.toContain('whsec_abc');
    expect(openSecret(key, sealed, binding)).toBe('whsec_abc');
    expect(() => openSecret(key, sealed, { ...binding, endpointId: binding.workspaceId })).toThrow(/did not open/);
    expect(() => openSecret(decodeWebhookKey(randomBytes(32).toString('hex')), sealed, binding)).toThrow(
      /did not open/,
    );
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => decodeWebhookKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('what a webhook may say (AC-6426)', () => {
  it('keeps text, numbers, yes or no, choices and phones, and leaves a file id out', () => {
    expect(webhookAnswer('hi')).toBe('hi');
    expect(webhookAnswer(3)).toBe(3);
    expect(webhookAnswer(false)).toBe(false);
    expect(webhookAnswer(['a', 'b'])).toEqual(['a', 'b']);
    expect(webhookAnswer({ number: '+44 20 7946 0000', country: 'GB', extra: 'x' })).toEqual({
      number: '+44 20 7946 0000',
      country: 'GB',
    });
    expect(webhookAnswer({ uploadId: '0193a000-0000-7000-8000-000000000009', name: 'cv.pdf' })).toBeUndefined();
    expect(webhookAnswer(Number.NaN)).toBeUndefined();
  });

  const booking: WebhookBookingData = {
    booking_id: '0193a000-0000-7000-8000-000000000003',
    page: { id: '0193a000-0000-7000-8000-000000000004', title: 'Intro call' },
    host: { name: 'Ada Lovelace', email: 'ada@acme.example' },
    start: '2026-11-02T09:00:00.000Z',
    end: '2026-11-02T09:30:00.000Z',
    time_zone: 'Europe/London',
    location_kind: 'video',
    status: 'confirmed',
    invitee: { name: 'Grace Hopper', email: 'grace@example.com' },
    answers: { company: 'Navy' },
  };

  it('holds each payload to its own list: a field outside it is refused', () => {
    expect(WebhookBookingData.safeParse(booking).success).toBe(true);
    expect(WebhookBookingData.safeParse({ ...booking, manage_token: 'x' }).success).toBe(false);
    expect(WebhookBookingData.safeParse({ ...booking, host: { ...booking.host, id: 'x' } }).success).toBe(false);
    const form = {
      submission_id: booking.booking_id,
      form: { id: booking.page.id, name: 'Contact' },
      answers: { email: 'grace@example.com' },
      source: { utm_source: 'news' },
    };
    expect(WebhookFormData.safeParse(form).success).toBe(true);
    expect(WebhookFormData.safeParse({ ...form, source: { ...form.source, visitor_id: 'v' } }).success).toBe(false);
    expect(WebhookSignupData.safeParse({ email: 'a@b.example', handle: 'ada' }).success).toBe(true);
    expect(WebhookSignupData.safeParse({ email: 'a@b.example', handle: 'ada', user_id: 'x' }).success).toBe(false);
    expect(Object.keys(WEBHOOK_DATA)).toHaveLength(7);
  });

  it('wraps the data in the envelope, and keeps the body to 64 KB, long answers cut first', () => {
    const base = {
      eventId: '0193a000-0000-7000-8000-000000000005',
      type: 'booking.created' as const,
      createdAt: '2026-11-01T10:00:00.000Z',
      workspaceId: '0193a000-0000-7000-8000-000000000006',
    };
    const small = webhookEnvelope({ ...base, data: booking });
    expect(small).toMatchObject({ id: base.eventId, type: 'booking.created', workspace_id: base.workspaceId });
    expect(isWebhookEnvelope(small)).toBe(true);
    const long = webhookEnvelope({ ...base, data: { ...booking, answers: { story: 'x'.repeat(80_000) } } });
    expect(Buffer.byteLength(JSON.stringify(long))).toBeLessThanOrEqual(WEBHOOK_BODY_MAX_BYTES);
    expect((long?.data as WebhookBookingData).answers.story).toHaveLength(500);
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`q${String(index)}`, 'y'.repeat(400)]));
    const cut = webhookEnvelope({ ...base, data: { ...booking, answers: many } });
    expect((cut?.data as WebhookBookingData).answers).toEqual({});
  });
});

describe('when a failed delivery is tried again (AC-6423)', () => {
  it('waits about 1 minute, 5, 30, 2 hours, 6, 12 and 24, then gives up', () => {
    expect(WEBHOOK_BACKOFF_SECONDS).toEqual([60, 300, 1800, 7200, 21_600, 43_200, 86_400]);
    expect(retryDelaySeconds(1, () => 0.5)).toBe(60);
    expect(retryDelaySeconds(7, () => 0.5)).toBe(86_400);
    expect(retryDelaySeconds(8, () => 0.5)).toBeUndefined();
  });

  it('jitters each wait by at most a tenth either way', () => {
    expect(retryDelaySeconds(2, () => 0)).toBe(270);
    expect(retryDelaySeconds(2, () => 0.999_999)).toBe(330);
  });
});

describe('the endpoint form (AC-6419)', () => {
  it('takes an https address and at least one event, each once', () => {
    const base = {
      workspace: 'acme',
      url: 'https://hooks.example.com/x',
      mutationId: '0193a000-0000-7000-8000-000000000007',
    };
    expect(WebhookCreateInput.safeParse({ ...base, events: ['booking.created'] }).success).toBe(true);
    expect(WebhookCreateInput.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(WebhookCreateInput.safeParse({ ...base, events: ['booking.created', 'booking.created'] }).success).toBe(
      false,
    );
    expect(WebhookCreateInput.safeParse({ ...base, url: 'http://hooks.example.com', events: ['ping'] }).success).toBe(
      false,
    );
  });
});
