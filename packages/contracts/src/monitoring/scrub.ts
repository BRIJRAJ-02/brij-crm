// What may leave for Sentry (spec 0010, AC-165): one scrub that runs in every
// send hook of both Sentry SDKs, the browser's and the server's. The CRM holds
// other people's contact data, so nothing personal leaves: no email, cookie,
// body, query string, header beyond two, or user field beyond the id. It is
// pure and vendor free (structural types, no Zod), so the browser's lazy
// Sentry chunk and the api share it.

/** What stands in for anything shaped like an email address. */
export const EMAIL_MARK = '[email]';

/** The only request headers that may leave: neither names nor holds a person. */
export const KEPT_HEADERS: ReadonlySet<string> = new Set(['content-type', 'x-request-id']);

// Anything shaped like an email address, wherever it sits in a text.
const EMAIL = /[\w.%+-]+@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,}/giu;

// A URL or a path, then its query and fragment: sign in codes, Google's `code`
// and `state`, a search. The URL keeps everything before `?` or `#`.
const QUERY = /((?:\b[a-z][a-z\d+.-]*:\/\/|\/)[^\s?#"'<>]*)[?#][^\s"'<>]*/giu;

// Request fields that carry what the person sent, or the server's environment.
const DROPPED_REQUEST_FIELDS: ReadonlySet<string> = new Set(['cookies', 'data', 'query_string', 'env']);

// Stack frame fields that name code, never a person. Left exactly as they are,
// so Sentry can still match a frame to its source.
const CODE_FIELDS: ReadonlySet<string> = new Set(['filename', 'abs_path', 'module', 'function', 'debug_id']);

// Deeper than any event Sentry builds; past it a value is cut rather than walked.
const MAX_DEPTH = 32;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A text with every email marked and every URL's query and fragment cut. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, EMAIL_MARK).replace(QUERY, '$1');
}

/** Only the headers in `KEPT_HEADERS`, whatever their case. */
function keptHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!isRecord(headers)) return undefined;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADERS.has(name.toLowerCase())));
}

/** The request without what the person sent: no cookies, body, query string or environment, two headers. */
function scrubRequest(request: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept = Object.entries(request).filter(([field]) => !DROPPED_REQUEST_FIELDS.has(field) && field !== 'headers');
  const headers = keptHeaders(request.headers);
  return Object.fromEntries(headers === undefined ? kept : [...kept, ['headers', headers]]);
}

/** Copies `value` with every text scrubbed, local variables dropped and code fields left alone. */
function walk(value: unknown, depth: number, ancestors: readonly object[]): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object' || value === null) return value;
  // A cycle or a structure deeper than any event: cut, never walked forever.
  if (depth > MAX_DEPTH || ancestors.includes(value)) return '[cut]';
  const inside = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item: unknown) => walk(item, depth + 1, inside));
  const entries = Object.entries(value)
    // A frame's local variables can hold anything the code held: a body, a value, a person.
    .filter(([key]) => key !== 'vars')
    .map(([key, item]) => [key, CODE_FIELDS.has(key) ? item : walk(item, depth + 1, inside)] as const);
  return Object.fromEntries(entries);
}

/**
 * A copy of a Sentry event or breadcrumb that is safe to send. It drops
 * `request.cookies`, `request.data`, `request.query_string`, `request.env`,
 * every request header but `content-type` and `x-request-id`, every `user`
 * field but `id`, and `extra.detail` (a Postgres error's detail quotes the
 * row); drops local variables from stack frames; cuts the query and fragment
 * from every URL; and marks anything shaped like an email as `[email]`. The
 * argument is never changed.
 */
export function scrub<T>(event: T): T {
  const walked = walk(event, 0, []);
  if (!isRecord(walked)) return walked as T;
  const fields = Object.entries(walked).flatMap(([field, value]): [string, unknown][] => {
    if (field === 'request' && isRecord(value)) return [[field, scrubRequest(value)]];
    if (field === 'user') return isRecord(value) && value.id !== undefined ? [[field, { id: value.id }]] : [];
    if (field === 'extra' && isRecord(value)) {
      return [[field, Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'detail'))]];
    }
    return [[field, value]];
  });
  return Object.fromEntries(fields) as T;
}
