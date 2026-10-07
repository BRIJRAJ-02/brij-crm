// UUID v7 (RFC 9562): a 48 bit millisecond time, then random bits, so ids
// sort by creation and inserts stay local in every index (spec 0004).
import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { refuse } from './refusals.ts';

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

/** The millisecond time a UUID v7 carries in its first 48 bits. */
export function uuidV7Time(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

/** True for a well formed uuid, so a malformed id is refused before it reaches Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * A uuid in its one spelling, lower case, as Postgres prints it. Ids match
 * case insensitively, but the engine compares, keys and publishes them as
 * strings, so every id a caller gives goes on in this form. Anything that
 * isn't a uuid comes back unchanged: it names nothing, and is refused or
 * left out where it is used.
 */
export function canonicalId<T>(value: T): T {
  return isUuid(value) ? (value.toLowerCase() as T) : value;
}

/**
 * Refuses `NOT_FOUND` with `message` when an id a caller gave isn't a uuid:
 * nothing can have that id, and casting it would fail the query (or a whole
 * batch) instead of refusing. Call it before any query that casts the id, and
 * use the id it returns from then on: the canonical, lower case spelling, so
 * an upper case id never becomes a second spelling of the same row.
 */
export function checkId(value: string, message: string): string {
  if (!isUuid(value)) throw refuse('NOT_FOUND', message);
  return value.toLowerCase();
}

/**
 * A map keyed by ids (values by attribute id) with every key canonical. Two
 * spellings of one id would be one key, so they are refused `CONFIG_INVALID`
 * rather than letting one of them win unseen. The result has no prototype, so
 * a key such as `__proto__` (which `JSON.parse` makes an own key) stays an
 * ordinary key, refused later as no attribute, and never becomes the map's
 * prototype, whose keys `in` would then find.
 */
export function canonicalKeys<T>(map: Readonly<Record<string, T>>): Record<string, T> {
  const result = Object.create(null) as Record<string, T>;
  for (const [key, value] of Object.entries(map)) {
    const canonical = canonicalId(key);
    if (Object.hasOwn(result, canonical)) {
      throw refuse('CONFIG_INVALID', 'That attribute is given twice. Give each attribute once.', canonical);
    }
    result[canonical] = value;
  }
  return result;
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
