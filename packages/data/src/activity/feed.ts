// A record's timeline in the browser (spec 0017): `records.activity` pages,
// ordered and merged by each entry's key, mapped to the shapes the library's
// ActivityFeed draws, with who did it named from the workspace's members and
// each attribute from the object's definitions. One feed per record, shared
// by the Activity tab and Overview's "Recent activity" (its first five), so
// both read the first page once. It pages as the feed scrolls, and keeps
// itself live by reading the first page again (`refresh`) when a change names
// the record, at most twice a second, merging by key. Loaded with the first
// record page, so it stays out of the first load.
import type {
  ActivityItem,
  ActorDisplay,
  AttributeDefinition,
  MemberSummary,
  RecordActivity,
  RecordRefDisplay,
} from '@crm/contracts';
import { ACTIVITY_PAGE, ACTIVITY_RECENT, compareActivityKeys } from '@crm/contracts/activity-keys';
import { toDataError, type DataError } from '../errors.ts';
import { toFieldAttribute, type FieldAttributeShape } from '../fields.ts';

/** Who did something when the members list can't name them. */
export const ACTOR_WORDS = {
  formerMember: 'Former member',
  apiKey: 'An API key',
  automation: 'An automation',
  system: 'System',
  /** A member the members list couldn't be read to name, or one hidden from the reader. */
  someone: 'Someone',
} as const;

/** How long a members list read again for an unknown actor stays good enough, in ms: a minute. */
const MEMBERS_FRESH_MS = 60_000;

/** The least time between two reads of a feed's first page, in ms (spec 0017): at most two a second. */
export const ACTIVITY_REFRESH_MS = 500;

/** How close to the last loaded entry the screen gets before the next page is asked for. */
const LOAD_AHEAD = 10;

/** How long after a failed page the next scroll may ask again, in ms. */
const MORE_RETRY_MS = 2_000;

interface EntryBase {
  readonly id: string;
  /** When it happened, ISO 8601 in UTC (milliseconds), for display. */
  readonly at: string;
  readonly actor: ActorDisplay;
}

/** A record a link entry names, as the library's `LinkedRecord` (the screen adds its page's `href`). */
export interface LinkedRecordShape {
  readonly display: RecordRefDisplay;
  readonly href?: string;
}

/**
 * One entry as the library's ActivityFeed draws it (structurally its
 * `ActivityEntry`): the creation, a value's change (a side that holds one
 * record too, with the records' displays), or what one write linked and
 * unlinked on a side that holds many. A kind with no mapping is left out.
 */
export type ActivityEntryShape =
  | (EntryBase & { readonly kind: 'created' })
  | (EntryBase & {
      readonly kind: 'change';
      readonly attribute: FieldAttributeShape;
      readonly from: unknown;
      readonly to: unknown;
      readonly fromDisplay?: unknown;
      readonly toDisplay?: unknown;
    })
  | (EntryBase & {
      readonly kind: 'links';
      readonly attribute: FieldAttributeShape;
      readonly added: readonly LinkedRecordShape[];
      readonly addedCount: number;
      readonly removed: readonly LinkedRecordShape[];
      readonly removedCount: number;
    })
  | (EntryBase & {
      /** A task linked to the record (spec 0019): "added a task", or "completed a task" when `isDone`. */
      readonly kind: 'task';
      /** The task's id, for the screen to open it (`?task=<id>`). */
      readonly itemId: string;
      readonly title: string;
      readonly isDone: boolean;
      /** Its dialog's address, which the screen adds. */
      readonly href?: string;
    });

/** Entries from outside, as the library's `ListSource` reads them. */
export interface EntrySource {
  /** The entries loaded, and one still loading past them while there are more. */
  readonly count: number;
  readonly getItem: (index: number) => ActivityEntryShape | undefined;
  /** Any entry's key, its id (taking any entry with one, so the feed's wider entry type fits). */
  readonly getKey: (entry: { readonly id: string }) => string;
  /** The range on screen: near the end, the next page is read. */
  readonly onRangeChange?: (range: { readonly start: number; readonly end: number }) => void;
}

/** Where a timeline stands: loading its first page, ready, failed (with Retry), or the record isn't available. */
export type ActivityStatus = 'loading' | 'ready' | 'error' | 'unavailable';

/** What a screen reads from a timeline, one object per change. */
export interface ActivityState {
  readonly status: ActivityStatus;
  /** The entries loaded, newest first. */
  readonly entries: readonly ActivityEntryShape[];
  /** The entries as the feed reads them. */
  readonly source: EntrySource;
  /** Older entries wait past the ones loaded. */
  readonly hasMore: boolean;
  /** Why it failed, while `status` is `error`. */
  readonly error?: DataError;
}

/** A record's timeline, as a screen subscribes to it (`useActivity` in `@crm/data/react`). */
export interface ActivityFeed {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ActivityState;
  /** Reads the first page again after a failure. */
  readonly retry: () => void;
  /** Settles once the first page landed, or failed. */
  readonly ready: () => Promise<void>;
  /** A screen shows it; the answer lets go. A timeline nobody shows for 30 seconds is forgotten. */
  readonly retain: () => () => void;
}

/** What the feeds need from the data layer. */
export interface ActivityFeedsOptions {
  /** A page of a record's timeline (`records.activity`). */
  readonly page: (workspace: string, recordId: string, cursor?: string) => Promise<RecordActivity>;
  /** The workspace's members, cached; `fresh` reads them again (someone who joined since). */
  readonly members: (workspace: string, fresh: boolean) => Promise<readonly MemberSummary[]>;
  /** An object's live attributes, cached (the definitions store), to name and draw each change. */
  readonly attributes: (workspace: string, objectId: string) => Promise<readonly AttributeDefinition[]>;
  /**
   * Listens to the workspace's live changes while a screen shows the feed
   * (`live.watch`); the answer stops. A record page opened on its own has no
   * table watching for it, so its timeline does.
   */
  readonly watch?: (workspace: string) => () => void;
  /** The tab is hidden: a change waits (marked stale) until `shown`, so a background tab reads nothing. */
  readonly isHidden?: () => boolean;
  /** Runs `run` after `ms`, answering a cancel. */
  readonly later?: (run: () => void, ms: number) => () => void;
  /** How long a timeline nobody shows is kept, in ms: 30 seconds. */
  readonly keepUnusedMs?: number;
  /** Unix milliseconds now. */
  readonly now?: () => number;
}

/** How an actor shows: a member by name, "Former member" for one no longer listed, the others by kind. */
export function actorDisplay(
  actor: ActivityItem['actor'],
  members: readonly MemberSummary[] | undefined,
): ActorDisplay {
  // Hidden from this person (a field rule on Created by): nobody named.
  if (actor === undefined) return { type: 'member', id: null, name: ACTOR_WORDS.someone };
  if (actor.type === 'member') {
    // The list couldn't be read: say nothing about who, rather than call them former.
    if (members === undefined) return { type: 'member', id: actor.id, name: ACTOR_WORDS.someone };
    const member = members.find((each) => each.id === actor.id);
    return member === undefined
      ? { type: 'member', id: actor.id, name: ACTOR_WORDS.formerMember }
      : { type: 'member', id: member.id, name: member.name, email: member.email };
  }
  if (actor.type === 'api_key') return { type: 'api_key', id: actor.id, name: ACTOR_WORDS.apiKey };
  if (actor.type === 'automation') return { type: 'automation', id: actor.id, name: ACTOR_WORDS.automation };
  return { type: 'system', id: null, name: ACTOR_WORDS.system };
}

/** What mapping an item needs: the members (undefined when they couldn't be read) and the object's attributes. */
export interface EntryContext {
  readonly members: readonly MemberSummary[] | undefined;
  readonly attributes: ReadonlyMap<string, AttributeDefinition>;
}

/** A member or actor value as the field set's display: the member by name, or the actor's kind. */
function actorValueDisplay(value: unknown, members: readonly MemberSummary[] | undefined): ActorDisplay | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) return undefined;
  const type = (value as { readonly type: unknown }).type;
  const id = 'id' in value ? (value as { readonly id: unknown }).id : null;
  if (type !== 'member' && type !== 'api_key' && type !== 'automation' && type !== 'system') return undefined;
  return actorDisplay({ type, id: typeof id === 'string' ? id : null }, members);
}

/**
 * An item as the feed draws it, or undefined for a kind this client has no
 * mapping for yet, or a change to an attribute the definitions don't hold
 * (archived or hidden since: a definitions change reads the feed again).
 */
export function toActivityEntry(item: ActivityItem, context: EntryContext): ActivityEntryShape | undefined {
  const base = { id: item.id, at: item.at, actor: actorDisplay(item.actor, context.members) };
  if (item.kind === 'created') return { ...base, kind: 'created' };
  if (item.kind === 'task') {
    if (item.itemId === undefined) return undefined;
    return { ...base, kind: 'task', itemId: item.itemId, title: item.title ?? '', isDone: item.isDone === true };
  }
  if (item.kind !== 'change' && item.kind !== 'links') return undefined;
  const definition = item.attributeId === undefined ? undefined : context.attributes.get(item.attributeId);
  if (definition === undefined) return undefined;
  const attribute = toFieldAttribute(definition);
  if (item.kind === 'links') {
    return {
      ...base,
      kind: 'links',
      attribute,
      added: (item.added ?? []).map((display) => ({ display })),
      addedCount: item.addedCount ?? 0,
      removed: (item.removed ?? []).map((display) => ({ display })),
      removedCount: item.removedCount ?? 0,
    };
  }
  const displayOf = (value: unknown, refs: ActivityItem['fromRefs']): unknown => {
    if (definition.type === 'record_reference') return refs?.[0];
    if (definition.type === 'actor_reference') {
      return Array.isArray(value)
        ? value.map((each) => actorValueDisplay(each, context.members))
        : actorValueDisplay(value, context.members);
    }
    return undefined;
  };
  const fromDisplay = displayOf(item.from, item.fromRefs);
  const toDisplay = displayOf(item.to, item.toRefs);
  return {
    ...base,
    kind: 'change',
    attribute,
    from: item.from ?? null,
    to: item.to ?? null,
    ...(fromDisplay === undefined ? {} : { fromDisplay }),
    ...(toDisplay === undefined ? {} : { toDisplay }),
  };
}

/** An entry held by a feed: the server's key (its order) and how the feed draws it. */
interface Held {
  readonly key: string;
  readonly entry: ActivityEntryShape;
}

/**
 * The first page merged into what a feed holds (0017-activity.md): the page
 * is the truth from the newest entry down to its last one (`lastKey`, the
 * server's last entry, drawn or not), so held entries in that range take the
 * page's content or leave; older held entries stay behind it with their
 * cursor. When everything held is older than the page (more than a page
 * arrived), there may be a gap: only the page stays.
 */
export function mergeHead(
  held: readonly Held[],
  heldCursor: string | undefined,
  page: readonly Held[],
  pageCursor: string | undefined,
  lastKey: string | undefined = page.at(-1)?.key,
): { readonly held: readonly Held[]; readonly cursor: string | undefined } {
  if (pageCursor === undefined || lastKey === undefined) return { held: page, cursor: pageCursor };
  const newest = held[0];
  if (newest !== undefined && compareActivityKeys(newest.key, lastKey) > 0) return { held: page, cursor: pageCursor };
  const older = held.filter((each) => compareActivityKeys(each.key, lastKey) > 0);
  if (older.length === 0) return { held: page, cursor: pageCursor };
  return { held: [...page, ...older], cursor: heldCursor };
}

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

const keyOf = (workspace: string, recordId: string) => `${workspace}\u0000${recordId}`;

/** The longest wait between tries of a page that failed, in ms. */
const MORE_RETRY_MAX_MS = 30_000;

/** The timelines of one data layer, one per workspace and record. */
export function createActivityFeeds({
  page,
  members,
  attributes,
  watch = () => () => undefined,
  isHidden = () => false,
  later = timeout,
  keepUnusedMs = 30_000,
  now = () => Date.now(),
}: ActivityFeedsOptions) {
  interface Feed {
    readonly workspace: string;
    readonly recordId: string;
    readonly objectId: string | undefined;
    readonly full: ActivityFeed;
    readonly recent: ActivityFeed;
    /** Reads the first page again and merges it, coalesced (a change named the record). */
    readonly refresh: () => void;
    /** Reads the first page again and keeps only it, coalesced (definitions changed, or a resync). */
    readonly reset: () => void;
    /** The tab is shown again: a change that waited while it was hidden is read now. */
    readonly wake: () => void;
    readonly dispose: () => void;
  }
  const feeds = new Map<string, Feed>();
  // When each workspace's members were last read again for an actor the list didn't hold: at most once a minute,
  // so records made by people who have left don't reread the list (shared with every screen) on each open.
  const membersReadAt = new Map<string, number>();

  function open(workspace: string, recordId: string, objectId: string | undefined): Feed {
    const key = keyOf(workspace, recordId);
    const listeners = new Set<() => void>();
    let status: ActivityStatus = 'loading';
    let error: DataError | undefined;
    let held: readonly Held[] = [];
    let cursor: string | undefined;
    let retains = 0;
    let cancelUnused: (() => void) | undefined;
    // Each time the held entries are replaced, a later page answering from before is dropped.
    let epoch = 0;
    // First page reads, numbered as sent: an answer older than one already applied is dropped.
    let sent = 0;
    let applied = 0;
    let loadingMore = false;
    let moreFailedAt: number | undefined;
    let moreFailures = 0;
    // The head refresh: one in flight, one waiting, and the cool down after each start.
    let refreshing = false;
    let refreshWaiting = false;
    let coolingDown: (() => void) | undefined;
    // The next head read replaces what is held instead of merging (a definitions change, a resync).
    let replaceNext = false;
    // A change arrived while nobody showed the feed (or the tab was hidden): read it again when someone does.
    let stale = false;
    // Live changes reach the feed while a screen shows it.
    let unwatch: (() => void) | undefined;
    let settleReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });

    const isCurrent = () => feeds.get(key) === feed;
    const onRangeChange = (range: { readonly start: number; readonly end: number }) => {
      if (range.end >= held.length - LOAD_AHEAD) loadMore();
    };
    const stateOf = (cut?: number): ActivityState => {
      const shown = (cut === undefined ? held : held.slice(0, cut)).map((each) => each.entry);
      const more = cut === undefined ? cursor !== undefined : held.length > cut || cursor !== undefined;
      // The full feed draws one entry still loading past the loaded ones while there are more.
      const tail = cut === undefined && cursor !== undefined ? 1 : 0;
      return {
        status,
        entries: shown,
        source: {
          count: shown.length + tail,
          getItem: (index) => shown[index],
          getKey: (entry) => entry.id,
          ...(cut === undefined ? { onRangeChange } : {}),
        },
        hasMore: more,
        ...(error === undefined ? {} : { error }),
      };
    };
    let full = stateOf();
    let recent = stateOf(ACTIVITY_RECENT);
    const announce = () => {
      full = stateOf();
      recent = stateOf(ACTIVITY_RECENT);
      for (const listener of listeners) listener();
    };

    /** The members, read again once when an actor isn't listed (someone who joined since). */
    const namesFor = async (loaded: readonly ActivityItem[]): Promise<readonly MemberSummary[] | undefined> => {
      const known = await members(workspace, false).catch(() => undefined);
      const unknown =
        known !== undefined &&
        loaded.some((item) => item.actor?.type === 'member' && !known.some((member) => member.id === item.actor?.id));
      const readAt = membersReadAt.get(workspace);
      if (unknown && (readAt === undefined || now() - readAt > MEMBERS_FRESH_MS)) {
        membersReadAt.set(workspace, now());
        return members(workspace, true).catch(() => known);
      }
      return known;
    };

    /**
     * A page's items in key order, mapped to entries (a kind or attribute this
     * client can't draw is left out), with the server's last key, drawn or not.
     */
    const mapped = async (
      answer: RecordActivity,
    ): Promise<{ readonly rows: readonly Held[]; readonly lastKey: string | undefined }> => {
      const sorted = [...answer.entries].sort((a, b) => compareActivityKeys(a.key, b.key)).slice(0, ACTIVITY_PAGE);
      const [known, defined] = await Promise.all([
        namesFor(sorted),
        objectId === undefined || !sorted.some((item) => item.attributeId !== undefined)
          ? Promise.resolve<readonly AttributeDefinition[]>([])
          : attributes(workspace, objectId).catch((): readonly AttributeDefinition[] => []),
      ]);
      const context = { members: known, attributes: new Map(defined.map((each) => [each.id, each])) };
      const rows = sorted.flatMap((item) => {
        const entry = toActivityEntry(item, context);
        return entry === undefined ? [] : [{ key: item.key, entry }];
      });
      return { rows, lastKey: sorted.at(-1)?.key };
    };

    /** The record went out of reach (hidden, or gone for good): nothing it showed stays. */
    const lose = (failure: DataError) => {
      held = [];
      cursor = undefined;
      status = 'unavailable';
      error = failure;
      epoch += 1;
      announce();
    };

    /** A page that drew nothing past a cursor (the server stopped short, or nothing could be drawn): read on. */
    const onIfEmpty = (added: number) => {
      if (added === 0 && cursor !== undefined) loadMore();
    };

    /** The first page, read with nothing kept (the first load, and Try again). */
    const loadFirst = () => {
      sent += 1;
      const mine = sent;
      loadingMore = false;
      // A feed already showing entries keeps them until the new page lands, so nothing flashes.
      if (held.length === 0 && status !== 'loading') {
        status = 'loading';
        error = undefined;
        announce();
      }
      page(workspace, recordId)
        .then(async (answer) => ({ answer, ...(await mapped(answer)) }))
        .then(
          ({ answer, rows }) => {
            if (!isCurrent() || mine < applied) return;
            applied = mine;
            epoch += 1;
            held = rows;
            cursor = answer.nextCursor;
            status = 'ready';
            error = undefined;
            announce();
            settleReady();
            onIfEmpty(rows.length);
          },
          (failure: unknown) => {
            if (!isCurrent() || mine < applied) return;
            settleReady();
            const dataFailure = toDataError(failure);
            // Missing or hidden: the page says the record isn't available, the same for both.
            if (dataFailure.code === 'NOT_FOUND') {
              lose(dataFailure);
              return;
            }
            // A passing failure with entries shown keeps them.
            if (held.length > 0) return;
            status = 'error';
            error = dataFailure;
            announce();
          },
        );
    };

    /**
     * The next page past the last loaded entry, appended (an entry already
     * held is not added twice). A failed page is tried again while a screen
     * shows the feed, waiting longer each time, so the entry still loading at
     * the end never waits on a scroll.
     */
    function loadMore() {
      if (loadingMore || cursor === undefined || status !== 'ready') return;
      if (moreFailedAt !== undefined && now() - moreFailedAt < MORE_RETRY_MS) return;
      loadingMore = true;
      const mine = epoch;
      const after = cursor;
      page(workspace, recordId, after)
        .then(async (answer) => ({ answer, ...(await mapped(answer)) }))
        .then(
          ({ answer, rows }) => {
            if (!isCurrent() || mine !== epoch) return;
            loadingMore = false;
            moreFailedAt = undefined;
            moreFailures = 0;
            // The page a head refresh moved past is no longer the tail.
            if (cursor !== after) return;
            const ids = new Set(held.map((each) => each.entry.id));
            const fresh = rows.filter((each) => !ids.has(each.entry.id));
            held = [...held, ...fresh];
            cursor = answer.nextCursor;
            announce();
            onIfEmpty(fresh.length);
          },
          () => {
            if (!isCurrent() || mine !== epoch) return;
            loadingMore = false;
            moreFailedAt = now();
            moreFailures += 1;
            if (retains === 0) return;
            const wait = Math.min(MORE_RETRY_MAX_MS, MORE_RETRY_MS * 2 ** (moreFailures - 1));
            later(() => {
              if (isCurrent() && retains > 0) loadMore();
            }, wait);
          },
        );
    }

    /** One head read: the first page, merged by key into what the feed holds, or replacing it after a reset. */
    const readHead = () => {
      refreshing = true;
      sent += 1;
      const mine = sent;
      const replacing = replaceNext;
      replaceNext = false;
      coolingDown = later(() => {
        coolingDown = undefined;
        if (refreshWaiting && !refreshing) {
          refreshWaiting = false;
          readHead();
        }
      }, ACTIVITY_REFRESH_MS);
      const finish = () => {
        refreshing = false;
        if (refreshWaiting && coolingDown === undefined) {
          refreshWaiting = false;
          readHead();
        }
      };
      page(workspace, recordId)
        .then(async (answer) => ({ answer, ...(await mapped(answer)) }))
        .then(
          ({ answer, rows, lastKey }) => {
            if (isCurrent() && mine >= applied) {
              applied = mine;
              if (replacing) {
                epoch += 1;
                loadingMore = false;
                held = rows;
                cursor = answer.nextCursor;
              } else {
                const merged = mergeHead(held, cursor, rows, answer.nextCursor, lastKey);
                held = merged.held;
                cursor = merged.cursor;
              }
              if (status !== 'ready') {
                status = 'ready';
                error = undefined;
                settleReady();
              }
              announce();
              onIfEmpty(held.length);
            }
            finish();
          },
          (failure: unknown) => {
            const dataFailure = toDataError(failure);
            if (isCurrent() && mine >= applied && dataFailure.code === 'NOT_FOUND') lose(dataFailure);
            // A reset that failed is tried with the next read; a failed refresh keeps the feed as it is.
            else if (replacing) replaceNext = true;
            finish();
          },
        );
    };

    /**
     * Reads the first page again for a change (0017-activity.md): at once when
     * none is in flight, and at most once more `ACTIVITY_REFRESH_MS` after, so
     * a burst costs at most two reads a second. A feed nobody shows, or in a
     * hidden tab, waits until it is shown.
     */
    const refresh = () => {
      if (!isCurrent()) return;
      if (retains === 0 || isHidden()) {
        stale = true;
        return;
      }
      if (refreshing || coolingDown !== undefined) {
        refreshWaiting = true;
        return;
      }
      readHead();
    };

    const wake = () => {
      if (!stale || retains === 0 || isHidden()) return;
      stale = false;
      refresh();
    };

    const retain = () => {
      retains += 1;
      // A handle a screen got before the feed was let go of (a reset, or the unused wait while the route
      // loaded): it comes back, and reads afresh.
      if (!isCurrent() && !feeds.has(key)) {
        feeds.set(key, feed);
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
    const handle = (snapshot: () => ActivityState): ActivityFeed => ({
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: snapshot,
      retry: loadFirst,
      ready: () => readyPromise,
      retain,
    });
    const dispose = () => {
      cancelUnused?.();
      cancelUnused = undefined;
      unwatch?.();
      unwatch = undefined;
      coolingDown?.();
      coolingDown = undefined;
      refreshing = false;
      refreshWaiting = false;
      if (isCurrent()) feeds.delete(key);
    };
    const feed: Feed = {
      workspace,
      recordId,
      objectId,
      full: handle(() => full),
      recent: handle(() => recent),
      refresh,
      reset: () => {
        if (retains === 0) {
          // Nobody shows it: forgotten, and read afresh by whoever opens it next (its handle comes back on retain).
          dispose();
          return;
        }
        // Through the same coalescer as a change, so a burst of definition edits costs two reads a second at most.
        replaceNext = true;
        refresh();
      },
      wake,
      dispose,
    };
    feeds.set(key, feed);
    // Nobody shows it yet: forgotten after the same wait, unless a screen retains it first.
    cancelUnused = later(dispose, keepUnusedMs);
    loadFirst();
    return feed;
  }

  const feedOf = (workspace: string, recordId: string, objectId: string | undefined): Feed =>
    feeds.get(keyOf(workspace, recordId)) ?? open(workspace, recordId, objectId);
  const inWorkspace = (workspace: string) => [...feeds.values()].filter((feed) => feed.workspace === workspace);

  return {
    /** A record's whole timeline, newest first (the Activity tab); `objectId` names its attributes. */
    forRecord: (workspace: string, recordId: string, objectId?: string): ActivityFeed =>
      feedOf(workspace, recordId, objectId).full,
    /** Its newest five entries (Overview's "Recent activity"), sharing the first page with `forRecord`. */
    recent: (workspace: string, recordId: string, objectId?: string): ActivityFeed =>
      feedOf(workspace, recordId, objectId).recent,
    /**
     * A live `records` event (0017-activity.md): a feed whose record it names
     * reads its first page again, and so does every feed of its object when
     * the event is coarse.
     */
    changed: (
      workspace: string,
      event: { readonly objectId: string; readonly recordIds: readonly string[]; readonly coarse?: boolean },
    ): void => {
      const named = new Set(event.recordIds);
      for (const feed of inWorkspace(workspace)) {
        if (named.has(feed.recordId) || (event.coarse === true && feed.objectId === event.objectId)) feed.refresh();
      }
    },
    /**
     * This tab's own write landed (its echo never comes back live): every
     * feed of the workspace a screen shows reads its first page again, since
     * a link written here changes the far records' timelines too (and the far
     * records a write unlinks aren't in its answer).
     */
    ownWrite: (workspace: string): void => {
      for (const feed of inWorkspace(workspace)) feed.refresh();
    },
    /** An object's definitions changed (an attribute archived, hidden or renamed): its feeds start again. */
    definitionsChanged: (workspace: string, objectId?: string): void => {
      for (const feed of inWorkspace(workspace)) {
        if (objectId === undefined || feed.objectId === undefined || feed.objectId === objectId) feed.reset();
      }
    },
    /** A full catch up or a reset (spec 0006, 0007): every feed of the workspace starts again. */
    resync: (workspace: string): void => {
      for (const feed of inWorkspace(workspace)) feed.reset();
    },
    /** The tab is shown again: the changes that waited while it was hidden are read. */
    shown: (): void => {
      for (const feed of feeds.values()) feed.wake();
    },
    /** Forgets every timeline (sign out). */
    clear: (): void => {
      for (const feed of [...feeds.values()]) feed.dispose();
      feeds.clear();
      membersReadAt.clear();
    },
  };
}

/** The timelines of a data layer. */
export type ActivityFeeds = ReturnType<typeof createActivityFeeds>;
