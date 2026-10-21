// Settings › Account › Security's device lines (spec 0033, AC-890): a
// device's name, and where and when it was last used, leaving out what the
// edge didn't know.
import type { AccountSession } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { deviceDetail, deviceName, sinceText } from './security-lines.ts';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const session = (changes: Partial<AccountSession> = {}): AccountSession => ({
  id: '0199a6f2-0000-7000-8000-000000000001',
  deviceLabel: 'Chrome on macOS',
  lastActiveAt: '2026-10-21T10:00:00.000Z',
  signedInAt: '2026-10-20T09:00:00.000Z',
  current: false,
  ...changes,
});

describe('device lines', () => {
  it('names a device, or says it is unknown', () => {
    expect(deviceName(session())).toBe('Chrome on macOS');
    expect(deviceName(session({ deviceLabel: ' ' }))).toBe('Unknown browser');
  });

  it('says where and when, with only what is known', () => {
    const where = deviceDetail(session({ city: 'Mumbai', country: 'IN' }), NOW);
    expect(where).toMatch(/^Mumbai, .+ · Active 2 hours ago$/);
    expect(deviceDetail(session(), NOW)).toBe('Active 2 hours ago');
    expect(deviceDetail(session({ current: true, country: 'IN' }), NOW)).toMatch(/ · Active now$/);
  });

  it('counts time in the largest whole unit', () => {
    expect(sinceText('2026-10-21T11:59:30.000Z', NOW)).toBe('this minute');
    expect(sinceText('2026-10-20T11:00:00.000Z', NOW)).toBe('yesterday');
    expect(sinceText('2026-09-01T12:00:00.000Z', NOW)).toBe('last month');
  });
});
