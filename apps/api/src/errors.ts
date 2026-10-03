// What a thrown error becomes on the wire. Every RPC error leaves with a code
// from the one error map in @crm/contracts and the status it gives that code:
// an engine refusal keeps its code and lists every refusal, bad input becomes
// INPUT_INVALID with its issues, and anything else is INTERNAL with no detail.
import { type ApiError, ApiRefusal, ERROR_MAP, ErrorCode, type InputIssue } from '@crm/contracts';
import { isRefusal } from '@crm/core';
import { ORPCError, ValidationError } from '@orpc/server';
import * as z from 'zod';

/** The error oRPC sends for one of the map's codes. */
export type ApiORPCError = ORPCError<ErrorCode, ApiError['data']>;

/** The sentence every unexpected failure answers with. The detail goes to the log only. */
export const INTERNAL_MESSAGE = 'Something went wrong on our side.';

/** Input issues sent back at most, so a huge bad payload can't produce a huger answer. */
export const MAX_INPUT_ISSUES = 50;

/** An oRPC error with one of the map's codes, at the status the map gives it. */
export function apiError(code: ErrorCode, message: string, data?: ApiError['data']): ApiORPCError {
  return new ORPCError(code, { status: ERROR_MAP[code].status, message, data });
}

/** The error to send, and whether it was expected (a refusal, bad input) or must be logged as a fault. */
export interface MappedError {
  readonly error: ApiORPCError;
  readonly expected: boolean;
}

function issuePath(path: ValidationError['issues'][number]['path']): InputIssue['path'] {
  return (path ?? []).map((segment) => {
    const key = typeof segment === 'object' ? segment.key : segment;
    return typeof key === 'number' ? key : String(key);
  });
}

// What a refusal may carry onto the wire: code, message and attribute, nothing else.
const Refusals = z.array(ApiRefusal).min(1);

/**
 * Ties engine refusals to the input field they are about (`SLUG_TAKEN` to
 * `slug`), so a form can show the message on that field. Anything else is
 * returned as it was, to be thrown again.
 */
export function withInputFields(error: unknown, fields: Readonly<Partial<Record<ErrorCode, string>>>): unknown {
  if (!isRefusal(error)) return error;
  const refusals = error.refusals.map((refusal) => {
    const field = fields[refusal.code];
    return field === undefined ? refusal : { ...refusal, field };
  });
  const [first] = refusals;
  return first === undefined ? error : apiError(first.code, first.message, { refusals });
}

/** Turns anything thrown into the API's error shape. It never throws itself. */
export function toApiError(error: unknown): MappedError {
  if (isRefusal(error)) {
    const refusals = Refusals.safeParse(error.refusals);
    // The first refusal names the code; something only shaped like a refusal is a fault.
    const [first] = refusals.success ? refusals.data : [];
    if (refusals.success && first !== undefined) {
      return { error: apiError(first.code, first.message, { refusals: refusals.data }), expected: true };
    }
    return { error: apiError('INTERNAL', INTERNAL_MESSAGE), expected: false };
  }
  if (error instanceof ORPCError) {
    const code = ErrorCode.safeParse(error.code);
    // Already one of ours. An INTERNAL thrown on purpose still loses its detail below.
    if (code.success && code.data !== 'INTERNAL' && error.status === ERROR_MAP[code.data].status) {
      return { error: error as ApiORPCError, expected: true };
    }
    // oRPC's own input check: the contract's schema refused the input.
    if (error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
      const issues = error.cause.issues
        .slice(0, MAX_INPUT_ISSUES)
        .map((issue) => ({ path: issuePath(issue.path), message: issue.message }));
      return { error: apiError('INPUT_INVALID', 'Some of the input is invalid.', { issues }), expected: true };
    }
    // oRPC refusing the request itself before any procedure: a body it couldn't
    // decode, or a GET on a procedure that only takes POST.
    if (error.code === 'BAD_REQUEST' || error.code === 'METHOD_NOT_SUPPORTED') {
      return { error: apiError('INPUT_INVALID', 'The request could not be read.'), expected: true };
    }
  }
  return { error: apiError('INTERNAL', INTERNAL_MESSAGE), expected: false };
}
