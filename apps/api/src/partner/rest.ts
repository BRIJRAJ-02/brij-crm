// The partner API (spec 0070, slice 2): `/api/partner/v1`, for a partner's server only.
//
// - `POST /api/partner/v1/token`: the OAuth token exchange (AC-7011). The client id and secret come as HTTP Basic or in
//   the body; the body is form encoded or JSON with OAuth's field names. It answers the connection and its access
//   token, once, with `cache-control: no-store`.
// - `GET /api/partner/v1/connections/{id}`: a connection's read of itself, with `Authorization: Bearer <token>`.
//   Slice 3 adds `PUT` and `DELETE /connections/{id}/members/{externalId}`, slice 4 `POST /connections/{id}/launch`.
//
// No route here reads a cookie, so the Origin check on writes (CSRF's defence for a cookie) doesn't apply, and
// `app.ts` lets `/api/partner/v1/` past it. Errors are the app's `{ code, message }` (AC-7025): a wrong client id or
// secret, and a token that opens nothing, are 401 `UNAUTHENTICATED`; anything wrong with a code is 400
// `INPUT_INVALID`. Every limit is spent before the database is: per address first, then per client id or connection
// (by what the token's public half names, parsed with no query), and a refused secret or token also counts against
// its address, so guessing costs the guesser. One log line per request names the partner or connection, the route
// and the status, never a secret, code or token.
import {
  type ErrorCode,
  errorStatus,
  PARTNER_CLIENT_ID,
  PARTNER_REQUESTS_A_MINUTE,
  PARTNER_TOKEN_REQUESTS_A_MINUTE,
  PartnerTokenRequest,
  type PartnerTokenAnswer,
} from '@crm/contracts';
import {
  enterAsPartner,
  exchangePartnerCode,
  notePartnerCall,
  parsePartnerAccessToken,
  readPartnerConnection,
  type PartnerEntry,
} from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { ORPCError } from '@orpc/server';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash } from 'node:crypto';
import type * as z from 'zod';
import { inputProblems, toApiError } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import { bearerOf } from '../v1/rest.ts';

/** Where the partner API lives, under the app's `/api`. */
export const PARTNER_V1_PREFIX = '/api/partner/v1/';

/** The largest body a partner request may carry. */
const BODY_LIMIT_BYTES = 64 * 1024;
/** Requests one address may make a minute, before anything is looked up. */
const ADDRESS_REQUESTS_A_MINUTE = 600;
/** Refused secrets or tokens one address may send in 10 minutes before it is refused outright. */
const REFUSED_RULE = { window: 600, max: 30 } as const;

/** What the partner API needs from the app. */
export interface PartnerApiDeps {
  readonly db: Database;
  /** The registry's one read: a partner and its secret's hash, by client id. */
  readonly partners: Pick<IdentityStore, 'partnerByClientId'>;
  /** The central limiter's one call. */
  readonly limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  readonly keepAlive: (work: Promise<unknown>) => void;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  partner: PartnerEntry;
}

/** A `{ code, message, data? }` answer at the code's status, never cached. */
function failure(
  code: ErrorCode,
  message: string,
  data: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const body = Object.keys(data).length === 0 ? { code, message } : { code, message, data };
  return Response.json(body, {
    status: errorStatus(code),
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

/** Bad input, worded as the RPC words it. */
function badInput(issues: readonly z.core.$ZodIssue[]): Response {
  const { message, issues: fields } = inputProblems(issues);
  return failure('INPUT_INVALID', message, { issues: fields });
}

/** Any error a service threw, as the app's RPC would word it; anything unexpected is logged and reported. */
function answerError(c: Context<{ Variables: Variables }>, error: unknown): Response {
  if (error instanceof ORPCError) return failure(error.code as ErrorCode, error.message);
  const mapped = toApiError(error);
  if (!mapped.expected) {
    log.error('api.partner.failed', { requestId: c.get('requestId'), ...errorFields(error) });
    captureFault(error, { requestId: c.get('requestId'), route: 'api partner' });
  }
  return failure(mapped.error.code, mapped.error.message);
}

const tooMany = (wait: number | undefined, message: string) =>
  failure('TOO_MANY_REQUESTS', message, {}, { 'retry-after': String(wait ?? 60) });

/** HTTP Basic's client id and secret (RFC 6749, 2.3.1: each form encoded before joining), or undefined. */
export function basicCredentials(header: string | undefined): { id: string; secret: string } | undefined {
  const match = /^basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header?.trim() ?? '');
  if (match?.[1] === undefined) return undefined;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return undefined;
  try {
    return {
      id: decodeURIComponent(decoded.slice(0, colon).replaceAll('+', ' ')),
      secret: decodeURIComponent(decoded.slice(colon + 1).replaceAll('+', ' ')),
    };
  } catch {
    return undefined;
  }
}

/** The token request's body: form encoded or JSON, as plain fields; undefined when it is neither. */
async function bodyOf(c: Context): Promise<Record<string, unknown> | undefined> {
  const type = c.req.header('content-type')?.toLowerCase() ?? '';
  try {
    if (type.startsWith('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(await c.req.text()));
    }
    if (type.startsWith('application/json')) {
      const parsed: unknown = await c.req.json();
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Mounts `/api/partner/v1` on the app (its base path is `/api`). */
export function mountPartnerApi(
  app: Hono<{ Variables: { requestId: string; clientIp: string | undefined; origin: string | undefined } }>,
  deps: PartnerApiDeps,
): void {
  const api = app as unknown as Hono<{ Variables: Variables }>;

  api.use(
    '/partner/v1/*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => failure('PAYLOAD_TOO_LARGE', 'This request is larger than the 64 KB the partner API accepts.'),
    }),
  );

  /** Every request's address count, before anything else. */
  api.use('/partner/v1/*', async (c, next) => {
    const address = c.get('clientIp') ?? 'unknown';
    const counted = await deps.limiter.consumeRateLimit(`partner:address:${address}`, {
      window: 60,
      max: ADDRESS_REQUESTS_A_MINUTE,
    });
    if (!counted.allowed) {
      return tooMany(counted.retryAfterSeconds, 'This address made too many requests this minute. Wait a moment.');
    }
    return next();
  });

  /** A refused secret or token: counted against its address; past `REFUSED_RULE` the address hears 429 instead. */
  const refused = async (address: string | undefined, answer: Response): Promise<Response> => {
    const counted = await deps.limiter.consumeRateLimit(`partner:refused:${address ?? 'unknown'}`, REFUSED_RULE);
    return counted.allowed
      ? answer
      : tooMany(counted.retryAfterSeconds, 'Too many refused requests from this address. Wait a few minutes.');
  };

  api.post('/partner/v1/token', async (c) => {
    const started = Date.now();
    const body = await bodyOf(c);
    if (body === undefined) {
      return failure('INPUT_INVALID', 'Send the token request as application/x-www-form-urlencoded or JSON.');
    }
    const parsed = PartnerTokenRequest.safeParse(body);
    if (!parsed.success) return badInput(parsed.error.issues);
    const basic = basicCredentials(c.req.header('authorization'));
    const clientId = basic?.id ?? parsed.data.client_id ?? '';
    const clientSecret = basic?.secret ?? parsed.data.client_secret ?? '';
    const badClient = () =>
      refused(
        c.get('clientIp'),
        failure('UNAUTHENTICATED', 'The client id or client secret is wrong.', {}, { 'www-authenticate': 'Basic' }),
      );
    if (!PARTNER_CLIENT_ID.test(clientId)) return badClient();
    // Per client and secret: junk secrets sent with a partner's public client id fill their own buckets, never the
    // one the partner's real secret counts in (a wrong secret also counts against its address, below).
    const keyed = createHash('sha256').update(clientSecret).digest('base64url').slice(0, 16);
    const perClient = await deps.limiter.consumeRateLimit(`partner:token:${clientId}:${keyed}`, {
      window: 60,
      max: PARTNER_TOKEN_REQUESTS_A_MINUTE,
    });
    if (!perClient.allowed) {
      return tooMany(perClient.retryAfterSeconds, 'This app asked for too many tokens this minute. Wait a moment.');
    }
    try {
      const exchanged = await exchangePartnerCode(
        { db: deps.db, partners: deps.partners },
        {
          clientId,
          clientSecret,
          code: parsed.data.code,
          redirectUri: parsed.data.redirect_uri,
          codeVerifier: parsed.data.code_verifier,
        },
      );
      log.info('api.partner.token', {
        requestId: c.get('requestId'),
        clientId,
        ok: exchanged.ok,
        ...(exchanged.ok ? { connectionId: exchanged.connection.id } : { reason: exchanged.reason }),
        ms: Date.now() - started,
      });
      if (!exchanged.ok) {
        return exchanged.reason === 'invalid_client'
          ? await badClient()
          : await refused(c.get('clientIp'), failure('INPUT_INVALID', exchanged.message));
      }
      const answer: PartnerTokenAnswer = {
        access_token: exchanged.token,
        token_type: 'Bearer',
        connection_id: exchanged.connection.id,
        connection: exchanged.connection,
      };
      return c.json(answer, 200, { 'cache-control': 'no-store', pragma: 'no-cache' });
    } catch (error) {
      return answerError(c, error);
    }
  });

  // Every route below needs a connection's access token.
  api.use('/partner/v1/connections/*', async (c, next) => {
    const started = Date.now();
    const unauthenticated = () =>
      refused(
        c.get('clientIp'),
        failure(
          'UNAUTHENTICATED',
          'Send the connection’s access token as Authorization: Bearer <token>.',
          {},
          { 'www-authenticate': 'Bearer' },
        ),
      );
    const token = bearerOf(c.req.header('authorization'));
    const parts = token === undefined ? undefined : parsePartnerAccessToken(token);
    if (token === undefined || parts === undefined) return unauthenticated();
    const perConnection = await deps.limiter.consumeRateLimit(`partner:connection:${parts.id}`, {
      window: 60,
      max: PARTNER_REQUESTS_A_MINUTE,
    });
    if (!perConnection.allowed) {
      return tooMany(perConnection.retryAfterSeconds, 'This connection made more than 120 requests this minute.');
    }
    const entry = await enterAsPartner({ db: deps.db }, token);
    if (entry === undefined) return unauthenticated();
    c.set('partner', entry);
    await next();
    deps.keepAlive(
      notePartnerCall({ db: deps.db }, entry).catch((error: unknown) => {
        log.warn('api.partner.touch_failed', { connectionId: entry.connectionId, ...errorFields(error) });
      }),
    );
    log.info('api.partner', {
      requestId: c.get('requestId'),
      partnerId: entry.partnerId,
      connectionId: entry.connectionId,
      workspaceId: entry.scope.workspaceId,
      method: c.req.method,
      // The route, ids left out.
      path: c.req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id'),
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  api.get('/partner/v1/connections/:id', async (c) => {
    try {
      const connection = await readPartnerConnection(c.get('partner').scope, { connectionId: c.req.param('id') });
      return c.json(connection, 200, { 'cache-control': 'no-store' });
    } catch (error) {
      return answerError(c, error);
    }
  });
}

/**
 * A partner's logo from our own origin (AC-7012): only its current version (`?v=`), else 404 without a body, so a
 * replaced logo is a new address. Served as an image only, never sniffed, and to nothing but our own pages.
 */
export async function partnerLogoResponse(
  deps: {
    readonly partnerLogo: IdentityStore['partnerLogo'];
    readonly limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  },
  request: { readonly clientId: string; readonly version: string | undefined; readonly address: string | undefined },
): Promise<Response> {
  const missing = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const { clientId, version } = request;
  if (!PARTNER_CLIENT_ID.test(clientId) || version === undefined || !/^\d{1,9}$/.test(version)) return missing();
  // 120 a minute per address: a miss reads no bytes (the version is compared in SQL), and a loop is still capped.
  const counted = await deps.limiter.consumeRateLimit(`partner:logo:${request.address ?? 'unknown'}`, {
    window: 60,
    max: 120,
  });
  if (!counted.allowed) {
    return new Response(null, { status: 429, headers: { 'retry-after': String(counted.retryAfterSeconds ?? 60) } });
  }
  const logo = await deps.partnerLogo(clientId, Number(version));
  if (logo === undefined) return missing();
  return new Response(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      'content-type': logo.type,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'cross-origin-resource-policy': 'same-origin',
    },
  });
}
