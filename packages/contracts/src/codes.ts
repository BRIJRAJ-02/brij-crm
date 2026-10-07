// `@crm/contracts/codes`: every stable error code, as plain lists with no Zod,
// so the browser's data layer can recognise a code without pulling the schema
// library into the first load. `errors.ts` builds the `ErrorCode` schema and
// the status map from this same list.
import { ENGINE_REFUSAL_CODES } from './values/engine.ts';

export { ENGINE_REFUSAL_CODES };

/** The request level codes: bad input, sign in, the edge guard, limits, and the server's own failures. */
export const REQUEST_ERROR_CODES = [
  'INPUT_INVALID',
  'UNAUTHENTICATED',
  'EMAIL_UNVERIFIED',
  'SIGNUP_CLOSED',
  'EDGE_REQUIRED',
  'FORBIDDEN_ORIGIN',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
  'API_UNAVAILABLE',
  'INTERNAL',
] as const;

/** Every code an API error can carry: the engine's refusals plus the request level codes. */
export const ERROR_CODES = [...ENGINE_REFUSAL_CODES, ...REQUEST_ERROR_CODES] as const;

/** One of the API's stable error codes. */
export type ErrorCodeName = (typeof ERROR_CODES)[number];
