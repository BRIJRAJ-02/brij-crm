// The partner API (spec 0070, slice 2): `/api/partner/v1`, for a partner's server only.
//
// - `POST /api/partner/v1/token`: the OAuth token exchange (AC-7011). The client id and secret come as HTTP Basic or in
//   the body; the body is form encoded or JSON with OAuth's field names. It answers the connection and its access
//   token, once, with `cache-control: no-store`.
// - `GET /api/partner/v1/connections/{id}`: a connection's read of itself, with `Authorization: Bearer <token>`.
// - `PUT`, `DELETE /connections/{id}/members/{externalId}` and `GET /connections/{id}/members` (slice 3): the
//   connection's managed members, added or updated (201 when added, 200 when it already was), removed (204, again
//   safe) and listed.
// - `POST /connections/{id}/launch` (slice 4, AC-7030): a one time address that opens one screen for one of the
//   partner's people in its frame, once, within 60 seconds. The code rides in the address's fragment, so no server log
//   or Referer ever holds it.
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
  PartnerExternalId,
  PartnerLaunchInput,
  PartnerMemberInput,
  PartnerTokenRequest,
  type PartnerLaunchAnswer,
  type PartnerTokenAnswer,
} from '@crm/contracts';
import {
  enterAsPartner,
  exchangePartnerCode,
  launchPartnerScreen,
  listPartnerMembers,
  notePartnerCall,
  parsePartnerAccessToken,
  putPartnerMember,
  readPartnerConnection,
  removePartnerMember,
  type ManagedUserEnder,
  type ManagedUserMaker,
  type PartnerEntry,
} from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { ORPCError } from '@orpc/server';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, randomUUID } from 'node:crypto';
import type * as z from 'zod';
import { inputProblems, toApiError } from '../errors.ts';
import { commitCounted } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import type { Analytics } from '../monitoring/posthog.ts';
import { captureFault } from '../monitoring/sentry.ts';
import type { WakeRelay } from '../realtime/wake.ts';
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
  /** The registry's reads: a partner and its secret's hash by client id, and a partner by id (a launch's address). */
  readonly partners: Pick<IdentityStore, 'partnerByClientId' | 'partnerById'>;
  /** The app's own address (`APP_URL`): a launch's address opens there. */
  readonly appUrl: string;
  /** The central limiter's one call. */
  readonly limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  /** Managed members' identities (slice 3): made, and their sessions ended and directory rows dropped on removal. */
  readonly users: ManagedUserMaker & ManagedUserEnder;
  readonly wakeRelay: WakeRelay;
  readonly analytics: Analytics;
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
      // The route, ids left out (an external id may be an address, so it never reaches a log).
      path: c.req.path
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
        .replace(/\/members\/[^/]+/, '/members/:externalId'),
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

  // Managed members (slice 3, AC-7020 to AC-7025). Each change writes its History row as the partner, and stores the
  // members' outbox rows through `commitCounted`, so every open tab of the workspace reads its people again.
  const writer = { wakeRelay: deps.wakeRelay, analytics: deps.analytics };
  const sourceOf = (c: Context<{ Variables: Variables }>) => ({
    requestId: c.get('requestId'),
    ...(c.get('clientIp') === undefined ? {} : { ip: c.get('clientIp') }),
  });
  /** The external id from the address, or a 400 naming it. */
  const externalIdOf = (c: Context<{ Variables: Variables }>) => {
    const parsed = PartnerExternalId.safeParse(c.req.param('externalId'));
    return parsed.success
      ? { ok: true as const, id: parsed.data }
      : { ok: false as const, answer: badInput(parsed.error.issues) };
  };

  api.get('/partner/v1/connections/:id/members', async (c) => {
    try {
      const list = await listPartnerMembers(c.get('partner').scope, { connectionId: c.req.param('id') });
      return c.json(list, 200, { 'cache-control': 'no-store' });
    } catch (error) {
      return answerError(c, error);
    }
  });

  api.put('/partner/v1/connections/:id/members/:externalId', async (c) => {
    const externalId = externalIdOf(c);
    if (!externalId.ok) return externalId.answer;
    const body = PartnerMemberInput.safeParse(await jsonOf(c));
    if (!body.success) return badInput(body.error.issues);
    try {
      const { result } = await commitCounted(writer, { mutationId: randomUUID() }, (hooks) =>
        putPartnerMember(
          c.get('partner').scope,
          { connectionId: c.req.param('id'), externalId: externalId.id, person: body.data },
          { users: deps.users },
          hooks,
          sourceOf(c),
        ),
      );
      return c.json(result.member, result.created ? 201 : 200, { 'cache-control': 'no-store' });
    } catch (error) {
      return answerError(c, error);
    }
  });

  // Embedded screens (slice 4, AC-7030): a one time address for one person and one screen. Nothing changes but the
  // launch's own row, so no outbox row and no History row.
  api.post('/partner/v1/connections/:id/launch', async (c) => {
    const body = PartnerLaunchInput.safeParse(await jsonOf(c));
    if (!body.success) return badInput(body.error.issues);
    try {
      const entry = c.get('partner');
      const partner = await deps.partners.partnerById(entry.partnerId);
      if (partner === undefined) return failure('NOT_FOUND', 'There is no such connection.');
      const launch = await launchPartnerScreen(entry.scope, { connectionId: c.req.param('id'), launch: body.data });
      const answer: PartnerLaunchAnswer = {
        url: launchAddress(deps.appUrl, partner.clientId, launch.code),
        expiresAt: launch.expiresAt.toISOString(),
      };
      return c.json(answer, 200, { 'cache-control': 'no-store', pragma: 'no-cache' });
    } catch (error) {
      return answerError(c, error);
    }
  });

  api.delete('/partner/v1/connections/:id/members/:externalId', async (c) => {
    const externalId = externalIdOf(c);
    if (!externalId.ok) return externalId.answer;
    try {
      await commitCounted(writer, { mutationId: randomUUID() }, (hooks) =>
        removePartnerMember(
          c.get('partner').scope,
          { connectionId: c.req.param('id'), externalId: externalId.id },
          { users: deps.users },
          hooks,
          sourceOf(c),
        ),
      );
      // Removed now or before: either way they are out (a DELETE is safe to send again).
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      return answerError(c, error);
    }
  });
}

/**
 * A launch's address (AC-7030): the frame's start page under the partner's client id, the one time code in the
 * fragment (never sent to a server, so no log or Referer keeps it).
 */
export function launchAddress(appUrl: string, clientId: string, code: string): string {
  const url = new URL(`/embed/${encodeURIComponent(clientId)}/start`, appUrl);
  url.hash = `code=${encodeURIComponent(code)}`;
  return url.href;
}

/** A JSON body, or undefined for anything that isn't JSON. */
async function jsonOf(c: Context): Promise<unknown> {
  if (!(c.req.header('content-type')?.toLowerCase() ?? '').startsWith('application/json')) return undefined;
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return undefined;
  }
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

/**
 * The origins a partner's frame may load our embedded screens in (AC-7032), for the edge's
 * `Content-Security-Policy: frame-ancestors` on `/embed/<clientId>/…`: public (the partner registered them to be
 * framed from), and the same for an unknown partner as for one with none, an empty list, so the edge sends
 * `frame-ancestors 'none'`. Cached a minute, so a change in the console reaches the edge within one.
 */
export async function partnerFrameResponse(
  deps: {
    readonly partners: Pick<IdentityStore, 'partnerByClientId'>;
    readonly limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  },
  request: { readonly clientId: string; readonly address: string | undefined },
): Promise<Response> {
  const answer = (frameOrigins: readonly string[]) =>
    Response.json(
      { frameOrigins },
      { headers: { 'cache-control': 'public, max-age=60, s-maxage=60', 'x-content-type-options': 'nosniff' } },
    );
  if (!PARTNER_CLIENT_ID.test(request.clientId)) return answer([]);
  const counted = await deps.limiter.consumeRateLimit(`partner:frame:${request.address ?? 'unknown'}`, {
    window: 60,
    max: 600,
  });
  if (!counted.allowed) {
    return new Response(null, { status: 429, headers: { 'retry-after': String(counted.retryAfterSeconds ?? 60) } });
  }
  const partner = await deps.partners.partnerByClientId(request.clientId);
  return answer(partner?.frameOrigins ?? []);
}
