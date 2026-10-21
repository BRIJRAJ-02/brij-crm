// Ids at the boundary (spec 0009): every UUID a request, an answer or an event
// carries is parsed in lower case, the spelling Postgres answers and every
// access policy is keyed by. An upper case spelling of the same id found no
// object, field or record rule in a policy, so it read what the rule hides;
// the server now only ever sees the canonical one. Ids used as record keys
// (`z.record(z.uuid(), …)`) stay as written: core canonicalises them itself
// and refuses two spellings of one id rather than merging them unseen.
import * as z from 'zod';

/** A UUID in any case, answered in lower case: the one way an id enters the server. */
export const Uuid = z.uuid().toLowerCase();
/** A UUID, in lower case. */
export type Uuid = z.infer<typeof Uuid>;

/** A UUID v7 a client mints for a new row, answered in lower case, and refused with `message` when it isn't one. */
export function uuidV7(message: string): z.ZodUUID {
  return z.uuid({ version: 'v7', message }).toLowerCase();
}
