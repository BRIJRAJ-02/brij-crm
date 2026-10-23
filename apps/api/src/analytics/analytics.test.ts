// The console's counting helpers (spec 0047): daily visitor ids, device
// classes, machines, the beacon's cleaning, and the activity throttle.
import { describe, expect, it } from 'vitest';
import { cleanPath, cleanReferrer, cleanSource, limitAddress } from '../public/site.ts';
import { createActivityNoter } from './activity.ts';
import { deviceOf, isMachine, visitorId, visitorKey } from './visitor.ts';

const KEY = visitorKey('a-test-salt-of-at-least-thirty-two-characters');
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

describe('visitor ids (AC-1626)', () => {
  it('are 32 hex digits, the same within a day and place, and new on the next day or elsewhere', () => {
    const base = { day: '2026-10-23', ip: '10.0.0.1', userAgent: CHROME, place: 'timefix.ai' };
    const id = visitorId(KEY, base);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId(KEY, base)).toBe(id);
    expect(visitorId(KEY, { ...base, day: '2026-10-24' })).not.toBe(id);
    expect(visitorId(KEY, { ...base, place: 'other.example' })).not.toBe(id);
    expect(visitorId(visitorKey('another-salt-of-at-least-thirty-two-chars'), base)).not.toBe(id);
  });

  it('class devices and drop machines', () => {
    expect(deviceOf(CHROME)).toBe('desktop');
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148 Safari/604.1')).toBe(
      'mobile',
    );
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Safari/604.1')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('mobile');
    expect(isMachine('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true);
    expect(isMachine('curl/8.4.0')).toBe(true);
    expect(isMachine(undefined)).toBe(true);
    expect(isMachine(CHROME)).toBe(false);
  });
});

describe("the beacon's cleaning (AC-1627)", () => {
  it('keeps a path without its query or fragment, and refuses anything else', () => {
    expect(cleanPath('/pricing?email=ada@example.com#top')).toBe('/pricing');
    expect(cleanPath('pricing')).toBeUndefined();
    expect(cleanPath('/a b')).toBeUndefined();
    expect(cleanPath(`/${'a'.repeat(300)}`)).toHaveLength(200);
  });

  it('counts an IPv6 address by its /64, and an IPv4 one as is', () => {
    expect(limitAddress('2001:db8:85a3:0042:1000:8a2e:0370:7334')).toBe('2001:db8:85a3:42::/64');
    expect(limitAddress('2001:db8:85a3:42::1')).toBe('2001:db8:85a3:42::/64');
    expect(limitAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(limitAddress('10.0.0.1')).toBe('10.0.0.1');
    expect(limitAddress('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(limitAddress('1:2:3:4:5:6:7:8:9:10')).toBe('unknown');
    expect(limitAddress('not an address')).toBe('unknown');
    expect(limitAddress(undefined)).toBe('unknown');
  });

  it('keeps a referring host, never the site itself, and a plain source', () => {
    expect(cleanReferrer('WWW.Google.com', 'timefix.ai')).toBe('google.com');
    expect(cleanReferrer('timefix.ai', 'timefix.ai')).toBeUndefined();
    expect(cleanReferrer('https://evil.example/path', 'timefix.ai')).toBeUndefined();
    expect(cleanSource('News_Letter-1')).toBe('news_letter-1');
    expect(cleanSource('<script>')).toBeUndefined();
  });
});

describe('the activity throttle (AC-1624)', () => {
  it('writes a person once every 10 minutes per process, and drops a failure', async () => {
    let now = 0;
    const written: string[] = [];
    const failures: unknown[] = [];
    const kept: Promise<unknown>[] = [];
    const note = createActivityNoter({
      note: (userId) => {
        written.push(userId);
        return userId === 'broken' ? Promise.reject(new Error('down')) : Promise.resolve();
      },
      keepAlive: (work) => kept.push(work),
      onError: (error) => failures.push(error),
      now: () => now,
    });
    note('ada');
    note('ada');
    now = 9 * 60_000;
    note('ada');
    now = 10 * 60_000;
    note('ada');
    note('broken');
    await Promise.all(kept);
    expect(written).toEqual(['ada', 'ada', 'broken']);
    expect(failures).toHaveLength(1);
  });
});
