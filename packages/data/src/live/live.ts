// Live updates in the browser (spec 0005, live patches; spec 0007, catch up):
// one Centrifugo connection for the tab, one subscription per workspace a
// screen shows, and the client's side of the seq contract
// (packages/data/AGENTS.md). Loaded with a dynamic import the first time a
// screen watches a workspace; Centrifugo's client loads with it, through its
// one wrapper (centrifuge.ts).
//
// Per workspace it keeps a watermark `W`: the last contiguous `seq` applied.
// It starts at the workspace's head, read (by the data layer) before the
// screen's first read, and is kept for the app load, across watches.
// - at or below `W`: a repeat, or one a catch up already covered, so dropped;
// - `W + 1`: applied (handed to its kind's handlers through the live router,
//   unless it is this tab's own write coming back, the stub, or a kind this
//   client doesn't know), and becomes `W`;
// - past `W + 1`: a gap, so `realtime.catchUp` from `W` fills it from the
//   outbox, and the events that arrived meanwhile follow in order.
// A new subscription catches up from `W` at once; one that came back without
// recovering what it missed (history gone, or Centrifugo restarted) after a
// random 0 to 2 seconds, so a whole team doesn't ask in step; and so does a
// tab coming back after 5 minutes hidden. A catch up answered `reset` (the
// outbox no longer holds the range) runs every store's resync instead.
// Nothing here polls: when the connection is down the screens say live
// updates are paused, and Centrifugo's client reconnects with its own backoff.
import type { ChangeEvent, ChangeEventKind } from '@crm/contracts';
import type { MutationLog } from './mutations.ts';
import type { LiveRouter } from './router.ts';

/** Whether changes arrive: `live`, `paused` (the connection or a subscription is down), or `off` (not configured). */
export type LiveStatus = 'live' | 'paused' | 'off';

/** Fetches a token; undefined means not allowed (signed out, or no longer a member), so stop asking. */
export type TokenSource = () => Promise<string | undefined>;

/** One channel to listen to, and what to do with what arrives on it. */
export interface LiveChannel {
  readonly name: string;
  /** The first token, fetched before listening (it names the channel). */
  readonly token: string;
  /** A fresh token before the current one runs out. */
  readonly renew: TokenSource;
  readonly onPublication: (data: unknown) => void;
  readonly onSubscribed: (info: { readonly wasRecovering: boolean; readonly recovered: boolean }) => void;
  /** Subscribing again after a drop, or failing to subscribe. */
  readonly onDown: (why: 'resubscribing' | 'failed') => void;
}

/** The realtime client, as live.ts sees it (centrifuge.ts implements it; tests fake it). */
export interface LiveTransport {
  /** Listens to a channel until the answer is called. The first listen connects. */
  readonly listen: (channel: LiveChannel) => () => void;
  /** The connection failed or dropped. */
  readonly onTrouble: (listener: () => void) => () => void;
  readonly close: () => void;
}

/** Opens the realtime client at `url`, connecting with `connectionToken`. */
export type OpenTransport = (url: string, connectionToken: TokenSource) => LiveTransport;

/** A workspace's subscription token, with the head it was signed at. */
export interface Granted {
  readonly channel: string;
  readonly token: string;
  readonly head: number;
}

/** What `realtime.catchUp` answers, as the live layer reads it (events parsed here, so an unknown kind is skipped). */
export interface CaughtUp {
  readonly head: number;
  readonly reset: boolean;
  readonly events: readonly unknown[];
}

/** Whether the tab is shown, and when that changes (`document` by default). */
export interface Visibility {
  readonly hidden: () => boolean;
  readonly onChange: (listener: () => void) => () => void;
}

/** What createLive needs. */
export interface LiveOptions {
  /** Centrifugo's WebSocket address (`VITE_REALTIME_URL`). */
  readonly url: string;
  readonly connectionToken: TokenSource;
  /** The workspace's channel, its token and the head, or undefined when not allowed. Rejects when the API can't be reached. */
  readonly subscriptionToken: (workspace: string) => Promise<Granted | undefined>;
  /**
   * The head the data layer read before the workspace's first read (the
   * first watermark), or undefined when it couldn't.
   */
  readonly head: (workspace: string) => Promise<number | undefined>;
  /** `realtime.catchUp` from `after`; undefined when not allowed. Rejects when the API can't be reached. */
  readonly catchUp: (workspace: string, after: number) => Promise<CaughtUp | undefined>;
  /** Loads and opens the realtime client: centrifuge.ts by default. */
  readonly open?: (url: string, connectionToken: TokenSource) => Promise<LiveTransport>;
  /** The stores' handlers and resyncs. */
  readonly router: LiveRouter;
  /** This tab's writes waiting for their echo. */
  readonly mutations: MutationLog;
  /** Called when the status changes between `live` and `paused`. */
  readonly onStatus: (status: 'live' | 'paused') => void;
  /** Waits `ms`. A timer by default; tests pass their own. */
  readonly wait?: (ms: number) => Promise<void>;
  /** A number in [0, 1), to spread refetches out (`Math.random`). */
  readonly random?: () => number;
  /** The clock, in ms (`Date.now`). */
  readonly now?: () => number;
  /** How long a first subscribe may take before the screens say paused: 5 seconds. */
  readonly startupMs?: number;
  /** Whether the tab is shown; `document` by default, nothing without one. */
  readonly visibility?: Visibility;
}

/** The longest spread before a refetch or catch up that many browsers make at once. */
export const REFETCH_JITTER_MS = 2000;

/** How long a tab may stay hidden before it catches up on coming back: 5 minutes (Centrifugo's history). */
export const HIDDEN_CATCH_UP_MS = 5 * 60_000;

/** The longest wait between tries at a workspace's subscription token or a catch up. */
const MAX_RETRY_MS = 30_000;

/**
 * The most deliveries a workspace holds while it waits for a catch up. Past
 * it they are dropped: the catch up reads to the head, which covers them.
 */
export const MAX_HELD = 5_000;

const timer = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The document's visibility, or nothing outside a browser. */
const documentVisibility = (): Visibility | undefined => {
  if (typeof document === 'undefined') return undefined;
  return {
    hidden: () => document.visibilityState === 'hidden',
    onChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
  };
};

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

/** One value a records event's write replaced: who replaced which version of which cell (spec 0006). */
type ReplacedEntry = NonNullable<Extract<ChangeEvent, { kind: 'records' }>['replaced']>[number];

const ACTOR_TYPES: ReadonlySet<unknown> = new Set(['member', 'api_key', 'automation', 'system']);

/** Whether `value` is a well formed `replaced` entry. */
function isReplacedEntry(value: unknown): value is ReplacedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { recordId, attributeId, versionId, by } = value as Record<string, unknown>;
  if (!isString(recordId) || !isString(attributeId) || !isString(versionId)) return false;
  if (typeof by !== 'object' || by === null) return false;
  const actor = by as Record<string, unknown>;
  return ACTOR_TYPES.has(actor.type) && (actor.id === null || isString(actor.id));
}

/** A delivery as a catch up would carry it: a records event without `replaced`. */
function withoutReplaced(delivery: Delivery): Delivery {
  const { event } = delivery;
  if (event?.kind !== 'records' || event.replaced === undefined) return delivery;
  const { replaced: _replaced, ...rest } = event;
  return { ...delivery, event: rest };
}

/** Each kind's fields: required and optional ids, and required and optional id lists. */
interface Shape {
  readonly refs?: readonly string[];
  readonly optionalRefs?: readonly string[];
  readonly lists?: readonly string[];
  readonly optionalLists?: readonly string[];
  readonly coarse?: boolean;
}

const SHAPES: Readonly<Record<ChangeEventKind, Shape>> = {
  records: { refs: ['objectId'], lists: ['recordIds', 'attributeIds'], coarse: true },
  entries: {
    refs: ['listId'],
    optionalRefs: ['objectId'],
    lists: ['entryIds', 'recordIds', 'attributeIds'],
    coarse: true,
  },
  definitions: { optionalRefs: ['objectId', 'listId'], optionalLists: ['attributeIds'] },
  views: { optionalRefs: ['objectId', 'listId'], lists: ['viewIds'], coarse: true },
  notes: { optionalRefs: ['objectId'], lists: ['recordIds', 'noteIds'], coarse: true },
  tasks: { lists: ['recordIds', 'taskIds'], coarse: true },
  members: { lists: ['memberIds'] },
  access: { lists: ['memberIds'] },
  jobs: { lists: ['jobIds'], coarse: true },
  restricted: {},
};

/**
 * One delivery: its `seq`, the write's mutation id, and the event when this
 * client knows its kind (undefined for a kind from a newer server, which is
 * skipped after its `seq` is applied).
 */
export interface Delivery {
  readonly seq: number;
  readonly mutationId: string | undefined;
  readonly event: ChangeEvent | undefined;
}

/**
 * A change event as published or caught up, or undefined for anything that
 * isn't one (no Zod here: it would grow this chunk). Only the fields of its
 * kind are kept.
 */
export function parseChangeEvent(data: unknown): Delivery | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  const { seq, kind, at, mutationId, coarse } = raw;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || !isString(kind)) return undefined;
  if (mutationId !== undefined && !isString(mutationId)) return undefined;
  if (!Object.hasOwn(SHAPES, kind)) return { seq, mutationId, event: undefined };
  const shape = SHAPES[kind as ChangeEventKind];
  if (at !== undefined && !isString(at)) return undefined;
  if (coarse !== undefined && typeof coarse !== 'boolean') return undefined;
  const event: Record<string, unknown> = { seq, at: at ?? '', kind };
  for (const name of shape.refs ?? []) {
    if (!isString(raw[name])) return undefined;
    event[name] = raw[name];
  }
  for (const name of shape.optionalRefs ?? []) {
    if (raw[name] === undefined) continue;
    if (!isString(raw[name])) return undefined;
    event[name] = raw[name];
  }
  for (const name of shape.lists ?? []) {
    if (!isStringArray(raw[name])) return undefined;
    event[name] = raw[name];
  }
  for (const name of shape.optionalLists ?? []) {
    if (raw[name] === undefined) continue;
    if (!isStringArray(raw[name])) return undefined;
    event[name] = raw[name];
  }
  if (shape.coarse === true && coarse === true) event.coarse = true;
  // What a records event's write replaced (spec 0006): only well formed entries are kept.
  if (kind === 'records' && Array.isArray(raw.replaced)) {
    const replaced = raw.replaced.filter(isReplacedEntry);
    if (replaced.length > 0) event.replaced = replaced.map((entry) => ({ ...entry, by: { ...entry.by } }));
  }
  if (kind !== 'restricted' && mutationId !== undefined) event.mutationId = mutationId;
  return { seq, mutationId: kind === 'restricted' ? undefined : mutationId, event: event as ChangeEvent };
}

interface Watched {
  watchers: number;
  state: 'starting' | 'live' | 'down';
  hasSubscribed: boolean;
  isStopped: boolean;
  /** No watermark could be read before the first read: the first subscribe resyncs, then catches up. */
  needsResync: boolean;
  /** A catch up is running; `again` asks for one more when it ends. */
  catching: boolean;
  /** The last catch up failed and waits to try again: the screens say paused meanwhile. */
  failing: boolean;
  /** Catch up was refused (signed out, or no longer a member): nothing tries again. */
  refused: boolean;
  again: boolean;
  /**
   * Centrifugo is replaying what a recovered subscription missed (it hands
   * them over right after `subscribed`, in the same task): those deliveries
   * lose `replaced`, since a tab away when its value was replaced hears
   * nothing of it (spec 0006, AC-47), as after a catch up.
   */
  replaying: boolean;
  /** Deliveries past `W + 1`, or that arrived while catching up, waiting for their turn. */
  readonly held: Map<number, Delivery>;
  /** Refetches waiting out their spread, by what they refetch. */
  readonly due: Set<string>;
  stop: () => void;
}

/** Live updates for the tab: `watch` a workspace while a screen shows it. */
export function createLive({
  url,
  connectionToken,
  subscriptionToken,
  head,
  catchUp,
  open = async (address, token) => (await import('./centrifuge.ts')).openCentrifuge(address, token),
  router,
  mutations,
  onStatus,
  wait = timer,
  random = Math.random,
  now = () => Date.now(),
  startupMs = 5000,
  visibility = documentVisibility(),
}: LiveOptions) {
  const watched = new Map<string, Watched>();
  // Each workspace's watermark, kept for the app load (across watches) until `stop`.
  const marks = new Map<string, number>();
  let transport: Promise<LiveTransport> | undefined;
  let stopTrouble: (() => void) | undefined;
  let status: 'live' | 'paused' = 'live';
  let hiddenSince: number | undefined = visibility?.hidden() === true ? now() : undefined;

  const report = () => {
    const next = [...watched.values()].some((entry) => entry.state === 'down' || entry.failing) ? 'paused' : 'live';
    if (next === status) return;
    status = next;
    onStatus(next);
  };
  const setState = (entry: Watched, state: Watched['state']) => {
    if (entry.isStopped || entry.state === state) return;
    entry.state = state;
    report();
  };

  const setFailing = (entry: Watched, failing: boolean) => {
    if (entry.isStopped || entry.failing === failing) return;
    entry.failing = failing;
    report();
  };

  const connect = (): Promise<LiveTransport> => {
    if (transport !== undefined) return transport;
    const opening = open(url, connectionToken).then(
      (opened) => {
        stopTrouble = opened.onTrouble(() => {
          // Not connected yet, or no longer: a workspace still starting is paused (a live one says so itself).
          for (const entry of watched.values()) if (entry.state === 'starting') setState(entry, 'down');
        });
        return opened;
      },
      (error: unknown) => {
        // The client didn't load (offline, say): the next watch tries again.
        if (transport === opening) transport = undefined;
        throw error;
      },
    );
    transport = opening;
    return opening;
  };

  /**
   * Runs `run` after a random 0 to 2 seconds, unless the workspace stopped
   * being watched meanwhile; once per `key` however often it is asked while
   * it waits (a burst of coarse events refetches once).
   */
  const later = (entry: Watched, key: string, run: () => void) => {
    if (entry.due.has(key)) return;
    entry.due.add(key);
    void wait(random() * REFETCH_JITTER_MS).then(() => {
      entry.due.delete(key);
      if (!entry.isStopped) run();
    });
  };

  /** Hands an event to its store: a coarse records event after its spread, once per object. */
  const apply = (workspace: string, entry: Watched, event: ChangeEvent) => {
    if (event.kind === 'records' && event.coarse === true) {
      later(entry, `object:${event.objectId}`, () => {
        router.dispatch(workspace, event);
      });
      return;
    }
    router.dispatch(workspace, event);
  };

  /** Applies held deliveries from `W + 1` on, in order; true when one is still held past a gap. */
  const drain = (workspace: string, entry: Watched): boolean => {
    let mark = marks.get(workspace);
    for (const seq of [...entry.held.keys()].sort((a, b) => a - b)) {
      const delivery = entry.held.get(seq);
      if (delivery === undefined) continue;
      if (mark !== undefined && seq <= mark) {
        // A repeat, or covered by a catch up (this tab's own write among them is echoed all the same).
        entry.held.delete(seq);
        mutations.echoed(delivery.mutationId, delivery.seq);
        continue;
      }
      if (mark !== undefined && seq > mark + 1) return true;
      entry.held.delete(seq);
      mark = seq;
      marks.set(workspace, seq);
      // This tab's own write: its answer already showed it. The stub and unknown kinds only move the watermark.
      if (mutations.echoed(delivery.mutationId, delivery.seq)) continue;
      if (delivery.event !== undefined) apply(workspace, entry, delivery.event);
    }
    return false;
  };

  /**
   * Catches up from the watermark through `realtime.catchUp`, then applies
   * what arrived meanwhile; again while a gap remains. One at a time per
   * workspace; a failed call is tried again with backoff.
   */
  const fill = async (workspace: string, entry: Watched): Promise<void> => {
    if (entry.refused) return;
    if (entry.catching) {
      entry.again = true;
      return;
    }
    entry.catching = true;
    const isStopped = () => entry.isStopped;
    const askedAgain = () => entry.again;
    try {
      for (let failures = 0; ;) {
        entry.again = false;
        const after = marks.get(workspace);
        if (after === undefined) return;
        let answer: CaughtUp | undefined;
        try {
          answer = await catchUp(workspace, after);
        } catch {
          if (isStopped()) return;
          setFailing(entry, true);
          await wait(Math.min(MAX_RETRY_MS, 1000 * 2 ** failures) * (1 + random()));
          failures += 1;
          if (isStopped()) return;
          continue;
        }
        if (isStopped()) return;
        setFailing(entry, false);
        // Not allowed any more (signed out, or removed): paused, and nothing to try again.
        if (answer === undefined) {
          entry.refused = true;
          entry.held.clear();
          setState(entry, 'down');
          return;
        }
        failures = 0;
        if (answer.reset) {
          // The outbox no longer holds what was missed: every store refetches what it holds.
          later(entry, 'resync', () => {
            router.resync(workspace);
          });
        } else {
          for (const data of answer.events) {
            const delivery = parseChangeEvent(data);
            if (delivery?.event !== undefined) apply(workspace, entry, delivery.event);
          }
        }
        marks.set(workspace, Math.max(after, answer.head));
        if (answer.reset || answer.head < after) marks.set(workspace, answer.head);
        const gap = drain(workspace, entry);
        // Read through a function: a trigger during the await above may have set it.
        if (askedAgain()) continue;
        // An event still past what the outbox answered: try again after a spread, never in a loop.
        if (gap) gapLater(workspace, entry);
        return;
      }
    } finally {
      entry.catching = false;
    }
  };

  /**
   * Catches up after a random 0 to 2 seconds, once however many gaps open
   * meanwhile, so every subscriber of a workspace doesn't ask at the same
   * moment, and a seq that arrives late (out of order) can close the gap
   * first, which then costs no call.
   */
  const gapLater = (workspace: string, entry: Watched) => {
    later(entry, 'catch-up', () => {
      if (drain(workspace, entry)) void fill(workspace, entry);
    });
  };

  const receive = (workspace: string, entry: Watched, data: unknown) => {
    if (entry.refused) return;
    const parsed = parseChangeEvent(data);
    if (parsed === undefined) return;
    const delivery = entry.replaying ? withoutReplaced(parsed) : parsed;
    const mark = marks.get(workspace);
    if (mark !== undefined && delivery.seq <= mark) return;
    // Past the cap only while a catch up is due or running, which reads to the head and covers them.
    if (entry.held.size >= MAX_HELD) entry.held.clear();
    entry.held.set(delivery.seq, delivery);
    // While catching up, it waits for the catch up to end.
    if (entry.catching) return;
    // No watermark at all (it couldn't be read): this event starts the count.
    if (mark === undefined) marks.set(workspace, delivery.seq - 1);
    if (drain(workspace, entry)) gapLater(workspace, entry);
  };

  /** Connects (once per tab) and subscribes, trying again with backoff while the client or a token can't load. */
  const start = async (workspace: string, entry: Watched) => {
    // Read fresh after each await: a release may stop the entry meanwhile.
    const isStopped = () => entry.isStopped;
    if (!marks.has(workspace)) {
      const first = await head(workspace).catch(() => undefined);
      if (first !== undefined && !marks.has(workspace)) marks.set(workspace, first);
    }
    for (let failures = 0; ; failures += 1) {
      if (isStopped()) return;
      try {
        const opened = await connect();
        const granted = await subscriptionToken(workspace);
        // Not allowed (signed out, or not a member): paused, and nothing to try again.
        if (granted === undefined) {
          setState(entry, 'down');
          return;
        }
        if (isStopped()) return;
        if (!marks.has(workspace)) {
          // No head was read before the first read: start from this one, and resync what was read before it.
          entry.needsResync = true;
          marks.set(workspace, granted.head);
        }
        entry.stop = opened.listen(channelFor(workspace, entry, granted));
        return;
      } catch {
        setState(entry, 'down');
        await wait(Math.min(MAX_RETRY_MS, 1000 * 2 ** failures) * (1 + random()));
      }
    }
  };

  /** The workspace's channel, and what its events, subscribes and drops do. */
  const channelFor = (workspace: string, entry: Watched, granted: Granted): LiveChannel => ({
    name: granted.channel,
    token: granted.token,
    renew: async () => (await subscriptionToken(workspace))?.token,
    onPublication: (data) => {
      receive(workspace, entry, data);
    },
    onSubscribed: ({ wasRecovering, recovered }) => {
      setState(entry, 'live');
      if (!entry.hasSubscribed) {
        // A new subscription: anything written since the watermark was missed.
        entry.hasSubscribed = true;
        if (entry.needsResync) {
          entry.needsResync = false;
          later(entry, 'resync', () => {
            router.resync(workspace);
          });
        }
        void fill(workspace, entry);
        return;
      }
      // Recovered: the missed events follow, in order. Otherwise they are gone from Centrifugo (history past
      // 5 minutes or 1,000 messages, or it restarted): the outbox has them.
      if (wasRecovering && recovered) {
        entry.replaying = true;
        queueMicrotask(() => {
          entry.replaying = false;
        });
        return;
      }
      later(entry, 'catch-up', () => {
        void fill(workspace, entry);
      });
    },
    onDown: (why) => {
      // The first subscribing is the start; after that, or on a failure, the screens say paused.
      if (why === 'failed' || entry.state === 'live') setState(entry, 'down');
    },
  });

  // A tab back after 5 minutes hidden may have missed more than Centrifugo kept: catch up.
  const stopVisibility = visibility?.onChange(() => {
    if (visibility.hidden()) {
      hiddenSince ??= now();
      return;
    }
    const since = hiddenSince;
    hiddenSince = undefined;
    if (since === undefined || now() - since < HIDDEN_CATCH_UP_MS) return;
    for (const [workspace, entry] of watched) if (entry.hasSubscribed) void fill(workspace, entry);
  });

  return {
    /** `live` or `paused`, as last reported through `onStatus`. */
    status: (): 'live' | 'paused' => status,
    /** The watermark of a workspace: the last contiguous `seq` applied, for tests and diagnostics. */
    watermark: (workspace: string): number | undefined => marks.get(workspace),
    /**
     * Listens to a workspace's changes while a screen shows it (counted, so
     * every screen may watch); the answer stops watching.
     */
    watch: (workspace: string): (() => void) => {
      const existing = watched.get(workspace);
      const entry: Watched = existing ?? {
        watchers: 0,
        state: 'starting',
        hasSubscribed: false,
        isStopped: false,
        needsResync: false,
        replaying: false,
        catching: false,
        failing: false,
        refused: false,
        again: false,
        held: new Map(),
        due: new Set(),
        stop: () => undefined,
      };
      entry.watchers += 1;
      if (existing === undefined) {
        watched.set(workspace, entry);
        // Paused if subscribing takes too long (no connection at all says nothing else).
        void wait(startupMs).then(() => {
          if (entry.state === 'starting') setState(entry, 'down');
        });
        start(workspace, entry).catch(() => {
          setState(entry, 'down');
        });
      }
      let isReleased = false;
      return () => {
        if (isReleased) return;
        isReleased = true;
        entry.watchers -= 1;
        if (entry.watchers > 0 || entry.isStopped) return;
        entry.isStopped = true;
        entry.stop();
        watched.delete(workspace);
        report();
        // Nothing watched: let the connection go.
        if (watched.size === 0) close();
      };
    },
    /** Stops every watch, forgets the watermarks and disconnects (sign out, or the session ended). */
    stop: () => {
      for (const entry of watched.values()) {
        entry.isStopped = true;
        entry.stop();
      }
      watched.clear();
      marks.clear();
      stopVisibility?.();
      close();
      report();
    },
  };

  function close() {
    const closing = transport;
    transport = undefined;
    stopTrouble?.();
    stopTrouble = undefined;
    void closing?.then((opened) => {
      opened.close();
    });
  }
}

/** Live updates, as createDataLayer holds them once loaded. */
export type Live = ReturnType<typeof createLive>;
