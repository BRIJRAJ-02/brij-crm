// The workspace's default currency and country (Settings › Workspace › General): where a new Currency attribute and a
// new phone number start, and what an imported "$" is read as. One copy per workspace, read when a screen first holds
// it (the workspace frame, once the page has drawn: nothing waits for it, so no first paint does) and put in place
// the moment General saves a change. Nothing live carries it: another admin's change shows on the next visit.
import type { WorkspaceSettings } from '@crm/contracts';

/** The workspace's region as the pages format with it; a field absent keeps the language's region's. */
export interface WorkspaceRegion {
  readonly currency?: string;
  readonly country?: string;
}

/** One workspace's region, read when first held; undefined until it arrives (or if the read failed). */
export interface RegionHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkspaceRegion | undefined;
  readonly retain: () => () => void;
}

/** What the store is made with. */
export interface RegionDeps {
  /** The workspace's settings, from the API. */
  readonly read: (workspace: string) => Promise<WorkspaceSettings>;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is. */
export const REGION_FRESH_MS = 60_000;

/** The region a settings answer holds. */
export function regionOf(settings: Pick<WorkspaceSettings, 'currency' | 'country'>): WorkspaceRegion {
  return {
    ...(settings.currency === undefined ? {} : { currency: settings.currency }),
    ...(settings.country === undefined ? {} : { country: settings.country }),
  };
}

/** The workspaces' regions. */
export function createRegionStore(deps: RegionDeps) {
  const now = deps.now ?? Date.now;
  const held = new Map<string, ReturnType<typeof make>>();

  function make(workspace: string) {
    let state: WorkspaceRegion | undefined;
    let readAt: number | undefined;
    let reading: Promise<void> | undefined;
    // The newest answer wins: a read that began before a save landed never puts its older answer over it.
    let version = 0;
    const listeners = new Set<() => void>();
    const put = (next: WorkspaceRegion) => {
      state = next;
      readAt = now();
      for (const listener of listeners) listener();
    };
    const read = () => {
      if (reading !== undefined) return;
      const began = version;
      reading = deps
        .read(workspace)
        .then(
          (settings) => {
            if (version === began) put(regionOf(settings));
          },
          () => undefined,
        )
        .finally(() => {
          reading = undefined;
        });
    };
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        if (readAt === undefined || now() - readAt >= REGION_FRESH_MS) read();
        return () => undefined;
      },
      /** A save landed: its answer is the region now. */
      set(region: WorkspaceRegion) {
        version += 1;
        put(region);
      },
    };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const made = make(workspace);
    held.set(workspace, made);
    return made;
  };

  return {
    /** A workspace's region, read when a screen first holds it. */
    of: (workspace: string): RegionHeld => of(workspace),
    /** Puts a saved region in place for every screen holding it. */
    set: (workspace: string, region: WorkspaceRegion): void => {
      of(workspace).set(region);
    },
    /** A workspace moved or was deleted: forgets its copy. */
    drop: (workspace: string): void => {
      held.delete(workspace);
    },
    /** Signed out: forgets every workspace's copy. */
    clear: (): void => {
      held.clear();
    },
  };
}
