// The product event catalog (spec 0010, AC-173, AC-177): a closed list of
// strict schemas, ids and closed lists only, and fixed milestone event ids.
import { describe, expect, it } from 'vitest';
import { milestoneEventId, PRODUCT_EVENT_NAMES, ProductEvent, uuidV5 } from './events.ts';

const USER = '0199c3a1-7f2e-7a10-9a3b-1c2d3e4f5a6b';
const WORKSPACE = '0199c3a1-8000-7b20-8c3d-2e3f4a5b6c7d';
const AT = '2026-10-12T09:30:00.000Z';

describe('the catalog', () => {
  it('names exactly the three events', () => {
    expect([...PRODUCT_EVENT_NAMES].sort()).toEqual(['first_record_created', 'user_signed_up', 'workspace_created']);
  });

  it.each([
    { event: 'user_signed_up', distinctId: USER, properties: { method: 'email_code' } },
    { event: 'user_signed_up', distinctId: USER, properties: { method: 'google' } },
    {
      event: 'workspace_created',
      distinctId: USER,
      id: milestoneEventId(WORKSPACE, 'workspace_created'),
      at: AT,
      properties: { workspace_id: WORKSPACE },
    },
    {
      event: 'first_record_created',
      distinctId: USER,
      id: milestoneEventId(WORKSPACE, 'first_record_created'),
      at: AT,
      properties: { workspace_id: WORKSPACE, object_kind: 'custom' },
    },
  ])('takes $event as the catalog has it', (event) => {
    expect(ProductEvent.parse(event)).toEqual(event);
  });

  it.each([
    ['an event outside the catalog', { event: 'record_viewed', distinctId: USER, properties: {} }],
    [
      'an email as the distinct id',
      { event: 'user_signed_up', distinctId: 'ada@example.com', properties: { method: 'google' } },
    ],
    [
      'a property outside the catalog',
      { event: 'user_signed_up', distinctId: USER, properties: { method: 'google', email: 'ada@example.com' } },
    ],
    ['a method outside the list', { event: 'user_signed_up', distinctId: USER, properties: { method: 'password' } }],
    [
      'a field beside the properties',
      { event: 'user_signed_up', distinctId: USER, properties: { method: 'google' }, name: 'Ada' },
    ],
    [
      'a workspace named, not by id',
      {
        event: 'workspace_created',
        distinctId: USER,
        id: milestoneEventId(WORKSPACE, 'workspace_created'),
        at: AT,
        properties: { workspace_id: 'Acme Ltd' },
      },
    ],
    [
      'an object kind outside the list',
      {
        event: 'first_record_created',
        distinctId: USER,
        id: milestoneEventId(WORKSPACE, 'first_record_created'),
        at: AT,
        properties: { workspace_id: WORKSPACE, object_kind: 'Investors' },
      },
    ],
    [
      'a milestone without its fixed id',
      { event: 'workspace_created', distinctId: USER, at: AT, properties: { workspace_id: WORKSPACE } },
    ],
  ])('refuses %s', (_name, event) => {
    expect(ProductEvent.safeParse(event).success).toBe(false);
  });
});

describe('milestoneEventId', () => {
  it('derives UUID v5 as RFC 9562 does', () => {
    // The RFC's own example: the DNS namespace and www.example.com.
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('gives one milestone of one workspace the same id every time, in any letter case, and every other a different one', () => {
    const id = milestoneEventId(WORKSPACE, 'workspace_created');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(milestoneEventId(WORKSPACE.toUpperCase(), 'workspace_created')).toBe(id);
    expect(milestoneEventId(WORKSPACE, 'first_record_created')).not.toBe(id);
    expect(milestoneEventId(USER, 'workspace_created')).not.toBe(id);
  });
});
