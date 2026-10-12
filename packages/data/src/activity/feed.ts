// A record's timeline in the browser (spec 0017): `records.activity` pages,
// ordered and merged by each entry's key, mapped to the shapes the library's
// ActivityFeed draws, with who did it named from the workspace's members.
// One feed per record, shared by the Activity tab and Overview's "Recent
// activity" (its first five), so both read the first page once. Milestone 1
// reads the first page only; paging as the feed scrolls and the live head
// refetch come with milestone 2. Loaded with the first record page, so it
// stays out of the first load.
import type { ActivityItem, ActorDisplay, MemberSummary, RecordActivity } from '@crm/contracts';
import { ACTIVITY_PAGE, ACTIVITY_RECENT, compareActivityKeys } from '@crm/contracts/activity-keys';
import { toDataError, type DataError } from '../errors.ts';

/** Who did something when the members list can't name them. */
export const ACTOR_WORDS = {
  formerMember: 'Former member',
  apiKey: 'An API key',
  automation: 'An automation',
  system: 'System',
} as const;

/**
 * One entry as the library's ActivityFeed draws it (structurally its
 * `ActivityEntry`): who did it, when, and what. Milestone 1 maps the creation
 * entry; changes and link entries join with milestone 2, and a kind with no
 * mapping is left out.
 */
export interface ActivityEntryShape {
  readonly id: string;
  /** When it happened, ISO 8601 in UTC (milliseconds), for display. */
  readonly at: string;
  readonly actor: ActorDisplay;
  readonly kind: 'created';
}

/** Entries from outside, as the library's `ListSource` reads them. */
export interface EntrySource {
  readonly count: number;
  readonly getItem: (index: number) => ActivityEntryShape | undefined;
  /** Any entry's key, its id (taking any entry with one, so the feed's wider entry type fits). */
  readonly getKey: (entry: { readonly id: string }) => string;
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
  /** Runs `run` after `ms`, answering a cancel. */
  readonly later?: (run: () => void, ms: number) => () => void;
  /** How long a timeline nobody shows is kept, in ms: 30 seconds. */
  readonly keepUnusedMs?: number;
}

/** How an actor shows: a member by name, "Former member" for one no longer listed, the others by kind. */
export function actorDisplay(actor: ActivityItem['actor'], members: readonly MemberSummary[]): ActorDisplay {
  if (actor.type === 'member') {
    const member = members.find((each) => each.id === actor.id);
    return member === undefined
      ? { type: 'member', id: actor.id, name: ACTOR_WORDS.formerMember }
      : { type: 'member', id: member.id, name: member.name, email: member.email };
  }
  if (actor.type === 'api_key') return { type: 'api_key', id: actor.id, name: ACTOR_WORDS.apiKey };
  if (actor.type === 'automation') return { type: 'automation', id: actor.id, name: ACTOR_WORDS.automation };
  return { type: 'system', id: null, name: ACTOR_WORDS.system };
}

/** An item as the feed draws it, or undefined for a kind this client has no mapping for yet. */
export function toActivityEntry(item: ActivityItem, members: readonly MemberSummary[]): ActivityEntryShape | undefined {
  if (item.kind !== 'created') return undefined;
  return { id: item.id, at: item.at, actor: actorDisplay(item.actor, members), kind: 'created' };
}

const EMPTY: readonly ActivityEntryShape[] = [];

const sourceOf = (entries: readonly ActivityEntryShape[]): EntrySource => ({
  count: entries.length,
  getItem: (index) => entries[index],
  getKey: (entry) => entry.id,
});

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => {
    clearTimeout(id);
  };
};

/** The timelines of one data layer, one per workspace and record. */
export function createActivityFeeds({ page, members, later = timeout, keepUnusedMs = 30_000 }: ActivityFeedsOptions) {
  interface Feed {
    readonly full: ActivityFeed;
    readonly recent: ActivityFeed;
    readonly dispose: () => void;
  }
  const feeds = new Map<string, Feed>();
  const keyOf = (workspace: string, recordId: string) => `${workspace}\u0000${recordId}`;

  function open(workspace: string, recordId: string): Feed {
    const key = keyOf(workspace, recordId);
    const listeners = new Set<() => void>();
    let status: ActivityStatus = 'loading';
    let error: DataError | undefined;
    let entries: readonly ActivityEntryShape[] = EMPTY;
    let nextCursor: string | undefined;
    let retains = 0;
    let cancelUnused: (() => void) | undefined;
    let settleReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      settleReady = resolve;
    });

    const stateOf = (cut?: number): ActivityState => {
      const shown = cut === undefined ? entries : entries.slice(0, cut);
      return {
        status,
        entries: shown,
        source: sourceOf(shown),
        hasMore: cut === undefined ? nextCursor !== undefined : entries.length > cut || nextCursor !== undefined,
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

    /** Names each item's actor, reading the members again once when one isn't listed (someone who joined since). */
    const named = async (loaded: readonly ActivityItem[]): Promise<readonly ActivityEntryShape[]> => {
      let known = await members(workspace, false).catch(() => []);
      const unknown = loaded.some(
        (item) => item.actor.type === 'member' && !known.some((member) => member.id === item.actor.id),
      );
      if (unknown) known = await members(workspace, true).catch(() => known);
      return loaded.flatMap((item) => {
        const entry = toActivityEntry(item, known);
        return entry === undefined ? [] : [entry];
      });
    };

    const load = () => {
      if (status !== 'loading') {
        status = 'loading';
        error = undefined;
        announce();
      }
      page(workspace, recordId).then(
        async (answer) => {
          const sorted = [...answer.entries].sort((a, b) => compareActivityKeys(a.key, b.key)).slice(0, ACTIVITY_PAGE);
          const mapped = await named(sorted);
          if (feeds.get(key) !== feed) return;
          entries = mapped;
          nextCursor = answer.nextCursor;
          status = 'ready';
          announce();
          settleReady();
        },
        (failure: unknown) => {
          if (feeds.get(key) !== feed) return;
          const dataFailure = toDataError(failure);
          // Missing or hidden: the page says the record isn't available, the same for both.
          status = dataFailure.code === 'NOT_FOUND' ? 'unavailable' : 'error';
          error = dataFailure;
          announce();
          settleReady();
        },
      );
    };

    const retain = () => {
      retains += 1;
      cancelUnused?.();
      cancelUnused = undefined;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retains -= 1;
        if (retains === 0) cancelUnused = later(dispose, keepUnusedMs);
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
      retry: load,
      ready: () => readyPromise,
      retain,
    });
    const dispose = () => {
      cancelUnused?.();
      cancelUnused = undefined;
      if (feeds.get(key) === feed) feeds.delete(key);
    };
    const feed: Feed = { full: handle(() => full), recent: handle(() => recent), dispose };
    feeds.set(key, feed);
    // Nobody shows it yet: forgotten after the same wait, unless a screen retains it first.
    cancelUnused = later(dispose, keepUnusedMs);
    load();
    return feed;
  }

  const feedOf = (workspace: string, recordId: string): Feed =>
    feeds.get(keyOf(workspace, recordId)) ?? open(workspace, recordId);

  return {
    /** A record's whole timeline, newest first (the Activity tab). */
    forRecord: (workspace: string, recordId: string): ActivityFeed => feedOf(workspace, recordId).full,
    /** Its newest five entries (Overview's "Recent activity"), sharing the first page with `forRecord`. */
    recent: (workspace: string, recordId: string): ActivityFeed => feedOf(workspace, recordId).recent,
    /** Forgets every timeline (sign out). */
    clear: (): void => {
      for (const feed of [...feeds.values()]) feed.dispose();
      feeds.clear();
    },
  };
}

/** The timelines of a data layer. */
export type ActivityFeeds = ReturnType<typeof createActivityFeeds>;
