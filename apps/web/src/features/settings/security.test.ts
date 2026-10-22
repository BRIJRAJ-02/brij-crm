// Settings › Account › Sign in and devices' device lines (spec 0033, AC-890): a
// device's name and rough place, leaving out what the edge didn't know, and
// this device listed first.
import type { AccountSession } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { currentFirst, deviceIcon, deviceName, devicePlace } from './security-lines.ts';

const session = (n: number, changes: Partial<AccountSession> = {}): AccountSession => ({
  id: `0199a6f2-0000-7000-8000-00000000000${String(n)}`,
  deviceLabel: 'Chrome on macOS',
  lastActiveAt: '2026-10-21T10:00:00.000Z',
  signedInAt: '2026-10-20T09:00:00.000Z',
  current: false,
  ...changes,
});

describe('device lines', () => {
  it('names a device, or says it is unknown', () => {
    expect(deviceName(session(1))).toBe('Chrome on macOS');
    expect(deviceName(session(1, { deviceLabel: ' ' }))).toBe('Unknown device');
  });

  it('draws a phone, a tablet or a screen by the system the name ends with', () => {
    expect(deviceIcon(session(1, { deviceLabel: 'Safari on iOS' }))).toBe('smartphone');
    expect(deviceIcon(session(1, { deviceLabel: 'Chrome on Android' }))).toBe('smartphone');
    expect(deviceIcon(session(1, { deviceLabel: 'Safari on iPadOS' }))).toBe('tablet');
    expect(deviceIcon(session(1))).toBe('monitor');
    expect(deviceIcon(session(1, { deviceLabel: '' }))).toBe('monitor');
  });

  it('says roughly where, with only what is known', () => {
    expect(devicePlace(session(1, { city: 'Mumbai', country: 'IN' }))).toMatch(/^Mumbai, \S+/);
    expect(devicePlace(session(1, { country: 'IN' }))).not.toContain(',');
    expect(devicePlace(session(1))).toBeUndefined();
  });

  it('lists this device first', () => {
    const ids = currentFirst([session(1), session(2, { current: true }), session(3)]).map((each) => each.id.slice(-1));
    expect(ids).toEqual(['2', '1', '3']);
  });
});
