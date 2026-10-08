// Centrifugo's tokens (spec 0005, change events): HS256 JWTs signed with the
// secret the Centrifugo service checks (`CENTRIFUGO_TOKEN_SECRET`, equal to its
// `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`), each good for 10 minutes. The
// one place the API signs them, with node:crypto and no JWT library.
import { createHmac } from 'node:crypto';
import { workspaceChannel } from '@crm/contracts';

/** How long a connection or subscription token lasts: 10 minutes. The browser asks again before it runs out. */
export const REALTIME_TOKEN_SECONDS = 10 * 60;

/** Signs Centrifugo's tokens for a signed in person. */
export interface RealtimeTokens {
  /** A connection token: `sub` is the user id. */
  readonly connection: (userId: string) => string;
  /** A token for one workspace's channel (`workspace:<id>`), for the same user id the connection carries. */
  readonly subscription: (userId: string, workspaceId: string) => { readonly channel: string; readonly token: string };
}

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Signs `claims` as an HS256 JWT. */
function sign(claims: Readonly<Record<string, unknown>>, secret: string): string {
  const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** Centrifugo's tokens, signed with `secret`; `now` (unix ms) is the clock, for tests. */
export function createRealtimeTokens({
  secret,
  now = () => Date.now(),
}: {
  readonly secret: string;
  readonly now?: () => number;
}): RealtimeTokens {
  const expiry = () => Math.floor(now() / 1000) + REALTIME_TOKEN_SECONDS;
  return {
    connection: (userId) => sign({ sub: userId, exp: expiry() }, secret),
    subscription: (userId, workspaceId) => {
      const channel = workspaceChannel(workspaceId);
      return { channel, token: sign({ sub: userId, channel, exp: expiry() }, secret) };
    },
  };
}
