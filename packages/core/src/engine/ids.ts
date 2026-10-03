// UUID v7 (RFC 9562): a 48 bit millisecond time, then random bits, so ids
// sort by creation and inserts stay local in every index (spec 0004).
import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A new UUID v7. Postgres 18's `uuidv7()` makes the same shape for rows the server inserts. */
export function newId(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True for a well formed UUID v7, the only id a client may mint for a new record. */
export function isUuidV7(value: string): boolean {
  return V7.test(value);
}

/** True for a well formed uuid, so a malformed id is refused before it reaches Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Ids as one `uuid[]` parameter list, for `= any(...)` in raw SQL. */
export function uuidArray(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
}

/**
 * Ids as a single `uuid[]` parameter, for long lists (a search's thousands of
 * owner ids) where one parameter per id would bloat the statement. Only ids the
 * database returned belong here: each is checked to be a uuid first.
 */
export function uuidList(ids: readonly string[]): SQL {
  if (!ids.every(isUuid)) throw new TypeError('uuidList takes uuids only.');
  return sql`${`{${ids.join(',')}}`}::uuid[]`;
}
