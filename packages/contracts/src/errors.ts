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
  readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503;
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
  // An object name already held in the workspace, ignoring case, archived objects included (spec 0012, AC-224).
  NAME_TAKEN: CONFLICT,
  UNIQUE_CONFLICT: CONFLICT,
  UNIQUE_HAS_DUPLICATES: CONFLICT,
  ID_TAKEN: CONFLICT,
  RECORD_DELETED: CONFLICT,
  RECORD_OUT_OF_SCOPE: CONFLICT,
  RELATIONSHIP_TAKEN: CONFLICT,
  ENTRY_EXISTS: CONFLICT,
  LIMIT_REACHED: CONFLICT,
  // The change would leave a live workspace with no active owner (spec 0009, AC-137).
  LAST_OWNER: CONFLICT,
  // Undo's precondition (spec 0006, AC-49): the cell changed since the version the write names.
  VERSION_CHANGED: CONFLICT,
  // Background jobs (spec 0008): the job already ended, its kind can't be cancelled, it isn't waiting for a
  // confirm, or it waited past its hour unconfirmed.
  JOB_FINISHED: CONFLICT,
  JOB_NOT_CANCELLABLE: CONFLICT,
  JOB_NOT_READY: CONFLICT,
  JOB_EXPIRED: CONFLICT,
  // Saved views (spec 0020, AC-469, AC-474).
  VIEW_CHANGED: CONFLICT,
  VIEW_IS_DEFAULT: CONFLICT,
  // Forms (spec 0023): a stale draft, a status change or submission action that doesn't fit; a paused or
  // archived form at its public address (410 Gone).
  FORM_CHANGED: CONFLICT,
  FORM_STATE: CONFLICT,
  FORM_CLOSED: { status: 410 },
  // Booking pages (spec 0025, AC-632): "That time was just taken", with fresh slots; a paused or deleted page.
  SLOT_TAKEN: CONFLICT,
  BOOKING_CLOSED: CONFLICT,
  CALENDAR_NOT_CONNECTED: CONFLICT,
  // Invitations (spec 0031, AC-805, AC-808, AC-809): every invalid token answers the same 404.
  INVITE_INVALID: { status: 404 },
  INVITE_EMAIL_MISMATCH: { status: 403 },
  INVITES_LIMIT: CONFLICT,
  SEAT_LIMIT: CONFLICT,
  // Availability schedules (spec 0035, AC-961, AC-962, AC-966): "You have 20 schedules", a stale editor, "Set
  // another schedule as default first", and a page naming a schedule its owner doesn't hold.
  SCHEDULE_LIMIT: CONFLICT,
  STALE: CONFLICT,
  DEFAULT_SCHEDULE: CONFLICT,
  SCHEDULE_NOT_ALLOWED: UNPROCESSABLE,
  IN_USE: CONFLICT,
  HOSTS_INVALID: UNPROCESSABLE,
  // Scheduling access (spec 0037, AC-1255, AC-1256).
  DELEGATE_INVALID: UNPROCESSABLE,
  DELEGATION_LIMIT: CONFLICT,
  // Time off (spec 0037, AC-1288): "Someone can have at most 50 upcoming time off entries."
  TIME_OFF_LIMIT: CONFLICT,
  // The sidebar (spec 0034, AC-934): "You have 50 favourites. Remove one first."
  NAV_LIMIT: CONFLICT,
  // Domain join (spec 0031, AC-819).
  DOMAIN_NOT_YOURS: UNPROCESSABLE,
  DOMAIN_PUBLIC: UNPROCESSABLE,
  // Deleting a workspace (spec 0031, AC-823): the typed name doesn't match.
  CONFIRM_MISMATCH: UNPROCESSABLE,
  CALENDAR_NOT_WRITABLE: CONFLICT,
  // Account security (spec 0033, AC-896): verify again (a fresh step up) before this account change.
  STEP_UP_REQUIRED: { status: 403 },
  // Turning two factor off proves it with the second factor itself, never an email code alone (AC-885).
  SECOND_FACTOR_REQUIRED: { status: 403 },
  // A code from the app, a backup code or a step up email code that didn't check out (AC-882, AC-896).
  CODE_INVALID: UNPROCESSABLE,
  // The second step of a sign in ran out (5 minutes) or had too many wrong codes: sign in again (AC-882).
  SIGN_IN_EXPIRED: { status: 401 },
  // Import and export (spec 0040, AC-1129, AC-1132).
  IMPORT_STARTED: CONFLICT,
  IMPORT_RUNNING: CONFLICT,
  IMPORT_UNDO_CLOSED: CONFLICT,
  EXPORT_TOO_LARGE: UNPROCESSABLE,
  // A workspace's sign in rules (spec 0033, AC-893 to AC-894): set up two factor, or sign in again, to open it; an
  // owner sets up their own two factor before requiring it; a workspace still requires the factor being turned off.
  TWO_FACTOR_REQUIRED: { status: 403 },
  SIGN_IN_AGAIN: { status: 403 },
  OWNER_NEEDS_TWO_FACTOR: CONFLICT,
  WORKSPACE_REQUIRES_TWO_FACTOR: CONFLICT,
  PAYLOAD_TOO_LARGE: { status: 413 },
  ATTRIBUTE_VALUE_INVALID: UNPROCESSABLE,
  VALUE_REQUIRED: UNPROCESSABLE,
  OPTION_ARCHIVED: UNPROCESSABLE,
  ATTRIBUTE_READ_ONLY: UNPROCESSABLE,
  CONFIG_INVALID: UNPROCESSABLE,
  FILTER_INVALID: UNPROCESSABLE,
  // A job past a million items (spec 0008, AC-116).
  JOB_TOO_LARGE: UNPROCESSABLE,
  // A write that breaks an attribute's rules (spec 0013, AC-254): every failing rule, with its ruleId.
  VALIDATION_FAILED: UNPROCESSABLE,
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
  /** The rule a `VALIDATION_FAILED` refusal is about (spec 0013). */
  ruleId: z.string().optional(),
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
