// The public API (parity #34, the first slice): `/api/v1`, records of any object over plain REST, for a workspace's
// API keys. A thin layer: each route parses its input with a shared schema (`@crm/contracts`, `Public*`), lets the key in through
// the access door (`enterWithKey`: the key's scope, capped by its creator as they stand now) and calls the same
// `@crm/core` service the app's RPC calls with that scope, so a key reads and writes exactly what the door allows and
// nothing else. A write goes through `commitCounted`, so its outbox rows, value history (actor `api_key`) and the
// relay's poke are the app's own.
//
// Only `Authorization: Bearer <key>` is read, never a cookie, so the Origin check on writes (CSRF's defence for a
// cookie) doesn't apply here, and `app.ts` lets `/api/v1/` past it. Every refusal to let a key in is the same 401.
// Each client address makes at most 600 requests a minute and each key 120, through the central limiter
// (shared across instances), before any key is looked up; a refused key counts against its address (30 in 10 minutes).
// List reads take places in a read gate of the API's own (2 per workspace), never the app's. One log
// line per request names the key, the route and the status, never the key itself.
import { randomUUID } from 'node:crypto';
import {
  API_KEY_REQUESTS_A_MINUTE,
  API_ADDRESS_REQUESTS_A_MINUTE,
  type ErrorCode,
  errorStatus,
  PublicCreateRecordBody,
  PublicListRecordsQuery,
  PublicUpdateRecordBody,
} from '@crm/contracts';
import {
  addRecord,
  deleteRecords,
  editRecord,
  enterWithKey,
  listAttributes,
  listObjects,
  newId,
  noteKeyUse,
  parseKeyToken,
  queryRecords,
  readRecordsById,
  type KeyEntry,
  type RuleSource,
} from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { ORPCError } from '@orpc/server';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type * as z from 'zod';
import { inputProblems, toApiError } from '../errors.ts';
import type { ReadGate } from '../gate.ts';
import { commitCounted } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import type { Analytics } from '../monitoring/posthog.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import { publicApiDocument } from './openapi.ts';

/** Refused keys an address may send in 10 minutes before it is refused outright (a mistyped key, not a search). */
const REFUSED_RULE = { window: 600, max: 30 } as const;
const TOO_MANY_REFUSED = 'Too many refused keys from this address. Wait a few minutes and try again.';
const TOO_MANY_KEY = 'This key made more than 120 requests this minute. Wait a moment and try again.';
const TOO_MANY_ADDRESS = 'This address made more than 600 requests this minute. Wait a moment and try again.';

/** Where the public API lives, under the app's `/api`. */
export const V1_PREFIX = '/api/v1/';

/** The largest body a v1 request may carry. */
const V1_BODY_LIMIT_BYTES = 1024 * 1024;

/** What the public API needs from the app. */
export interface PublicApiDeps {
  readonly db: Database;
  readonly rules: RuleSource;
  /** The central limiter's one call. */
  readonly limiter: Pick<IdentityStore, 'consumeRateLimit'>;
  /** The public API's own read gate: a script's reads never take the places the app's people read with. */
  readonly readGate: ReadGate;
  readonly wakeRelay: WakeRelay;
  readonly analytics: Analytics;
  readonly keepAlive: (work: Promise<unknown>) => void;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  key: KeyEntry;
}

/** A `{ code, message, data? }` answer (the app's `ApiError`) at the code's status; `data` holds issues or refusals. */
function failure(
  code: ErrorCode,
  message: string,
  data: Record<string, unknown> = {},
  headers?: Record<string, string>,
) {
  const body = Object.keys(data).length === 0 ? { code, message } : { code, message, data };
  return Response.json(body, { status: errorStatus(code), ...(headers ? { headers } : {}) });
}

/** Any error a service threw, as the app's RPC would word it; anything unexpected is logged and reported. */
function answerError(c: Context<{ Variables: Variables }>, error: unknown): Response {
  if (error instanceof ORPCError) {
    const code = error.code as ErrorCode;
    const data: unknown = error.data;
    return failure(code, error.message, typeof data === 'object' && data !== null ? { ...data } : {});
  }
  const mapped = toApiError(error);
  if (!mapped.expected) {
    log.error('api.v1.failed', { requestId: c.get('requestId'), ...errorFields(error) });
    captureFault(error, { requestId: c.get('requestId'), route: 'api v1' });
  }
  const data = mapped.error.data;
  return failure(mapped.error.code, mapped.error.message, data === undefined ? {} : { ...data });
}

/** Bad input, worded as the RPC words it. */
function badInput(issues: readonly z.core.$ZodIssue[]): Response {
  const { message, issues: fields } = inputProblems(issues);
  return failure('INPUT_INVALID', message, { issues: fields });
}

/** The key from `Authorization: Bearer <key>`, or undefined. */
export function bearerOf(header: string | undefined): string | undefined {
  // The scheme's name is case insensitive (RFC 7235).
  const match = /^bearer ([A-Za-z0-9_-]{1,200})$/i.exec(header?.trim() ?? '');
  return match?.[1];
}

/** The object a path names, by id or API slug, among those the key may see; undefined answers as unknown. */
async function objectOf(scope: KeyEntry['scope'], named: string): Promise<string | undefined> {
  const objects = await listObjects(scope);
  return objects.find((object) => object.id === named || object.apiSlug === named)?.id;
}

const UNKNOWN_OBJECT = (): Response => failure('NOT_FOUND', 'That object does not exist.');
const UNKNOWN_RECORD = (): Response => failure('NOT_FOUND', 'That record does not exist.');

/** Reads a JSON body, or undefined when it isn't JSON. */
async function jsonOf(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Mounts `/api/v1` on the app (its base path is `/api`). */
export function mountPublicApi(
  app: Hono<{ Variables: { requestId: string; clientIp: string | undefined; origin: string | undefined } }>,
  deps: PublicApiDeps,
): void {
  const v1 = app as unknown as Hono<{ Variables: Variables }>;
  // Built once per app, the first time it is asked for.
  let document: unknown;

  v1.get('/v1/openapi.json', (c) => {
    document ??= publicApiDocument();
    return c.json(document, 200, { 'cache-control': 'public, max-age=300' });
  });

  v1.use(
    '/v1/*',
    bodyLimit({
      maxSize: V1_BODY_LIMIT_BYTES,
      onError: () => failure('PAYLOAD_TOO_LARGE', 'This request is larger than the 1 MB the API accepts.'),
    }),
  );

  const unauthenticated = () =>
    failure(
      'UNAUTHENTICATED',
      'Send a live API key as Authorization: Bearer <key>.',
      {},
      {
        'www-authenticate': 'Bearer',
      },
    );
  const tooMany = (wait: number | undefined, message: string) =>
    failure('TOO_MANY_REQUESTS', message, {}, { 'retry-after': String(wait ?? 60) });

  // The limits, the key, then the route; one log line per request. Every limit is spent before the database is: a
  // key's own count by the id its public half names (parsed, no query), and a refused key also counts against its
  // address, so guessing keys costs the guesser, not the database.
  v1.use('/v1/*', async (c, next) => {
    if (c.req.path === `${V1_PREFIX}openapi.json`) return next();
    const started = Date.now();
    const address = c.get('clientIp') ?? 'unknown';
    /** A refused key: counted against its address; past `REFUSED_RULE` the address hears 429 instead. */
    const refused = async () => {
      const counted = await deps.limiter.consumeRateLimit(`api:refused:${address}`, REFUSED_RULE);
      return counted.allowed ? unauthenticated() : tooMany(counted.retryAfterSeconds, TOO_MANY_REFUSED);
    };
    const token = bearerOf(c.req.header('authorization'));
    const parts = token === undefined ? undefined : parseKeyToken(token);
    if (token === undefined || parts === undefined) return refused();
    // Before any lookup: the address's own count (so made up key ids can't each cost a query unbounded), then the
    // key's, by the id its public half names.
    const perAddress = await deps.limiter.consumeRateLimit(`api:address:${address}`, {
      window: 60,
      max: API_ADDRESS_REQUESTS_A_MINUTE,
    });
    if (!perAddress.allowed) return tooMany(perAddress.retryAfterSeconds, TOO_MANY_ADDRESS);
    const perKey = await deps.limiter.consumeRateLimit(`api:key:${parts.keyId}`, {
      window: 60,
      max: API_KEY_REQUESTS_A_MINUTE,
    });
    if (!perKey.allowed) return tooMany(perKey.retryAfterSeconds, TOO_MANY_KEY);
    const entry = await enterWithKey({ db: deps.db, rules: deps.rules, log }, token);
    if (entry === undefined) return refused();
    const workspaceId = entry.scope.workspaceId;
    c.set('key', entry);
    await next();
    deps.keepAlive(
      noteKeyUse({ db: deps.db }, entry).catch((error: unknown) => {
        log.warn('api.v1.touch_failed', { keyId: entry.keyId, ...errorFields(error) });
      }),
    );
    log.info('api.v1', {
      requestId: c.get('requestId'),
      keyId: entry.keyId,
      workspaceId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  /** A write's request: the relay's poke and no milestone (no person made it). */
  const writer = { wakeRelay: deps.wakeRelay, analytics: deps.analytics };

  v1.get('/v1/objects', async (c) => {
    try {
      const objects = await listObjects(c.get('key').scope);
      return c.json({ objects });
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.get('/v1/objects/:object/attributes', async (c) => {
    const { scope } = c.get('key');
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      return c.json({ attributes: await listAttributes(scope, objectId) });
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.get('/v1/objects/:object/records', async (c) => {
    const { scope } = c.get('key');
    const query = PublicListRecordsQuery.safeParse(c.req.query());
    if (!query.success) return badInput(query.error.issues);
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      const page = await deps.readGate.run(scope.workspaceId, () =>
        queryRecords(
          scope,
          {
            objectId,
            limit: query.data.limit ?? 50,
            ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
          },
          c.req.raw.signal,
        ),
      );
      return c.json({
        records: page.records,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      });
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.get('/v1/objects/:object/records/:id', async (c) => {
    const { scope } = c.get('key');
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      const [record] = await readRecordsById(scope, [c.req.param('id')]);
      if (record?.objectId !== objectId) return UNKNOWN_RECORD();
      return c.json(record);
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.post('/v1/objects/:object/records', async (c) => {
    const { scope } = c.get('key');
    const body = PublicCreateRecordBody.safeParse(await jsonOf(c));
    if (!body.success) return badInput(body.error.issues);
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      // The caller's id is its retry key: the same create again answers the record already made.
      const id = body.data.id ?? newId();
      const { result } = await commitCounted(writer, { mutationId: randomUUID() }, (hooks) =>
        addRecord(
          scope,
          {
            objectId,
            id,
            ...(body.data.values === undefined ? {} : { values: body.data.values }),
            ...(body.data.timeZone === undefined ? {} : { timeZone: body.data.timeZone }),
          },
          hooks,
        ),
      );
      return c.json(result.record, 201);
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.patch('/v1/objects/:object/records/:id', async (c) => {
    const { scope } = c.get('key');
    const body = PublicUpdateRecordBody.safeParse(await jsonOf(c));
    if (!body.success) return badInput(body.error.issues);
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      const [found] = await readRecordsById(scope, [c.req.param('id')]);
      if (found?.objectId !== objectId) return UNKNOWN_RECORD();
      const values = Object.fromEntries(Object.entries(body.data.values).map(([id, value]) => [id, { value }]));
      const { result } = await commitCounted(writer, { mutationId: randomUUID() }, (hooks) =>
        editRecord(
          scope,
          {
            recordId: found.id,
            values,
            ...(body.data.timeZone === undefined ? {} : { timeZone: body.data.timeZone }),
          },
          hooks,
        ),
      );
      return c.json(result.record);
    } catch (error) {
      return answerError(c, error);
    }
  });

  v1.delete('/v1/objects/:object/records/:id', async (c) => {
    const { scope } = c.get('key');
    try {
      const objectId = await objectOf(scope, c.req.param('object'));
      if (objectId === undefined) return UNKNOWN_OBJECT();
      const { result } = await commitCounted(writer, { mutationId: randomUUID() }, (hooks) =>
        deleteRecords(scope, { objectId, recordIds: [c.req.param('id')], batchId: newId() }, hooks),
      );
      const [outcome] = result;
      if (outcome?.state === 'refused') {
        const refusal = outcome.refusal;
        return failure(refusal?.code ?? 'NOT_FOUND', refusal?.message ?? 'That record does not exist.');
      }
      return c.json({ id: c.req.param('id'), deleted: true });
    } catch (error) {
      return answerError(c, error);
    }
  });
}
