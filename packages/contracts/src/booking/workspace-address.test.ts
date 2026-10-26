import { describe, expect, it } from 'vitest';
import { parseWorkspaceAddress } from './workspace-address.ts';

const origins = ['https://app.timefix.com', 'https://timefix.com'];

describe('parseWorkspaceAddress (spec 0056, AC-5610)', () => {
  it('names the page of a booking key, a form key, a handle and a handle with a slug', () => {
    expect(parseWorkspaceAddress('https://timefix.com/b/abc123', origins)).toEqual({
      kind: 'booking_key',
      key: 'abc123',
    });
    expect(parseWorkspaceAddress('https://app.timefix.com/f/contact-us?x=1#top', origins)).toEqual({
      kind: 'form_key',
      key: 'contact-us',
    });
    expect(parseWorkspaceAddress('https://timefix.com/ada-lovelace/', origins)).toEqual({
      kind: 'handle',
      handle: 'ada-lovelace',
    });
    expect(parseWorkspaceAddress(' https://timefix.com/ada-lovelace/intro-call ', origins)).toEqual({
      kind: 'booking',
      handle: 'ada-lovelace',
      slug: 'intro-call',
    });
  });

  it('is nothing for another site, a look alike origin, another scheme or port, and a path that is no page', () => {
    for (const address of [
      'https://example.com/b/abc123',
      'https://timefix.com.evil.dev/b/abc123',
      'http://timefix.com/b/abc123',
      'https://timefix.com:8443/b/abc123',
      'https://timefix.com/sign-in',
      'https://timefix.com/w/acme/home',
      'https://timefix.com/',
      'https://timefix.com/ada-lovelace/intro/extra',
      'mailto:ada@timefix.com',
      'not an address',
    ]) {
      expect(parseWorkspaceAddress(address, origins), address).toBeUndefined();
    }
  });
});
