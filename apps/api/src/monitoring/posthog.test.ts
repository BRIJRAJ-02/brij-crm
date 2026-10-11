// The PostHog wrapper (spec 0010, AC-165, AC-166, AC-173, AC-178), driving the
// real `posthog-node` client against a fake capture endpoint on this machine:
// catalog events only, each with `environment`, no person profile and no
// location; nothing at all without a key; and a slow or failing PostHog never
// slows or breaks the caller.
import { milestoneEventId, type ProductEvent } from '@crm/contracts/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakePostHog, startFakePostHog } from '../../test/posthog.ts';
import { createAnalytics, keepEvent, NO_ANALYTICS } from './posthog.ts';

const KEY = 'phc_testkey';
const USER = '0199c3a1-7f2e-7a10-9a3b-1c2d3e4f5a6b';
const WORKSPACE = '0199c3a1-8000-7b20-8c3d-2e3f4a5b6c7d';
const AT = '2026-10-12T09:30:00.000Z';

let fake: FakePostHog;
let warnings: { message: string; fields?: Record<string, unknown> }[];
const log = {
  warn: (message: string, fields?: Record<string, unknown>) => {
    warnings.push({ message, ...(fields === undefined ? {} : { fields }) });
  },
};

beforeEach(async () => {
  fake = await startFakePostHog();
  warnings = [];
});
afterEach(async () => {
  await fake.close();
});

/** Analytics against the fake endpoint, sending each event at once. */
const analytics = (environment: 'local' | 'preview' | 'production' = 'production') =>
  createAnalytics({ key: KEY, host: fake.host, environment, log, flushAt: 1 });

describe('createAnalytics', () => {
  it('sends a catalog event with environment, no person profile and no location, to the batch endpoint only', async () => {
    const sending = analytics('production');
    expect(sending.enabled).toBe(true);
    sending.capture({ event: 'user_signed_up', distinctId: USER, properties: { method: 'email_code' } });
    await expect.poll(() => fake.events()).toHaveLength(1);
    const [event] = fake.events();
    expect(event).toMatchObject({
      event: 'user_signed_up',
      distinct_id: USER,
      properties: {
        method: 'email_code',
        environment: 'production',
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    // Only the catalog's properties and the SDK's own `$` ones: nothing else about the person or the request.
    const ours = Object.keys(event?.properties ?? {}).filter((key) => !key.startsWith('$'));
    expect(ours.sort()).toEqual(['environment', 'method']);
    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /batch/']);
    expect(fake.requests[0]?.body).toMatchObject({ api_key: KEY });
    await sending.shutdown(2000);
  });

  it('sends a milestone with its fixed id and the time it was reached, so a resend is the same event', async () => {
    const sending = analytics('preview');
    const id = milestoneEventId(WORKSPACE, 'first_record_created');
    const event: ProductEvent = {
      event: 'first_record_created',
      distinctId: USER,
      id,
      at: AT,
      properties: { workspace_id: WORKSPACE, object_kind: 'people' },
    };
    sending.capture(event);
    sending.capture(event);
    await expect.poll(() => fake.events()).toHaveLength(2);
    for (const sent of fake.events()) {
      expect(sent).toMatchObject({
        event: 'first_record_created',
        distinct_id: USER,
        uuid: id,
        timestamp: AT,
        properties: { workspace_id: WORKSPACE, object_kind: 'people', environment: 'preview' },
      });
    }
    await sending.shutdown(2000);
  });

  it('refuses an event outside the catalog or with a property outside it, sends nothing, and logs only its name', async () => {
    const sending = analytics();
    const withEmail = {
      event: 'user_signed_up',
      distinctId: USER,
      properties: { method: 'google', email: 'ada@example.com' },
    } as unknown as ProductEvent;
    const unknown = { event: 'record_viewed', distinctId: USER, properties: {} } as unknown as ProductEvent;
    const byEmail = {
      event: 'user_signed_up',
      distinctId: 'ada@example.com',
      properties: { method: 'google' },
    } as unknown as ProductEvent;
    for (const event of [withEmail, unknown, byEmail]) expect(() => sending.capture(event)).not.toThrow();
    await sending.shutdown(2000);
    expect(fake.requests).toEqual([]);
    expect(warnings.map((warning) => warning.fields?.event)).toEqual(['user_signed_up', 'unknown', 'user_signed_up']);
    expect(JSON.stringify(warnings)).not.toContain('ada@example.com');
  });

  it('is a no op without a key: nothing sent, nothing fails (local, tests, previews)', async () => {
    const off = createAnalytics({ key: undefined, host: fake.host, environment: 'local', log });
    expect(off).toBe(NO_ANALYTICS);
    expect(off.enabled).toBe(false);
    off.capture({ event: 'user_signed_up', distinctId: USER, properties: { method: 'google' } });
    await off.shutdown(100);
    expect(fake.requests).toEqual([]);
  });

  it('returns at once while PostHog hangs, and shutdown gives up within its timeout', async () => {
    fake.setMode('hang');
    const sending = analytics();
    const started = performance.now();
    for (let index = 0; index < 50; index += 1) {
      sending.capture({ event: 'user_signed_up', distinctId: USER, properties: { method: 'google' } });
    }
    expect(performance.now() - started).toBeLessThan(50);
    await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
    const stopping = performance.now();
    await sending.shutdown(300);
    expect(performance.now() - stopping).toBeLessThan(1500);
  });

  it('never throws or rejects when PostHog fails', async () => {
    fake.setMode('fail');
    const sending = analytics();
    expect(() =>
      sending.capture({ event: 'user_signed_up', distinctId: USER, properties: { method: 'google' } }),
    ).not.toThrow();
    await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
    await expect(sending.shutdown(500)).resolves.toBeUndefined();
  });
});

describe('keepEvent, the SDK’s last hook', () => {
  it('drops an event outside the catalog', () => {
    expect(keepEvent({ event: '$exception', distinctId: USER, properties: { message: 'boom' } })).toBeNull();
    expect(keepEvent(null)).toBeNull();
  });

  it('scrubs what a catalog event carries', () => {
    const kept = keepEvent({
      event: 'user_signed_up',
      distinctId: USER,
      properties: { method: 'google', $current_url: 'https://app.test/sign-in?email=ada@example.com' },
    });
    expect(kept?.properties).toEqual({ method: 'google', $current_url: 'https://app.test/sign-in' });
  });
});
