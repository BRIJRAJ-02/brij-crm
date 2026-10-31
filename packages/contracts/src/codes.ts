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

/**
 * The code Centrifugo closes a browser's live connection with when one of the
 * person's sessions was signed out from another device (spec 0033, AC-891).
 * It sits in Centrifugo's terminal range, so the client never reconnects on
 * its own: the app checks its session first, and goes to sign in when it has
 * none (spec 0009's 4500, "access changed", is the other terminal code).
 */
export const SIGNED_OUT_DISCONNECT_CODE = 4501;

/**
 * The code Centrifugo closes a browser's live connection with when the
 * person's access in a workspace changed (spec 0009, AC-146; spec 0007,
 * AC-84): a role, a rule, a team or a removal. Terminal, so the client never
 * resubscribes with the token it held: it asks the door for each channel
 * again (its audience channel may have moved, or it is no longer a member),
 * then reconnects and catches up.
 */
export const ACCESS_CHANGED_DISCONNECT_CODE = 4500;
