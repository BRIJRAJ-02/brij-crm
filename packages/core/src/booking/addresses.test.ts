// The refusal list (spec 0055, AC-5520), as a table. Every line here is an address somebody could put behind a
// link on their page, and the ones that must never be opened are the point of the test.
import { describe, expect, it } from 'vitest';
import { isFetchableUrl, isRefusedAddress } from './addresses.ts';

describe('isRefusedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback, the whole /8'],
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private, the bottom of the /12'],
    ['172.31.255.255', 'private, the top of the /12'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'the cloud metadata address'],
    ['100.64.0.1', 'carrier grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['198.18.0.1', 'benchmarking'],
    ['::1', 'loopback, v6'],
    ['::', 'the unspecified address'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link local, v6'],
    ['ff02::1', 'multicast, v6'],
    ['::ffff:169.254.169.254', 'the metadata address, written as mapped v6'],
    ['::ffff:127.0.0.1', 'loopback, written as mapped v6'],
    ['64:ff9b::7f00:1', 'loopback, written through NAT64'],
    ['2002:7f00:0001::', 'loopback, written as 6to4'],
    ['not an address', 'anything unreadable'],
    ['', 'nothing at all'],
  ])('refuses %s (%s)', (address) => {
    expect(isRefusedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34', 'an ordinary public address'],
    ['8.8.8.8', 'a public resolver'],
    ['172.32.0.1', 'just past the private /12'],
    ['172.15.255.255', 'just before the private /12'],
    ['100.63.255.255', 'just before carrier grade NAT'],
    ['100.128.0.1', 'just past carrier grade NAT'],
    ['2606:4700:4700::1111', 'a public v6 address'],
    ['::ffff:93.184.216.34', 'a public v4 address written as mapped v6'],
  ])('allows %s (%s)', (address) => {
    expect(isRefusedAddress(address)).toBe(false);
  });
});

describe('isFetchableUrl', () => {
  it.each(['https://linktr.ee/ada', 'https://example.co.uk/path?q=1', 'https://sub.domain.example.com/'])(
    'allows %s',
    (href) => {
      expect(isFetchableUrl(new URL(href))).toBe(true);
    },
  );

  it.each([
    ['http://example.com/', 'plain http'],
    ['ftp://example.com/', 'another scheme'],
    ['file:///etc/passwd', 'a local file'],
    ['https://127.0.0.1/', 'a literal address, which would skip the name check'],
    ['https://[::1]/', 'a literal v6 address'],
    ['https://169.254.169.254/latest/meta-data/', 'the metadata address, written out'],
    ['https://user:pass@example.com/', 'credentials in the address'],
    ['https://example.com./', 'a trailing dot, the same name to DNS and a different string to an allow list'],
    ['https://localhost/', 'a single label name'],
  ])('refuses %s (%s)', (href) => {
    expect(isFetchableUrl(new URL(href))).toBe(false);
  });
});
