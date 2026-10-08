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
      versions.delete(versionId);
      versions.set(versionId, written);
      while (versions.size > limit) {
        const oldest = versions.keys().next();
        if (oldest.done === true) break;
        versions.delete(oldest.value);
      }
    },
    get: (versionId) => versions.get(versionId.toLowerCase()) ?? versions.get(versionId),
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
}

/** What one action was, for the toast that names it: one cell, a paste, or a range clear. */
export type UndoKind = 'cell' | 'paste' | 'clear';

/** One user action on the undo stack: its kind, its object, and every cell of it that landed. */
export interface UndoEntry {
  readonly kind: UndoKind;
  readonly objectId: string;
  readonly cells: readonly UndoCell[];
}

/** A tab's undo stack, one per workspace, `depth` (50) entries each; the oldest goes first. */
export interface UndoStack {
  readonly push: (workspace: string, entry: UndoEntry) => void;
  /** The newest entry, taken off the stack; undefined when there is none. */
  readonly pop: (workspace: string) => UndoEntry | undefined;
  readonly size: (workspace: string) => number;
  readonly clear: () => void;
}

/** An empty undo stack. */
export function createUndoStack(depth: number = UNDO_DEPTH): UndoStack {
  const stacks = new Map<string, readonly UndoEntry[]>();
  return {
    push: (workspace, entry) => {
      if (entry.cells.length === 0) return;
      const stack = [...(stacks.get(workspace) ?? []), entry];
      stacks.set(workspace, stack.length > depth ? stack.slice(stack.length - depth) : stack);
    },
    pop: (workspace) => {
      const stack = stacks.get(workspace) ?? [];
      const top = stack.at(-1);
      if (top !== undefined) stacks.set(workspace, stack.slice(0, -1));
      return top;
    },
    size: (workspace) => stacks.get(workspace)?.length ?? 0,
    clear: () => {
      stacks.clear();
    },
  };
}
