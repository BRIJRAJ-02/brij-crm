// The record store's interface (spec 0005, the data layer): one copy of every
// record in the browser, keyed by id, whichever store holds it. The plain
// store (plain-store.ts) implements it. The prototype gate (AC-40) measured
// it against one on TanStack DB (in git at 4bac1a0), and
// docs/specs/0005-core-loop/verify.md records the numbers and the call.

/**
 * What the store needs of a record: its id and its values by attribute id,
 * and what orders two copies of it. The real layer stores RecordView.
 */
export interface RecordBody {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * Each cell's value version by attribute id: the uuid v7 of the write that
   * set it, so a later write has a greater one. A row never replaces a cell
   * the store holds at a newer version with an older one.
   */
  readonly versions?: Readonly<Record<string, string>>;
  /** A multi reference cell's full link count, when its list was cut short; it travels with the cell. */
  readonly linkTotals?: Readonly<Record<string, number>>;
  /** When the record last changed (ISO 8601 UTC): orders two copies for the cells without a version. */
  readonly updatedAt?: string;
}

/** Values by attribute id: what one edit changes. */
export type RecordValues = Readonly<Record<string, unknown>>;

/**
 * One optimistic change, showing from the moment it's made until its own
 * answer arrives. Only its own response (or its own echo) ends it: `confirm`
 * makes the server's row the record's base, `refuse` takes the change back.
 * Either way every other pending layer on that record stays on top.
 */
export interface Layer<Row extends RecordBody> {
  /** The mutation id the server sees, so the echo of this change can be told apart. */
  readonly id: string;
  readonly recordId: string;
  /** The server's answer: `row` becomes the base and this layer goes. */
  readonly confirm: (row: Row) => void;
  /** Refused (or signed out): this layer goes and the record shows what it would have without it. */
  readonly refuse: () => void;
}

/**
 * Called once per store change with the ids whose visible row changed. The
 * store calls it synchronously; batching per frame belongs to the live layer.
 */
export type StoreListener = (ids: ReadonlySet<string>) => void;

/**
 * The record store. Each record is a base (the last server state) with
 * optimistic layers on top, in the order they were made. A server row replaces
 * the base and the layers re-apply on top, so a confirmation never clobbers a
 * second edit still in flight, and a refusal restores exactly what the record
 * would show without that edit.
 */
export interface RecordStore<Row extends RecordBody> {
  /** The record as screens see it (its base with every layer on top), the same object until it changes. */
  readonly get: (id: string) => Row | undefined;
  /**
   * Rows from the server (a window, an event refetch): each becomes its
   * record's base, cell by cell by version (`newerBase`). A row nothing holds
   * and no layer waits on isn't kept; `hold` holds each row once as it lands
   * (a window's block), for the caller to `release`. A row with the same data
   * as the base keeps the old object, so nothing re-renders.
   */
  readonly receive: (rows: readonly Row[], options?: { readonly hold?: boolean }) => void;
  /** Holds records: each hold keeps a body until its `release`. Windows hold their ids; an open record page holds its one. */
  readonly hold: (ids: Iterable<string>) => void;
  /** Lets go of one hold per id. A record nothing holds and no layer waits on leaves the store at once. */
  readonly release: (ids: Iterable<string>) => void;
  /** Records gone on the server (trashed or out of reach): dropped with any layers. */
  readonly remove: (ids: readonly string[]) => void;
  /** An optimistic edit, showing at once. `mutationId` is the one sent with it. */
  readonly edit: (recordId: string, values: RecordValues, mutationId: string) => Layer<Row>;
  /**
   * An optimistic new record (a draft with no base yet), showing at once. A
   * refusal takes every edit made on the draft with it.
   */
  readonly create: (draft: Row, mutationId: string) => Layer<Row>;
  /** The ids with layers still waiting on the server. */
  readonly pending: () => ReadonlySet<string>;
  readonly subscribe: (listener: StoreListener) => () => void;
  /** How many records the store holds: those held, and those with layers waiting. */
  readonly size: () => number;
  /** Forgets everything (sign out). Pending layers are dropped without a word. */
  readonly clear: () => void;
}

/** Whether `a` is a later version than `b` (uuid v7 strings sort by time; an absent version is the oldest). */
const isLater = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && (b === undefined || a.toLowerCase() > b.toLowerCase());

/** A row with the given cells taken from `from` (values, versions and link totals), or `onto` itself when there are none. */
function withCells<Row extends RecordBody>(onto: Row, from: Row, cells: readonly string[]): Row {
  if (cells.length === 0) return onto;
  const taken = new Set(cells);
  const pick = <T>(target: Readonly<Record<string, T>> | undefined, source: Readonly<Record<string, T>> | undefined) =>
    Object.fromEntries([
      ...Object.entries(target ?? {}).filter(([cell]) => !taken.has(cell)),
      ...Object.entries(source ?? {}).filter(([cell]) => taken.has(cell)),
    ]);
  return {
    ...onto,
    values: pick(onto.values, from.values),
    versions: pick(onto.versions, from.versions),
    ...(onto.linkTotals === undefined && from.linkTotals === undefined
      ? {}
      : { linkTotals: pick(onto.linkTotals, from.linkTotals) }),
  };
}

/**
 * The newer of two copies of one record, cell by cell (spec 0005, writes): a
 * cell keeps the copy with the later version, so an answer or a block that
 * left the server before a newer write never puts an older value back. A
 * cell without a version on one side (never set, or a reference with no
 * current link) goes by the record's `updatedAt`, as do the record's own
 * fields: the copy changed last wins them, and `incoming` wins a tie.
 */
export function newerBase<Row extends RecordBody>(current: Row | undefined, incoming: Row): Row {
  if (current === undefined || current === incoming) return incoming;
  const incomingIsOlder =
    current.updatedAt !== undefined && incoming.updatedAt !== undefined && incoming.updatedAt < current.updatedAt;
  const mine = current.versions ?? {};
  const theirs = incoming.versions ?? {};
  if (incomingIsOlder) {
    // Start from ours; take only the cells the older copy holds at a later version.
    const cells = Object.keys(theirs).filter((cell) => isLater(theirs[cell], mine[cell]));
    return withCells(current, incoming, cells);
  }
  // Start from theirs; keep only the cells we hold at a later version than theirs.
  const cells = Object.keys(mine).filter((cell) => theirs[cell] !== undefined && isLater(mine[cell], theirs[cell]));
  return withCells(incoming, current, cells);
}

/** The base with each layer's values on top, oldest first: the one composition rule both stores share. */
export function composeRecord<Row extends RecordBody>(
  base: Row | undefined,
  layers: readonly { readonly draft?: Row; readonly values: RecordValues }[],
): Row | undefined {
  const start = base ?? layers.find((layer) => layer.draft !== undefined)?.draft;
  if (start === undefined) return undefined;
  if (layers.length === 0) return start;
  const values = layers.reduce<RecordValues>((merged, layer) => ({ ...merged, ...layer.values }), start.values);
  return { ...start, values };
}

/**
 * The layers left once `layerId` is answered. On a confirmation, older layers
 * lose the cells it wrote: the base now holds the newer value for them, and an
 * older edit's value must never show over it.
 */
export function remainingLayers<Layered extends { readonly id: string; readonly values: RecordValues }>(
  layers: readonly Layered[],
  layerId: string,
  confirmed: boolean,
): readonly Layered[] {
  const at = layers.findIndex((layer) => layer.id === layerId);
  const answered = layers[at];
  if (answered === undefined) return layers;
  const rest = layers.filter((layer) => layer.id !== layerId);
  if (!confirmed) return rest;
  const written = new Set(Object.keys(answered.values));
  return rest.map((layer, index) =>
    index >= at || !Object.keys(layer.values).some((key) => written.has(key))
      ? layer
      : { ...layer, values: Object.fromEntries(Object.entries(layer.values).filter(([key]) => !written.has(key))) },
  );
}
