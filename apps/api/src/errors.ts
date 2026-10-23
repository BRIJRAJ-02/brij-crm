// What a thrown error becomes on the wire. Every RPC error leaves with a code
// from the one error map in @crm/contracts and the status it gives that code:
// an engine refusal keeps its code and lists every refusal, bad input (the
// contract's, or a field only the engine could check) becomes INPUT_INVALID
// with its issues, and anything else is INTERNAL with no detail.
import { type ApiError, ApiRefusal, ERROR_MAP, ErrorCode, type InputIssue } from '@crm/contracts';
import { isInputError, isRefusal } from '@crm/core';
import { ORPCError, ValidationError } from '@orpc/server';
import * as z from 'zod';

/** The error oRPC sends for one of the map's codes. */
export type ApiORPCError = ORPCError<ErrorCode, ApiError['data']>;

/** The sentence every unexpected failure answers with. The detail goes to the log only. */
export const INTERNAL_MESSAGE = 'Something went wrong. Try again.';

/** Input issues sent back at most, so a huge bad payload can't produce a huger answer. */
export const MAX_INPUT_ISSUES = 50;

/** The sentence bad input answers with when no issue says it better. */
export const INPUT_INVALID_MESSAGE = 'Some of what you entered isn\u2019t valid.';

/** An oRPC error with one of the map's codes, at the status the map gives it. */
export function apiError(code: ErrorCode, message: string, data?: ApiError['data']): ApiORPCError {
  return new ORPCError(code, { status: ERROR_MAP[code].status, message, data });
}

/** The error to send, and whether it was expected (a refusal, bad input) or must be logged as a fault. */
export interface MappedError {
  readonly error: ApiORPCError;
  readonly expected: boolean;
}

/** One problem a schema found, as Zod or oRPC hands it: where, what, and Zod's issue code. */
export interface SchemaIssue {
  readonly path?: ValidationError['issues'][number]['path'];
  readonly message: string;
  readonly code?: unknown;
}

function issuePath(path: SchemaIssue['path']): InputIssue['path'] {
  return (path ?? []).map((segment) => {
    const key = typeof segment === 'object' ? segment.key : segment;
    return typeof key === 'number' ? key : String(key);
  });
}

/** An INPUT_INVALID answer's sentence and the issues it lists. */
export interface InputProblems {
  readonly message: string;
  readonly issues: InputIssue[];
}

/** How `inputProblems` words its answer: how many issues it lists, and whether a field's sentence may lead. */
export interface InputProblemsOptions {
  readonly limit?: number;
  /** The first field's sentence leads, when no rule over the whole input does (a public page's one form). */
  readonly leadWithField?: boolean;
}

/**
 * What a schema's issues say on the wire. An issue on a field stays in
 * `issues`, so a form shows it on that field. An issue on no field (a rule
 * over the whole input, "The end time has to be after the start time.") is
 * said in the sentence only. Otherwise the sentence is `INPUT_INVALID_MESSAGE`
 * (or the first field's, with `leadWithField`), as it is for an input that
 * isn't even the right shape, which nobody typed. The words are the schema's
 * own or the plain safety net's (`installPlainErrors`): where and what, never
 * the input.
 */
export function inputProblems(
  found: readonly SchemaIssue[],
  { limit = MAX_INPUT_ISSUES, leadWithField = false }: InputProblemsOptions = {},
): InputProblems {
  const kept = found.slice(0, limit);
  const issues = kept
    .map((issue) => ({ path: issuePath(issue.path), message: issue.message }))
    .filter((issue) => issue.path.length > 0);
  const whole = kept.find(
    (issue) => (issue.path ?? []).length === 0 && issue.code !== 'invalid_type' && issue.message !== '',
  );
  const lead = leadWithField ? issues[0]?.message : undefined;
  return { message: whole?.message ?? lead ?? INPUT_INVALID_MESSAGE, issues };
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

/**
 * The sentence an answer leads with: its first refusal's, except that several
 * failed rules read "<n> rules aren't met." (spec 0013, `VALIDATION_FAILED`).
 */
function summaryOf(refusals: readonly ApiRefusal[]): string {
  const [first] = refusals;
  if (first === undefined) return INTERNAL_MESSAGE;
  const rules = refusals.filter((refusal) => refusal.code === 'VALIDATION_FAILED');
  if (first.code === 'VALIDATION_FAILED' && rules.length > 1) {
    return `${String(rules.length)} rules aren\u2019t met.`;
  }
  return first.message;
}

/** Turns anything thrown into the API's error shape. It never throws itself. */
export function toApiError(error: unknown): MappedError {
  // A field only the server could check (a record id from a device with a wrong clock): one issue on it.
  if (isInputError(error)) {
    const { field, message } = error.inputProblem;
    return { error: apiError('INPUT_INVALID', message, { issues: [{ path: [field], message }] }), expected: true };
  }
  if (isRefusal(error)) {
    const refusals = Refusals.safeParse(error.refusals);
    // The first refusal names the code; something only shaped like a refusal is a fault.
    const [first] = refusals.success ? refusals.data : [];
    if (refusals.success && first !== undefined) {
      return { error: apiError(first.code, summaryOf(refusals.data), { refusals: refusals.data }), expected: true };
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
      const { message, issues } = inputProblems(error.cause.issues);
      return { error: apiError('INPUT_INVALID', message, { issues }), expected: true };
    }
    // oRPC refusing the request itself before any procedure: a body it couldn't
    // decode, or a GET on a procedure that only takes POST.
    if (error.code === 'BAD_REQUEST' || error.code === 'METHOD_NOT_SUPPORTED') {
      return { error: apiError('INPUT_INVALID', 'The request could not be read.'), expected: true };
    }
  }
  return { error: apiError('INTERNAL', INTERNAL_MESSAGE), expected: false };
}
