// What a tab remembers of its own confirmed writes (spec 0006, milestone 1),
// in memory only and per data layer, so one per tab: the versions it wrote
// (the replaced notice matches an event's `replaced` against them, and "Use
// mine" saves the value kept beside each), and the undo stack (each action's
// cells, the value before and the version written, checked on the server by
// `ifVersionId` when undone). Both go with the records on sign out and on a
// workspace switch. Deletes and creates go on the same stack (spec 0022).

/** The most versions a tab remembers as its own: its last 500 written cells. */
export const OWN_VERSIONS = 500;

/** The most actions one tab can undo in one workspace (`UNDO_DEPTH`). */
export const UNDO_DEPTH = 50;

/** The most cells the undo stack keeps per workspace across its entries; past it the oldest entries go first. */
export const UNDO_CELLS = 20_000;

/** A cell this tab wrote: where, what it wrote, and the record's name then (the notice names it). */
export interface OwnVersion {
  readonly workspace: string;
  readonly objectId: string;
  readonly recordId: string;
  readonly attributeId: string;
  readonly value: unknown;
  readonly recordName: string;
}

/** The versions this tab wrote, by version id, the last `limit` kept (oldest dropped first). */
export interface OwnVersions {
  readonly add: (versionId: string, written: OwnVersion) => void;
  readonly get: (versionId: string) => OwnVersion | undefined;
  readonly size: () => number;
  readonly clear: () => void;
}

/** A tab's own versions, the last `limit` (500) of them. */
export function createOwnVersions(limit: number = OWN_VERSIONS): OwnVersions {
  // A Map keeps insertion order, so the first key is the oldest.
  const versions = new Map<string, OwnVersion>();
  return {
    add: (versionId, written) => {
      const key = versionId.toLowerCase();
      versions.delete(key);
      versions.set(key, written);
      while (versions.size > limit) {
        const oldest = versions.keys().next();
        if (oldest.done === true) break;
        versions.delete(oldest.value);
      }
    },
    get: (versionId) => versions.get(versionId.toLowerCase()),
    size: () => versions.size,
    clear: () => {
      versions.clear();
    },
  };
}

/** One cell an undo puts back: the value the screen showed before the action, and the version the action wrote. */
export interface UndoCell {
  readonly recordId: string;
  readonly attributeId: string;
  readonly before: unknown;
  readonly writtenVersionId: string;
  /** The version the action replaced (the base's when it went out), so undoing it can hand an older entry its own. */
  readonly replacedVersionId?: string;
}

/** What one action was, for the toast that names it: one cell, a paste, a range clear, or a bulk edit (spec 0022). */
export type UndoKind = 'cell' | 'paste' | 'clear' | 'bulk';

/**
 * A company a person's write filed them under by their email (spec 0059,
 * AC-5920): the person's Company cell and the version the link carries, the
 * company, and whether the write made it. Undoing it clears the cell while it
 * still holds that link, and moves a company the write made to the trash
 * while nothing else links to it.
 */
export interface FiledLink {
  readonly recordId: string;
  readonly attributeId: string;
  readonly linkVersionId: string;
  readonly company: { readonly objectId: string; readonly recordId: string; readonly name: string };
  readonly made: boolean;
}

/** One edit on the undo stack: its kind, its object, and every cell of it that landed. */
export interface CellsEntry {
  /** The action's own id (its write's mutation id): a toast's Undo names it, so it undoes that action or nothing. */
  readonly id: string;
  readonly kind: UndoKind;
  readonly objectId: string;
  readonly cells: readonly UndoCell[];
  /** Companies the edit filed people under (spec 0059): undoing the edit undoes them too. */
  readonly filed?: readonly FiledLink[];
}

/**
 * A delete on the undo stack (spec 0022, AC-526): undoing it restores the
 * records still in the trash with its batch id (`records.restoreBatch`).
 */
export interface DeleteEntry {
  readonly id: string;
  readonly kind: 'delete';
  readonly objectId: string;
  readonly batchId: string;
  /** How many records it moved to the trash. */
  readonly count: number;
  /** The record's name when it deleted one, for the toast ("Restored Ada Lovelace"). */
  readonly recordName?: string;
}

/** A record made here (spec 0022, AC-541): undoing it moves the record to the trash. */
export interface CreateEntry {
  readonly id: string;
  readonly kind: 'create';
  readonly objectId: string;
  readonly recordId: string;
  readonly recordName: string;
  /** The company the create filed the person under (spec 0059): undoing the create undoes it too. */
  readonly filed?: FiledLink;
}

/** One link delta an undo sends (spec 0014): add a far record on a side, or remove one. */
export type LinkStep =
  | {
      readonly kind: 'add';
      readonly recordId: string;
      readonly attributeId: string;
      readonly target: { readonly objectId: string; readonly recordId: string };
      /** Takes the record back from whoever holds it now, on a far side that holds one. */
      readonly move?: boolean;
    }
  | {
      readonly kind: 'remove';
      readonly recordId: string;
      readonly attributeId: string;
      readonly target: { readonly objectId: string; readonly recordId: string };
    };

/**
 * A link added or removed from a cell (spec 0014, the data layer): undoing
 * it sends its inverse (remove for add, add for remove; a move adds the
 * record back to its old holder, moving it). Never pushed itself.
 */
export interface LinksEntry {
  readonly id: string;
  readonly kind: 'links';
  readonly objectId: string;
  /** The record and side the person changed, for the toast ("Undid Team on Acme"). */
  readonly recordId: string;
  readonly attributeId: string;
  /** Whether the side holds many, and its pair: what the inverse shows at once and rereads. */
  readonly isMulti: boolean;
  readonly pairedAttributeId?: string;
  readonly recordName: string;
  readonly inverse: LinkStep;
}

/** One user action on the undo stack: an edit of cells, a delete, a create, or a link delta. */
export type UndoEntry = CellsEntry | DeleteEntry | CreateEntry | LinksEntry;

/** Whether an entry is an edit of cells (a cell, a paste or a range clear). */
export function isCellsEntry(entry: UndoEntry): entry is CellsEntry {
  return entry.kind !== 'delete' && entry.kind !== 'create' && entry.kind !== 'links';
}

/** How many cells an entry holds against the stack's budget: a delete, a create or a link delta counts as one. */
const sizeOf = (entry: UndoEntry): number =>
  isCellsEntry(entry) ? entry.cells.length + (entry.filed?.length ?? 0) : 1;

/** The companies an entry filed people under (spec 0059), whatever its kind. */
export function filedOf(entry: UndoEntry): readonly FiledLink[] {
  if (entry.kind === 'create') return entry.filed === undefined ? [] : [entry.filed];
  return isCellsEntry(entry) ? (entry.filed ?? []) : [];
}

/** The entry with its filings left out (spec 0059): what stays on the stack once a toast's Undo took them back. */
export function withoutFiled(entry: UndoEntry): UndoEntry {
  if (entry.kind === 'create') {
    const { filed: _filed, ...rest } = entry;
    return rest;
  }
  if (!isCellsEntry(entry)) return entry;
  const { filed: _filed, ...rest } = entry;
  return rest;
}

/** A tab's undo stack, one per workspace, `depth` (50) entries each; the oldest goes first. */
export interface UndoStack {
  readonly push: (workspace: string, entry: UndoEntry) => void;
  /** The newest entry, taken off the stack; undefined when there is none. */
  readonly pop: (workspace: string) => UndoEntry | undefined;
  /** The newest entry, left on the stack. */
  readonly top: (workspace: string) => UndoEntry | undefined;
  /** Takes the entry with this id off the stack, wherever it sits (a delete job undone from its toast). */
  readonly drop: (workspace: string, id: string) => void;
  /** The entry with this id, wherever it sits, left on the stack; undefined when it is gone. */
  readonly find: (workspace: string, id: string) => UndoEntry | undefined;
  /** Puts `entry` in the place of the entry with its id, wherever it sits (a filing taken back from its toast). */
  readonly replace: (workspace: string, entry: UndoEntry) => void;
  /**
   * Cells an undo just put back, by `${recordId}:${attributeId}:${from}` to
   * the version it wrote: an older entry that wrote `from` there (the version
   * the undone action replaced) now finds the new one, so the next press
   * undoes it too. One pass over the stack, however many cells.
   */
  readonly rewrite: (workspace: string, handOver: ReadonlyMap<string, string>) => void;
  readonly size: (workspace: string) => number;
  readonly clear: () => void;
}

/** An empty undo stack. */
export function createUndoStack(depth: number = UNDO_DEPTH, cellBudget: number = UNDO_CELLS): UndoStack {
  const stacks = new Map<string, readonly UndoEntry[]>();
  return {
    push: (workspace, entry) => {
      if (isCellsEntry(entry) && entry.cells.length === 0 && (entry.filed ?? []).length === 0) return;
      let stack = [...(stacks.get(workspace) ?? []), entry];
      if (stack.length > depth) stack = stack.slice(stack.length - depth);
      // Bounded by cells too, so 50 pastes of 500 rows never hold their old values for the session.
      let cells = stack.reduce((sum, each) => sum + sizeOf(each), 0);
      while (cells > cellBudget && stack.length > 1) {
        const [oldest] = stack;
        cells -= oldest === undefined ? 0 : sizeOf(oldest);
        stack = stack.slice(1);
      }
      stacks.set(workspace, stack);
    },
    rewrite: (workspace, handOver) => {
      const stack = stacks.get(workspace);
      if (stack === undefined || handOver.size === 0) return;
      const now = (cell: UndoCell) => handOver.get(`${cell.recordId}:${cell.attributeId}:${cell.writtenVersionId}`);
      stacks.set(
        workspace,
        stack.map((entry) =>
          isCellsEntry(entry) && entry.cells.some((cell) => now(cell) !== undefined)
            ? {
                ...entry,
                cells: entry.cells.map((cell) => {
                  const to = now(cell);
                  return to === undefined ? cell : { ...cell, writtenVersionId: to };
                }),
              }
            : entry,
        ),
      );
    },
    pop: (workspace) => {
      const stack = stacks.get(workspace) ?? [];
      const top = stack.at(-1);
      if (top !== undefined) stacks.set(workspace, stack.slice(0, -1));
      return top;
    },
    top: (workspace) => stacks.get(workspace)?.at(-1),
    drop: (workspace, id) => {
      const stack = stacks.get(workspace);
      if (stack === undefined || !stack.some((entry) => entry.id === id)) return;
      stacks.set(
        workspace,
        stack.filter((entry) => entry.id !== id),
      );
    },
    find: (workspace, id) => stacks.get(workspace)?.find((entry) => entry.id === id),
    replace: (workspace, entry) => {
      const stack = stacks.get(workspace);
      if (stack === undefined || !stack.some((each) => each.id === entry.id)) return;
      stacks.set(
        workspace,
        stack.map((each) => (each.id === entry.id ? entry : each)),
      );
    },
    size: (workspace) => stacks.get(workspace)?.length ?? 0,
    clear: () => {
      stacks.clear();
    },
  };
}
