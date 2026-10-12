// A change event as the harness reads it (spec 0007's `ChangeEvent`), parsed
// by hand as the browser's live layer does (`parseChangeEvent` in
// packages/data), without Zod: every user parses every publication, so at
// 250 users a thread the parse is on the hot path. Only what a People table
// acts on is kept: a records event's object, ids and attributes; the stub;
// and, for every other kind, its seq and `mutationId`.

/** A records event, as a People table acts on it. */
export interface LiveRecordsEvent {
  readonly kind: 'records';
  readonly seq: number;
  /** The commit time `at`, in ms since the epoch on the database's clock. */
  readonly atMs: number;
  readonly objectId: string;
  readonly recordIds: readonly string[];
  readonly attributeIds: readonly string[];
  readonly createdIds: readonly string[];
  readonly deletedIds: readonly string[];
  readonly restoredIds: readonly string[];
  readonly coarse: boolean;
  readonly mutationId?: string;
}

/** One event: records, the stub, or another kind (which a People table only counts). */
export type LiveEvent =
  | LiveRecordsEvent
  | { readonly kind: 'restricted'; readonly seq: number; readonly atMs: number }
  | { readonly kind: 'other'; readonly seq: number; readonly atMs: number; readonly mutationId?: string };

const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
/** An optional id list: absent is empty; anything else that isn't a list of strings is malformed. */
const optionalIds = (value: unknown): readonly string[] | undefined =>
  value === undefined ? [] : isStrings(value) ? value : undefined;

/**
 * A publication or a catch up's event, or undefined for anything that isn't
 * one (no positive seq, no `at`, or a records event missing its ids, which the
 * browser drops as well).
 */
export function parseLiveEvent(data: unknown): LiveEvent | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  const { seq, kind, at, mutationId } = raw;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || !isString(kind) || !isString(at)) {
    return undefined;
  }
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return undefined;
  if (mutationId !== undefined && !isString(mutationId)) return undefined;
  const mine = kind === 'restricted' || mutationId === undefined ? {} : { mutationId };
  if (kind === 'restricted') return { kind, seq, atMs };
  if (kind !== 'records') return { kind: 'other', seq, atMs, ...mine };
  const { objectId, recordIds, attributeIds, coarse } = raw;
  const createdIds = optionalIds(raw.createdIds);
  const deletedIds = optionalIds(raw.deletedIds);
  const restoredIds = optionalIds(raw.restoredIds);
  if (!isString(objectId) || !isStrings(recordIds) || !isStrings(attributeIds)) return undefined;
  if (createdIds === undefined || deletedIds === undefined || restoredIds === undefined) return undefined;
  if (coarse !== undefined && typeof coarse !== 'boolean') return undefined;
  return {
    kind,
    seq,
    atMs,
    objectId,
    recordIds,
    attributeIds,
    createdIds,
    deletedIds,
    restoredIds,
    coarse: coarse === true,
    ...mine,
  };
}
