// What request tracing samples and sends (spec 0010, milestone 2, AC-170).
// Pure and vendor free, so it can be read and tested without Sentry: the
// sampler `sentry.ts` hands the SDK, the span names, and `keepSpan`, which
// every span passes before it leaves (`beforeSendSpan`), the span side of the
// one `scrub` (AC-165).
import type { AppEnvironment } from '@crm/contracts';
import { KEPT_HEADERS, scrubText } from '@crm/contracts/monitoring';
import { EDGE_HEADER } from '../edge.ts';

/** The share of api requests traced in each environment (AC-170): every one in a preview, a fifth in production, none on a laptop. */
export const TRACE_RATES: Readonly<Record<AppEnvironment, number>> = { local: 0, preview: 1, production: 0.2 };

/** The paths a trace may start from: procedures and sign in. Health checks and anything else are never traced. */
const TRACED_PATHS = ['/api/rpc/', '/api/auth/'] as const;

/** What the sampler reads about a span about to start (the SDK's sampling context, structurally). */
export interface SamplingInput {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly normalizedRequest?: { readonly url?: string; readonly headers?: Readonly<Record<string, unknown>> };
}

/** The longest path a trace starts from: every procedure and sign in route is far shorter. */
const MAX_TRACED_PATH = 128;

/** Headers that carry a caller's trace: one with any of them is never traced, so no caller picks the rate or the id. */
const TRACE_HEADERS: readonly string[] = ['sentry-trace', 'baggage', 'traceparent'];

/** The request's path, from the span's `url.path`, else the request's URL; undefined for a span that is no request. */
function pathOf({ attributes, normalizedRequest }: SamplingInput): string | undefined {
  const path = attributes?.['url.path'];
  if (typeof path === 'string') return path;
  const url = normalizedRequest?.url;
  if (url === undefined || !URL.canParse(url, 'http://api')) return undefined;
  return new URL(url, 'http://api').pathname;
}

/** Whether the request carries `header`, in its headers or as a span attribute (`http.request.header.<name>`). */
function hasHeader({ attributes, normalizedRequest }: SamplingInput, header: string): boolean {
  if (attributes?.[`http.request.header.${header}`] !== undefined) return true;
  const headers = normalizedRequest?.headers ?? {};
  return Object.keys(headers).some((name) => name.toLowerCase() === header);
}

function sampleRate(environment: AppEnvironment, input: SamplingInput): number {
  if (input.attributes?.['sentry.op'] !== 'http.server') return 0;
  const path = pathOf(input);
  if (path === undefined || path.length > MAX_TRACED_PATH) return 0;
  const routed = path.replace(/\/{2,}/g, '/');
  if (!TRACED_PATHS.some((prefix) => routed.startsWith(prefix))) return 0;
  if (TRACE_HEADERS.some((header) => hasHeader(input, header))) return 0;
  // Outside a laptop every real request came through Vercel's middleware, which adds the edge header.
  if (environment !== 'local' && !hasHeader(input, EDGE_HEADER)) return 0;
  return TRACE_RATES[environment];
}

/**
 * The rate a new trace in the api starts at: `TRACE_RATES` for an incoming
 * request to a procedure or a sign in route through the edge, and 0 for
 * anything else (a health check, an unknown or overlong path, work outside any
 * request, a request that brings a trace of its own). So no caller can make
 * the api trace more than its rate (the quota is the owner's) or choose a
 * trace id. It never throws: anything unexpected is 0.
 */
export function requestSampleRate(environment: AppEnvironment, input: SamplingInput): number {
  try {
    return sampleRate(environment, input);
  } catch {
    return 0;
  }
}

/** A procedure's trace name (`rpc records.query`). */
export const procedureTraceName = (procedure: string): string => `rpc ${procedure}`;

// SQL: an escape string (backslashes escape), a quoted literal (with doubled quotes inside), a dollar quoted body, or a
// number that isn't a placeholder (`$1`) or part of a name. Each becomes `?`, so a statement that inlined a value sends
// its shape only. A literal the text ends inside (a statement cut short) runs to the end, so no part of it is kept.
const SQL_LITERALS =
  /[eE]'(?:[^'\\]|\\[\s\S]|'')*(?:'|$)|'(?:[^']|'')*(?:'|$)|\$([A-Za-z_]\w*)?\$[\s\S]*?(?:\$\1\$|$)|(?<![$\w.])\d+(?:\.\d+)?(?![\w.])/gu;

/** The longest text a span keeps: anything longer is cut before it is shaped or scrubbed, so a span costs little. */
export const MAX_SPAN_TEXT = 1024;

/** The longest SQL statement a span keeps. */
export const MAX_SPAN_SQL = 2048;

/** A statement with every literal replaced by `?`: the work it does, never a value it carried. */
export function sqlShape(text: string): string {
  return text.slice(0, MAX_SPAN_SQL).replace(SQL_LITERALS, '?');
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
  // The whole URL: `url.path` carries what a chart needs.
  'url.full',
  // A failed span's message, which for a query is Postgres's, and can quote a value.
  'sentry.status.message',
  // Where the server and the database live and the login it uses: nothing a chart needs.
  'server.address',
  'server.port',
  'network.local.address',
  'db.connection_string',
  'db.namespace',
  'db.user',
]);

// Prefixes of attributes that are never kept (a bound query parameter, a person field other than the id, a header).
const DROPPED_PREFIXES = ['db.query.parameter.', 'user_agent.', 'http.request.header.', 'http.response.header.'];

// The attributes that hold SQL text, or a summary of it.
const SQL_ATTRIBUTES: ReadonlySet<string> = new Set(['db.statement', 'db.query.text', 'db.query.summary']);

/** Whether an attribute may leave. */
function keptAttribute(key: string): boolean {
  if (DROPPED_ATTRIBUTES.has(key)) return false;
  if (key.startsWith('user.')) return key === 'user.id';
  const header = /^http\.(?:request|response)\.header\.(.+)$/u.exec(key)?.[1];
  if (header !== undefined) return KEPT_HEADERS.has(header.toLowerCase());
  return !DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** A text cut, then shaped (for SQL) and scrubbed. */
function keptText(text: string, sql: boolean): string {
  return scrubText(sql ? sqlShape(text) : text.slice(0, MAX_SPAN_TEXT));
}

/** A value with every text cut and scrubbed (and shaped, for SQL), whether bare or in its `{ value, unit }` box. */
function keptValue(value: unknown, sql: boolean): unknown {
  if (typeof value === 'string') return keptText(value, sql);
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
  readonly links?: unknown;
}

/** The value of an attribute, bare or boxed. */
function attributeValue(attributes: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = attributes[key];
  return typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
}

/**
 * A copy of a span that is safe to send: no user agent, client or server
 * address, full URL, query, body, bound parameter, status message, database
 * location or login, header beyond `content-type` and `x-request-id`, user
 * field beyond the id, or link to another span; every text cut to
 * `MAX_SPAN_TEXT` (SQL to `MAX_SPAN_SQL`) and scrubbed (emails marked, URL
 * queries cut); and SQL, in a database span's name, statement and summary,
 * reduced to its shape. The span is never changed.
 */
export function keepSpan<T extends SpanLike>(span: T): T {
  const op = attributeValue(span.attributes, 'sentry.op');
  const database = typeof op === 'string' && op.startsWith('db');
  const attributes = Object.fromEntries(
    Object.entries(span.attributes)
      .filter(([key]) => keptAttribute(key))
      .map(([key, value]) => [key, keptValue(value, SQL_ATTRIBUTES.has(key))]),
  );
  const { links: _links, ...rest } = span;
  return { ...rest, name: keptText(span.name, database), attributes } as T;
}

// What a span that can't be read leaves without.
const BLANKED_FIELDS: ReadonlySet<string> = new Set(['name', 'attributes', 'links']);

/**
 * `keepSpan`, failing closed: a span it can't read leaves with nothing but a
 * placeholder name, never as it came.
 */
export function keepSpanOrBlank<T extends SpanLike>(span: T): T {
  try {
    return keepSpan(span);
  } catch {
    // Only the fields that place it in its trace, each read on its own: one that throws is left out too.
    const placed = Object.keys(span)
      .filter((key) => !BLANKED_FIELDS.has(key))
      .flatMap((key): [string, unknown][] => {
        try {
          return [[key, (span as Readonly<Record<string, unknown>>)[key]]];
        } catch {
          return [];
        }
      });
    return { ...Object.fromEntries(placed), name: 'span', attributes: {} } as unknown as T;
  }
}
