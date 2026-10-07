// The one error map (spec 0005): every stable code the API answers with, the
// HTTP status it travels with, and the shape of an error body. The API sets
// statuses from it, and the client data layer branches on the same codes.
import * as z from 'zod';
import { ERROR_CODES } from './codes.ts';
import { ENGINE_REFUSAL_CODES } from './values/engine.ts';

/** Every stable code an API error can carry: the engine's refusals plus the request level codes (`codes.ts`). */
export const ErrorCode = z.enum(ERROR_CODES);
/** One of the API's stable error codes. */
export type ErrorCode = z.infer<typeof ErrorCode>;

/** How one code travels: its HTTP status, and the `Retry-After` seconds when a retry may succeed. */
export interface ErrorMapEntry {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;
  readonly retryAfterSeconds?: number;
}

const CONFLICT = { status: 409 } as const;
const UNPROCESSABLE = { status: 422 } as const;

/**
 * Every code's HTTP status. Conflicts with existing data are 409, invalid
 * values and configuration 422, and a non member gets the same 404 as an
 * unknown workspace. `INTERNAL` is never detailed. Adding a code without an
 * entry fails the type check.
 */
export const ERROR_MAP = {
  INPUT_INVALID: { status: 400 },
  UNAUTHENTICATED: { status: 401 },
  // Signed in, but the email isn't proven yet (a Google account that says so): no workspace until it is.
  EMAIL_UNVERIFIED: { status: 403 },
  // A new email that isn't on SIGNUP_ALLOWLIST: no code is sent and no user is made.
  SIGNUP_CLOSED: { status: 403 },
  EDGE_REQUIRED: { status: 403 },
  FORBIDDEN_ORIGIN: { status: 403 },
  // A workspace permission the actor lacks, on something they can see (spec 0009). Anything hidden is NOT_FOUND.
  FORBIDDEN: { status: 403 },
  NOT_FOUND: { status: 404 },
  SLUG_TAKEN: CONFLICT,
  UNIQUE_CONFLICT: CONFLICT,
  UNIQUE_HAS_DUPLICATES: CONFLICT,
  ID_TAKEN: CONFLICT,
  RECORD_DELETED: CONFLICT,
  RELATIONSHIP_TAKEN: CONFLICT,
  ENTRY_EXISTS: CONFLICT,
  LIMIT_REACHED: CONFLICT,
  // The change would leave a live workspace with no active owner (spec 0009, AC-137).
  LAST_OWNER: CONFLICT,
  PAYLOAD_TOO_LARGE: { status: 413 },
  ATTRIBUTE_VALUE_INVALID: UNPROCESSABLE,
  VALUE_REQUIRED: UNPROCESSABLE,
  OPTION_ARCHIVED: UNPROCESSABLE,
  ATTRIBUTE_READ_ONLY: UNPROCESSABLE,
  CONFIG_INVALID: UNPROCESSABLE,
  FILTER_INVALID: UNPROCESSABLE,
  // The fallback wait when the limiter gives none of its own.
  RATE_LIMITED: { status: 429, retryAfterSeconds: 60 },
  // Too many heavy reads in flight for one workspace at once; one finishing frees a place.
  TOO_MANY_REQUESTS: { status: 429, retryAfterSeconds: 1 },
  // The query ran out of time or was cancelled; a moment later it usually succeeds.
  QUERY_CANCELLED: { status: 503, retryAfterSeconds: 1 },
  API_UNAVAILABLE: { status: 503 },
  INTERNAL: { status: 500 },
} as const satisfies Record<ErrorCode, ErrorMapEntry>;

/**
 * One engine refusal inside an error's data: the code, how to fix it, and
 * what it's about: an attribute (a value refused), or a field of the
 * procedure's input (`slug` for a taken workspace address), so a form can
 * show the message on that field.
 */
export const ApiRefusal = z.object({
  code: z.enum(ENGINE_REFUSAL_CODES),
  message: z.string(),
  attributeId: z.string().optional(),
  field: z.string().optional(),
});
/** One engine refusal inside an error's data. */
export type ApiRefusal = z.infer<typeof ApiRefusal>;

/** One input problem inside an `INPUT_INVALID` error: where it is in the input, and what's wrong. */
export const InputIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
/** One input problem inside an `INPUT_INVALID` error. */
export type InputIssue = z.infer<typeof InputIssue>;

/**
 * Every API error: a stable code, a plain sentence, and for engine refusals
 * every refusal (one per attribute), or for bad input the issues found.
 */
export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  data: z
    .object({
      refusals: z.array(ApiRefusal).optional(),
      issues: z.array(InputIssue).optional(),
    })
    .optional(),
});
/** Every API error's shape. */
export type ApiError = z.infer<typeof ApiError>;

/** The HTTP status a code travels with. */
export function errorStatus(code: ErrorCode): ErrorMapEntry['status'] {
  return ERROR_MAP[code].status;
}

/** The `Retry-After` seconds a code is sent with, or undefined when retrying won't help. */
export function retryAfterSeconds(code: ErrorCode): number | undefined {
  const entry: ErrorMapEntry = ERROR_MAP[code];
  return entry.retryAfterSeconds;
}
