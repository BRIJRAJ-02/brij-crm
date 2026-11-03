// The guest menu render's read headers (security review, should-fix 4): the secret and the guest's address only while
// a well formed secret is set, and never an address that isn't one.
import { describe, expect, it } from 'vitest';
import { GUEST_IP_HEADER, RENDER_HEADER } from '@crm/contracts/menu';
import { menuReadHeaders } from './menu-read.ts';

const SECRET = 'a-test-edge-secret-of-at-least-32-characters';

describe('menuReadHeaders', () => {
  it('sends the very header names the api checks (one shared name, @crm/contracts)', () => {
    expect([RENDER_HEADER, GUEST_IP_HEADER]).toEqual(['x-crm-render', 'x-crm-guest-ip']);
    expect(Object.keys(menuReadHeaders({ secret: SECRET, guestIp: '203.0.113.7' }))).toEqual([
      'accept',
      RENDER_HEADER,
      GUEST_IP_HEADER,
    ]);
  });

  it('vouches for the guest with the secret and their address', () => {
    expect(menuReadHeaders({ secret: SECRET, guestIp: '203.0.113.7' })).toEqual({
      accept: 'application/json',
      [RENDER_HEADER]: SECRET,
      [GUEST_IP_HEADER]: '203.0.113.7',
    });
    expect(menuReadHeaders({ secret: SECRET, guestIp: '2001:db8::1' })[GUEST_IP_HEADER]).toBe('2001:db8::1');
  });

  it('sends the secret alone when the edge gave no address, or one that is not an address', () => {
    for (const guestIp of [undefined, '', '1.2.3.4, 5.6.7.8', 'evil\r\nx: y']) {
      expect(menuReadHeaders({ secret: SECRET, guestIp })).toEqual({
        accept: 'application/json',
        [RENDER_HEADER]: SECRET,
      });
    }
  });

  it('vouches for nobody without a well formed secret', () => {
    for (const secret of [undefined, '', 'short', `${SECRET} with spaces`]) {
      expect(menuReadHeaders({ secret, guestIp: '203.0.113.7' })).toEqual({ accept: 'application/json' });
    }
  });
});
