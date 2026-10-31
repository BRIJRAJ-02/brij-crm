// Centrifugo's tokens (spec 0005, change events): HS256 JWTs signed with the
// secret the Centrifugo service checks (`CENTRIFUGO_TOKEN_SECRET`, equal to its
// `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`), each good for an hour. The
// one place the API signs them, with node:crypto and no JWT library.
import { createHmac } from 'node:crypto';
import { audienceChannel } from '@crm/contracts';

/**
 * How long a connection or subscription token lasts: an hour (spec 0008,
 * milestone 3; 10 minutes before). The browser asks again before it runs out,
 * and each renewal is a query, so a shorter life kept Neon's compute awake for
 * an open tab nobody used. Events carry ids only and every read goes through
 * the door, so a member removed meanwhile learns only that something changed.
 */
export const REALTIME_TOKEN_SECONDS = 60 * 60;

/** Signs Centrifugo's tokens for a signed in person. */
export interface RealtimeTokens {
  /** A connection token: `sub` is the user id. */
  readonly connection: (userId: string) => string;
  /**
   * A token for one audience's channel of a workspace (`audienceChannel`: `workspace:<id>` for the open audience,
   * `workspace:<id>.<key>` for any other, spec 0007 milestone 4), for the same user id the connection carries.
   * `audience` is the caller's own policy key, from the scope the door built, never from the browser.
   */
  readonly subscription: (
    userId: string,
    workspaceId: string,
    audience: string,
  ) => { readonly channel: string; readonly token: string };
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
    subscription: (userId, workspaceId, audience) => {
      const channel = audienceChannel(workspaceId, audience);
      return { channel, token: sign({ sub: userId, channel, exp: expiry() }, secret) };
    },
  };
}
