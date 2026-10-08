// Live updates in the browser (spec 0005, live patches): one Centrifugo
// connection for the tab, one subscription per workspace a screen shows, and
// the client's side of the seq contract (packages/data/AGENTS.md). Loaded with
// a dynamic import the first time a screen watches a workspace; Centrifugo's
// client loads with it, through its one wrapper (centrifuge.ts).
//
// Per workspace it keeps the highest `seq` applied:
// - at or below it: a repeat, or one a refetch already covered, so dropped;
// - highest + 1: applied, unless it is this tab's own write coming back;
// - past highest + 1: a gap, so everything held for the workspace is fetched
//   again (spread over 0 to 2 seconds, so a whole team doesn't ask at once).
// A subscription that comes back without recovering what it missed is a gap
// too. Nothing here polls: when the connection is down the screens say live
// updates are paused, and Centrifugo's client reconnects with its own backoff.
import type { ChangeEvent } from '@crm/contracts';
import type { MutationLog } from './mutations.ts';

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

/** What a change asks of the data layer. */
export interface LiveHandlers {
  /** These records of the object changed: refetch the ones held, and place new ones. */
  readonly records: (workspace: string, objectId: string, recordIds: readonly string[]) => void;
  /** Too many to list (`coarse`): refetch everything held of the object. */
  readonly object: (workspace: string, objectId: string) => void;
  /** The object's attributes changed: fetch them again. */
  readonly definitions: (workspace: string, objectId: string) => void;
  /** Changes may have been missed: refetch everything held for the workspace. */
  readonly workspace: (workspace: string) => void;
}

/** What createLive needs. */
export interface LiveOptions {
  /** Centrifugo's WebSocket address (`VITE_REALTIME_URL`). */
  readonly url: string;
  readonly connectionToken: TokenSource;
  /** The workspace's channel and its token, or undefined when not allowed. Rejects when the API can't be reached. */
  readonly subscriptionToken: (
    workspace: string,
  ) => Promise<{ readonly channel: string; readonly token: string } | undefined>;
  /** Loads and opens the realtime client: centrifuge.ts by default. */
  readonly open?: (url: string, connectionToken: TokenSource) => Promise<LiveTransport>;
  readonly handlers: LiveHandlers;
  /** This tab's writes waiting for their echo. */
  readonly mutations: MutationLog;
  /** Called when the status changes between `live` and `paused`. */
  readonly onStatus: (status: 'live' | 'paused') => void;
  /** Waits `ms`. A timer by default; tests pass their own. */
  readonly wait?: (ms: number) => Promise<void>;
  /** A number in [0, 1), to spread refetches out (`Math.random`). */
  readonly random?: () => number;
  /** How long a first subscribe may take before the screens say paused: 5 seconds. */
  readonly startupMs?: number;
}

/** The longest spread before a refetch that many browsers make at once (a gap, a lost recovery, a coarse change). */
export const REFETCH_JITTER_MS = 2000;

/** The longest wait between tries at a workspace's first subscription token. */
const MAX_TOKEN_RETRY_MS = 30_000;

const timer = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** A change event as published, or undefined for anything else (no Zod here: it would grow this chunk). */
export function parseChangeEvent(data: unknown): ChangeEvent | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const event = data as Record<string, unknown>;
  const { seq, kind, objectId, recordIds, attributeIds, mutationId, coarse } = event;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return undefined;
  if (kind !== 'records' && kind !== 'definitions') return undefined;
  if (typeof objectId !== 'string' || !isStringArray(recordIds) || !isStringArray(attributeIds)) return undefined;
  if (mutationId !== undefined && typeof mutationId !== 'string') return undefined;
  if (coarse !== undefined && coarse !== true) return undefined;
  return {
    seq,
    kind,
    objectId,
    recordIds,
    attributeIds,
    ...(mutationId === undefined ? {} : { mutationId }),
    ...(coarse === undefined ? {} : { coarse }),
  };
}

interface Watched {
  watchers: number;
  /** The highest `seq` applied; undefined until the first event after a (re)start. */
  highest: number | undefined;
  state: 'starting' | 'live' | 'down';
  hasSubscribed: boolean;
  isStopped: boolean;
  stop: () => void;
}

/** Live updates for the tab: `watch` a workspace while a screen shows it. */
export function createLive({
  url,
  connectionToken,
  subscriptionToken,
  open = async (address, token) => (await import('./centrifuge.ts')).openCentrifuge(address, token),
  handlers,
  mutations,
  onStatus,
  wait = timer,
  random = Math.random,
  startupMs = 5000,
}: LiveOptions) {
  const watched = new Map<string, Watched>();
  let transport: Promise<LiveTransport> | undefined;
  let stopTrouble: (() => void) | undefined;
  let status: 'live' | 'paused' = 'live';

  const report = () => {
    const next = [...watched.values()].some((entry) => entry.state === 'down') ? 'paused' : 'live';
    if (next === status) return;
    status = next;
    onStatus(next);
  };
  const setState = (entry: Watched, state: Watched['state']) => {
    if (entry.isStopped || entry.state === state) return;
    entry.state = state;
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

  /** Runs `run` after a random 0 to 2 seconds, unless the workspace stopped being watched meanwhile. */
  const later = (entry: Watched, run: () => void) => {
    void wait(random() * REFETCH_JITTER_MS).then(() => {
      if (!entry.isStopped) run();
    });
  };

  const apply = (workspace: string, entry: Watched, event: ChangeEvent) => {
    if (event.kind === 'definitions') {
      handlers.definitions(workspace, event.objectId);
    } else if (event.coarse === true) {
      later(entry, () => {
        handlers.object(workspace, event.objectId);
      });
    } else {
      handlers.records(workspace, event.objectId, event.recordIds);
    }
  };

  const receive = (workspace: string, entry: Watched, data: unknown) => {
    const event = parseChangeEvent(data);
    if (event === undefined) return;
    const { highest } = entry;
    // A repeat, or one a refetch already covered.
    if (highest !== undefined && event.seq <= highest) return;
    entry.highest = event.seq;
    const isOwn = mutations.echoed(event.mutationId);
    if (highest !== undefined && event.seq > highest + 1) {
      // A gap: what came between is lost, so everything held is fetched again (which covers this one too).
      later(entry, () => {
        handlers.workspace(workspace);
      });
      return;
    }
    // This tab's own write: its answer already showed it.
    if (isOwn) return;
    apply(workspace, entry, event);
  };

  const start = async (workspace: string, entry: Watched) => {
    const opened = await connect();
    let granted: { readonly channel: string; readonly token: string } | undefined;
    for (let failures = 0; granted === undefined; failures += 1) {
      if (entry.isStopped) return;
      try {
        granted = await subscriptionToken(workspace);
        // Not allowed (signed out, or not a member): paused, and nothing to try again.
        if (granted === undefined) {
          setState(entry, 'down');
          return;
        }
      } catch {
        setState(entry, 'down');
        await wait(Math.min(MAX_TOKEN_RETRY_MS, 1000 * 2 ** failures) * (1 + random()));
      }
    }
    if (entry.isStopped) return;
    entry.stop = opened.listen({
      name: granted.channel,
      token: granted.token,
      renew: async () => (await subscriptionToken(workspace))?.token,
      onPublication: (data) => {
        receive(workspace, entry, data);
      },
      onSubscribed: ({ wasRecovering, recovered }) => {
        setState(entry, 'live');
        if (!entry.hasSubscribed) {
          // The first subscribe: anything written between the screen's first load and now was missed.
          entry.hasSubscribed = true;
          entry.highest = undefined;
          handlers.workspace(workspace);
          return;
        }
        // Recovered: the missed events follow, in order. Otherwise they are gone (history past 5 minutes or
        // 1,000 messages, or Centrifugo restarted), so the next event starts the count again.
        if (wasRecovering && recovered) return;
        entry.highest = undefined;
        later(entry, () => {
          handlers.workspace(workspace);
        });
      },
      onDown: (why) => {
        // The first subscribing is the start; after that, or on a failure, the screens say paused.
        if (why === 'failed' || entry.state === 'live') setState(entry, 'down');
      },
    });
  };

  return {
    /**
     * Listens to a workspace's changes while a screen shows it (counted, so
     * every screen may watch); the answer stops watching.
     */
    watch: (workspace: string): (() => void) => {
      const existing = watched.get(workspace);
      const entry: Watched = existing ?? {
        watchers: 0,
        highest: undefined,
        state: 'starting',
        hasSubscribed: false,
        isStopped: false,
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
    /** Stops every watch and disconnects (sign out, or the session ended). */
    stop: () => {
      for (const entry of watched.values()) {
        entry.isStopped = true;
        entry.stop();
      }
      watched.clear();
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
