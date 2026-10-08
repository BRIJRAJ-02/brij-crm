// What a tab remembers of its own confirmed writes (spec 0006, milestone 1),
// in memory only and per data layer, so one per tab: the versions it wrote
// (the replaced notice matches an event's `replaced` against them, and "Use
// mine" saves the value kept beside each), and the undo stack (each action's
// cells, the value before and the version written, checked on the server by
// `ifVersionId` when undone). Both go with the records on sign out and on a
// workspace switch.

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

/** What one action was, for the toast that names it: one cell, a paste, or a range clear. */
export type UndoKind = 'cell' | 'paste' | 'clear';

/** One user action on the undo stack: its kind, its object, and every cell of it that landed. */
export interface UndoEntry {
  /** The action's own id (its write's mutation id): a toast's Undo names it, so it undoes that action or nothing. */
  readonly id: string;
  readonly kind: UndoKind;
  readonly objectId: string;
  readonly cells: readonly UndoCell[];
}

/** A tab's undo stack, one per workspace, `depth` (50) entries each; the oldest goes first. */
export interface UndoStack {
  readonly push: (workspace: string, entry: UndoEntry) => void;
  /** The newest entry, taken off the stack; undefined when there is none. */
  readonly pop: (workspace: string) => UndoEntry | undefined;
  /** The newest entry, left on the stack. */
  readonly top: (workspace: string) => UndoEntry | undefined;
  /**
   * A cell an undo just put back at version `to`: an older entry that wrote
   * `from` there (the version the undone action replaced) now finds `to`, so
   * the next press undoes it too.
   */
  readonly rewrite: (workspace: string, recordId: string, attributeId: string, from: string, to: string) => void;
  readonly size: (workspace: string) => number;
  readonly clear: () => void;
}

/** An empty undo stack. */
export function createUndoStack(depth: number = UNDO_DEPTH, cellBudget: number = UNDO_CELLS): UndoStack {
  const stacks = new Map<string, readonly UndoEntry[]>();
  return {
    push: (workspace, entry) => {
      if (entry.cells.length === 0) return;
      let stack = [...(stacks.get(workspace) ?? []), entry];
      if (stack.length > depth) stack = stack.slice(stack.length - depth);
      // Bounded by cells too, so 50 pastes of 500 rows never hold their old values for the session.
      let cells = stack.reduce((sum, each) => sum + each.cells.length, 0);
      while (cells > cellBudget && stack.length > 1) {
        cells -= stack[0]?.cells.length ?? 0;
        stack = stack.slice(1);
      }
      stacks.set(workspace, stack);
    },
    rewrite: (workspace, recordId, attributeId, from, to) => {
      const stack = stacks.get(workspace);
      if (stack === undefined) return;
      stacks.set(
        workspace,
        stack.map((entry) =>
          entry.cells.some(
            (cell) => cell.recordId === recordId && cell.attributeId === attributeId && cell.writtenVersionId === from,
          )
            ? {
                ...entry,
                cells: entry.cells.map((cell) =>
                  cell.recordId === recordId && cell.attributeId === attributeId && cell.writtenVersionId === from
                    ? { ...cell, writtenVersionId: to }
                    : cell,
                ),
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
    size: (workspace) => stacks.get(workspace)?.length ?? 0,
    clear: () => {
      stacks.clear();
    },
  };
}
