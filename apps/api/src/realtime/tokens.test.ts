// Centrifugo's tokens (spec 0005): HS256 JWTs with the claims Centrifugo
// reads, signed with the shared secret, good for 10 minutes.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRealtimeTokens, REALTIME_TOKEN_SECONDS } from './tokens.ts';

const SECRET = 'a-centrifugo-token-secret-of-32-characters';
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const USER = '0199a6f2-0000-7000-8000-000000000001';
const WORKSPACE = '0199a6f2-0000-7000-8000-000000000002';

/** A token's header and claims, after checking its signature with `secret`. */
function read(token: string, secret = SECRET): { header: unknown; claims: unknown } {
  const [header = '', claims = '', signature = ''] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  expect(signature).toBe(expected);
  const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  return { header: decode(header), claims: decode(claims) };
}

describe("Centrifugo's tokens", () => {
  const tokens = createRealtimeTokens({ secret: SECRET, now: () => NOW });

  it('signs a connection token for the user, good for 10 minutes', () => {
    expect(read(tokens.connection(USER))).toEqual({
      header: { alg: 'HS256', typ: 'JWT' },
      claims: { sub: USER, exp: NOW / 1000 + REALTIME_TOKEN_SECONDS },
    });
    expect(REALTIME_TOKEN_SECONDS).toBe(600);
  });

  it("signs a subscription token for the workspace's channel only, with the same user", () => {
    const { channel, token } = tokens.subscription(USER, WORKSPACE);
    expect(channel).toBe(`workspace:${WORKSPACE}`);
    expect(read(token).claims).toEqual({ sub: USER, channel, exp: NOW / 1000 + REALTIME_TOKEN_SECONDS });
  });

  it('signs with its own secret, so another secret never verifies', () => {
    const [header = '', claims = '', signature = ''] = tokens.connection(USER).split('.');
    expect(signature).not.toBe(
      createHmac('sha256', 'another-secret').update(`${header}.${claims}`).digest('base64url'),
    );
  });
});
