// A failed query must never leave the process with its values (spec 0010,
// AC-165). Drizzle's error message is `Failed query: <sql>\nparams: <values>`,
// so it carries record values and session tokens, and a Postgres error's own
// message or detail can quote a value too. Before an error is logged or sent
// to Sentry it goes through `safeError`: a failed query becomes a fresh Error
// that names only its SQLSTATE and constraint, keeps the original stack
// frames, and drops its cause.

// A Postgres SQLSTATE: five characters, digits and capitals (23505, 22P02, XX000).
const SQLSTATE = /^[0-9A-Z]{5}$/;

// How far down an error's causes to look: drizzle wraps the driver's error once.
const MAX_CAUSES = 4;

/** What a failed query may say about itself: its SQLSTATE and the constraint it broke. */
export interface QueryFacts {
  readonly code?: string;
  readonly constraint?: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** A Postgres error: a SQLSTATE `code` and the fields only the driver sets, so a Node `EPIPE` isn't one. */
function isPostgresError(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.code === 'string' && SQLSTATE.test(value.code) && ('severity' in value || 'routine' in value);
}

/**
 * The SQLSTATE and constraint of a failed query, when `error` or one of its
 * causes is one: drizzle's query error (it has `query` and `params`) or the
 * driver's Postgres error. Undefined for anything else.
 */
export function queryFailure(error: unknown): QueryFacts | undefined {
  let current: unknown = error;
  let isQuery = false;
  let code: string | undefined;
  let constraint: string | undefined;
  for (let depth = 0; depth <= MAX_CAUSES && isRecord(current); depth += 1) {
    if ('query' in current && 'params' in current) isQuery = true;
    if (isPostgresError(current)) {
      isQuery = true;
      code ??= String(current.code);
      if (typeof current.constraint === 'string') constraint ??= current.constraint;
    }
    current = current.cause;
  }
  if (!isQuery) return undefined;
  return { ...(code === undefined ? {} : { code }), ...(constraint === undefined ? {} : { constraint }) };
}

/**
 * The error as it may be logged or reported: a failed query becomes a fresh
 * Error (`Query failed (23505 values_unique)`) with the same name and stack
 * frames and no cause; anything else is returned as it is.
 */
export function safeError(error: unknown): unknown {
  const facts = queryFailure(error);
  if (facts === undefined) return error;
  const detail = [facts.code, facts.constraint].filter((part) => part !== undefined).join(' ');
  const message = detail === '' ? 'Query failed' : `Query failed (${detail})`;
  const safe = new Error(message);
  safe.name = error instanceof Error ? error.name : 'Error';
  // The frames only: the stack's first line repeats the message, values and all.
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line)) : [];
  safe.stack = [`${safe.name}: ${message}`, ...frames].join('\n');
  return safe;
}
