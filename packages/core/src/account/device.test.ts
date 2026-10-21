// What device a session is on (spec 0033, AC-890): the browser family and its
// system from a user agent, best effort, empty when it says nothing we know.
import { describe, expect, it } from 'vitest';
import { deviceLabel, deviceParts } from './device.ts';

const AGENTS: readonly (readonly [string, string])[] = [
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Chrome on macOS',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Edge on Windows',
  ],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox on Linux'],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Safari on macOS',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    'Chrome on iOS',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'Safari on iPadOS',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Samsung Internet on Android',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0',
    'Opera on Windows',
  ],
  [
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Chrome on ChromeOS',
  ],
];

describe('deviceLabel', () => {
  it.each(AGENTS)('reads %s as %s', (agent, label) => {
    expect(deviceLabel(agent)).toBe(label);
  });

  it('says what it knows, and nothing when it knows nothing', () => {
    expect(deviceLabel('curl/8.7.1')).toBe('');
    expect(deviceLabel(undefined)).toBe('');
    expect(deviceLabel(null)).toBe('');
    expect(deviceLabel('SomeApp/1.0 (Windows NT 10.0)')).toBe('Windows');
    expect(deviceParts('Firefox/1.0')).toEqual({ browser: 'Firefox', system: '' });
  });

  it('reads only the start of a very long user agent', () => {
    expect(deviceLabel(`${'x'.repeat(600)} Chrome/131.0 (Macintosh)`)).toBe('');
  });
});
