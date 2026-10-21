// The email preferences endpoints (the emails lane), outside the RPC router:
// no session, only a signed token from an optional email, which names one
// member in one workspace and the topic of the email it came in. The door
// (`enterEmailLink`) turns it into that member's narrow scope, which reads
// and sets their own email preferences and nothing else.
//
// Two tokens, each signed for its own use. The page's ("Email preferences"
// in the footer) rides in the link's fragment (`/email-preferences#t=`),
// which no request, log or Referer holds, and the page sends it in a header;
// it reads and changes every topic, limited per client address. The one
// click's (RFC 8058's `List-Unsubscribe`) rides in the query, since the
// reader's mail service posts to the address as it is, with no Origin (the
// Origin check skips that one path) and no header of ours; so request logs
// hold it, and it can only turn its own topic off. A mail service posts
// every reader's one click from a few addresses, so that limit is per
// member and topic, and only a token that opens nothing counts against the
// address. Opened in a browser instead, the same address goes to the page,
// which asks before it posts: a GET never changes anything, since link
// scanners fetch it. Answers never name the member's address or anyone else.
//
//   GET  /api/public/email-preferences              x-crm-email-link: <page token>; every topic and the workspace's name
//   POST /api/public/email-preferences              the same header, { topic, subscribed }: one topic on or off
//   POST /api/public/email-preferences/unsubscribe?t=<one click token>  the link's topic off (or the token in the header)
//   GET  /api/public/email-preferences/unsubscribe?t=<one click token>  303 to the page, which asks first
import { createHash } from 'node:crypto';
import { errorStatus, type ErrorCode } from '@crm/contracts';
import { EmailPreferenceChange, type EmailUnsubscribed } from '@crm/contracts/emails';
import type { EmailLink, EmailLinkKey } from '@crm/core';
import { enterEmailLink, readEmailLinkToken, readEmailPreferences, setEmailPreference } from '@crm/core/public';
import type { Database } from '@crm/db';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { toApiError } from '../errors.ts';
import { log } from '../log.ts';
import type { LimitRule, PublicLimiter } from './limits.ts';

/** What the endpoints read from the request: its id and the client address the edge guard trusted. */
interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

/** The one click unsubscribe's route, under the app's `/api` base path. */
const UNSUBSCRIBE_ROUTE = '/public/email-preferences/unsubscribe';

/** The path the one click unsubscribe posts to: the Origin check lets it through without an Origin. */
export const EMAIL_UNSUBSCRIBE_PATH = `/api${UNSUBSCRIBE_ROUTE}`;

/** The header the page sends a link's token in (the one click's too, when the page asks first). */
export const EMAIL_LINK_HEADER = 'x-crm-email-link';

/** 30 reads or changes a minute per client address: a person clicking, never a crawler walking tokens. */
export const EMAIL_PREFERENCE_LIMIT: LimitRule = { max: 30, windowMs: 60_000 };

/** 5 one click unsubscribes a minute per member and topic: a mail service's retries, never a loop. */
export const EMAIL_UNSUBSCRIBE_LIMIT: LimitRule = { max: 5, windowMs: 60_000 };

/** What the endpoints need: the database, the key links are signed with, and the limiter. */
export interface EmailPreferenceServices {
  readonly db: Database;
  readonly linkKey: EmailLinkKey;
  readonly limiter: PublicLimiter;
  readonly now?: () => Date;
}

/** A JSON answer, never cached and never indexed: the page is one member's. */
function ok(body: unknown): Response {
  return Response.json(body, { headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
}

/** A refusal in the shared `{ code, message }` shape. */
function answer(code: ErrorCode, message: string, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(
    { code, message },
    { status: errorStatus(code), headers: { 'cache-control': 'no-store', ...headers } },
  );
}

/** The client address as a short hash: limits key on it, and no raw address is kept. */
function addressKey(clientIp: string | undefined): string {
  return createHash('sha256')
    .update(clientIp ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}

/** The page that asks before a one click's token posts, the token in the fragment (`u`, not the page's `t`). */
function confirmPageFor(token: string | undefined): string {
  return token === undefined || token === ''
    ? '/email-preferences'
    : `/email-preferences#${new URLSearchParams({ u: token }).toString()}`;
}

/** Mounts the email preferences endpoints on the app (its base path is `/api`). */
export function mountEmailPreferences(app: Hono<{ Variables: Variables }>, services: EmailPreferenceServices): void {
  const { db, linkKey, limiter } = services;
  const now = () => services.now?.() ?? new Date();
  const limited = (retryAfterSeconds: number) =>
    answer('RATE_LIMITED', 'Too many requests. Wait a moment and try again.', {
      'retry-after': String(retryAfterSeconds),
    });
  const gone = () => answer('NOT_FOUND', 'This link doesn’t open email preferences any more.');

  /** The link's member scope, or the refusal to answer (unknown, expired, or its member gone). */
  const open = async (link: EmailLink) => {
    try {
      return { scope: await enterEmailLink({ db }, link), link };
    } catch (error) {
      const mapped = toApiError(error);
      if (!mapped.expected) throw error;
      return { refused: answer(mapped.error.code, mapped.error.message) };
    }
  };

  /** The page's way in: limited per client address first, then the header's token. */
  const enterPage = async (clientIp: string | undefined, token: string | undefined) => {
    const decision = limiter(`email-preferences:${addressKey(clientIp)}`, EMAIL_PREFERENCE_LIMIT);
    if (!decision.allowed) return { refused: limited(decision.retryAfterSeconds) };
    const link = readEmailLinkToken(linkKey, token, now(), 'page');
    return link === undefined ? { refused: gone() } : open(link);
  };

  /** The one click's way in: the token first; a bad one counts against the address, a good one its member and topic. */
  const enterUnsubscribe = async (clientIp: string | undefined, token: string | undefined) => {
    const link = readEmailLinkToken(linkKey, token, now(), 'unsubscribe');
    const decision =
      link === undefined
        ? limiter(`email-unsubscribe-refused:${addressKey(clientIp)}`, EMAIL_PREFERENCE_LIMIT)
        : limiter(`email-unsubscribe:${link.workspaceId}:${link.memberId}:${link.topic}`, EMAIL_UNSUBSCRIBE_LIMIT);
    if (!decision.allowed) return { refused: limited(decision.retryAfterSeconds) };
    return link === undefined ? { refused: gone() } : open(link);
  };

  app.get('/public/email-preferences', async (c) => {
    const entered = await enterPage(c.get('clientIp'), c.req.header(EMAIL_LINK_HEADER));
    if ('refused' in entered) return entered.refused;
    return ok(await readEmailPreferences(entered.scope, entered.link.topic));
  });

  app.post('/public/email-preferences', bodyLimit({ maxSize: 4_096 }), async (c) => {
    const entered = await enterPage(c.get('clientIp'), c.req.header(EMAIL_LINK_HEADER));
    if ('refused' in entered) return entered.refused;
    const change = EmailPreferenceChange.safeParse(await c.req.json().catch(() => undefined));
    if (!change.success) return answer('INPUT_INVALID', 'Send a topic and whether it is on.');
    const view = await setEmailPreference(entered.scope, change.data, entered.link.topic);
    log.info('email.preference.set', {
      requestId: c.get('requestId'),
      workspaceId: entered.link.workspaceId,
      memberId: entered.link.memberId,
      topic: change.data.topic,
      subscribed: change.data.subscribed,
    });
    return ok(view);
  });

  // RFC 8058's one click: the mail service posts `List-Unsubscribe=One-Click` (the page that asks first posts the
  // token in the header); the link's own topic goes off. The answer names the topic and the workspace, nothing else.
  app.post(UNSUBSCRIBE_ROUTE, bodyLimit({ maxSize: 1_024 }), async (c) => {
    const entered = await enterUnsubscribe(c.get('clientIp'), c.req.query('t') ?? c.req.header(EMAIL_LINK_HEADER));
    if ('refused' in entered) return entered.refused;
    const { topic } = entered.link;
    const view = await setEmailPreference(entered.scope, { topic, subscribed: false }, topic);
    log.info('email.preference.unsubscribed', {
      requestId: c.get('requestId'),
      workspaceId: entered.link.workspaceId,
      memberId: entered.link.memberId,
      topic,
    });
    return ok({ unsubscribed: true, workspaceName: view.workspaceName, topic } satisfies EmailUnsubscribed);
  });

  // The same address opened in a browser (some mail apps do): to the page, which asks before it posts the token.
  app.get(UNSUBSCRIBE_ROUTE, (c) =>
    c.body(null, 303, {
      location: confirmPageFor(c.req.query('t')),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    }),
  );
}
