// Options made from a cell, while the server makes them (spec 0012, AC-238).
// A cell's "Create" shows the new option's label at once: its id is set in
// the record store, and the label and hue sit here until the object's
// attributes come back with the option itself. Plain and small, so it sits
// in the first load with the rest of the layer's surface.
import type { Hue } from '@crm/contracts/values';

/** An option a cell made, by its minted id: what the cell shows before the attribute lists it. */
export interface PendingOption {
  readonly attributeId: string;
  readonly id: string;
  readonly label: string;
  readonly hue: Hue;
}

/** Every pending option of a workspace's attributes, by `workspace/attributeId`, oldest first. */
export type PendingOptions = ReadonlyMap<string, readonly PendingOption[]>;

/** At most this many are kept; the oldest goes first (each is ignored once its attribute lists it anyway). */
export const MAX_PENDING_OPTIONS = 200;

const keyOf = (workspace: string, attributeId: string) => `${workspace}/${attributeId}`;

/**
 * The pending options store: `add` as a cell asks, `remove` on a refusal,
 * and nothing on success, since a screen merges a pending option only while
 * its attribute's options don't hold that id (`withPendingOptions`), so a
 * landed one gives way to the real one as the lists are read again. One
 * snapshot object per change, for `useSyncExternalStore`.
 */
export function createPendingOptions() {
  let snapshot: PendingOptions = new Map();
  let order: readonly { readonly key: string; readonly id: string }[] = [];
  const listeners = new Set<() => void>();
  const publish = (next: PendingOptions) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const without = (map: PendingOptions, key: string, id: string): PendingOptions => {
    const kept = (map.get(key) ?? []).filter((option) => option.id !== id);
    const next = new Map(map);
    if (kept.length === 0) next.delete(key);
    else next.set(key, kept);
    return next;
  };
  return {
    add: (workspace: string, option: PendingOption): void => {
      const key = keyOf(workspace, option.attributeId);
      let next: PendingOptions = new Map([...snapshot, [key, [...(snapshot.get(key) ?? []), option]]]);
      order = [...order, { key, id: option.id }];
      while (order.length > MAX_PENDING_OPTIONS) {
        const [oldest, ...rest] = order;
        order = rest;
        if (oldest !== undefined) next = without(next, oldest.key, oldest.id);
      }
      publish(next);
    },
    remove: (workspace: string, attributeId: string, optionId: string): void => {
      const key = keyOf(workspace, attributeId);
      order = order.filter((each) => !(each.key === key && each.id === optionId));
      publish(without(snapshot, key, optionId));
    },
    clear: (): void => {
      order = [];
      if (snapshot.size > 0) publish(new Map());
    },
    getSnapshot: (): PendingOptions => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The pending options store. */
export type PendingOptionsStore = ReturnType<typeof createPendingOptions>;

/**
 * A field attribute with the cell made options of its workspace not yet in
 * its own options added at the end, so a cell shows the new label at once.
 * The same attribute when there are none.
 */
export function withPendingOptions<
  T extends {
    readonly id: string;
    readonly options?: readonly {
      readonly id: string;
      readonly label: string;
      readonly hue: Hue;
      readonly archived: boolean;
    }[];
  },
>(attribute: T, workspace: string, pending: PendingOptions): T {
  const waiting = pending.get(keyOf(workspace, attribute.id));
  if (waiting === undefined || attribute.options === undefined) return attribute;
  const held = new Set(attribute.options.map((option) => option.id));
  const added = waiting.filter((option) => !held.has(option.id));
  if (added.length === 0) return attribute;
  return {
    ...attribute,
    options: [
      ...attribute.options,
      ...added.map((option) => ({ id: option.id, label: option.label, hue: option.hue, archived: false })),
    ],
  };
}
