// A Captures list (Links' booking pages, Forms' forms): one held list per
// workspace, the one copy every screen reads, so a write made anywhere (the
// list's menu, the New dialog, the editor's rename) shows in the list without a
// refresh. These are settings, with no change events of their own, so the list
// is read again when a screen holds it after a while away (`FRESH_MS`), and a
// write the layer makes patches it in place: shown at once where it can be
// (`show`), put back on a refusal (`undo`), and the server's answer put in
// place once it lands (`land`). A read that started before a write landed is
// dropped and asked again, so an older answer never undoes a newer change.
import { toDataError, type DataError } from '../errors.ts';

/** How long a list read stays fresh: a screen held again within it shows the list without asking. */
export const FRESH_MS = 1_000;

/** A Captures list as a screen reads it: loading, failed (its first read), or the items as last known. */
export type CaptureListState<Item> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | {
      readonly status: 'ready';
      readonly items: readonly Item[];
      /** Rows shown before the server made them (a duplicate on its way): drawn, but not opened yet. */
      readonly pendingIds: ReadonlySet<string>;
    };

/** One workspace's list, as a screen retains it. */
export interface CaptureListView<Item> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CaptureListState<Item>;
  /** Held while a screen shows it; read when first held, unless a read just landed. */
  readonly retain: () => () => void;
  /** For a route loader: settles at once when the list is held already (reading it again behind), else after the first read, which it rejects with. */
  readonly ready: () => Promise<void>;
  /** Reads it again (Try again). */
  readonly reload: () => void;
}

/** A change to a list's items: a pure function from the items to the new items. */
export type ItemsChange<Item> = (items: readonly Item[]) => readonly Item[];

/** One write through the list: what to show at once, how to put it back, and what the answer changes. */
export interface ListWrite<Item, Answer> {
  readonly send: () => Promise<Answer>;
  readonly show?: ItemsChange<Item>;
  readonly undo?: ItemsChange<Item>;
  readonly land?: (items: readonly Item[], answer: Answer) => readonly Item[];
  /** A row `show` adds before the server made it. */
  readonly pendingId?: string;
}

/** What the list needs. */
export interface CaptureListDeps<Item> {
  readonly read: (workspace: string) => Promise<readonly Item[]>;
  /** The clock, for tests. */
  readonly now?: () => number;
}

const NONE: ReadonlySet<string> = new Set();

/** Items with `item` first, unless one with its id is there, which it replaces in place. */
export function upsertFirst<Item extends { readonly id: string }>(item: Item): ItemsChange<Item> {
  return (items) =>
    items.some((each) => each.id === item.id)
      ? items.map((each) => (each.id === item.id ? item : each))
      : [item, ...items];
}

/** Items with the one `id` names changed by `change`; none when it isn't there. */
export function patchItem<Item extends { readonly id: string }>(
  id: string,
  change: (item: Item) => Item,
): ItemsChange<Item> {
  return (items) => items.map((each) => (each.id === id ? change(each) : each));
}

/** Items without the one `id` names. */
export function dropItem<Item extends { readonly id: string }>(id: string): ItemsChange<Item> {
  return (items) => items.filter((each) => each.id !== id);
}

/**
 * A change to one row shown at once, and how to put it back: only while the
 * row still shows this change, since a later write owns it after that.
 */
export function shownPatch<Item extends { readonly id: string }>(
  items: readonly Item[] | undefined,
  id: string,
  change: (item: Item) => Item,
): { readonly show: ItemsChange<Item>; readonly undo: ItemsChange<Item> } {
  const before = items?.find((each) => each.id === id);
  let shown: Item | undefined;
  return {
    show: patchItem<Item>(id, (item) => {
      shown = change(item);
      return shown;
    }),
    undo: patchItem<Item>(id, (item) => (item === shown && before !== undefined ? before : item)),
  };
}

/** A row gone at once, and how to put it back where it was. */
export function shownDrop<Item extends { readonly id: string }>(
  items: readonly Item[] | undefined,
  id: string,
): { readonly show: ItemsChange<Item>; readonly undo: ItemsChange<Item> } {
  const index = items?.findIndex((each) => each.id === id) ?? -1;
  const before = index < 0 ? undefined : items?.[index];
  return {
    show: dropItem<Item>(id),
    undo: (now) =>
      before === undefined || now.some((each) => each.id === id)
        ? now
        : [...now.slice(0, index), before, ...now.slice(index)],
  };
}

/**
 * Captures lists for one kind of item: a held list per workspace, read
 * through `deps.read`, and `write` for every change the layer makes to them.
 */
export function createCaptureList<Item extends { readonly id: string }>(deps: CaptureListDeps<Item>) {
  const now = deps.now ?? (() => Date.now());
  const lists = new Map<string, ReturnType<typeof makeList>>();

  function makeList(workspace: string) {
    let state: CaptureListState<Item> = { status: 'loading' };
    let held = 0;
    let readAt: number | undefined;
    let reading: Promise<void> | undefined;
    // Moves on every write sent and landed; a read that saw it move lands nothing.
    let epoch = 0;
    let writing = 0;
    let isStale = false;
    const listeners = new Set<() => void>();
    const set = (next: CaptureListState<Item>) => {
      state = next;
      for (const listener of listeners) listener();
    };

    const read = (): Promise<void> => {
      if (reading !== undefined) return reading;
      const startedAt = epoch;
      const current: Promise<void> = deps.read(workspace).then(
        (items) => {
          reading = undefined;
          if (startedAt !== epoch || writing > 0) {
            // It may miss a write: a list already shown keeps what it shows, a first one shows it for now.
            // Either way it is read again once the writes are in.
            isStale = true;
            if (state.status !== 'ready') set({ status: 'ready', items, pendingIds: NONE });
            if (writing === 0) return read();
            return undefined;
          }
          isStale = false;
          readAt = now();
          set({ status: 'ready', items, pendingIds: state.status === 'ready' ? state.pendingIds : NONE });
          return undefined;
        },
        (error: unknown) => {
          reading = undefined;
          // A list already shown stays; only a first read shows the failure.
          if (state.status !== 'ready') {
            set({ status: 'error', error: toDataError(error) });
            throw toDataError(error);
          }
        },
      );
      reading = current;
      return current;
    };

    const isFresh = () => state.status === 'ready' && !isStale && readAt !== undefined && now() - readAt < FRESH_MS;

    /** Applies a change to the items when the list holds them. */
    const change = (run: ItemsChange<Item>, pending?: { readonly add?: string; readonly remove?: string }) => {
      if (state.status !== 'ready') return;
      let pendingIds = state.pendingIds;
      if (pending?.add !== undefined || pending?.remove !== undefined) {
        const next = new Set(pendingIds);
        if (pending.add !== undefined) next.add(pending.add);
        if (pending.remove !== undefined) next.delete(pending.remove);
        pendingIds = next;
      }
      set({ status: 'ready', items: run(state.items), pendingIds });
    };

    const settle = () => {
      epoch += 1;
      writing -= 1;
      // A held list read again after its writes; one nobody holds is read when next held.
      if (writing === 0 && isStale && held > 0) void read();
    };

    return {
      view: {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => state,
        retain() {
          held += 1;
          if (held === 1 && !isFresh()) read().catch(() => undefined);
          return () => {
            held -= 1;
          };
        },
        ready(): Promise<void> {
          if (state.status === 'ready') {
            if (!isFresh()) read().catch(() => undefined);
            return Promise.resolve();
          }
          return read();
        },
        reload() {
          read().catch(() => undefined);
        },
      } satisfies CaptureListView<Item>,

      async write<Answer>(write: ListWrite<Item, Answer>): Promise<Answer> {
        epoch += 1;
        writing += 1;
        // A write while nothing is known: the next read asks the server, which has it.
        if (state.status !== 'ready') isStale = true;
        if (write.show !== undefined)
          change(write.show, { ...(write.pendingId === undefined ? {} : { add: write.pendingId }) });
        try {
          const answer = await write.send();
          const land = write.land;
          change(land === undefined ? (items) => items : (items) => land(items, answer), {
            ...(write.pendingId === undefined ? {} : { remove: write.pendingId }),
          });
          settle();
          return answer;
        } catch (error) {
          if (write.undo !== undefined)
            change(write.undo, { ...(write.pendingId === undefined ? {} : { remove: write.pendingId }) });
          settle();
          throw error;
        }
      },
    };
  }

  const listOf = (workspace: string) => {
    const found = lists.get(workspace);
    if (found !== undefined) return found;
    const made = makeList(workspace);
    lists.set(workspace, made);
    return made;
  };

  return {
    /** The workspace's list. */
    view: (workspace: string): CaptureListView<Item> => listOf(workspace).view,
    /** The items as the list holds them now, when it holds them. */
    items: (workspace: string): readonly Item[] | undefined => {
      const state = listOf(workspace).view.getSnapshot();
      return state.status === 'ready' ? state.items : undefined;
    },
    /** Sends a write, showing it in the list as `write` says; answers what the server did, or rejects as it did. */
    write: <Answer>(workspace: string, write: ListWrite<Item, Answer>): Promise<Answer> =>
      listOf(workspace).write(write),
    /** Forgets every list (sign out). */
    clear: () => {
      lists.clear();
    },
  };
}

/** A Captures list store. */
export type CaptureListStore<Item extends { readonly id: string }> = ReturnType<typeof createCaptureList<Item>>;
