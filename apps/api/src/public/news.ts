// Unsubscribing from a business's news and offers (10 November 2026, migration 0204; GDPR, CAN-SPAM, and the Gmail
// and Yahoo bulk sender rules), outside the RPC router: no session, only an unsubscribe link's signed token
// (`readNewsUnsubscribeToken`), which names the workspace, the place that sent it, the Person, the purpose and a hash
// of the address. The door (`enterNewsPlace`) enters the place's reservation page as its own key would.
//
//   POST /api/public/news/unsubscribe?t=<token>   RFC 8058's one click (a mail service posts `List-Unsubscribe=One-Click`
//                                                 with no Origin, which app.ts lets through for this one path), or the
//                                                 page's press with `{ token }` in the body: the consent withdrawn
//   GET  /api/public/news/unsubscribe?t=<token>   the same address opened in a browser: a 303 to the place's page,
//                                                 which asks first, since link scanners fetch addresses too
//   POST /api/public/news/subscribe               `{ token }`: subscribe again, by the double opt-in's email, never a grant
//
// Every answer is the same whether or not anything changed (`unsubscribed`, `check_email`), so a link never says
// whether its address is on a list; only a token that is not ours answers NOT_FOUND. Limits are durable (the identity
// store's `rate_limit` rows, across serverless instances) behind the memory gate: a mail service posts every
// reader's one click from a few addresses, so a good token counts against its Person and purpose, and only a token
// that opens nothing counts against the client address, as the member one click does. Durable keys are HMACs, never
// an address. Logs name the request, the workspace and the outcome, never the token, the Person or an address.
import { createHash, createHmac } from 'node:crypto';
import { errorStatus, PublicNewsUnsubscribeInput, type ErrorCode } from '@crm/contracts';
import type { ManageLinkKey } from '@crm/core';
import {
  enterNewsPlace,
  NEWS_UNSUBSCRIBE_PATH,
  newsUnsubscribePagePath,
  readNewsUnsubscribeToken,
  resubscribeNews,
  withdrawNews,
  type NewsUnsubscribeLink,
} from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { toApiError } from '../errors.ts';
import { log } from '../log.ts';
import { limitAddress, type LimitRule, type PublicLimiter } from './limits.ts';
import type { DurableLimiter } from './tables.ts';

/** What the routes read from the request: its id and the client address the edge guard trusted. */
interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** The one click's path, under the app's `/api` base path: app.ts lets its POST through with no Origin. */
export { NEWS_UNSUBSCRIBE_PATH };

/** Subscribe again's path: from the place's page, on the booking origin or the app's. */
export const NEWS_SUBSCRIBE_PATH = '/api/public/news/subscribe';

/** The routes' limits. */
export const NEWS_LIMITS = {
  /** Tokens that open nothing, per client address: a person mistyping, never a sweep of forged tokens. */
  refusedPerAddress: { max: 30, windowMs: 60_000 },
  /** One Person's unsubscribes: a mail service's retries and a press or two, never a loop. */
  unsubscribesPerPerson: { max: 5, windowMs: 60_000 },
  /** Subscribe again, per client address. */
  subscribesPerAddress: { max: 10, windowMs: 60_000 },
  /** Subscribe again, per Person: each sends an email, so 3 a day; one withdrawal asks once anyway. */
  subscribesPerPerson: { max: 3, windowMs: 86_400_000 },
  /** A browser opening the one click's address, per client address. */
  opensPerAddress: { max: 30, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/** What the routes need. */
export interface PublicNewsServices {
  readonly db: Database;
  /** The reservation link key, which unsubscribe tokens derive their own key from (the worker signs with the same). */
  readonly linkKey: ManageLinkKey;
  readonly limiter: PublicLimiter;
  readonly durable: DurableLimiter;
  readonly now?: () => Date;
}

const answer = (code: ErrorCode, message: string, headers: Readonly<Record<string, string>> = {}): Response =>
  Response.json({ code, message }, { status: errorStatus(code), headers: { 'cache-control': 'no-store', ...headers } });

const ok = (body: unknown): Response =>
  Response.json(body, { headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });

const gone = () => answer('NOT_FOUND', 'This link no longer works.');

const tooMany = (retryAfterSeconds: number | undefined) =>
  answer('RATE_LIMITED', 'Too many requests. Wait a moment and try again.', {
    'retry-after': String(retryAfterSeconds ?? 60),
  });

/** A durable rule from a memory one: the identity store counts its windows in whole seconds. */
const durableRule = (rule: LimitRule) => ({ window: Math.max(1, Math.ceil(rule.windowMs / 1000)), max: rule.max });

/** Mounts the news unsubscribe routes on the app (its base path is `/api`). */
export function mountPublicNews(app: Hono<{ Variables: Variables }>, services: PublicNewsServices): void {
  const { db, limiter, durable, linkKey } = services;
  const now = () => services.now?.() ?? new Date();
  const limitKey = createHmac('sha256', linkKey).update('crm:news-limit').digest();
  const sealed = (text: string): string => createHmac('sha256', limitKey).update(text).digest('base64url').slice(0, 22);
  const hashed = (text: string): string => createHash('sha256').update(text).digest('base64url').slice(0, 22);
  const addressOf = (c: Context<{ Variables: Variables }>) => limitAddress(c.get('clientIp')) ?? 'unknown';
  const personOf = (link: NewsUnsubscribeLink) => `${link.workspaceId}:${link.recordId}:${link.purpose}`;

  /** Spends a window in memory, then durably: its 429, or nothing. */
  const spend = async (name: string, part: string, rule: LimitRule): Promise<Response | undefined> => {
    const memory = limiter(`news:${name}:${hashed(part)}`, rule);
    if (!memory.allowed) return tooMany(memory.retryAfterSeconds);
    const lasting = await durable.consumeRateLimit(`public-news:${name}:${sealed(part)}`, durableRule(rule));
    return lasting.allowed ? undefined : tooMany(lasting.retryAfterSeconds);
  };

  /** The token's link, or the refusal: a bad token counts against the address, a good one against its Person. */
  const linkOf = async (
    c: Context<{ Variables: Variables }>,
    token: string | undefined,
    personRule: LimitRule,
    name: string,
  ): Promise<{ readonly link: NewsUnsubscribeLink } | { readonly refused: Response }> => {
    const link = readNewsUnsubscribeToken(linkKey, token, now());
    if (link === undefined) {
      return { refused: (await spend('refused', addressOf(c), NEWS_LIMITS.refusedPerAddress)) ?? gone() };
    }
    const refused = await spend(name, personOf(link), personRule);
    return refused === undefined ? { link } : { refused };
  };

  /** The token from the query (the one click) or a JSON body (the page); a form body carries none. */
  const tokenOf = async (c: Context<{ Variables: Variables }>): Promise<string | undefined> => {
    const query = c.req.query('t');
    if (query !== undefined) return query;
    if (!(c.req.header('content-type') ?? '').includes('application/json')) return undefined;
    const parsed = PublicNewsUnsubscribeInput.safeParse(await c.req.json().catch(() => undefined));
    return parsed.success ? parsed.data.token : undefined;
  };

  /** The link's place entered, or the refusal (the place or its workspace gone: one NOT_FOUND). */
  const enter = async (link: NewsUnsubscribeLink) => {
    try {
      return { entry: await enterNewsPlace({ db }, link) };
    } catch (error) {
      const mapped = toApiError(error);
      if (!mapped.expected) throw error;
      return { refused: gone() };
    }
  };

  app.post('/public/news/unsubscribe', bodyLimit({ maxSize: 4_096 }), async (c) => {
    const read = await linkOf(c, await tokenOf(c), NEWS_LIMITS.unsubscribesPerPerson, 'unsubscribe');
    if ('refused' in read) return read.refused;
    const entered = await enter(read.link);
    // A workspace since deleted emails nobody: a signed link is told it's done, as every other one is.
    if ('refused' in entered) return ok({ status: 'unsubscribed' });
    const outcome = await withdrawNews(entered.entry, read.link);
    log.info('news.unsubscribed', { requestId: c.get('requestId'), workspaceId: read.link.workspaceId, outcome });
    return ok({ status: 'unsubscribed' });
  });

  // A browser (some mail apps open the address instead of posting): to the place's page, which asks first. A GET
  // never changes anything, since link scanners fetch addresses too.
  app.get('/public/news/unsubscribe', async (c) => {
    const refused = await spend('open', addressOf(c), NEWS_LIMITS.opensPerAddress);
    if (refused !== undefined) return refused;
    const token = c.req.query('t');
    const link = readNewsUnsubscribeToken(linkKey, token, now());
    if (link === undefined || token === undefined) return gone();
    const entered = await enter(link);
    // A place gone has no page to ask on; its one click still works.
    if ('refused' in entered || entered.entry.key === '') return gone();
    return c.body(null, 303, {
      location: newsUnsubscribePagePath(entered.entry.key, token),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
  });

  app.post('/public/news/subscribe', bodyLimit({ maxSize: 4_096 }), async (c) => {
    const refused = await spend('subscribe-address', addressOf(c), NEWS_LIMITS.subscribesPerAddress);
    if (refused !== undefined) return refused;
    const parsed = PublicNewsUnsubscribeInput.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return gone();
    const read = await linkOf(c, parsed.data.token, NEWS_LIMITS.subscribesPerPerson, 'subscribe');
    if ('refused' in read) return read.refused;
    const entered = await enter(read.link);
    if ('refused' in entered) return entered.refused;
    const outcome = await resubscribeNews(entered.entry, { linkKey }, read.link);
    log.info('news.resubscribe', { requestId: c.get('requestId'), workspaceId: read.link.workspaceId, outcome });
    return ok({ status: 'check_email' });
  });
}
