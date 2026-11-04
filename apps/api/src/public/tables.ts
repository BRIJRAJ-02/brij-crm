// Table seating's public endpoints (spec 0066 B7 lite; spec 0065 AC-6550 to AC-6557), outside the RPC router: no
// session, only a place's public key. Each request enters through core's table door (`enterTablePage`), which gives
// the place's narrow `booking` actor write on People and Companies of that one workspace and nothing else. Same origin
// only (a write's Origin is checked by the app: the booking origin may write here), rate limited per client address
// and per place like the booking pages, and a reservation passes the same bot checks.
//
//   GET  /api/public/tables/:key                       the page's facts
//   GET  /api/public/tables/:key/times                 ?party&date: the offered starts of one place date
//   POST /api/public/tables/:key/reserve               a guest's reservation, answering the manage token once
//   POST /api/public/tables/:key/visit                 { guest }: the reservation, by token or by code with email
//   POST /api/public/tables/:key/change                { guest, start, party? }: a new time or party size
//   POST /api/public/tables/:key/cancel                { guest, reason? }
//   POST /api/public/tables/:key/ics                   { guest }: the reservation as a calendar file (Add to calendar)
//
// The guest's key (token, or code and email) always travels in a POST body, never a URL, so no log or history keeps
// it. A lookup by code is limited tighter than a read, per address and per place, so codes can't be swept; a change
// or cancel by code spends its own bucket, so looking a reservation up never uses up the guest's change.
import { createHash } from 'node:crypto';
import {
  errorStatus,
  GuestKey,
  PublicReserveInput,
  PublicTableCancelInput,
  PublicTableChangeInput,
  PublicTableTimesQuery,
  type ErrorCode,
} from '@crm/contracts';
import { outboxHook, type BusyReader, type ManageLinkKey, type SlotCache } from '@crm/core';
import {
  enterTablePage,
  guestCancel,
  guestChange,
  guestIcs,
  guestReserve,
  guestTimes,
  guestVisit,
  readTablePage,
  TABLE_KEY_PATTERN,
  type GuestKey as CoreGuestKey,
} from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { inputProblems, toApiError, type SchemaIssue } from '../errors.ts';
import { errorFields, log } from '../log.ts';
import { BOOKING_LIMITS, botReason, type LimitRule, type PublicLimiter } from './limits.ts';

/** The table routes' own limits, beside the booking pages' (AC-6557). */
export const TABLE_LIMITS = {
  readsPerAddress: BOOKING_LIMITS.readsPerAddress,
  readsPerPlace: { max: 600, windowMs: 60_000 },
  reservesPerAddress: BOOKING_LIMITS.booksPerAddress,
  reservesPerPlace: BOOKING_LIMITS.booksPerPage,
  managePerAddress: BOOKING_LIMITS.managePerAddress,
  /** A lookup by code and email: 10 a minute per address, 60 per place, so codes can't be swept. */
  lookupsPerAddress: { max: 10, windowMs: 60_000 },
  lookupsPerPlace: { max: 60, windowMs: 60_000 },
  /** A change or cancel by code and email: its own bucket, as tight, apart from the lookups. */
  codeWritesPerAddress: { max: 10, windowMs: 60_000 },
  codeWritesPerPlace: { max: 60, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

const BODY_LIMIT_BYTES = 16 * 1024;
const BOT_REFUSED = 'We couldn’t take that reservation. Check your details and try again.';

/** What the table routes need. */
export interface PublicTableServices {
  readonly db: Database;
  readonly busy: BusyReader & { readonly fresh?: BusyReader };
  readonly slotCache: SlotCache;
  /** The key manage tokens derive from (the booking pages' and the worker's), so emails write the same link. */
  readonly linkKey: ManageLinkKey;
  readonly limiter: PublicLimiter;
  readonly now?: () => Date;
  /** The calendar file's facts: the UID's domain, the public origin and the sending address. */
  readonly ics: { readonly uidDomain: string; readonly publicOrigin: string; readonly organizerEmail: string };
  /** Pokes the relay after a committed write, so open Service lists hear the `visits` event. */
  readonly wakeRelay: () => void;
}

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

function answer(
  code: ErrorCode,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
) {
  return Response.json(
    { code, message, ...extra },
    { status: errorStatus(code), headers: { 'cache-control': 'no-store', ...headers } },
  );
}

function ok(body: unknown): Response {
  return Response.json(body, { headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
}

/** A refusal as its code and sentence (a SLOT_TAKEN carries the next free times); anything else rethrown. */
function refusalAnswer(error: unknown): Response {
  const mapped = toApiError(error);
  if (!mapped.expected) throw error;
  const { code, message, data } = mapped.error;
  const next = (error as { next?: unknown }).next;
  return answer(code, message, {
    ...(data === undefined ? {} : { data }),
    ...(Array.isArray(next) ? { next } : {}),
  });
}

function addressKey(clientIp: string | undefined): string {
  return createHash('sha256')
    .update(clientIp ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}

const invalid = (issues: readonly SchemaIssue[]) => {
  const { message, issues: listed } = inputProblems(issues, { limit: 10, leadWithField: true });
  return answer('INPUT_INVALID', message, { data: { issues: listed } });
};

const missing = () => answer('NOT_FOUND', 'This page is no longer available.');

/** Mounts the table routes on the app (its base path is `/api`). */
export function mountPublicTables(app: Hono<{ Variables: Variables }>, services: PublicTableServices): void {
  const { db, limiter } = services;
  const deps = {
    busy: services.busy,
    slotCache: services.slotCache,
    linkKey: services.linkKey,
    ...(services.now === undefined ? {} : { now: services.now }),
    log,
  };

  const limited = (checks: readonly (readonly [string, LimitRule])[]): Response | undefined => {
    for (const [key, rule] of checks) {
      const decision = limiter(key, rule);
      if (!decision.allowed) {
        return answer(
          'RATE_LIMITED',
          'Too many requests. Wait a moment and try again.',
          {},
          { 'retry-after': String(decision.retryAfterSeconds) },
        );
      }
    }
    return undefined;
  };

  const jsonOf = async (c: Context<{ Variables: Variables }>): Promise<{ readonly body: unknown } | undefined> => {
    try {
      return { body: await c.req.json() };
    } catch {
      return undefined;
    }
  };

  /**
   * The limits a guest key spends: by code, tighter, per address and per place, a read (`lookup`) and a change or
   * cancel (`write`) each in their own bucket.
   */
  const guestLimits = (
    c: Context<{ Variables: Variables }>,
    key: string,
    guest: CoreGuestKey,
    use: 'lookup' | 'write' = 'lookup',
  ) => {
    const address = addressKey(c.get('clientIp'));
    const byCode =
      use === 'lookup'
        ? ([
            [`tables:lookup:${address}`, TABLE_LIMITS.lookupsPerAddress],
            [`tables:lookup-place:${key}`, TABLE_LIMITS.lookupsPerPlace],
          ] as const)
        : ([
            [`tables:code-write:${address}`, TABLE_LIMITS.codeWritesPerAddress],
            [`tables:code-write-place:${key}`, TABLE_LIMITS.codeWritesPerPlace],
          ] as const);
    return limited([[`tables:manage:${address}`, TABLE_LIMITS.managePerAddress], ...('code' in guest ? byCode : [])]);
  };

  app.use(
    '/public/tables/:key/*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => answer('PAYLOAD_TOO_LARGE', 'This request is larger than a reservation needs.'),
    }),
  );

  app.get('/public/tables/:key', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const refused = limited([
      [`tables:read:${addressKey(c.get('clientIp'))}`, TABLE_LIMITS.readsPerAddress],
      [`tables:read-place:${key}`, TABLE_LIMITS.readsPerPlace],
    ]);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterTablePage({ db }, key);
      return ok(await readTablePage(entry, deps));
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.get('/public/tables/:key/times', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const refused = limited([
      [`tables:read:${addressKey(c.get('clientIp'))}`, TABLE_LIMITS.readsPerAddress],
      [`tables:read-place:${key}`, TABLE_LIMITS.readsPerPlace],
    ]);
    if (refused !== undefined) return refused;
    const query = PublicTableTimesQuery.safeParse(c.req.query());
    if (!query.success) return invalid(query.error.issues);
    try {
      const entry = await enterTablePage({ db }, key);
      const times = await guestTimes(entry, deps, query.data);
      return ok({ date: query.data.date, times });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/tables/:key/reserve', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const refused = limited([
      [`tables:reserve:${addressKey(c.get('clientIp'))}`, TABLE_LIMITS.reservesPerAddress],
      [`tables:reserve-place:${key}`, TABLE_LIMITS.reservesPerPlace],
    ]);
    if (refused !== undefined) return refused;
    const read = await jsonOf(c);
    if (read === undefined) return answer('INPUT_INVALID', 'The request could not be read.');
    const input = PublicReserveInput.safeParse(read.body);
    if (!input.success) return invalid(input.error.issues);
    const bot = botReason(input.data, (services.now?.() ?? new Date()).getTime());
    if (bot !== undefined) {
      log.warn('tables.bot_refused', { requestId: c.get('requestId'), reason: bot });
      return answer('INPUT_INVALID', BOT_REFUSED);
    }
    try {
      const entry = await enterTablePage({ db }, key);
      const made = await guestReserve(entry, deps, input.data, [outboxHook()]);
      if (!made.booked.replayed) services.wakeRelay();
      return ok({ visit: made.visit, ...(made.manageToken === undefined ? {} : { manageToken: made.manageToken }) });
    } catch (error) {
      if (!toApiError(error).expected) {
        log.error('tables.reserve_failed', { requestId: c.get('requestId'), ...errorFields(error) });
      }
      return refusalAnswer(error);
    }
  });

  app.post('/public/tables/:key/visit', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const read = await jsonOf(c);
    const parsed = GuestKey.safeParse((read?.body as { guest?: unknown } | undefined)?.guest);
    if (!parsed.success) return invalid(parsed.error.issues);
    const refused = guestLimits(c, key, parsed.data);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterTablePage({ db }, key);
      return ok({ visit: await guestVisit(entry, parsed.data, deps) });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/tables/:key/change', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const read = await jsonOf(c);
    const input = PublicTableChangeInput.safeParse(read?.body);
    if (!input.success) return invalid(input.error.issues);
    const refused = guestLimits(c, key, input.data.guest, 'write');
    if (refused !== undefined) return refused;
    try {
      const entry = await enterTablePage({ db }, key);
      const changed = await guestChange(entry, deps, input.data, [outboxHook()]);
      services.wakeRelay();
      return ok({ visit: changed.visit });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/tables/:key/cancel', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const read = await jsonOf(c);
    const input = PublicTableCancelInput.safeParse(read?.body);
    if (!input.success) return invalid(input.error.issues);
    const refused = guestLimits(c, key, input.data.guest, 'write');
    if (refused !== undefined) return refused;
    try {
      const entry = await enterTablePage({ db }, key);
      const done = await guestCancel(entry, deps, input.data, [outboxHook()]);
      if (done.cancelled) services.wakeRelay();
      return ok({ visit: done.visit });
    } catch (error) {
      return refusalAnswer(error);
    }
  });

  app.post('/public/tables/:key/ics', async (c) => {
    const key = c.req.param('key');
    if (!TABLE_KEY_PATTERN.test(key)) return missing();
    const read = await jsonOf(c);
    const parsed = GuestKey.safeParse((read?.body as { guest?: unknown } | undefined)?.guest);
    if (!parsed.success) return invalid(parsed.error.issues);
    const refused = guestLimits(c, key, parsed.data);
    if (refused !== undefined) return refused;
    try {
      const entry = await enterTablePage({ db }, key);
      const body = await guestIcs(
        entry,
        parsed.data,
        {
          uidDomain: services.ics.uidDomain,
          pageUrl: `${services.ics.publicOrigin}/r/${key}/manage`,
          organizerEmail: services.ics.organizerEmail,
        },
        deps,
      );
      return new Response(body, {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'attachment; filename="reservation.ics"',
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return refusalAnswer(error);
    }
  });
}
