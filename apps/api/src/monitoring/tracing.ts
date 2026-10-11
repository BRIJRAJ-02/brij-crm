// What request tracing samples and sends (spec 0010, milestone 2, AC-170).
// Pure and vendor free, so it can be read and tested without Sentry: the
// sampler `sentry.ts` hands the SDK, the span names, and `keepSpan`, which
// every span passes before it leaves (`beforeSendSpan`), the span side of the
// one `scrub` (AC-165).
import type { AppEnvironment } from '@crm/contracts';
import { KEPT_HEADERS, MAX_TEXT, scrubText } from '@crm/contracts/monitoring';

/** The share of api requests traced in each environment (AC-170): every one in a preview, a fifth in production, none on a laptop. */
export const TRACE_RATES: Readonly<Record<AppEnvironment, number>> = { local: 0, preview: 1, production: 0.2 };

/** The paths a trace may start from: procedures and sign in. Health checks and anything else are never traced. */
const TRACED_PATHS = ['/api/rpc/', '/api/auth/'] as const;

/** What the sampler reads about a span about to start (the SDK's sampling context, structurally). */
export interface SamplingInput {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly normalizedRequest?: { readonly url?: string };
}

/** The request's path, from the span's `url.path`, else the request's URL; undefined for a span that is no request. */
function pathOf({ attributes, normalizedRequest }: SamplingInput): string | undefined {
  const path = attributes?.['url.path'];
  if (typeof path === 'string') return path;
  const url = normalizedRequest?.url;
  if (url === undefined || !URL.canParse(url, 'http://api')) return undefined;
  return new URL(url, 'http://api').pathname;
}

/**
 * The rate a new trace in the api starts at: `TRACE_RATES` for an incoming
 * request to a procedure or a sign in route, and 0 for anything else (a health
 * check, an unknown path, work outside any request). An incoming trace's own
 * decision is never followed, so a caller can't make the api trace more than
 * its rate (the quota is the owner's).
 */
export function requestSampleRate(environment: AppEnvironment, input: SamplingInput): number {
  if (input.attributes?.['sentry.op'] !== 'http.server') return 0;
  const path = pathOf(input)?.replace(/\/{2,}/g, '/');
  if (path === undefined || !TRACED_PATHS.some((prefix) => path.startsWith(prefix))) return 0;
  return TRACE_RATES[environment];
}

/** A procedure's trace name (`rpc records.query`). */
export const procedureTraceName = (procedure: string): string => `rpc ${procedure}`;

// SQL: an escape string (backslashes escape), a quoted literal (with doubled quotes inside), a dollar quoted body, or a
// number that isn't a placeholder (`$1`) or part of a name. Each becomes `?`, so a statement that inlined a value sends
// its shape only. A literal the text ends inside (a statement cut short) runs to the end, so no part of it is kept.
const SQL_LITERALS =
  /[eE]'(?:[^'\\]|\\[\s\S]|'')*(?:'|$)|'(?:[^']|'')*(?:'|$)|\$([A-Za-z_]\w*)?\$[\s\S]*?(?:\$\1\$|$)|(?<![$\w.])\d+(?:\.\d+)?(?![\w.])/gu;

/** The longest statement shaped: past it, a statement is cut first (Sentry cuts far shorter anyway). */
const MAX_SQL = MAX_TEXT;

/** A statement with every literal replaced by `?`: the work it does, never a value it carried. */
export function sqlShape(text: string): string {
  return text.slice(0, MAX_SQL).replace(SQL_LITERALS, '?');
}

// Attributes that name the person or their machine, or carry what they sent.
const DROPPED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'client.address',
  'client.port',
  'network.peer.address',
  'network.peer.port',
  'http.client_ip',
  'url.query',
  'http.query',
  'http.request.body',
  'http.response.body',
  // Where the database lives and the login it uses: nothing a chart needs.
  'db.connection_string',
  'db.user',
]);

// Prefixes of attributes that are never kept (a bound query parameter, a person field other than the id, a header).
const DROPPED_PREFIXES = ['db.query.parameter.', 'user_agent.', 'http.request.header.', 'http.response.header.'];

// The attributes that hold SQL text.
const SQL_ATTRIBUTES: ReadonlySet<string> = new Set(['db.statement', 'db.query.text']);

/** Whether an attribute may leave. */
function keptAttribute(key: string): boolean {
  if (DROPPED_ATTRIBUTES.has(key)) return false;
  if (key.startsWith('user.')) return key === 'user.id';
  const header = /^http\.(?:request|response)\.header\.(.+)$/u.exec(key)?.[1];
  if (header !== undefined) return KEPT_HEADERS.has(header.toLowerCase());
  return !DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** A value with every text scrubbed (and shaped, for SQL), whether bare or in its `{ value, unit }` box. */
function keptValue(value: unknown, sql: boolean): unknown {
  if (typeof value === 'string') return scrubText(sql ? sqlShape(value) : value);
  if (Array.isArray(value)) return value.map((item: unknown) => keptValue(item, sql));
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return { ...value, value: keptValue(value.value, sql) };
  }
  return value;
}

/** A span as `beforeSendSpan` sees it, the fields read here. */
export interface SpanLike {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** The value of an attribute, bare or boxed. */
function attributeValue(attributes: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = attributes[key];
  return typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
}

/**
 * A copy of a span that is safe to send: no user agent, client address,
 * query, body, bound parameter, header beyond `content-type` and
 * `x-request-id`, or user field beyond the id; every text scrubbed (emails
 * marked, URL queries cut); and SQL, in a database span's name and its
 * statement, reduced to its shape. The span is never changed.
 */
export function keepSpan<T extends SpanLike>(span: T): T {
  const op = attributeValue(span.attributes, 'sentry.op');
  const database = typeof op === 'string' && op.startsWith('db');
  const attributes = Object.fromEntries(
    Object.entries(span.attributes)
      .filter(([key]) => keptAttribute(key))
      .map(([key, value]) => [key, keptValue(value, SQL_ATTRIBUTES.has(key))]),
  );
  return { ...span, name: scrubText(database ? sqlShape(span.name) : span.name), attributes };
}
