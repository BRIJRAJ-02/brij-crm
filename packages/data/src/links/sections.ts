// A record page's related sections in the browser (spec 0014's section
// source, spec 0017 milestone 3): one source per record and side, pages of
// `links.page` in the side's order (20 at first, 20 more with each Show
// more), the exact total, and the far records as display shapes only, never
// record bodies (they never enter the record store). The sidebar's section
// and Overview's card of the same side share one source, so the first page
// is read once. It keeps itself live by reading what it holds again when a
// change names the record and side, a far record it holds, or the far
// object's trash, at most twice a second; and it shows this tab's own Add
// and Remove at once (`hide`, `show`), until a read after the write lands.
// Loaded with the first record page, so it stays out of the first load.
import type { LinkPage, RecordRefDisplay } from '@crm/contracts';
import { LINK_PAGE_MAX, LINK_PREVIEW } from '@crm/contracts/link-limits';
import { toDataError, type DataError } from '../errors.ts';

/** The least time between two reads of a section again, in ms: at most two a second, as the timeline. */
export const SECTION_REFRESH_MS = 500;

/** The most rows a section reads again for a change; rows past them stay as they were until Show more. */
export const SECTION_REREAD_MAX = 200;

/** Where a section stands: loading its first page, shown, failed, or out of reach (missing, hidden or archived). */
export type LinkSectionStatus = 'loading' | 'ready' | 'error' | 'unavailable';

/** A section as a screen draws it. */
export interface LinkSectionState {
  readonly status: LinkSectionStatus;
  /** The related records in the side's order, this tab's own Add and Remove shown already. */
  readonly items: readonly RecordRefDisplay[];
  /** The exact total, once the first page is in. */
  readonly total?: number;
  /** More rows past the ones held (Show more). */
  readonly hasMore: boolean;
  /** Show more is out. */
  readonly isLoadingMore: boolean;
  readonly error?: DataError;
}

/** One record's side, as a screen subscribes to it (`useLinkSection` in `@crm/data/react`). */
export interface LinkSection {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LinkSectionState;
  /** Reads the first page again after a failure. */
  readonly retry: () => void;
  /** The next 20 rows. */
  readonly showMore: () => void;
  /** A screen shows it: live changes reach it while held. The answer lets go. */
  readonly retain: () => () => void;
}

/** A change this tab shows at once on a section: settled with whether its write landed. */
export interface SectionChange {
  readonly settle: (landed: boolean) => void;
}

/** What a section source needs from the layer around it. */
export interface LinkSectionsOptions {
  /** One page of `links.page`. */
  readonly page: (
    workspace: string,
    input: {
      readonly recordId: string;
      readonly attributeId: string;
      readonly cursor?: string;
      readonly limit: number;
    },
  ) => Promise<LinkPage>;
  /** Listens to the workspace's live changes while a section is shown. */
  readonly watch?: (workspace: string) => () => void;
  /** Whether the tab is hidden: a hidden tab's sections read nothing until shown. */
  readonly isHidden?: () => boolean;
  readonly later?: (run: () => void, ms: number) => () => void;
  /** How long a section nobody shows is kept, in ms. */
  readonly keepUnusedMs?: number;
}

/**
 * Which section: a record (of `objectId`) and its side, the objects the
 * side's records come from (the relationship's targets), so a trash, restore
 * or coarse change there reads it again, and those objects' name attributes,
 * so a held record reads again only when its name changes (the rows show
 * nothing else).
 */
export interface SectionKey {
  readonly recordId: string;
  readonly objectId: string;
  readonly attributeId: string;
  readonly farObjectIds: readonly string[];
  readonly farNameAttributeIds?: readonly string[];
}

/** A records event as the sections read it. */
export interface SectionEvent {
  readonly objectId: string;
  readonly recordIds: readonly string[];
  readonly attributeIds?: readonly string[];
  readonly deletedIds?: readonly string[];
  readonly restoredIds?: readonly string[];
  readonly coarse?: boolean;
}

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

/** Whether two rows show the same: the record, its name and its colour. */
const sameDisplay = (a: RecordRefDisplay, b: RecordRefDisplay | undefined) =>
  b !== undefined && a.recordId === b.recordId && a.name === b.name && a.hue === b.hue && a.kind === b.kind;

const keyOf = (workspace: string, recordId: string, attributeId: string) =>
  `${workspace}\u0000${recordId}\u0000${attributeId}`;

/** One change shown before its write lands, and the read that has to come after it. */
type Pending =
  | { readonly kind: 'remove'; readonly recordId: string; after?: number }
  | { readonly kind: 'add'; readonly display: RecordRefDisplay; readonly baseTotal?: number; after?: number };

/** The sections of one data layer, one per workspace, record and side. */
export function createLinkSections({
  page,
  watch = () => () => undefined,
  isHidden = () => false,
  later = timeout,
  keepUnusedMs = 30_000,
}: LinkSectionsOptions) {
  interface Source {
    readonly workspace: string;
    readonly recordId: string;
    readonly attributeId: string;
    readonly objectId: string;
    readonly objectIds: ReadonlySet<string>;
    readonly handle: LinkSection;
    /** Whether a change names this section: its record and side, a far record it holds, or its far object's trash. */
    readonly concerns: (event: SectionEvent) => boolean;
    readonly refresh: () => void;
    readonly wake: () => void;
    readonly reset: () => void;
    readonly hide: (recordId: string) => SectionChange;
    readonly show: (display: RecordRefDisplay) => SectionChange;
    readonly dispose: () => void;
    /** The far objects' name attributes as the screen asking now names them: one may have moved (late trap #15). */
    readonly nameBy: (attributeIds: readonly string[]) => void;
  }
  const sources = new Map<string, Source>();

  function open(
    workspace: string,
    { recordId, objectId, attributeId, farObjectIds, farNameAttributeIds = [] }: SectionKey,
  ): Source {
    let names = farNameAttributeIds;
    const key = keyOf(workspace, recordId, attributeId);
    const listeners = new Set<() => void>();
    let status: LinkSectionStatus = 'loading';
    let error: DataError | undefined;
    let held: readonly RecordRefDisplay[] = [];
    let total: number | undefined;
    let cursor: string | undefined;
    let loadingMore = false;
    let retains = 0;
    let cancelUnused: (() => void) | undefined;
    let unwatch: (() => void) | undefined;
    // Each read of what is held is numbered as sent: an answer older than one applied is dropped.
    let sent = 0;
    let applied = 0;
    // Each time what is held is replaced, a Show more answering from before is dropped.
    let epoch = 0;
    let refreshing = false;
    let refreshWaiting = false;
    let coolingDown: (() => void) | undefined;
    let stale = false;
    const pending = new Set<Pending>();

    const isCurrent = () => sources.get(key) === source;
    const stateOf = (): LinkSectionState => {
      const ids = new Set(held.map((each) => each.recordId));
      let items = held;
      let shownTotal = total;
      for (const change of pending) {
        if (change.kind === 'remove') {
          if (!ids.has(change.recordId)) continue;
          items = items.filter((each) => each.recordId !== change.recordId);
          if (shownTotal !== undefined) shownTotal = Math.max(0, shownTotal - 1);
        } else {
          if (ids.has(change.display.recordId)) continue;
          // Past the rows held, the new link sits further down the side's order: only the total shows it.
          if (cursor === undefined) items = [...items, change.display];
          // Until a read counts it: a read that already did leaves the total as it answered.
          if (shownTotal !== undefined && total === change.baseTotal) shownTotal += 1;
        }
      }
      return {
        status,
        items,
        ...(shownTotal === undefined ? {} : { total: shownTotal }),
        hasMore: cursor !== undefined,
        isLoadingMore: loadingMore,
        ...(error === undefined ? {} : { error }),
      };
    };
    let snapshot = stateOf();
    const announce = () => {
      snapshot = stateOf();
      for (const listener of listeners) listener();
    };

    /** A read after a change's write landed came in: the change shows in what is held now. */
    const settlePending = (read: number) => {
      for (const change of pending) if (change.after !== undefined && read > change.after) pending.delete(change);
    };

    const lose = (failure: DataError) => {
      held = [];
      total = undefined;
      cursor = undefined;
      status = 'unavailable';
      error = failure;
      epoch += 1;
      pending.clear();
      announce();
    };

    /**
     * Reads the rows held again from the top, in pages of up to 50, as many
     * as were held (at least the first page, at most `SECTION_REREAD_MAX`);
     * what it reads replaces what was held.
     */
    const readHeld = async (): Promise<{ items: RecordRefDisplay[]; total?: number; cursor?: string }> => {
      const want = Math.min(Math.max(held.length, LINK_PREVIEW), SECTION_REREAD_MAX);
      const items: RecordRefDisplay[] = [];
      let next: string | undefined;
      // The first page answers the side's total; the later ones leave it out.
      let counted: number | undefined;
      do {
        const answer = await page(workspace, {
          recordId,
          attributeId,
          ...(next === undefined ? {} : { cursor: next }),
          limit: Math.min(LINK_PAGE_MAX, Math.max(want - items.length, 1)),
        });
        items.push(...answer.items);
        if (answer.total !== undefined) counted = answer.total;
        next = answer.nextCursor;
      } while (next !== undefined && items.length < want);
      return {
        items,
        ...(counted === undefined ? {} : { total: counted }),
        ...(next === undefined ? {} : { cursor: next }),
      };
    };

    /** The first page, with nothing kept (the first load, and Try again). */
    const loadFirst = () => {
      sent += 1;
      const mine = sent;
      if (held.length === 0 && status !== 'loading') {
        status = 'loading';
        error = undefined;
        announce();
      }
      page(workspace, { recordId, attributeId, limit: LINK_PREVIEW }).then(
        (answer) => {
          if (!isCurrent() || mine < applied) return;
          applied = mine;
          epoch += 1;
          held = answer.items;
          total = answer.total ?? answer.items.length;
          cursor = answer.nextCursor;
          status = 'ready';
          error = undefined;
          settlePending(mine);
          announce();
        },
        (failure: unknown) => {
          if (!isCurrent() || mine < applied) return;
          const dataFailure = toDataError(failure);
          if (dataFailure.code === 'NOT_FOUND') {
            lose(dataFailure);
            return;
          }
          if (held.length > 0) return;
          status = 'error';
          error = dataFailure;
          announce();
        },
      );
    };

    /** The next 20 rows past the last held, appended (a row already held is not added twice). */
    const showMore = () => {
      if (loadingMore || cursor === undefined || status !== 'ready') return;
      loadingMore = true;
      announce();
      const mine = epoch;
      const after = cursor;
      page(workspace, { recordId, attributeId, cursor: after, limit: LINK_PREVIEW }).then(
        (answer) => {
          if (!isCurrent() || mine !== epoch) return;
          loadingMore = false;
          if (cursor === after) {
            const ids = new Set(held.map((each) => each.recordId));
            held = [...held, ...answer.items.filter((each) => !ids.has(each.recordId))];
            // A later page carries no total: the first page's stands.
            if (answer.total !== undefined) total = answer.total;
            cursor = answer.nextCursor;
          }
          announce();
        },
        (failure: unknown) => {
          if (!isCurrent() || mine !== epoch) return;
          loadingMore = false;
          const dataFailure = toDataError(failure);
          if (dataFailure.code === 'NOT_FOUND') lose(dataFailure);
          else {
            // The rows stay; the error says Show more didn't load, and pressing it again tries again.
            error = dataFailure;
            announce();
          }
        },
      );
    };

    /** One read of what is held, replacing it once it lands (a newer read already applied wins). */
    const readAgain = () => {
      refreshing = true;
      sent += 1;
      const mine = sent;
      coolingDown = later(() => {
        coolingDown = undefined;
        if (refreshWaiting && !refreshing) {
          refreshWaiting = false;
          readAgain();
        }
      }, SECTION_REFRESH_MS);
      const finish = () => {
        refreshing = false;
        if (refreshWaiting && coolingDown === undefined) {
          refreshWaiting = false;
          readAgain();
        }
      };
      readHeld().then(
        (answer) => {
          if (isCurrent() && mine >= applied) {
            applied = mine;
            // A Show more out meanwhile answered from before this read: it is asked again once it lands.
            const wantedMore = loadingMore;
            loadingMore = false;
            // What was read replaces what was held: past SECTION_REREAD_MAX rows the rest goes (Show more reads it
            // again), so a row trashed, renamed or removed down there never stays as it was.
            const same =
              answer.items.length === held.length &&
              answer.items.every((each, index) => sameDisplay(each, held[index])) &&
              answer.cursor === cursor &&
              (answer.total === undefined || answer.total === total);
            if (!same) {
              epoch += 1;
              held = answer.items;
              if (answer.total !== undefined) total = answer.total;
              cursor = answer.cursor;
            }
            const settled = pending.size;
            settlePending(mine);
            const changed = !same || pending.size !== settled || status !== 'ready' || error !== undefined;
            status = 'ready';
            error = undefined;
            // Nothing new: no new snapshot, so the rows don't draw again.
            if (changed) announce();
            if (wantedMore) showMore();
          }
          finish();
        },
        (failure: unknown) => {
          const dataFailure = toDataError(failure);
          if (isCurrent() && mine >= applied && dataFailure.code === 'NOT_FOUND') lose(dataFailure);
          finish();
        },
      );
    };

    /** Reads what is held again for a change: at once, and at most once more `SECTION_REFRESH_MS` after. */
    const refresh = () => {
      if (!isCurrent()) return;
      if (retains === 0 || isHidden()) {
        stale = true;
        return;
      }
      if (status === 'loading' && held.length === 0) {
        // The first page is still out: read again once it lands, so the change isn't missed.
        refreshWaiting = true;
        if (!refreshing && coolingDown === undefined) {
          refreshWaiting = false;
          readAgain();
        }
        return;
      }
      if (refreshing || coolingDown !== undefined) {
        refreshWaiting = true;
        return;
      }
      readAgain();
    };

    const wake = () => {
      if (!stale || retains === 0 || isHidden()) return;
      stale = false;
      refresh();
    };

    const retain = () => {
      retains += 1;
      if (!isCurrent() && !sources.has(key)) {
        sources.set(key, source);
        loadFirst();
      }
      unwatch ??= watch(workspace);
      cancelUnused?.();
      cancelUnused = undefined;
      wake();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retains -= 1;
        if (retains > 0) return;
        unwatch?.();
        unwatch = undefined;
        cancelUnused = later(dispose, keepUnusedMs);
      };
    };

    const dispose = () => {
      cancelUnused?.();
      cancelUnused = undefined;
      unwatch?.();
      unwatch = undefined;
      coolingDown?.();
      coolingDown = undefined;
      refreshing = false;
      refreshWaiting = false;
      if (isCurrent()) sources.delete(key);
    };

    /** A change shown at once; once its write lands it stays until a read sent after that comes in. */
    const track = (change: Pending): SectionChange => {
      pending.add(change);
      announce();
      return {
        settle: (landed) => {
          if (!landed) {
            pending.delete(change);
            announce();
            return;
          }
          change.after = sent;
          refresh();
          // Nobody shows it: the next screen reads it afresh anyway.
          if (retains === 0) {
            pending.delete(change);
            announce();
          }
        },
      };
    };

    const objectIds = new Set(farObjectIds);
    const source: Source = {
      workspace,
      recordId,
      attributeId,
      objectId,
      objectIds,
      handle: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        retry: loadFirst,
        showMore,
        retain,
      },
      concerns: (event) => {
        // Too many to name: any coarse change to the record's own object or the far one.
        if (event.coarse === true) return event.objectId === objectId || objectIds.has(event.objectId);
        if (event.recordIds.includes(recordId)) {
          return event.attributeIds === undefined || event.attributeIds.length === 0
            ? true
            : event.attributeIds.includes(attributeId);
        }
        if (!objectIds.has(event.objectId)) return false;
        // A far record trashed or restored moves the total whether it is held or not, and a restore brings it back.
        if ((event.deletedIds?.length ?? 0) + (event.restoredIds?.length ?? 0) > 0) return true;
        // A held record's name: the rows show nothing else, so any other change to it reads nothing.
        const named =
          event.attributeIds === undefined ||
          event.attributeIds.length === 0 ||
          event.attributeIds.some((id) => names.includes(id));
        if (!named) return false;
        const heldIds = new Set(held.map((each) => each.recordId));
        return event.recordIds.some((id) => heldIds.has(id));
      },
      refresh,
      wake,
      reset: () => {
        if (retains === 0) {
          dispose();
          return;
        }
        refresh();
      },
      hide: (far) => track({ kind: 'remove', recordId: far }),
      show: (display) => track({ kind: 'add', display, ...(total === undefined ? {} : { baseTotal: total }) }),
      dispose,
      nameBy: (attributeIds) => {
        names = attributeIds;
      },
    };
    sources.set(key, source);
    cancelUnused = later(dispose, keepUnusedMs);
    loadFirst();
    return source;
  }

  const sourceOf = (workspace: string, side: SectionKey) => {
    const held = sources.get(keyOf(workspace, side.recordId, side.attributeId));
    if (held === undefined) return open(workspace, side);
    held.nameBy(side.farNameAttributeIds ?? []);
    return held;
  };
  const inWorkspace = (workspace: string) => [...sources.values()].filter((each) => each.workspace === workspace);

  return {
    /**
     * One record's side (spec 0014's section source), shared by every
     * screen asking for it: see `SectionKey`.
     */
    section: (workspace: string, side: SectionKey): LinkSection => sourceOf(workspace, side).handle,
    /** A Remove from the section, shown at once: the row leaves and the total drops until the write settles. */
    hide: (workspace: string, recordId: string, attributeId: string, farRecordId: string): SectionChange | undefined =>
      sources.get(keyOf(workspace, recordId, attributeId))?.hide(farRecordId),
    /** An Add from the section, shown at once: the row joins the end (when every row is held) and the total rises. */
    show: (
      workspace: string,
      recordId: string,
      attributeId: string,
      display: RecordRefDisplay,
    ): SectionChange | undefined => sources.get(keyOf(workspace, recordId, attributeId))?.show(display),
    /** A live `records` event: every section it concerns reads what it holds again. */
    changed: (workspace: string, event: SectionEvent): void => {
      for (const each of inWorkspace(workspace)) if (each.concerns(event)) each.refresh();
    },
    /**
     * This tab's own write landed (its echo never comes back): every section
     * of the workspace a screen shows reads again, since a link written here
     * from either side, or a far record renamed here, changes them.
     */
    ownWrite: (workspace: string): void => {
      for (const each of inWorkspace(workspace)) each.refresh();
    },
    /**
     * An object's definitions changed (a side archived or hidden, a name
     * attribute changed): the sections on it or showing its records read
     * again, or go; every section when no object is named.
     */
    definitionsChanged: (workspace: string, objectId?: string): void => {
      for (const each of inWorkspace(workspace)) {
        if (objectId === undefined || each.objectId === objectId || each.objectIds.has(objectId)) each.reset();
      }
    },
    /**
     * This tab named the records of these objects by another attribute (late trap #15; its echo never comes
     * back): the sections listing their records read again, since every row's name may have changed. Sections
     * on those objects' own records list other objects' records, so they read nothing.
     */
    renamed: (workspace: string, objectIds: readonly string[]): void => {
      for (const each of inWorkspace(workspace)) {
        if (objectIds.some((id) => each.objectIds.has(id))) each.refresh();
      }
    },
    /** A full catch up (spec 0006, 0007): every section of the workspace reads again. */
    resync: (workspace: string): void => {
      for (const each of inWorkspace(workspace)) each.reset();
    },
    /** The tab is shown again: the changes that waited are read. */
    shown: (): void => {
      for (const each of sources.values()) each.wake();
    },
    /** Forgets every section (sign out). */
    clear: (): void => {
      for (const each of [...sources.values()]) each.dispose();
      sources.clear();
    },
  };
}

/** The related sections of a data layer. */
export type LinkSections = ReturnType<typeof createLinkSections>;
