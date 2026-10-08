// Every failure the data layer hands a screen has one shape (spec 0005): a
// stable `code`, a plain `message` that says what to do, and for refusals the
// details (`data.refusals`, `data.issues`). Screens branch on the code and
// show the message; they never see a transport error. No Zod here: this
// module is in the first load, so it reads the plain code list.
import type { ApiRefusal, ErrorCode, InputIssue } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts/codes';
import { ORPCError } from '@orpc/client';

/**
 * The codes sign in answers beyond the API's own: a code that is wrong, has
 * expired, or was tried too often. Better Auth sends them; the API keeps them.
 */
export const SIGN_IN_CODES = ['INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS'] as const;

/** One of the sign in codes beyond the API's own. */
export type SignInCode = (typeof SIGN_IN_CODES)[number];

/** Every code a data layer failure can carry. */
export type DataErrorCode = ErrorCode | SignInCode;

/** The details a refusal carries: every engine refusal (one per attribute or field), or the input problems found. */
export interface DataErrorDetails {
  readonly refusals?: readonly ApiRefusal[];
  readonly issues?: readonly InputIssue[];
}

/**
 * A failure from the data layer, in the shared `{ code, message, data? }`
 * shape. It is an `Error`, so a route loader can throw it and an error
 * component can catch it; recognise it with `isDataError`.
 */
export interface DataError extends Error {
  readonly name: 'DataError';
  readonly code: DataErrorCode;
  readonly data?: DataErrorDetails;
  /**
   * How long to wait before trying again, in whole seconds, from the answer's
   * `Retry-After` (a `RATE_LIMITED` refusal, a cancelled query). Absent when
   * the answer didn't say.
   */
  readonly retryAfterSeconds?: number;
}

/** Builds a DataError from its parts. */
export function dataError(
  code: DataErrorCode,
  message: string,
  data?: DataErrorDetails,
  retryAfterSeconds?: number,
): DataError {
  return Object.assign(new Error(message), {
    name: 'DataError' as const,
    code,
    ...(data === undefined ? {} : { data }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

/** The same failure, carrying the answer's wait (when it had one and the failure doesn't already). */
export function withRetryAfter(error: DataError, retryAfterSeconds: number | undefined): DataError {
  if (retryAfterSeconds === undefined || error.retryAfterSeconds !== undefined) return error;
  return dataError(error.code, error.message, error.data, retryAfterSeconds);
}

/**
 * A `Retry-After` header as whole seconds from `now` (Unix milliseconds):
 * either form the header allows, delay seconds or an HTTP date. Undefined
 * when it is missing or unreadable; never below zero.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  // An HTTP date names its day and month; anything else (a negative number, a bare year) is unreadable.
  if (!/[a-z]/i.test(text)) return undefined;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * The sentence a refused write gives one attribute: its own refusal (a taken
 * unique value, an invalid value), or its input problem, else, for a refusal
 * about nothing in particular, the whole answer's; undefined when the answer
 * is about other attributes only. The one wording a grid cell, its toast and
 * a form's field all show, so they always say the same thing.
 */
export function refusalFor(error: DataError, attributeId: string): string | undefined {
  const refusals = error.data?.refusals ?? [];
  const own = refusals.find((refusal) => refusal.attributeId === attributeId);
  if (own !== undefined) return own.message;
  const issue = error.data?.issues?.find((each) => each.path[0] === 'values' && each.path[1] === attributeId);
  if (issue !== undefined) return issue.message;
  const isAboutAttributes =
    refusals.some((refusal) => refusal.attributeId !== undefined) ||
    (error.data?.issues ?? []).some((each) => each.path[0] === 'values');
  return isAboutAttributes ? undefined : error.message;
}

/** The sentence that sums up a refused write, in the same words as `refusalFor`: its first refusal's, else the answer's. */
export function refusalSummary(error: DataError): string {
  return error.data?.refusals?.[0]?.message ?? error.data?.issues?.[0]?.message ?? error.message;
}

/** Whether a thrown value is a DataError, so a screen can read its code. */
export function isDataError(error: unknown): error is DataError {
  return error instanceof Error && error.name === 'DataError' && 'code' in error && typeof error.code === 'string';
}

/** The messages the layer writes itself, when the server can't say. */
export const ERROR_MESSAGES = {
  offline: "Can't reach the CRM. Check your connection, then try again.",
  internal: 'Something went wrong. Try again in a moment.',
  signedOut: 'You were signed out. Sign in again to carry on.',
  rateLimited: 'Too many tries. Wait a moment, then try again.',
} as const;

const KNOWN: readonly string[] = [...ERROR_CODES, ...SIGN_IN_CODES];

function isKnownCode(code: unknown): code is DataErrorCode {
  return typeof code === 'string' && KNOWN.includes(code);
}

/** A code by HTTP status, for an answer that didn't carry one of ours. */
function codeForStatus(status: unknown): ErrorCode {
  if (status === 400) return 'INPUT_INVALID';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503 || status === 504) return 'API_UNAVAILABLE';
  return 'INTERNAL';
}

function messageFor(code: DataErrorCode, message: unknown): string {
  // INTERNAL is never detailed, whatever came with it.
  if (code === 'INTERNAL') return ERROR_MESSAGES.internal;
  if (typeof message === 'string' && message.trim() !== '') return message;
  return code === 'API_UNAVAILABLE' ? ERROR_MESSAGES.offline : ERROR_MESSAGES.internal;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isRefusal(value: unknown): value is ApiRefusal {
  return (
    isRecord(value) &&
    isKnownCode(value.code) &&
    typeof value.message === 'string' &&
    (value.attributeId === undefined || typeof value.attributeId === 'string') &&
    (value.field === undefined || typeof value.field === 'string')
  );
}

function isIssue(value: unknown): value is InputIssue {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    Array.isArray(value.path) &&
    value.path.every((part) => typeof part === 'string' || typeof part === 'number')
  );
}

/** The refusals and issues an error's data carries, keeping only well formed ones. */
function detailsOf(data: unknown): DataErrorDetails | undefined {
  if (!isRecord(data)) return undefined;
  const refusals = Array.isArray(data.refusals) ? data.refusals.filter(isRefusal) : [];
  const issues = Array.isArray(data.issues) ? data.issues.filter(isIssue) : [];
  if (refusals.length === 0 && issues.length === 0) return undefined;
  return { ...(refusals.length > 0 ? { refusals } : {}), ...(issues.length > 0 ? { issues } : {}) };
}

/**
 * Any failure from a call (an oRPC error, Better Auth's `{ code, message,
 * status }`, a dropped connection) as a DataError. An answer the server
 * didn't shape gets a code from its status; failing to reach the server is
 * `API_UNAVAILABLE`.
 */
export function toDataError(error: unknown): DataError {
  if (isDataError(error)) return error;
  if (error instanceof ORPCError) {
    if (!isKnownCode(error.code)) return byStatus(error.status);
    return dataError(error.code, messageFor(error.code, error.message), detailsOf(error.data));
  }
  // fetch rejects with a TypeError when the network or the server can't be reached.
  if (error instanceof TypeError) return dataError('API_UNAVAILABLE', ERROR_MESSAGES.offline);
  if (isRecord(error) && 'status' in error) {
    if (!isKnownCode(error.code)) return byStatus(error.status);
    return dataError(error.code, messageFor(error.code, error.message));
  }
  return dataError('INTERNAL', ERROR_MESSAGES.internal);
}

/**
 * A failure the server can't have seen, for monitoring (spec 0010, AC-163):
 * what failed, the request id of the answer when there was one (its
 * `x-request-id`), and the procedure or sign in step.
 */
export interface DataFault {
  readonly error: unknown;
  readonly requestId?: string;
  readonly procedure?: string;
}

/** Whether a thrown value is a cancelled call: the caller let go of it, nothing failed. */
function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

/**
 * Whether a failure is one the server never saw and nobody expected, so the
 * layer reports it (spec 0010, AC-163): an answer without one of our codes (a
 * proxy's page, a malformed body), or an error thrown inside the layer. Being
 * offline, a cancelled call and every answer with one of our codes are not:
 * the server reports its own faults, and a refusal is no fault.
 */
export function isUnseenFault(error: unknown): boolean {
  if (isDataError(error) || isAbort(error)) return false;
  if (error instanceof ORPCError) return !isKnownCode(error.code);
  // fetch's own failure: offline, or the server unreachable.
  if (error instanceof TypeError) return false;
  if (isRecord(error) && 'status' in error) return !isKnownCode(error.code);
  return true;
}

/** An answer without one of our codes (a proxy's page, a malformed body): our own code and words, from its status. */
function byStatus(status: unknown): DataError {
  const code = codeForStatus(status);
  if (code === 'API_UNAVAILABLE') return dataError(code, ERROR_MESSAGES.offline);
  if (code === 'UNAUTHENTICATED') return dataError(code, ERROR_MESSAGES.signedOut);
  if (code === 'RATE_LIMITED') return dataError(code, ERROR_MESSAGES.rateLimited);
  return dataError(code, ERROR_MESSAGES.internal);
}
