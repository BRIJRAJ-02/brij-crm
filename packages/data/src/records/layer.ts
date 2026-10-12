// The records part of the data layer (spec 0005, task 11; spec 0006,
// milestone 1): one store of RecordView bodies for the app, a view per object
// (windows over the store, with a count and a status), optimistic creates and
// edits with rollback, cell refusals and toasts, and live patches: a change
// event's records fetched again in place, a new one placed at the end. Every
// edit names the base version it started from, a paste or a range clear is one
// batch write, the tab keeps its own written versions (the replaced notice)
// and an undo stack. createDataLayer loads this module when a screen first
// asks for records, so it stays out of the first load.
import type {
  AttributeDefinition,
  BatchResults,
  CreateRecordInput,
  RecordCount,
  RecordPage,
  RecordView,
  ChangeEvent,
  SetValuesBatchInput,
  SetValuesInput,
  WrittenRecord,
} from '@crm/contracts';
import { canJump, type JumpAttribute } from '@crm/contracts/jump';
import type { FilterGroup, Hue, SortRules } from '@crm/contracts/values';
import type { PatternCompiler, RuleFailure } from '@crm/contracts/validation';
import { dataError, refusalFor, refusalSummary, toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createOwnVersions, createUndoStack, type UndoCell, type UndoKind } from './history.ts';
import { createReferenceNames, type NameState, type RecordRef } from './names.ts';
import { createRecordSubscriptions, type RecordAttributes, type RecordSubscription } from './one.ts';
import { createPlainStore, sameData } from './plain-store.ts';
import type { Layer } from './store.ts';

/** A records change event (spec 0007's union), as the live router hands it over. */
type RecordsEvent = Extract<ChangeEvent, { kind: 'records' }>;
import { createRecordView, nextFrame, type Pin, type RecordSource, type RowNote, type Scheduler } from './view.ts';
import { createWindows, type ReadFrom, type WindowCount, type WindowMode, type Windows } from './windows.ts';
import {
  checkInBrowser,
  needsPattern,
  NO_PATTERN,
  objectRulesOf,
  touchedRules,
  type ObjectRules,
} from '../validation/rules.ts';

/** Rows per block: `records.query` with `position` = block × 100 (spec 0005, value sourcing). */
const BLOCK_SIZE = 100;
/** How many times a read the server turned away for being busy (429) is tried again. */
const BUSY_TRIES = 5;
/** How many times a write that never reached the server is sent again (the same ids, so nothing happens twice). */
const OFFLINE_TRIES = 2;
/** The wait before trying again when the answer named none, in seconds. */
const DEFAULT_WAIT_SECONDS = 1;
/** The longest wait before a block that failed to load is tried again, in ms. */
const MAX_BLOCK_RETRY_MS = 30_000;
/** The most ids `records.get` takes at once. */
const GET_LIMIT = 500;
/** The most records one paste, range clear or undo writes at once (`MAX_BATCH_RECORDS` in the contract, AC-50). */
export const MAX_BATCH_RECORDS = 500;
/** The most cells one write changes (`MAX_BATCH_CELLS` in the contract). */
export const MAX_BATCH_CELLS = 5_000;
/** The most a write may carry, under the API's 1 MB body limit with room for the ids around it. */
export const MAX_WRITE_BYTES = 900_000;
/** What each cell adds to a write besides its value: its attribute id, base version and the JSON around them. */
const CELL_OVERHEAD_BYTES = 120;
/** The longest spread before a refetch many browsers make at once (a count after an unplaced change), in ms. */
const SPREAD_MS = 2000;
/** How long a changed id is remembered, so a block that was loading when it changed fetches it again, in ms. */
const RECENT_MS = 10_000;
/** How long a window waits after the last change in it before it settles order and membership, in ms (AC-56). */
export const SETTLE_MS = 1500;
/** The longest a window waits after the first change that dirtied it, so steady traffic never starves a settle, in ms. */
export const SETTLE_MAX_MS = 5000;
/** How many times a block or a count that failed is tried again by itself before it waits for the screen or Retry. */
const MAX_AUTO_RETRIES = 5;
/** Read refusals that mean the view itself is wrong (a bad filter or sort, a gone object): its error state, Retry. */
const REFUSED_READS: ReadonlySet<string> = new Set(['FILTER_INVALID', 'NOT_FOUND', 'INPUT_INVALID']);

/** The question a view asks (spec 0006, AC-51): its filter and sorts. Two screens asking the same one share a window. */
export interface ViewQuery {
  readonly filter?: FilterGroup;
  readonly sorts?: SortRules;
}

/** What a window needs to know of its object: the primary attribute (always read) and each attribute's kind (its mode). */
export interface ObjectShape {
  readonly primaryAttributeId?: string;
  /** Each attribute's kind, and its title when known (a refusal's toast names the field). */
  readonly attributes: readonly (JumpAttribute & { readonly id: string; readonly title?: string })[];
}

/**
 * Refusals that may pass if sent again unchanged: the server busy, failing or
 * out of reach. Only these offer Retry; a refused value would only be refused
 * again, so its cell says why instead.
 */
const TEMPORARY_CODES: ReadonlySet<string> = new Set([
  'INTERNAL',
  'API_UNAVAILABLE',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
]);

/** `value` as JSON with every object's keys in order and nothing undefined, so two spellings of one query match. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The attribute ids a filter names, at any depth (a through chain's own attribute included). */
function filterAttributes(group: FilterGroup | undefined): readonly string[] {
  if (group === undefined) return [];
  return group.conditions.flatMap((condition): readonly string[] => {
    if ('conditions' in condition) return filterAttributes(condition);
    return 'attributeId' in condition && typeof condition.attributeId === 'string' ? [condition.attributeId] : [];
  });
}

/**
 * What a change must touch to move a window's order or membership: the
 * attributes its filter and sorts name. `any` when every write can (a sort or
 * filter on updated at or updated by, which every write moves).
 */
function orderAttributesOf(query: ViewQuery, shape: ObjectShape | undefined): OrderAttributes {
  const ids = new Set([...filterAttributes(query.filter), ...(query.sorts ?? []).map((sort) => sort.attributeId)]);
  const moving = (shape?.attributes ?? []).filter(
    (attribute) => attribute.isSystem && (attribute.apiSlug === 'updated_at' || attribute.apiSlug === 'updated_by'),
  );
  return {
    ids,
    any: moving.some((attribute) => ids.has(attribute.id)),
    moving: new Set(moving.map((attribute) => attribute.id)),
  };
}

/** The attributes a window's order and membership depend on (`orderAttributesOf`). */
interface OrderAttributes {
  readonly ids: ReadonlySet<string>;
  readonly any: boolean;
  /** The object's updated at and updated by: every write moves them. */
  readonly moving: ReadonlySet<string>;
}

/** The calls the records layer makes, each mapped to a DataError on failure (a 401 has already signed out). */
export interface RecordsApi {
  readonly query: (
    input: ReadFrom &
      ViewQuery & {
        readonly workspace: string;
        readonly objectId: string;
        readonly limit: number;
        readonly attributeIds: readonly string[];
        readonly now: string;
        readonly timeZone: string;
      },
    signal: AbortSignal,
  ) => Promise<RecordPage>;
  readonly count: (
    input: {
      readonly workspace: string;
      readonly objectId: string;
      readonly filter?: FilterGroup;
      readonly now: string;
      readonly timeZone: string;
    },
    signal: AbortSignal,
  ) => Promise<RecordCount>;
  /** Records by id; with `attributeIds`, only those and the primary. */
  readonly get: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
    readonly attributeIds?: readonly string[];
  }) => Promise<RecordView[]>;
  readonly create: (input: CreateRecordInput) => Promise<WrittenRecord>;
  readonly setValues: (input: SetValuesInput) => Promise<WrittenRecord>;
  readonly setValuesBatch: (input: SetValuesBatchInput) => Promise<BatchResults>;
}

/** One cell a write changes: its value, and for an undo the version it must still be at (`ifVersionId`). */
interface CellWrite {
  readonly attributeId: string;
  /** What the cell shows (and holds, once it lands). */
  readonly value: unknown;
  /**
   * What goes to the server when it differs from what shows: a new option
   * from a cell sends `{ newOption }` while the cell shows its minted id
   * (spec 0012, AC-238).
   */
  readonly sent?: unknown;
  readonly ifVersionId?: string;
}

/** One record's cells in a write. */
interface RecordWrite {
  readonly recordId: string;
  readonly cells: readonly CellWrite[];
}

/** How a write is treated: pushed on the undo stack as this kind of action, and codes that roll back quietly. */
interface WriteOptions {
  readonly undo?: UndoKind;
  /** The action's mutation id, when the caller needs to know it (the undo entry's id); minted otherwise. */
  readonly mutationId?: string;
  /** Refusals that roll back with no cell mark (an undo's `VERSION_CHANGED`, which its own toast counts). */
  readonly quiet?: ReadonlySet<string>;
}

/** How one record's part of a write ended: landed (`row`), refused (`failure`), or gone on the server. */
interface RecordOutcome {
  readonly recordId: string;
  readonly cells: readonly CellWrite[];
  readonly row?: RecordView;
  /** With `row`: the version the write made for each attribute it changed (the answer's `written`). */
  readonly written?: Readonly<Record<string, string>>;
  /** With `row`: each cell's version in the base when the write went out, which it replaced. */
  readonly sentFrom?: ReadonlyMap<string, string>;
  readonly failure?: DataError;
  readonly gone?: boolean;
}

/** What an edit came to, for the screen's toast: refused whole over 500 records, or how many cells landed. */
export type EditOutcome =
  | { readonly kind: 'too-many'; readonly limit: number }
  /** More cells, or more data, than one write carries (5,000 cells, about 900 kB): refused before anything shows. */
  | { readonly kind: 'too-big' }
  | {
      readonly kind: 'done';
      readonly cells: number;
      readonly landed: number;
      /** The undo entry this action pushed, for a toast's Undo (`undo.run(workspace, undoId)`); absent when none. */
      readonly undoId?: string;
    };

/**
 * What an undo did, for the screen's toast (spec 0006, AC-48, AC-49):
 * nothing to undo, or the action it undid, how many of its cells went back,
 * how many were kept because they changed since, and how many were refused
 * for another reason (those already raised their own toast).
 */
export type UndoOutcome =
  | { readonly kind: 'nothing' }
  /** A toast's Undo whose action is no longer the newest (a later change, or already undone): nothing was done. */
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'undone';
      readonly action: UndoKind;
      readonly objectId: string;
      readonly cells: number;
      readonly undone: number;
      readonly kept: number;
      readonly failed: number;
      /** The action's first cell, which a one cell undo names ("Undid Email on Jane Doe"). */
      readonly first: { readonly recordId: string; readonly attributeId: string; readonly recordName: string };
    };

/**
 * The facts of a "your value was replaced" notice (spec 0006, AC-46): which
 * record, the cells replaced (the first is named, "and 2 more" for the rest),
 * who replaced them, and "Use mine", which saves this tab's values again as a
 * normal, undoable edit. The screen words it.
 */
export interface ReplacedNotice {
  readonly workspace: string;
  readonly objectId: string;
  readonly recordId: string;
  readonly recordName: string;
  readonly attributeIds: readonly string[];
  readonly by: { readonly type: 'member' | 'api_key' | 'automation'; readonly id: string | null };
  readonly useMine: () => void;
}

/** One cell's new value, as the grid hands it over (structurally the library's `CellChange`). */
export interface CellChange {
  readonly rowId: string;
  readonly columnId: string;
  readonly value: unknown;
}

/** A change as the layer writes it: what goes to the server when it differs from `value` (a cell's new option, only ever made here). */
interface SentChange extends CellChange {
  readonly sent?: unknown;
}

/** A new option a cell's write sends (`{ newOption: { id, label } }`), alone or in a multi select's list. */
interface NewOptionSent {
  readonly id: string;
  readonly label: string;
}

/** The new option a cell's sent value names, if any (spec 0012, AC-238). */
function newOptionOf(sent: unknown): NewOptionSent | undefined {
  const items: readonly unknown[] = Array.isArray(sent) ? (sent as readonly unknown[]) : [sent];
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('newOption' in item)) continue;
    const option = (item as { readonly newOption: unknown }).newOption;
    if (typeof option !== 'object' || option === null) continue;
    const { id, label } = option as { readonly id?: unknown; readonly label?: unknown };
    if (typeof id === 'string' && typeof label === 'string') return { id, label };
  }
  return undefined;
}

/** Where a view stands: loading its count and first rows, ready, or failed (with Retry). */
export type ViewStatus = 'loading' | 'ready' | 'error';

/** What a screen reads from a view, one object per change. */
export interface ViewState {
  /** The grid's RowSource. */
  readonly source: RecordSource<RecordView>;
  readonly status: ViewStatus;
  /** Why it failed, while `status` is `error`. */
  readonly error?: DataError;
  /** Refused values by `${recordId}:${attributeId}`, to a sentence; each goes with the cell's next edit. */
  readonly cellErrors: ReadonlyMap<string, string>;
  /** The count for the label: exact, or "10,000+" when `atLeast` (a filtered view past 10,000). */
  readonly count: WindowCount;
  /** How the view reads: jumping by position, or paging by cursor (spec 0006, AC-52, AC-53). */
  readonly mode: WindowMode;
  /** Notes on the member's own rows (spec 0006, AC-56): made here, or no longer matching the view. */
  readonly rowNotes: ReadonlyMap<string, RowNote>;
  /**
   * How the records a cell links to show (a person's Company): each one's
   * display, `loading` while its name is read (in the next frame, batched,
   * once per record for the app load), or `unknown` when it can't be read
   * (hidden from this person, or deleted). The view renders again when names
   * arrive, and a live change to a named record reads it again.
   */
  readonly referenceDisplays: (refs: readonly RecordRef[]) => readonly NameState[];
}

/** One screen reading a view: the columns it shows (`columns`), and `release` when it goes. */
export interface ViewReader {
  /** The attributes this screen shows now; a newly shown one is fetched for the loaded rows only. */
  readonly columns: (attributeIds: readonly string[]) => void;
  readonly release: () => void;
}

/** An object's records as one screen shows them, for useSyncExternalStore (`useView` in `@crm/data/react`). */
export interface RecordsView {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ViewState;
  /** Loads the count and every block on screen again, after a failure. */
  readonly retry: () => void;
  /** Settles once the count and the first block have loaded, or failed (the status then says so). */
  readonly ready: () => Promise<void>;
  /** The row a record shows at, while a loaded block or a pin holds it (a record just made here sits first). */
  readonly indexOf: (recordId: string) => number | undefined;
  /**
   * A screen shows the view with these columns (`useView` calls it in an
   * effect); the reader's `release` lets go. A view nobody shows for 30 seconds
   * lets go of its rows, and the next `view()` makes a fresh one. Counted, so
   * StrictMode's second effect changes nothing. The member's own rows stay
   * in place until the last reader leaves.
   */
  readonly retain: (attributeIds?: readonly string[]) => ViewReader;
  /** A cell editor opened (true) or closed (false) in the view: order and membership don't settle while one is open. */
  readonly holdSettle: (isHeld: boolean) => void;
}

/** What the records layer needs from createDataLayer. */
export interface RecordsLayerOptions {
  readonly api: RecordsApi;
  readonly notify: (notice: Notice) => void;
  readonly mintId: () => string;
  /** When views announce changes: once a frame in the browser. */
  readonly schedule?: Scheduler;
  /** Waits `ms`, or rejects when `signal` aborts first. A timer by default; tests pass their own. */
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Unix milliseconds now, for a draft's timestamps. */
  readonly now?: () => number;
  /** A number in [0, 1), to spread retries out so many browsers don't retry in step (`Math.random`). */
  readonly random?: () => number;
  /** How long a view nobody shows is kept before it lets go of its rows, in ms: a minute. */
  readonly keepUnusedViewMs?: number;
  /** Listens to a workspace's live changes while one of its views is open; the answer stops (`live.watch`). */
  readonly watch?: (workspace: string) => () => void;
  /**
   * Settles once the workspace's head is read (spec 0007), so a view's first
   * read comes after its first watermark. At once by default.
   */
  readonly beforeRead?: (workspace: string) => Promise<void>;
  /**
   * Mutation ids about to go out (`MutationLog.sent`), how many echoes each
   * answer named (`answered`), and ones refused, which will never echo (`forget`).
   */
  readonly mutations?: {
    readonly sent: (mutationId: string) => void;
    readonly answered: (mutationId: string, echoes: number) => void;
    readonly forget: (mutationId: string) => void;
  };
  /** This person's member id in a workspace (`access.mine`), so their own saves never raise a replaced notice. */
  readonly memberOf?: (workspace: string) => Promise<string | undefined>;
  /** A value this tab wrote was replaced by someone else's later save (spec 0006, AC-46): the screen words it. */
  readonly onReplaced?: (notice: ReplacedNotice) => void;
  /** The object's primary attribute and its attributes' kinds (spec 0005's `attributes.list` cache until milestone 3). */
  readonly describe?: (workspace: string, objectId: string) => Promise<ObjectShape>;
  /** The browser's time zone, which relative date filters resolve in (AC-51). */
  readonly timeZone?: () => string;
  /**
   * An object's attribute definitions, with their rules inline, from the
   * definitions store (spec 0013, AC-257): at once when they are held, else
   * once they load. A create or an edit is checked against their rules
   * before anything shows or is sent. Without it nothing is checked here
   * (the server checks every write anyway).
   */
  readonly definitionsOf?: (
    workspace: string,
    objectId: string,
  ) => readonly AttributeDefinition[] | Promise<readonly AttributeDefinition[]>;
  /** Runs `run` after `ms`, answering a cancel: settle's timer. A timer by default; tests pass their own. */
  readonly later?: (run: () => void, ms: number) => () => void;
  /**
   * A cell's new option (spec 0012, AC-238) as its write goes: `asked` as it
   * goes out (again on a Retry), `refused` when it rolls back, and `made`
   * once it lands, with the id the server set (a live option with that label
   * when one appeared meanwhile, else the minted one).
   */
  readonly cellOptions?: {
    readonly asked: (
      workspace: string,
      option: { readonly attributeId: string; readonly id: string; readonly label: string; readonly hue: Hue },
    ) => void;
    readonly refused: (workspace: string, attributeId: string, id: string) => void;
    readonly made: (
      workspace: string,
      objectId: string,
      made: { readonly attributeId: string; readonly id: string; readonly resolvedId: string },
    ) => void;
  };
}

/** The words the records layer raises itself. */
export const RECORD_WORDS = {
  retry: 'Retry',
  draftRefused: 'That record wasn’t created, so the change to it wasn’t saved.',
  /** A multi select's new option on a cell whose values haven't loaded yet: sending it would replace them. */
  optionNotReady: 'That cell is still loading. Try again in a moment.',
  /** A column just shown whose values couldn't be read for the rows on screen (spec 0006, AC-55). */
  columnNotRead: 'Couldn’t load that column’s values.',
  recordGone: 'That record was deleted, so the change wasn’t saved.',
  notSaved: (count: number) => `${String(count)} changes weren’t saved.`,
  /** One cell that failed for a passing reason, by its field: "Couldn’t save City. Something went wrong…". */
  notSavedNamed: (title: string, reason: string) => `Couldn’t save ${title}. ${reason}`,
  /** Refused values on several records: each cell already says why, so this only counts them. */
  notSavedMarked: (count: number) => `${String(count)} changes weren’t saved. Each cell says why.`,
  /** Several rules a write breaks, in one toast (spec 0013; the server's own words for it). */
  rulesNotMet: (count: number) => `${String(count)} rules aren\u2019t met.`,
  /** A refused undo, sent again from its toast's Retry. */
  undoRetried: (count: number) => (count === 1 ? 'Undid 1 change.' : `Undid ${String(count)} changes.`),
  kept: (count: number) =>
    count === 1
      ? '1 cell was changed since, so it was kept.'
      : `${String(count)} cells were changed since, so they were kept.`,
} as const;

/** UTF-8, as a request body counts its bytes. */
const UTF8 = new TextEncoder();

/** How many bytes a cell adds to a write: its value as JSON in UTF-8, and its ids and version around it. */
function cellBytes(value: unknown): number {
  // A cell's value is JSON shaped; `undefined` (nothing at all) is the one that stringifies to nothing.
  return CELL_OVERHEAD_BYTES + (value === undefined ? 0 : UTF8.encode(JSON.stringify(value)).byteLength);
}

const timer = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(toDataError(signal.reason));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(toDataError(signal.reason));
      },
      { once: true },
    );
  });

interface ViewEntry {
  readonly workspace: string;
  readonly objectId: string;
  readonly query: ViewQuery;
  readonly windows: Windows;
  readonly view: RecordsView;
  readonly invalidate: () => void;
  /** Settles now: the blocks on screen and the count again (live changes may have been missed). */
  readonly reread: () => void;
  /** Something may have moved the order or membership: settle 1.5 s after the last such change. */
  readonly markDirty: () => void;
  readonly orderAttributes: () => OrderAttributes;
  /** The attributes the window reads now: its readers' columns and the primary. */
  readonly attributes: () => readonly string[];
  /** The member edited these records here: those on screen keep their place through the next settle. */
  readonly edited: (ids: readonly string[]) => void;
  /** The member made this record here: it sits first, marked new, until they leave. */
  readonly created: (id: string) => void;
  /** A record made here was refused: it leaves. */
  readonly withdrawn: (id: string) => void;
  readonly isRetained: () => boolean;
  /** Whether a loaded block or a pin holds `id`. */
  readonly shows: (id: string) => boolean;
  readonly isReady: () => boolean;
  readonly dispose: () => void;
}

/** Splits `items` into runs of at most `size`. */
const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** One object's changes gathered for a frame: its record ids, and the attributes they name ('all' when one didn't say). */
interface Gathered {
  readonly ids: Set<string>;
  readonly attributes: Set<string> | 'all';
  /** Records the writes made, deleted or restored: a window's count and membership move (settle). */
  readonly lifecycle: Set<string>;
}

/** The records a change event names as made, deleted and restored (spec 0007; owner decision pending). */
export interface Lifecycle {
  readonly createdIds?: readonly string[];
  readonly deletedIds?: readonly string[];
  readonly restoredIds?: readonly string[];
}

/** The records layer: one store for the app, a view per object, and the writes that change them. */
export function createRecordsLayer({
  api,
  notify,
  mintId,
  schedule = nextFrame,
  wait = timer,
  now = () => Date.now(),
  random = Math.random,
  keepUnusedViewMs = 30_000,
  watch = () => () => undefined,
  beforeRead = () => Promise.resolve(),
  mutations = { sent: () => undefined, answered: () => undefined, forget: () => undefined },
  memberOf = () => Promise.resolve(undefined),
  onReplaced = () => undefined,
  describe = () => Promise.resolve({ attributes: [] }),
  timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  definitionsOf,
  later = (run, ms) => {
    const id = setTimeout(run, ms);
    return () => {
      clearTimeout(id);
    };
  },
  cellOptions = { asked: () => undefined, refused: () => undefined, made: () => undefined },
}: RecordsLayerOptions) {
  // Each held attribute list's rules (spec 0013), worked out once per list: a list read again is a new one.
  const rulesByList = new WeakMap<readonly AttributeDefinition[], ObjectRules>();
  const rulesOfList = (list: readonly AttributeDefinition[]): ObjectRules => {
    const known = rulesByList.get(list);
    if (known !== undefined) return known;
    const rules = objectRulesOf(list);
    rulesByList.set(list, rules);
    return rules;
  };

  // RE2 for pattern rules (spec 0013, AC-258), loaded with `import()` the first time a write touches one.
  let patterns: PatternCompiler | undefined;
  let loadingPatterns: Promise<PatternCompiler> | undefined;
  const loadPatterns = (): Promise<PatternCompiler> => {
    loadingPatterns ??= import('../validation/pattern.ts').then(({ compilePattern }) => {
      patterns = compilePattern;
      return compilePattern;
    });
    return loadingPatterns;
  };

  /**
   * What a write is checked with (spec 0013, AC-257): the object's rules and
   * the pattern engine it needs. Answered at once when both are at hand (no
   * rule, or the definitions held and RE2 loaded), else once they are, so a
   * write to an object with no rules shows at once.
   */
  function checkWith(
    workspace: string,
    objectId: string | undefined,
    written: ReadonlySet<string>,
    isCreate: boolean,
  ):
    | { readonly rules: ObjectRules; readonly pattern: PatternCompiler }
    | undefined
    | Promise<{ readonly rules: ObjectRules; readonly pattern: PatternCompiler } | undefined> {
    if (definitionsOf === undefined || objectId === undefined) return undefined;
    const ready = (rules: ObjectRules) => {
      const touched = touchedRules(rules, written, isCreate);
      if (touched.length === 0) return undefined;
      if (!needsPattern(touched)) return { rules, pattern: NO_PATTERN };
      if (patterns !== undefined) return { rules, pattern: patterns };
      // A failed load leaves the patterns to the server.
      return loadPatterns().then(
        (pattern) => ({ rules, pattern }),
        () => ({ rules, pattern: NO_PATTERN }),
      );
    };
    const definitions = definitionsOf(workspace, objectId);
    return definitions instanceof Promise
      ? definitions.then(
          (list) => ready(rulesOfList(list)),
          () => undefined,
        )
      : ready(rulesOfList(definitions));
  }

  /** What one record's broken rules say on a cell: its own rule's message, else the first one's, which names its field. */
  const ruleMessageFor = (failures: readonly RuleFailure[], attributeId: string): string | undefined =>
    (failures.find((failure) => failure.attributeId === attributeId) ?? failures[0])?.message;

  /** A browser check's failures as the refusals the server would answer. */
  const refusalsOfRules = (failures: readonly RuleFailure[]) =>
    failures.map((failure) => ({
      code: 'VALIDATION_FAILED' as const,
      message: failure.message,
      ruleId: failure.ruleId,
      ...(failure.attributeId === undefined ? {} : { attributeId: failure.attributeId }),
    }));

  /** One sentence for a record's broken rules: the rule's own message, or how many there are. */
  const rulesSummary = (count: number, first: string | undefined): string =>
    count > 1 || first === undefined ? RECORD_WORDS.rulesNotMet(count) : first;

  // New options from cells (spec 0012, AC-238): each minted id's label and hue, and what it resolved to once its
  // write answered (the id the server set, or undefined when refused), so a write naming it waits for that.
  const optionLooks = new Map<string, { readonly label: string; readonly hue: Hue }>();
  const madeOptions = new Map<
    string,
    { readonly promise: Promise<string | undefined>; readonly settle: (id: string | undefined) => void; done: boolean }
  >();
  /** The made option's entry for a minted id, a fresh one when there is none or the last one settled (a Retry). */
  const madeEntry = (id: string) => {
    const held = madeOptions.get(id);
    if (held !== undefined && !held.done) return held;
    let settle: (resolved: string | undefined) => void = () => undefined;
    const promise = new Promise<string | undefined>((resolve) => {
      settle = resolve;
    });
    const entry = {
      promise,
      settle: (resolved: string | undefined) => {
        entry.done = true;
        settle(resolved);
      },
      done: false,
    };
    madeOptions.set(id, entry);
    return entry;
  };
  /** Settles a cell's new option, if it names one: the id the server set, or undefined when refused. */
  const settleOptions = (
    workspace: string,
    objectId: string | undefined,
    cells: readonly CellWrite[],
    row?: RecordView,
  ) => {
    for (const cell of cells) {
      const option = newOptionOf(cell.sent);
      if (option === undefined) continue;
      if (row === undefined || objectId === undefined) {
        madeEntry(option.id).settle(undefined);
        cellOptions.refused(workspace, cell.attributeId, option.id);
        continue;
      }
      const held = row.values[cell.attributeId];
      const sentIds = new Set(
        (Array.isArray(cell.sent) ? (cell.sent as readonly unknown[]) : []).filter(
          (item): item is string => typeof item === 'string',
        ),
      );
      const resolvedId =
        typeof held === 'string'
          ? held
          : Array.isArray(held)
            ? ((held as readonly unknown[]).find(
                (item): item is string => typeof item === 'string' && !sentIds.has(item),
              ) ?? option.id)
            : option.id;
      madeEntry(option.id).settle(resolvedId);
      cellOptions.made(workspace, objectId, { attributeId: cell.attributeId, id: option.id, resolvedId });
    }
  };
  /**
   * The ids a write names that are new options still on their way (made by
   * another cell's write), waited for and mapped to the ids the server set; a
   * refused one leaves a list, and a single value as it is (the server
   * refuses it on the cell).
   */
  const resolveMade = async (value: unknown): Promise<unknown> => {
    const ids: readonly unknown[] = Array.isArray(value) ? (value as readonly unknown[]) : [value];
    const waiting = ids.filter((id): id is string => typeof id === 'string' && madeOptions.has(id));
    if (waiting.length === 0) return value;
    const resolved = new Map(
      await Promise.all(
        waiting.map(async (id) => [id, await (madeOptions.get(id)?.promise ?? Promise.resolve(id))] as const),
      ),
    );
    if (!Array.isArray(value)) return typeof value === 'string' ? (resolved.get(value) ?? value) : value;
    return (value as readonly unknown[]).flatMap((id) => {
      if (typeof id !== 'string' || !resolved.has(id)) return [id];
      const to = resolved.get(id);
      return to === undefined ? [] : [to];
    });
  };
  const store = createPlainStore<RecordView>({ now, later });
  // The names of linked records, read by id with the primary attribute only; arriving names redraw that workspace's views.
  const names = createReferenceNames({
    read: async (workspace, ids) => {
      const rows = await whenFree(() => api.get({ workspace, ids, attributeIds: [] }));
      return rows.map((row) => ({ id: row.id, display: row.display }));
    },
    schedule,
    onNames: (workspace) => {
      for (const entry of viewsOf(workspace)) entry.invalidate();
      subscriptions.renamed(workspace);
    },
    held: (recordId) => store.get(recordId)?.display,
    later: (run, ms) => {
      later(run, ms);
    },
  });
  // The versions this tab wrote (the last 500), its undo stack, and the undoable writes still out, by workspace.
  const own = createOwnVersions();
  const undo = createUndoStack();
  const inflight = new Map<string, Set<Promise<void>>>();
  // Each workspace's undo work, one press at a time.
  const undoing = new Map<string, Promise<void>>();
  const views = new Map<string, ViewEntry>();
  // Creates still waiting on the server, by record id: an edit to the draft is sent after it.
  const creating = new Map<string, Promise<boolean>>();
  // Each record's last write still out: the next one is sent after it, so the server applies a
  // record's edits in the order they were made and the later value gets the later version.
  const sending = new Map<string, Promise<unknown>>();
  let cellErrors: ReadonlyMap<string, string> = new Map();

  const keyOf = (workspace: string, objectId: string, query: ViewQuery = {}) => {
    const filter = query.filter === undefined || query.filter.conditions.length === 0 ? null : query.filter;
    const sorts = query.sorts === undefined || query.sorts.length === 0 ? null : query.sorts;
    return `${workspace}\u0000${objectId}\u0000${canonicalJson({ filter, sorts })}`;
  };
  const viewsOf = (workspace: string) => [...views.values()].filter((entry) => entry.workspace === workspace);

  const setCellErrors = (changes: readonly (readonly [string, string | undefined])[]) => {
    if (!changes.some(([key, message]) => cellErrors.get(key) !== message)) return;
    const next = new Map(cellErrors);
    for (const [key, message] of changes) {
      if (message === undefined) next.delete(key);
      else next.set(key, message);
    }
    cellErrors = next;
    for (const entry of views.values()) entry.invalidate();
    subscriptions.invalidate();
  };

  /** Runs a read, trying again after the server's `Retry-After` while it answers that it's busy (429). */
  async function whenFree<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const failure = toDataError(error);
        if (failure.code !== 'TOO_MANY_REQUESTS' || attempt >= BUSY_TRIES || signal?.aborted === true) throw failure;
        // At least the server's wait, longer each try, and spread out, so busy browsers don't retry in step.
        const seconds = failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS;
        await wait(Math.round(seconds * 1000 * attempt * (1 + random())), signal);
      }
    }
  }

  /** Sends a write, sending it again when it never reached the server (its ids make a repeat harmless). */
  async function delivered<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const failure = toDataError(error);
        if (failure.code !== 'API_UNAVAILABLE' || attempt > OFFLINE_TRIES) throw failure;
        await wait((failure.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS) * 1000);
      }
    }
  }

  /** Records gone on the server: out of the store and out of every window, whose later rows reload. */
  const dropRecords = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    store.remove(ids);
    const gone = new Set(ids);
    for (const entry of views.values()) entry.windows.drop(gone);
  };

  function openView(workspace: string, objectId: string, query: ViewQuery, warm: readonly string[]): ViewEntry {
    const key = keyOf(workspace, objectId, query);
    let status: ViewStatus = 'loading';
    let error: DataError | undefined;
    let isCounted = false;
    let settleReady: () => void = () => undefined;
    let readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    let countController = new AbortController();
    let blockFailures = 0;
    let blockRetry: AbortController | undefined;
    // What the object looks like: its primary attribute, and its attributes' kinds, which pick the mode.
    let shape: ObjectShape | undefined;
    let mode: WindowMode = 'position';
    // The window's clock (spec 0006, AC-51): one `now` for every block and count, refreshed at each settle.
    let clock = now();
    // A refused cursor restarts the chain once; a read that lands allows it again.
    let hasRestarted = false;
    const isOpen = () => views.get(key)?.view === view;

    // Visible attributes (spec 0006, AC-55): each reader's columns, unioned, plus the primary.
    const readers = new Map<symbol, readonly string[]>();
    const attributeSet = (): readonly string[] => {
      const shown = readers.size === 0 ? warm : [...readers.values()].flat();
      const primary = shape?.primaryAttributeId;
      return [...new Set([...shown, ...(primary === undefined ? [] : [primary])])];
    };
    let readSet = attributeSet();

    const setStatus = (next: ViewStatus, failure?: DataError) => {
      if (status === next && error === failure) return;
      status = next;
      error = failure;
      inner.invalidate();
      if (next === 'loading') return;
      // Whoever awaits `ready` reads the snapshot next: it must already show the rows.
      inner.flush();
      settleReady();
    };
    const fail = (failure: unknown) => {
      setStatus('error', toDataError(failure));
    };
    /**
     * A read failed. Before the view is ready, or refused outright (a bad
     * filter, a cursor the restart didn't fix), that is the view failing
     * (Retry). Otherwise the table stays and the block is tried again later.
     */
    const blockFailed = (failure: unknown, read: { readonly withCursor: boolean }) => {
      const problem = toDataError(failure);
      const isCursorRefused =
        read.withCursor &&
        problem.code === 'INPUT_INVALID' &&
        (problem.data?.issues ?? []).some((issue) => issue.path[0] === 'cursor');
      // A cursor the server refused (another view's, or one it can no longer read): the chain starts again, once.
      if (isCursorRefused && !hasRestarted) {
        hasRestarted = true;
        windows.restart();
        return;
      }
      if (status !== 'ready' || isCursorRefused || REFUSED_READS.has(problem.code)) {
        fail(problem);
        return;
      }
      if (blockRetry !== undefined) return;
      // A statement that ran out of time would only run out again: it waits for the screen to ask (a scroll,
      // Retry). Anything else is tried again by itself a few times, longer each time, then waits too.
      if (problem.code === 'QUERY_CANCELLED' || blockFailures >= MAX_AUTO_RETRIES) return;
      blockFailures += 1;
      const controller = new AbortController();
      blockRetry = controller;
      const delay = Math.min(MAX_BLOCK_RETRY_MS, 1000 * 2 ** (blockFailures - 1)) * (1 + random());
      wait(Math.round(delay), controller.signal).then(
        () => {
          blockRetry = undefined;
          windows.loadMissing();
        },
        () => {
          blockRetry = undefined;
        },
      );
    };
    /** Ready once the count is in and the first row has loaded (or there are none). */
    const checkReady = () => {
      if (status !== 'loading' || !isCounted) return;
      if (windows.count() === 0 || inner.getSnapshot().getItem(0) !== undefined || windows.idAt(0) !== undefined)
        setStatus('ready');
    };

    /** The clock and filter every block and count of this window carries. */
    const clockInput = () => ({ now: new Date(clock).toISOString(), timeZone: timeZone() });

    const windows = createWindows({
      mode: () => mode,
      blockSize: BLOCK_SIZE,
      read: async (from, limit, signal) => {
        const asked = now();
        readSet = attributeSet();
        const page = await whenFree(
          () =>
            api.query(
              {
                workspace,
                objectId,
                ...from,
                limit,
                ...(query.filter === undefined ? {} : { filter: query.filter }),
                ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
                attributeIds: readSet,
                ...clockInput(),
              },
              signal,
            ),
          signal,
        );
        store.receive(page.records, { hold: true });
        // Changed while this block was on its way: its rows may be older than the change.
        const stale = page.records.map((record) => record.id).filter((id) => changedSince(workspace, id, asked));
        if (stale.length > 0) {
          whenFree(() => api.get({ workspace, ids: stale, attributeIds: attributeSet() })).then(
            (rows) => {
              store.receive(rows);
            },
            // Left as loaded: the next change to it, or a settle, brings it up to date.
            () => undefined,
          );
        }
        const ids = page.records.map((record) => record.id);
        return page.nextCursor === undefined ? { ids } : { ids, nextCursor: page.nextCursor };
      },
      onError: blockFailed,
      onRead: () => {
        hasRestarted = false;
        blockFailures = 0;
      },
      release: store.release,
      // Rows moved under the windows (a short block, a record gone): the settle rereads the count with the rows.
      onStale: () => {
        markDirty();
      },
    });
    const inner = createRecordView({
      store,
      windows,
      schedule,
      onShown: (range) => {
        // An edited row held in place lets go once it scrolls out of sight (spec 0006, AC-56).
        const kept = inner
          .pins()
          .filter((pin) => created.has(pin.id) || (pin.index >= range.start && pin.index < range.end));
        if (kept.length !== inner.pins().length) inner.setPins(kept);
      },
    });
    windows.subscribe(checkReady);

    function refreshCount(): Promise<void> {
      countController.abort();
      const controller = new AbortController();
      countController = controller;
      return whenFree(
        () =>
          api.count(
            {
              workspace,
              objectId,
              ...(query.filter === undefined ? {} : { filter: query.filter }),
              ...clockInput(),
            },
            controller.signal,
          ),
        controller.signal,
      ).then(
        (told) => {
          if (countController !== controller) return;
          countFailures = 0;
          const isFirst = !isCounted;
          isCounted = true;
          windows.setCount(told);
          // The first block, so the grid has rows the moment it mounts (the router loader waits for this).
          // Only the first time: a later count must never move the windows back to the top.
          if (isFirst && windows.count() > 0) windows.show({ start: 0, end: Math.min(windows.count(), BLOCK_SIZE) });
          checkReady();
          inner.invalidate();
        },
        (failure: unknown) => {
          if (countController !== controller || controller.signal.aborted) return;
          if (status !== 'ready') {
            fail(failure);
            return;
          }
          // Ready: the table and its count stay, and the count is asked again later, longer each time, a few times
          // at most (the next settle or Retry asks again), so an idle tab never keeps a failing query going.
          if (countFailures >= MAX_AUTO_RETRIES || toDataError(failure).code === 'QUERY_CANCELLED') return;
          countFailures += 1;
          const delay = Math.min(MAX_BLOCK_RETRY_MS, 1000 * 2 ** (countFailures - 1)) * (1 + random());
          void wait(Math.round(delay)).then(() => {
            if (countController === controller && isOpen()) void refreshCount();
          });
        },
      );
    }
    let countFailures = 0;

    // Settle (spec 0006, AC-56): order and membership reread 1.5 s after the last change, never under an editor.
    const created = new Set<string>();
    const edited = new Set<string>();
    const dirt = { isDirty: false };
    const isMarked = () => dirt.isDirty;
    let isSettling = false;
    let editors = 0;
    let settleTimer: (() => void) | undefined;
    let settleController: AbortController | undefined;
    const isFiltered = () => query.filter !== undefined && query.filter.conditions.length > 0;

    // When the first change still waiting to settle came: a settle never waits longer than SETTLE_MAX_MS after it.
    let dirtySince: number | undefined;
    /**
     * Times the settle: 1.5 s after the last change, never more than 5 s after
     * the first, then a random 0 to 2 s more, so the many tabs one change
     * dirties never reread in the same instant (spec 0006's rule for any
     * refetch many tabs may start at once).
     */
    const scheduleSettle = () => {
      settleTimer?.();
      const since = dirtySince ?? now();
      const quiet = Math.max(0, Math.min(SETTLE_MS, since + SETTLE_MAX_MS - now()));
      settleTimer = later(
        () => {
          settleTimer = undefined;
          void settle();
        },
        quiet + Math.round(random() * SPREAD_MS),
      );
    };
    const markDirty = () => {
      if (!dirt.isDirty) dirtySince = now();
      dirt.isDirty = true;
      if (!isSettling && retains > 0) scheduleSettle();
    };
    /** Rereads the blocks on screen and the count with a fresh clock, then holds the member's own rows in place. */
    async function settle(): Promise<void> {
      // A view nobody shows keeps its mark and settles when a screen shows it again.
      if (!dirt.isDirty || isSettling || editors > 0 || status !== 'ready' || !isOpen() || retains === 0) return;
      dirt.isDirty = false;
      dirtySince = undefined;
      isSettling = true;
      clock = now();
      const controller = new AbortController();
      settleController = controller;
      // Rows the member edited here and can see now: each keeps the screen row it is at.
      const range = inner.shown();
      const held = [...edited].flatMap((id): Pin[] => {
        const index = inner.rowOf(id);
        return index !== undefined && index >= range.start && index < range.end ? [{ id, index }] : [];
      });
      edited.clear();
      try {
        await Promise.all([windows.reread(controller.signal), refreshCount()]);
      } catch {
        // Left as it was (failed, or an editor opened): still dirty, and the rows held stay the member's.
        isSettling = false;
        settleController = undefined;
        for (const pin of held) edited.add(pin.id);
        if (!isMarked()) dirtySince = now();
        dirt.isDirty = true;
        return;
      }
      settleController = undefined;
      isSettling = false;
      if (!isOpen()) return;
      const noteOf = (id: string, fallback?: RowNote): RowNote | undefined =>
        isFiltered() && !windows.has(id) ? 'no-longer-matches' : fallback;
      const before = inner.pins().filter((pin) => !held.some((each) => each.id === pin.id));
      const next = [...before, ...held].map((pin) => {
        const note = noteOf(pin.id, created.has(pin.id) ? 'new' : undefined);
        return note === undefined ? { id: pin.id, index: pin.index } : { ...pin, note };
      });
      inner.setPins(next);
      // Changed again while it settled (an event or an edit set the mark meanwhile): settle once more.
      if (isMarked()) scheduleSettle();
    }

    const referenceDisplays = (refs: readonly RecordRef[]) => names.displaysOf(workspace, refs);
    let lastSource: RecordSource<RecordView> | undefined;
    let lastErrors = cellErrors;
    let lastStatus: ViewStatus = status;
    let snapshot: ViewState | undefined;
    const rowNotesOf = (): ReadonlyMap<string, RowNote> =>
      new Map(inner.pins().flatMap((pin) => (pin.note === undefined ? [] : [[pin.id, pin.note] as const])));
    const view: RecordsView = {
      subscribe: inner.subscribe,
      getSnapshot: () => {
        const source = inner.getSnapshot();
        if (snapshot === undefined || source !== lastSource || cellErrors !== lastErrors || status !== lastStatus) {
          lastSource = source;
          lastErrors = cellErrors;
          lastStatus = status;
          snapshot = {
            source,
            status,
            cellErrors,
            count: windows.told(),
            mode,
            rowNotes: rowNotesOf(),
            referenceDisplays,
            ...(error === undefined ? {} : { error }),
          };
        }
        return snapshot;
      },
      retry: () => {
        if (status === 'error') {
          readyPromise = new Promise<void>((resolve) => {
            settleReady = resolve;
          });
        }
        hasRestarted = false;
        blockFailures = 0;
        countFailures = 0;
        setStatus('loading');
        // The object's shape never came (its attributes failed to load): ask for it first, which then counts.
        if (shape === undefined) {
          start();
          return;
        }
        void refreshCount();
        windows.refresh();
      },
      ready: () => readyPromise,
      indexOf: (id) => inner.rowOf(id),
      retain: (attributeIds = []) => {
        retains += 1;
        clearTimeout(unused);
        const reader = Symbol('reader');
        readers.set(reader, attributeIds);
        showColumns();
        // Changes came while nobody showed it: they settle now that a screen does.
        if (retains === 1 && dirt.isDirty && !isSettling) scheduleSettle();
        let isReleased = false;
        return {
          columns: (next) => {
            if (isReleased) return;
            readers.set(reader, next);
            showColumns();
          },
          release: () => {
            if (isReleased) return;
            isReleased = true;
            retains -= 1;
            readers.delete(reader);
            if (retains === 0) {
              // The member left the view: the rows they made or edited here go back to the server's order.
              created.clear();
              edited.clear();
              inner.setPins([]);
              letGoLater();
            }
          },
        };
      },
      holdSettle: (isHeld) => {
        editors = Math.max(0, editors + (isHeld ? 1 : -1));
        // An editor opened under a settle already reading: it stops, so rows never move under the draft.
        if (isHeld) settleController?.abort();
        if (editors === 0 && dirt.isDirty && !isSettling) scheduleSettle();
      },
    };

    /** Columns shown since the blocks were read: fetched for the loaded rows only, 500 ids a call. */
    function showColumns() {
      const next = attributeSet();
      const added = next.filter((id) => !readSet.includes(id));
      readSet = next;
      if (added.length === 0 || status !== 'ready') return;
      fetchColumns(added);
    }

    /** Reads `added` for the rows loaded now; a failure says so once, with Retry, and the cells stay skeletons. */
    function fetchColumns(added: readonly string[]) {
      const ids = [...new Set([...windows.loadedIds(), ...inner.pins().map((pin) => pin.id)])];
      void Promise.all(
        chunks(ids, GET_LIMIT).map((part) =>
          whenFree(() => api.get({ workspace, ids: part, attributeIds: added })).then((rows) => {
            store.receive(rows.filter((row) => store.get(row.id) !== undefined));
          }),
        ),
      ).catch(() => {
        if (!isOpen()) return;
        notify({
          tone: 'danger',
          message: RECORD_WORDS.columnNotRead,
          action: {
            label: RECORD_WORDS.retry,
            onAction: () => {
              fetchColumns(added);
            },
          },
        });
      });
    }

    let retains = 0;
    let unused: ReturnType<typeof setTimeout> | undefined;
    // Live changes to this workspace reach the view while it is open.
    const unwatch = watch(workspace);
    const dispose = () => {
      countController.abort();
      blockRetry?.abort();
      settleTimer?.();
      settleController?.abort();
      inner.dispose();
      unwatch();
    };
    /** Nobody shows the view: after a while it leaves the layer and lets go of its rows. */
    const letGoLater = () => {
      clearTimeout(unused);
      unused = setTimeout(() => {
        if (retains > 0) return;
        if (views.get(key)?.view === view) views.delete(key);
        dispose();
      }, keepUnusedViewMs);
    };
    // The first read waits for the workspace's head, so nothing written meanwhile is missed, and for the
    // object's shape, which picks the mode (spec 0006, AC-52) and names the primary attribute.
    function start() {
      void Promise.all([beforeRead(workspace), describe(workspace, objectId)]).then(
        ([, described]) => {
          shape = described;
          const byId = new Map(described.attributes.map((attribute) => [attribute.id, attribute]));
          mode = canJump(query.filter, query.sorts, (id) => byId.get(id)) ? 'position' : 'cursor';
          readSet = attributeSet();
          if (!isCounted && isOpen()) void refreshCount();
        },
        (failure: unknown) => {
          if (isOpen()) fail(failure);
        },
      );
    }
    start();
    // A view the router warmed but no screen ever showed goes too.
    letGoLater();
    return {
      workspace,
      objectId,
      query,
      windows,
      view,
      invalidate: inner.invalidate,
      reread: () => {
        // Still loading: what it loads is already newer than what was missed.
        if (status !== 'ready') return;
        dirt.isDirty = true;
        void settle();
      },
      markDirty,
      orderAttributes: () => orderAttributesOf(query, shape),
      attributes: () => readSet,
      edited: (ids) => {
        for (const id of ids) if (windows.has(id) || created.has(id)) edited.add(id);
      },
      created: (id) => {
        created.add(id);
        // First in the view, marked new, until the member leaves it (spec 0006, AC-56).
        const shifted = inner.pins().map((pin) => (created.has(pin.id) ? pin : { ...pin, index: pin.index + 1 }));
        const made = shifted.filter((pin) => created.has(pin.id)).map((pin) => ({ ...pin, index: pin.index + 1 }));
        const others = shifted.filter((pin) => !created.has(pin.id));
        inner.setPins([{ id, index: 0, note: 'new' }, ...made, ...others]);
        markDirty();
      },
      withdrawn: (id) => {
        if (!created.delete(id)) return;
        const rest = inner.pins().filter((pin) => pin.id !== id);
        inner.setPins(rest.map((pin) => ({ ...pin, index: pin.index - 1 })));
      },
      isRetained: () => retains > 0,
      shows: (id) => windows.has(id) || inner.pins().some((pin) => pin.id === id),
      isReady: () => status === 'ready',
      dispose: () => {
        clearTimeout(unused);
        dispose();
      },
    };
  }

  /** The version an edit names as its base for each cell (spec 0006, AC-45): the base's, never a layer's. */
  function baseVersionsOf(base: RecordView | undefined, cells: readonly CellWrite[]) {
    const bases = new Map<string, string | null>();
    if (base === undefined) return bases;
    for (const cell of cells) {
      // Unknown (never read) has no base to name; read with no version means never set.
      if (Object.hasOwn(base.values, cell.attributeId))
        bases.set(cell.attributeId, base.versions[cell.attributeId] ?? null);
    }
    return bases;
  }

  /** One record's part of a write: its cells, its layer, and what the record showed and held when it began. */
  interface Prepared {
    readonly recordId: string;
    readonly cells: readonly CellWrite[];
    readonly layer: Layer<RecordView>;
    /** What the screen showed for each cell when the action began: what undo puts back. */
    readonly before: ReadonlyMap<string, unknown>;
    /** The base's version for each cell when the edit began; empty when the record had no base yet (a draft). */
    readonly bases: ReadonlyMap<string, string | null>;
  }

  /**
   * Writes cells of one or more records as one action (spec 0006): each
   * record's cells show at once as one optimistic layer, and the whole action
   * is one write with one `mutationId` (`records.setValues` for one record,
   * `records.setValuesBatch` for several), sent after each record's last
   * write and its create. Each record lands or rolls back on its own: a
   * refusal rolls its cells back and marks them (a `quiet` code rolls back
   * with no mark), and a record gone on the server leaves every window. The
   * versions the write made (its answer's `written`, never the read back)
   * join the tab's own versions; with `undo`, the cells it changed go on the
   * undo stack as one entry.
   */
  function write(
    workspace: string,
    objectId: string | undefined,
    writes: readonly RecordWrite[],
    options: WriteOptions = {},
  ): Promise<readonly RecordOutcome[]> {
    const mutationId = options.mutationId ?? mintId();
    // A cell's new option shows by its label from now until it lands or rolls back (again on a Retry).
    for (const each of writes) {
      for (const cell of each.cells) {
        const option = newOptionOf(cell.sent);
        if (option === undefined) continue;
        madeEntry(option.id);
        cellOptions.asked(workspace, {
          attributeId: cell.attributeId,
          id: option.id,
          label: option.label,
          hue: optionLooks.get(option.id)?.hue ?? 'gray',
        });
      }
    }
    // Every cell's old refusal goes in one change, so a big paste invalidates the views once.
    setCellErrors(
      writes.flatMap((each) => each.cells.map((cell) => [`${each.recordId}:${cell.attributeId}`, undefined] as const)),
    );
    const prepared = writes.map((each): Prepared => {
      const shown = store.get(each.recordId);
      const values = Object.fromEntries(each.cells.map((cell) => [cell.attributeId, cell.value]));
      return {
        recordId: each.recordId,
        cells: each.cells,
        // Only cells whose value was read: an unknown one (a column not read yet) has no old value to put back.
        before: new Map(
          each.cells.flatMap((cell) =>
            shown !== undefined && !Object.hasOwn(shown.values, cell.attributeId)
              ? []
              : [[cell.attributeId, shown?.values[cell.attributeId] ?? null] as const],
          ),
        ),
        bases: baseVersionsOf(store.base(each.recordId), each.cells),
        layer: store.edit(each.recordId, values, mutationId),
      };
    });
    mutations.sent(mutationId);
    // After each record's last write (and its create, if it is still being made), so the server applies one
    // record's edits in the order they were made and the later value gets the later version.
    const turn = Promise.all(
      prepared.map((each) =>
        (sending.get(each.recordId) ?? Promise.resolve()).then(
          () => undefined,
          () => undefined,
        ),
      ),
    );
    const mine = turn.then(() => send(workspace, mutationId, prepared, options));
    // What lands may move rows in a filtered or sorted window: those settle, and the edited rows keep their place.
    void mine.then((outcomes) => {
      const landedIds = outcomes.flatMap((outcome) => (outcome.row === undefined ? [] : [outcome.recordId]));
      if (landedIds.length === 0) return;
      const written = new Set(
        outcomes.flatMap((outcome) => (outcome.row === undefined ? [] : outcome.cells.map((cell) => cell.attributeId))),
      );
      for (const entry of viewsOf(workspace)) {
        if (!landedIds.some((id) => entry.shows(id))) continue;
        entry.edited(landedIds);
        const order = entry.orderAttributes();
        if (order.any || [...written].some((id) => order.ids.has(id))) entry.markDirty();
      }
    });
    for (const each of prepared) sending.set(each.recordId, mine);
    void mine.finally(() => {
      for (const each of prepared) if (sending.get(each.recordId) === mine) sending.delete(each.recordId);
    });
    if (options.undo !== undefined && objectId !== undefined) {
      const kind = options.undo;
      const entry = mine.then((outcomes) => {
        undo.push(workspace, { id: mutationId, kind, objectId, cells: undoCells(prepared, outcomes) });
      });
      // An undo pressed meanwhile waits for this write's answer first (spec 0006).
      const waiting = inflight.get(workspace) ?? new Set<Promise<void>>();
      inflight.set(workspace, waiting);
      waiting.add(entry);
      void entry.finally(() => waiting.delete(entry));
    }
    return mine;
  }

  /**
   * The cells of an action that the write changed (its answer's `written`):
   * what its undo puts back, the version it must find, and the version it
   * replaced, so undoing a later action on the same cell can hand this one
   * the version that undo wrote.
   */
  function undoCells(prepared: readonly Prepared[], outcomes: readonly RecordOutcome[]): UndoCell[] {
    const byRecord = new Map(outcomes.map((outcome) => [outcome.recordId, outcome]));
    return prepared.flatMap((each) => {
      const outcome = byRecord.get(each.recordId);
      if (outcome?.row === undefined) return [];
      return each.cells.flatMap((cell): UndoCell[] => {
        const written = outcome.written?.[cell.attributeId];
        // Unchanged (no new version) is left out: there is nothing to undo. So is a cell whose old value was never read.
        if (written === undefined || !each.before.has(cell.attributeId)) return [];
        const replaced = outcome.sentFrom?.get(cell.attributeId);
        return [
          {
            recordId: each.recordId,
            attributeId: cell.attributeId,
            before: each.before.get(cell.attributeId) ?? null,
            writtenVersionId: written,
            ...(replaced === undefined ? {} : { replacedVersionId: replaced }),
          },
        ];
      });
    });
  }

  /** Each cell's version in the record's base now: what a write sent after its turn replaces. */
  function versionsNow(each: Prepared): ReadonlyMap<string, string> {
    const versions = store.base(each.recordId)?.versions ?? {};
    return new Map(
      each.cells.flatMap((cell) => {
        const version = versions[cell.attributeId];
        return version === undefined ? [] : [[cell.attributeId, version] as const];
      }),
    );
  }

  /** Sends a prepared action once the creates it waits on are in, and settles each record's layer by its outcome. */
  async function send(
    workspace: string,
    mutationId: string,
    prepared: readonly Prepared[],
    options: WriteOptions,
  ): Promise<readonly RecordOutcome[]> {
    const outcomes: RecordOutcome[] = [];
    const live: Prepared[] = [];
    for (const each of prepared) {
      const pendingCreate = creating.get(each.recordId);
      if (pendingCreate !== undefined && !(await pendingCreate)) {
        // The create was refused, and the draft went with this edit on it.
        notify({ tone: 'danger', message: RECORD_WORDS.draftRefused });
        settleOptions(workspace, undefined, each.cells);
        outcomes.push({ recordId: each.recordId, cells: each.cells });
        continue;
      }
      live.push(each);
    }
    if (live.length === 0) {
      mutations.forget(mutationId);
      return outcomes;
    }
    // After the record's turn: the base now holds the record's last confirmed write, which this one replaces.
    const sentFrom = new Map(live.map((each) => [each.recordId, versionsNow(each)]));
    // Options other cells are making, named here (chosen on another row, or kept in a list): their real ids.
    const resolvedValues = new Map<string, unknown>();
    for (const each of live) {
      for (const cell of each.cells) {
        resolvedValues.set(`${each.recordId}:${cell.attributeId}`, await resolveMade(cell.sent ?? cell.value));
      }
    }
    const itemOf = (each: Prepared) => {
      // A draft's edit names the base its create answered.
      const bases = each.bases.size > 0 ? each.bases : baseVersionsOf(store.base(each.recordId), each.cells);
      return {
        recordId: each.recordId,
        values: Object.fromEntries(
          each.cells.map((cell) => {
            const base = bases.get(cell.attributeId);
            return [
              cell.attributeId,
              {
                value: resolvedValues.get(`${each.recordId}:${cell.attributeId}`) ?? cell.sent ?? cell.value,
                ...(cell.ifVersionId !== undefined
                  ? { ifVersionId: cell.ifVersionId }
                  : base === undefined
                    ? {}
                    : { baseVersionId: base }),
              },
            ];
          }),
        ),
      };
    };
    const landedAs = (each: Prepared, row: RecordView, written: Readonly<Record<string, string>>) =>
      landed(workspace, each, row, written, sentFrom.get(each.recordId));
    try {
      const [only] = live;
      if (live.length === 1 && only !== undefined) {
        const answer = await delivered(() =>
          api.setValues({ workspace, mutationId, timeZone: timeZone(), ...itemOf(only) }),
        );
        const { echoes, written, ...row } = answer;
        mutations.answered(mutationId, echoes);
        return [...outcomes, landedAs(only, row, written)];
      }
      const answer = await delivered(() =>
        api.setValuesBatch({ workspace, mutationId, timeZone: timeZone(), items: live.map(itemOf) }),
      );
      mutations.answered(mutationId, answer.echoes);
      const results = new Map(answer.results.map((result) => [result.recordId, result]));
      for (const each of live) {
        const result = results.get(each.recordId);
        if (result?.record !== undefined) {
          outcomes.push(landedAs(each, result.record, result.written ?? {}));
          continue;
        }
        const [first] = result?.refusals ?? [];
        const failure =
          first === undefined
            ? dataError('INTERNAL', RECORD_WORDS.notSaved(1))
            : dataError(first.code, first.message, { refusals: result?.refusals ?? [] });
        outcomes.push(refused(workspace, each, failure, options));
      }
      return outcomes;
    } catch (error) {
      const failure = toDataError(error);
      mutations.forget(mutationId);
      return [...outcomes, ...live.map((each) => refused(workspace, each, failure, options))];
    }
  }

  /**
   * A record's part landed: its row becomes the base, and each version the
   * write itself made (`written`, never the read back, which may already hold
   * someone else's) joins the tab's own versions.
   */
  function landed(
    workspace: string,
    each: Prepared,
    row: RecordView,
    written: Readonly<Record<string, string>>,
    sentFrom: ReadonlyMap<string, string> | undefined,
  ): RecordOutcome {
    each.layer.confirm(row);
    settleOptions(workspace, row.objectId, each.cells, row);
    for (const cell of each.cells) {
      const versionId = written[cell.attributeId];
      if (versionId === undefined) continue;
      own.add(versionId, {
        workspace,
        objectId: row.objectId,
        recordId: row.id,
        attributeId: cell.attributeId,
        // A new option's cell holds the id the server set (a reused option's, maybe), never the minted one.
        value: cell.sent === undefined ? cell.value : (row.values[cell.attributeId] ?? null),
        recordName: row.display.name,
      });
    }
    return {
      recordId: each.recordId,
      cells: each.cells,
      row,
      written,
      ...(sentFrom === undefined ? {} : { sentFrom }),
    };
  }

  /** A record's part was refused: its cells roll back, marked with why unless the code is quiet. */
  function refused(workspace: string, each: Prepared, failure: DataError, options: WriteOptions): RecordOutcome {
    each.layer.refuse();
    settleOptions(workspace, undefined, each.cells);
    const outcome = { recordId: each.recordId, cells: each.cells, failure };
    // Signed out: the layer already said so, and sign in comes next.
    if (failure.code === 'UNAUTHENTICATED') return { recordId: each.recordId, cells: each.cells };
    if (failure.code === 'RECORD_DELETED' || failure.code === 'NOT_FOUND') {
      dropRecords([each.recordId]);
      return { ...outcome, gone: true };
    }
    if (options.quiet?.has(failure.code) === true) return outcome;
    setCellErrors(
      each.cells.map((cell) => [
        `${each.recordId}:${cell.attributeId}`,
        refusalFor(failure, cell.attributeId) ??
          // A rule on a field the edit didn't touch (spec 0013, AC-256): the edited cell says it, naming that field.
          (failure.code === 'VALIDATION_FAILED' ? failure.data?.refusals?.[0]?.message : undefined),
      ]),
    );
    return outcome;
  }

  /** An attribute's title from the object's shape, or undefined when it can't be read. */
  async function titleOf(workspace: string, objectId: string | undefined, attributeId: string) {
    if (objectId === undefined) return undefined;
    const shape = await describe(workspace, objectId).catch(() => undefined);
    return shape?.attributes.find((attribute) => attribute.id === attributeId)?.title;
  }

  /**
   * What an action's refusals say, said once. A gone record says so. A
   * passing failure (the server busy or out of reach) offers Retry, which
   * sends the cells again (`retry`: an edit as a new edit, an undo as the
   * same undo, still checked by its versions); one cell names its field. A
   * refused value would only be refused again: on an edit its cell already
   * says why (marked, with its tooltip), so one such refusal raises nothing
   * and several are counted with no Retry; an undo, which may act out of
   * sight, says it in the toast.
   */
  function tellRefusals(
    where: { readonly workspace: string; readonly objectId: string | undefined; readonly cellsShow: boolean },
    outcomes: readonly RecordOutcome[],
    retry: (refused: readonly RecordOutcome[]) => void,
  ) {
    if (outcomes.some((outcome) => outcome.gone === true)) notify({ tone: 'danger', message: RECORD_WORDS.recordGone });
    const refusedOnes = outcomes.filter((outcome) => outcome.failure !== undefined && outcome.gone !== true);
    const passing = refusedOnes.filter((outcome) => TEMPORARY_CODES.has(outcome.failure?.code ?? ''));
    const lasting = refusedOnes.filter((outcome) => !TEMPORARY_CODES.has(outcome.failure?.code ?? ''));
    const [first] = passing;
    if (first?.failure !== undefined) {
      const failure = first.failure;
      const action = {
        label: RECORD_WORDS.retry,
        onAction: () => {
          retry(passing);
        },
      };
      const [cell] = first.cells;
      if (passing.length === 1 && first.cells.length === 1 && cell !== undefined) {
        void titleOf(where.workspace, where.objectId, cell.attributeId).then((title) => {
          const reason = refusalSummary(failure);
          notify({
            tone: 'danger',
            message: title === undefined ? reason : RECORD_WORDS.notSavedNamed(title, reason),
            action,
          });
        });
      } else {
        notify({ tone: 'danger', message: RECORD_WORDS.notSaved(passing.length), action });
      }
    }
    const [firstLasting] = lasting;
    if (firstLasting?.failure === undefined) return;
    if (!where.cellsShow) {
      notify({
        tone: 'danger',
        message: lasting.length === 1 ? refusalSummary(firstLasting.failure) : RECORD_WORDS.notSaved(lasting.length),
      });
      return;
    }
    if (lasting.length > 1) {
      notify({ tone: 'danger', message: RECORD_WORDS.notSavedMarked(lasting.length) });
      return;
    }
    // A broken rule says so in a toast too, with no Retry: the same save would be refused again (spec 0013, AC-256).
    if (firstLasting.failure.code === 'VALIDATION_FAILED') {
      const refusals = firstLasting.failure.data?.refusals ?? [];
      notify({ tone: 'danger', message: rulesSummary(refusals.length, refusals[0]?.message) });
    }
  }

  /** Roughly how many bytes a write of these cells sends: their values in UTF-8, and each cell's ids and version. */
  const encodedSize = (changes: readonly SentChange[]): number =>
    changes.reduce((sum, change) => sum + cellBytes(change.value), 0);

  /**
   * Edits cells as one action (spec 0006, AC-48, AC-50): a cell, a paste or a
   * range clear. Over 500 records, or more than one request can carry, it is
   * refused before anything shows. Each record's cells show at once and land
   * or roll back on their own; one toast with Retry covers the refused ones;
   * what landed goes on the undo stack.
   */
  async function edit(
    workspace: string,
    objectId: string | undefined,
    changes: readonly SentChange[],
    kind: UndoKind,
  ): Promise<EditOutcome> {
    const byRecord = new Map<string, CellWrite[]>();
    for (const change of changes) {
      byRecord.set(change.rowId, [
        ...(byRecord.get(change.rowId) ?? []),
        {
          attributeId: change.columnId,
          value: change.value,
          ...(change.sent === undefined ? {} : { sent: change.sent }),
        },
      ]);
    }
    if (byRecord.size > MAX_BATCH_RECORDS) return { kind: 'too-many', limit: MAX_BATCH_RECORDS };
    if (changes.length > MAX_BATCH_CELLS || encodedSize(changes) > MAX_WRITE_BYTES) return { kind: 'too-big' };
    const object = objectId ?? store.get(changes[0]?.rowId ?? '')?.objectId;
    // The object's rules first (spec 0013, AC-257), with the same checker the server runs: a record that breaks
    // one shows nothing new and sends nothing, its cells say why, and a toast says it once, with no Retry.
    const asked = checkWith(workspace, object, new Set(changes.map((change) => change.columnId)), false);
    const check = asked instanceof Promise ? await asked : asked;
    const refusedByRules = new Map<string, readonly RuleFailure[]>();
    if (check !== undefined) {
      const at = new Date(now()).toISOString();
      for (const [recordId, cells] of byRecord) {
        const shown = store.get(recordId)?.values ?? {};
        const failures = checkInBrowser({
          rules: check.rules,
          values: { ...shown, ...Object.fromEntries(cells.map((cell) => [cell.attributeId, cell.value])) },
          written: new Set(cells.map((cell) => cell.attributeId)),
          isCreate: false,
          now: at,
          timeZone: timeZone(),
          pattern: check.pattern,
        });
        if (failures.length > 0) refusedByRules.set(recordId, failures);
      }
    }
    if (refusedByRules.size > 0) {
      setCellErrors(
        [...refusedByRules].flatMap(([recordId, failures]) =>
          (byRecord.get(recordId) ?? []).map(
            (cell) => [`${recordId}:${cell.attributeId}`, ruleMessageFor(failures, cell.attributeId)] as const,
          ),
        ),
      );
      const [only] = [...refusedByRules.values()];
      notify({
        tone: 'danger',
        message:
          refusedByRules.size === 1 && only !== undefined
            ? rulesSummary(only.length, only[0]?.message)
            : RECORD_WORDS.notSavedMarked(refusedByRules.size),
      });
      for (const recordId of refusedByRules.keys()) byRecord.delete(recordId);
      if (byRecord.size === 0) return { kind: 'done', cells: changes.length, landed: 0 };
    }
    const mutationId = mintId();
    const outcomes = await write(
      workspace,
      object,
      [...byRecord].map(([recordId, cells]) => ({ recordId, cells })),
      { undo: kind, mutationId },
    );
    tellRefusals({ workspace, objectId: object, cellsShow: true }, outcomes, (refusedOnes) => {
      const again = refusedOnes.flatMap((outcome) =>
        outcome.cells.map((cell) => ({
          rowId: outcome.recordId,
          columnId: cell.attributeId,
          value: cell.value,
          ...(cell.sent === undefined ? {} : { sent: cell.sent }),
        })),
      );
      void edit(workspace, object, again, kind);
    });
    const landedCells = outcomes.reduce(
      (sum, outcome) => sum + (outcome.row === undefined ? 0 : outcome.cells.length),
      0,
    );
    // Its entry went on the stack before this answer (the push runs first): a toast's Undo names it.
    const pushed = undo.top(workspace)?.id === mutationId;
    return { kind: 'done', cells: changes.length, landed: landedCells, ...(pushed ? { undoId: mutationId } : {}) };
  }

  /** Splits record writes into runs whose encoded size stays under one request's limit; each record stays whole. */
  function bySize(writes: readonly RecordWrite[]): RecordWrite[][] {
    const runs: RecordWrite[][] = [];
    let run: RecordWrite[] = [];
    let size = 0;
    for (const each of writes) {
      const own = each.cells.reduce((sum, cell) => sum + cellBytes(cell.value), 0);
      if (run.length > 0 && (size + own > MAX_WRITE_BYTES || run.length >= MAX_BATCH_RECORDS)) {
        runs.push(run);
        run = [];
        size = 0;
      }
      run.push(each);
      size += own;
    }
    if (run.length > 0) runs.push(run);
    return runs;
  }

  /** Writes record writes in runs a request can carry (an undo's old values can be far bigger than the change). */
  async function writeInRuns(
    workspace: string,
    objectId: string,
    writes: readonly RecordWrite[],
    options: WriteOptions,
  ): Promise<readonly RecordOutcome[]> {
    const outcomes = await Promise.all(bySize(writes).map((run) => write(workspace, objectId, run, options)));
    return outcomes.flat();
  }

  /**
   * Writes undo cells back, each checked by the version its action wrote
   * (`ifVersionId`): a record refused only because some of its cells changed
   * since sends its other cells once more without them. Answers what landed,
   * what was kept and what was refused for another reason. A landed cell
   * hands the version it wrote to any older entry that wrote the version this
   * one replaced, so repeated presses walk back one cell's own changes.
   */
  async function undoCellsBack(
    workspace: string,
    objectId: string,
    cells: readonly UndoCell[],
  ): Promise<{ readonly landed: number; readonly kept: number; readonly failed: readonly RecordOutcome[] }> {
    const byRecord = new Map<string, CellWrite[]>();
    for (const cell of cells) {
      byRecord.set(cell.recordId, [
        ...(byRecord.get(cell.recordId) ?? []),
        { attributeId: cell.attributeId, value: cell.before, ifVersionId: cell.writtenVersionId },
      ]);
    }
    const quiet = new Set(['VERSION_CHANGED']);
    const first = await writeInRuns(
      workspace,
      objectId,
      [...byRecord].map(([recordId, writes]) => ({ recordId, cells: writes })),
      { quiet },
    );
    let kept = 0;
    const retry: RecordWrite[] = [];
    const settled: RecordOutcome[] = [];
    for (const outcome of first) {
      if (outcome.failure?.code !== 'VERSION_CHANGED') {
        settled.push(outcome);
        continue;
      }
      const changed = new Set(
        (outcome.failure.data?.refusals ?? []).flatMap((refusal) =>
          refusal.code === 'VERSION_CHANGED' && refusal.attributeId !== undefined ? [refusal.attributeId] : [],
        ),
      );
      const rest = outcome.cells.filter((cell) => !changed.has(cell.attributeId));
      kept += outcome.cells.length - rest.length;
      if (rest.length > 0) retry.push({ recordId: outcome.recordId, cells: rest });
    }
    const second = retry.length === 0 ? [] : await writeInRuns(workspace, objectId, retry, { quiet });
    for (const outcome of second) {
      if (outcome.failure?.code === 'VERSION_CHANGED') kept += outcome.cells.length;
      else settled.push(outcome);
    }
    // Each cell put back hands its new version to the older entry that wrote what this one replaced, in one pass.
    // A cell that landed writing nothing (a resend whose first try had landed) holds the value at the row's version.
    const byCell = new Map(cells.map((cell) => [`${cell.recordId}:${cell.attributeId}`, cell]));
    const handOver = new Map<string, string>();
    for (const outcome of settled) {
      const { row } = outcome;
      if (row === undefined) continue;
      for (const cell of outcome.cells) {
        const undone = byCell.get(`${outcome.recordId}:${cell.attributeId}`);
        const now =
          outcome.written?.[cell.attributeId] ??
          (sameData(row.values[cell.attributeId] ?? null, cell.value) ? row.versions[cell.attributeId] : undefined);
        if (undone?.replacedVersionId !== undefined && now !== undefined) {
          handOver.set(`${outcome.recordId}:${cell.attributeId}:${undone.replacedVersionId}`, now);
        }
      }
    }
    undo.rewrite(workspace, handOver);
    const landedCells = settled.reduce(
      (sum, outcome) => sum + (outcome.row === undefined ? 0 : outcome.cells.length),
      0,
    );
    const failed = settled.filter((outcome) => outcome.failure !== undefined);
    // Retry sends the same undo again, after any undo still running, still checked by the versions its action wrote.
    tellRefusals({ workspace, objectId, cellsShow: false }, failed, (refusedOnes) => {
      const ids = new Set(
        refusedOnes.flatMap((outcome) => outcome.cells.map((cell) => `${outcome.recordId}:${cell.attributeId}`)),
      );
      void inTurn(workspace, async () => {
        const again = await undoCellsBack(
          workspace,
          objectId,
          cells.filter((cell) => ids.has(`${cell.recordId}:${cell.attributeId}`)),
        );
        // No screen asked for this one: the layer says what it did.
        if (again.landed > 0) notify({ tone: 'success', message: RECORD_WORDS.undoRetried(again.landed) });
        if (again.kept > 0) notify({ tone: 'success', message: RECORD_WORDS.kept(again.kept) });
      });
    });
    return { landed: landedCells, kept, failed };
  }

  /**
   * Runs undo work for a workspace one at a time, after every undoable write
   * still out: a second press waits until the first press's writes have
   * answered and handed their versions on, so a quick double press walks
   * back two changes to one cell.
   */
  function inTurn<T>(workspace: string, work: () => Promise<T>): Promise<T> {
    const before = undoing.get(workspace) ?? Promise.resolve();
    const mine = before.then(async () => {
      await Promise.all([...(inflight.get(workspace) ?? [])]);
      return work();
    });
    const done = mine.then(
      () => undefined,
      () => undefined,
    );
    undoing.set(workspace, done);
    void done.then(() => {
      if (undoing.get(workspace) === done) undoing.delete(workspace);
    });
    return mine;
  }

  /**
   * Undoes the newest action on this tab's stack for the workspace (spec
   * 0006, AC-48, AC-49), after any undoable write and any undo still out has
   * answered; with `only`, that action alone and only while it is the newest
   * (a toast's Undo). Each cell is written back only while it still holds the
   * version the action wrote (checked on the server): a cell changed since is
   * kept. The undo shows at once, rolls back what is refused, is live to
   * others, and is never pushed itself (no redo).
   */
  function runUndo(workspace: string, only?: string): Promise<UndoOutcome> {
    return inTurn(workspace, async (): Promise<UndoOutcome> => {
      // A toast's Undo undoes its own action or nothing: once a newer one sits on top (or it was undone), it is stale.
      if (only !== undefined && undo.top(workspace)?.id !== only) return { kind: 'stale' };
      const entry = undo.pop(workspace);
      const [firstCell] = entry?.cells ?? [];
      if (entry === undefined || firstCell === undefined) return { kind: 'nothing' };
      const { landed: undone, kept, failed } = await undoCellsBack(workspace, entry.objectId, entry.cells);
      const shown = store.get(firstCell.recordId) ?? store.base(firstCell.recordId);
      return {
        kind: 'undone',
        action: entry.kind,
        objectId: entry.objectId,
        cells: entry.cells.length,
        undone,
        kept,
        failed: failed.reduce((sum, outcome) => sum + outcome.cells.length, 0),
        first: {
          recordId: firstCell.recordId,
          attributeId: firstCell.attributeId,
          recordName: shown?.display.name ?? '',
        },
      };
    });
  }

  /**
   * What an event says this tab's values were replaced by (spec 0006, AC-46,
   * AC-47): for each entry whose version this tab wrote, replaced by someone
   * other than this member and not the system, one notice per record, naming
   * its first cell. A catch up carries no `replaced`, so a tab that was away
   * hears nothing.
   */
  async function replacedIn(workspace: string, event: RecordsEvent): Promise<void> {
    // No list (none replaced, or more than 200 cells): the records are refetched, and nothing is said.
    const replaced = event.replaced;
    if (replaced === undefined) return;
    const by = replaced.by;
    if (by.type === 'system') return;
    const mine = replaced.cells.flatMap((entry) => {
      const written = own.get(entry.versionId);
      if (written === undefined || written.workspace !== workspace || entry.recordId !== written.recordId) return [];
      return [{ entry, written }];
    });
    if (mine.length === 0) return;
    const me = await memberOf(workspace);
    // Not knowing who this is, a save from the person's own other tab can't be told apart: say nothing.
    if (me === undefined) return;
    if (by.type === 'member' && by.id === me) return;
    const byRecord = new Map<string, typeof mine>();
    for (const each of mine) {
      byRecord.set(each.entry.recordId, [...(byRecord.get(each.entry.recordId) ?? []), each]);
    }
    for (const [recordId, cells] of byRecord) {
      const [firstCell] = cells;
      if (firstCell === undefined) continue;
      onReplaced({
        workspace,
        objectId: firstCell.written.objectId,
        recordId,
        recordName: store.get(recordId)?.display.name ?? firstCell.written.recordName,
        attributeIds: cells.map((each) => each.entry.attributeId),
        by: { type: by.type, id: by.id },
        useMine: () => {
          void edit(
            workspace,
            firstCell.written.objectId,
            cells.map((each) => ({ rowId: recordId, columnId: each.entry.attributeId, value: each.written.value })),
            'cell',
          );
        },
      });
    }
  }

  /**
   * Reads records again by id, 500 at a time, with only `attributeIds` when
   * given; ids the server leaves out are gone and leave every window.
   */
  async function refetch(workspace: string, ids: readonly string[], attributeIds?: readonly string[]): Promise<void> {
    const held = ids.filter((id) => isHeldIn(workspace, id));
    await Promise.all(
      chunks(held, GET_LIMIT).map(async (part) => {
        const rows = await whenFree(() =>
          api.get({ workspace, ids: part, ...(attributeIds === undefined ? {} : { attributeIds }) }),
        );
        // Only rows this workspace's views still show: the store is keyed by record id alone.
        store.receive(rows.filter((row) => isHeldIn(workspace, row.id)));
        const found = new Set(rows.map((row) => row.id));
        const gone = new Set(part.filter((id) => !found.has(id) && !store.pending().has(id)));
        if (gone.size === 0) return;
        for (const entry of viewsOf(workspace)) entry.windows.drop(gone);
        store.remove([...gone].filter((id) => ![...views.values()].some((entry) => entry.shows(id))));
      }),
    );
  }

  /**
   * Whether one of `workspace`'s views shows `id`. Record ids are unique per
   * workspace only, so a change event from one workspace never touches a
   * record another workspace's view holds under the same id.
   */
  function isHeldIn(workspace: string, id: string): boolean {
    return viewsOf(workspace).some((entry) => entry.shows(id)) || subscriptions.holds(workspace, id);
  }

  // One record at a time (spec 0006, `records.one`; the record page, spec 0017): the same store, its body held.
  const subscriptions = createRecordSubscriptions({
    store,
    read: (workspace, ids, attributeIds) =>
      beforeRead(workspace).then(() =>
        whenFree(() => api.get({ workspace, ids, ...(attributeIds === undefined ? {} : { attributeIds }) })),
      ),
    refetch,
    isShown: (workspace, id) => viewsOf(workspace).some((entry) => entry.shows(id)),
    cellErrorsOf: (recordId) => {
      const prefix = `${recordId}:`;
      return new Map(
        [...cellErrors].flatMap(([key, message]) =>
          key.startsWith(prefix) ? [[key.slice(prefix.length), message] as const] : [],
        ),
      );
    },
    displaysOf: (workspace, refs) => names.displaysOf(workspace, refs),
    later,
    keepUnusedMs: keepUnusedViewMs,
  });

  // Ids change events named in the last 10 seconds, by workspace, with when: a block in flight checks them.
  let recent = new Map<string, Map<string, number>>();
  function remember(workspace: string, ids: readonly string[]) {
    const time = now();
    for (const [key, changed] of recent) {
      for (const [id, at] of changed) if (time - at > RECENT_MS) changed.delete(id);
      if (changed.size === 0) recent.delete(key);
    }
    const changed = recent.get(workspace) ?? new Map<string, number>();
    recent.set(workspace, changed);
    for (const id of ids) changed.set(id, time);
  }
  function changedSince(workspace: string, id: string, since: number): boolean {
    const at = recent.get(workspace)?.get(id);
    return at !== undefined && at >= since;
  }

  // Change events' record and attribute ids, by workspace and object, gathered for one frame.
  let incoming = new Map<string, Map<string, Gathered>>();
  let isGathering = false;

  function applyIncoming() {
    isGathering = false;
    const gathered = incoming;
    incoming = new Map();
    for (const [workspace, objects] of gathered) {
      for (const [objectId, change] of objects) {
        const entries = viewsOf(workspace).filter((entry) => entry.objectId === objectId);
        const ids = [...change.ids];
        const held = ids.filter((id) => viewsOf(workspace).some((entry) => entry.shows(id)));
        // A record a screen subscribes to (a record page) reads what it shows that changed.
        subscriptions.changed(workspace, change.ids, change.attributes, change.lifecycle);
        // Visible attributes (spec 0006, AC-55): only what the event names and the windows read, plus what every
        // write moves when a window shows it. An event naming only attributes no window reads fetches nothing.
        const read = new Set(entries.flatMap((entry) => entry.attributes()));
        const moving = new Set(entries.flatMap((entry) => [...entry.orderAttributes().moving]));
        const always = [...read].filter((id) => moving.has(id));
        const wanted =
          change.attributes === 'all'
            ? undefined
            : [
                ...new Set([
                  ...[...change.attributes].filter((id) => read.has(id)),
                  ...(change.attributes.size > 0 ? always : []),
                ]),
              ];
        if (held.length > 0 && (wanted === undefined || wanted.length > 0)) {
          const attributeIds = wanted === undefined ? [...read] : wanted;
          // A refetch that fails leaves rows out of date: once more a moment later, then the views settle again.
          refetch(workspace, held, attributeIds).catch(() => {
            void wait(Math.round((1 + random()) * SPREAD_MS))
              .then(() => refetch(workspace, held, attributeIds))
              .catch(() => {
                records.reload(workspace, objectId);
              });
          });
        }
        // Order and membership (spec 0006, AC-56): settle a window when a change may move its rows.
        for (const entry of entries) {
          if (!entry.isReady()) continue;
          const order = entry.orderAttributes();
          const touches =
            change.attributes === 'all' ||
            change.attributes.size === 0 ||
            order.any ||
            [...change.attributes].some((id) => order.ids.has(id));
          // A record the event names as made, deleted or restored moves the count and maybe the rows; an edit to a
          // record out of sight, naming only attributes the order ignores, moves nothing, so no tab rereads for it.
          if (touches || change.lifecycle.size > 0) entry.markDirty();
        }
      }
    }
  }

  const records = {
    /**
     * An object's records as one question asks for them (spec 0006, AC-51):
     * its filter and sorts. Every screen asking the same question shares one
     * window, made on first use, its count and first block loading; a new
     * filter or sort opens a new window, and the old one goes once nobody
     * shows it. `attributeIds` are the columns the first block reads until a
     * screen names its own (`retain`); the primary attribute always comes.
     */
    view: (
      workspace: string,
      objectId: string,
      query: ViewQuery = {},
      attributeIds: readonly string[] = [],
    ): RecordsView => {
      const key = keyOf(workspace, objectId, query);
      const existing = views.get(key);
      if (existing !== undefined) return existing.view;
      const entry = openView(workspace, objectId, query, attributeIds);
      views.set(key, entry);
      return entry.view;
    },

    /**
     * Makes a record at once: a draft sits first in every view of its object
     * a screen shows, marked new, until the member leaves it (spec 0006,
     * AC-56); the server's row then replaces it. A refusal takes it out
     * again and rejects with the
     * refusals, so a form can mark its fields. A write that never reached the
     * server is sent again with the same id, which the server answers with the
     * record it already made. A form that may send again (Create pressed after
     * a lost answer) mints `id` once (`newId`) and passes it each time.
     */
    create: async (
      workspace: string,
      objectId: string,
      values: Readonly<Record<string, unknown>>,
      id: string = mintId(),
    ): Promise<RecordView> => {
      // Every rule of the object, before the draft shows (spec 0013, AC-257): a refusal rejects as the server's would.
      const asked = checkWith(workspace, objectId, new Set(Object.keys(values)), true);
      const check = asked instanceof Promise ? await asked : asked;
      if (check !== undefined) {
        const failures = checkInBrowser({
          rules: check.rules,
          values,
          written: new Set(Object.keys(values)),
          isCreate: true,
          now: new Date(now()).toISOString(),
          timeZone: timeZone(),
          pattern: check.pattern,
        });
        if (failures.length > 0) {
          throw dataError('VALIDATION_FAILED', rulesSummary(failures.length, failures[0]?.message), {
            refusals: refusalsOfRules(failures),
          });
        }
      }
      const mutationId = mintId();
      const at = new Date(now()).toISOString();
      // Who made it is the server's to say; the draft shows only its values until the answer.
      const nobody = { type: 'system' as const, id: null };
      const draft: RecordView = {
        id,
        objectId,
        createdAt: at,
        createdBy: nobody,
        updatedAt: at,
        updatedBy: nobody,
        display: { objectId, recordId: id, name: '', kind: 'other' },
        revision: 0,
        values,
        versions: {},
        linkTotals: {},
      };
      const layer = store.create(draft, mutationId);
      mutations.sent(mutationId);
      const placed = viewsOf(workspace).filter((entry) => entry.objectId === objectId && entry.isRetained());
      for (const entry of placed) entry.created(id);
      let settle: (made: boolean) => void = () => undefined;
      creating.set(
        id,
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      );
      try {
        const {
          echoes,
          written: _written,
          ...row
        } = await delivered(() => api.create({ workspace, objectId, id, values, timeZone: timeZone(), mutationId }));
        mutations.answered(mutationId, echoes);
        layer.confirm(row);
        settle(true);
        return row;
      } catch (error) {
        mutations.forget(mutationId);
        layer.refuse();
        for (const entry of placed) entry.withdrawn(id);
        settle(false);
        throw toDataError(error);
      } finally {
        creating.delete(id);
      }
    },

    /**
     * Edits cells as one action (a cell, a paste, a range clear): they show at
     * once, then go as one write (`records.setValues` for one record,
     * `records.setValuesBatch` for up to 500), each naming the base version it
     * started from. A refused record rolls back, marks each refused cell with
     * its message, and one toast with Retry covers them all. A second edit to
     * a cell while the first is in flight shows on top of it, and no late
     * answer brings the older value back. What lands goes on the undo stack.
     */
    setValues: (
      workspace: string,
      changes: readonly CellChange[],
      kind: UndoKind = changes.length > 1 ? 'paste' : 'cell',
    ): Promise<EditOutcome> => edit(workspace, undefined, changes, kind),

    /**
     * Sets a new option on one record's select, multi select or status cell
     * (spec 0012, AC-238): the cell shows `optionId` at once (added to what a
     * multi select holds), and one `records.setValues` sends
     * `{ newOption: { id, label } }`, which the server makes and sets in one
     * transaction, or rolls back with the cell marked. One action on the undo
     * stack, like any cell edit.
     */
    createOption: async (
      workspace: string,
      change: {
        readonly objectId: string;
        readonly recordId: string;
        readonly attributeId: string;
        readonly optionId: string;
        readonly label: string;
        readonly hue: Hue;
        readonly isMulti: boolean;
      },
    ): Promise<EditOutcome> => {
      const newOption = { newOption: { id: change.optionId, label: change.label } };
      const body = store.get(change.recordId);
      // A multi select keeps what it holds: one whose values haven't loaded would be replaced by the new option alone.
      if (change.isMulti && (body === undefined || !Object.hasOwn(body.values, change.attributeId))) {
        notify({ tone: 'danger', message: RECORD_WORDS.optionNotReady });
        return { kind: 'done', cells: 1, landed: 0 };
      }
      const held = body?.values[change.attributeId];
      const kept = Array.isArray(held) ? (held as readonly unknown[]).filter((id) => typeof id === 'string') : [];
      optionLooks.set(change.optionId, { label: change.label, hue: change.hue });
      return edit(
        workspace,
        change.objectId,
        [
          {
            rowId: change.recordId,
            columnId: change.attributeId,
            value: change.isMulti ? [...kept, change.optionId] : change.optionId,
            sent: change.isMulti ? [...kept, newOption] : newOption,
          },
        ],
        'cell',
      );
    },

    undo: {
      /**
       * Undoes this tab's newest action in the workspace (see `runUndo`);
       * with `only`, that action alone, and only while it is the newest.
       */
      run: (workspace: string, only?: string): Promise<UndoOutcome> => runUndo(workspace, only),
      /** How many actions this tab can undo in the workspace (for tests). */
      depth: (workspace: string): number => undo.size(workspace),
    },

    /** A records event named values its write replaced: raises the notice for the ones this tab wrote. */
    replaced: (workspace: string, event: RecordsEvent): void => {
      void replacedIn(workspace, event);
    },

    /** Reads records again by id (a change event's ids); ids the server leaves out are gone and leave every window. */
    refetch,

    /**
     * Another tab or person changed these records of an object (a change
     * event naming `attributeIds`). Gathered for one frame, then: the ones
     * held are fetched again in place, with only the changed attributes the
     * windows read (none when the event names only others); and every window
     * a change may reorder (its filter or sort attributes, or a record the
     * event names as made, deleted or restored, which moves its count)
     * settles 1.5 s later.
     */
    changed: (
      workspace: string,
      objectId: string,
      ids: readonly string[],
      attributeIds?: readonly string[],
      lifecycle: Lifecycle = {},
    ): void => {
      if (ids.length === 0) return;
      remember(workspace, ids);
      // A renamed record shows its new name wherever a cell links to it.
      names.forget(workspace, ids);
      const objects = incoming.get(workspace) ?? new Map<string, Gathered>();
      incoming.set(workspace, objects);
      const gathered = objects.get(objectId) ?? {
        ids: new Set<string>(),
        attributes: new Set<string>(),
        lifecycle: new Set<string>(),
      };
      for (const id of ids) gathered.ids.add(id);
      for (const id of [
        ...(lifecycle.createdIds ?? []),
        ...(lifecycle.deletedIds ?? []),
        ...(lifecycle.restoredIds ?? []),
      ]) {
        gathered.lifecycle.add(id);
      }
      // An event that doesn't say which attributes changed reads everything the windows show.
      const attributes =
        attributeIds === undefined || gathered.attributes === 'all'
          ? 'all'
          : new Set([...gathered.attributes, ...attributeIds]);
      objects.set(objectId, { ids: gathered.ids, attributes, lifecycle: gathered.lifecycle });
      if (isGathering) return;
      isGathering = true;
      schedule(applyIncoming);
    },

    /**
     * Changes may have been missed (a gap, a lost recovery, a coarse event):
     * the workspace's views (or one object's) settle now, reading the blocks
     * on screen and the count again and keeping the table on screen.
     */
    reload: (workspace: string, objectId?: string): void => {
      for (const entry of viewsOf(workspace)) if (objectId === undefined || entry.objectId === objectId) entry.reread();
      subscriptions.reload(workspace, objectId);
    },

    /**
     * One record with the attributes a screen shows (spec 0006, `records.one`):
     * served from the same store as every table (one body), holding it while
     * subscribed, reading only what the body lacks (everything asked when no
     * view keeps it fresh), patched live, and `deleted` when it goes away.
     * `'all'` reads every attribute the object has.
     */
    one: (workspace: string, recordId: string, attributeIds: RecordAttributes): RecordSubscription =>
      subscriptions.one(workspace, recordId, attributeIds),

    /** Forgets every record and view (sign out, or someone else signed in). */
    clear: () => {
      subscriptions.clear();
      for (const entry of views.values()) entry.dispose();
      views.clear();
      incoming = new Map();
      recent = new Map();
      creating.clear();
      sending.clear();
      store.clear();
      names.clear();
      cellErrors = new Map();
      own.clear();
      undo.clear();
      inflight.clear();
      undoing.clear();
      optionLooks.clear();
      madeOptions.clear();
    },

    /** How many record bodies the store holds now (for tests and the gate). */
    size: () => store.size(),
  };
  return records;
}

/** The records layer, as createDataLayer holds it once loaded. */
export type RecordsLayer = ReturnType<typeof createRecordsLayer>;
