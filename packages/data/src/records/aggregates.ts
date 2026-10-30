// A view's calculations (the CRM flow pass), loaded with the records layer:
// one entry per question (workspace, object, filter, the asks sorted, and a
// board's columns), shared by every screen asking it, so a table's footer is
// one read however many columns calculate, and moving a column asks nothing.
// An entry's answers stay on screen while a newer read is out. It is read
// again when something it depends on changes: a records change for its object
// naming an ask's or the filter's attribute, a record made, deleted or
// restored, a coarse reload, or this tab's own write (when it shows and when
// it lands or rolls back). Those mark it stale and it reads again 1.5 seconds
// after the last (`SETTLE_MS`), at most 5 seconds after the first
// (`SETTLE_MAX_MS`), one read in flight at a time. An entry nobody holds only
// notes it is stale and reads when held again; 30 seconds after the last
// screen lets go, it is dropped.
import type { FilterGroup } from '@crm/contracts/values';
import type {
  AggregateAnswers,
  AggregateAskSpec,
  AggregateQuestion,
  AggregateSource,
  AggregateState,
} from './aggregate-source.ts';

/** How long after the last change an entry reads again, in ms. */
export const AGGREGATE_SETTLE_MS = 1500;
/** The longest an entry waits after the first change that made it stale, in ms. */
export const AGGREGATE_SETTLE_MAX_MS = 5000;
/** How long an entry nobody holds is kept, in ms. */
const KEEP_MS = 30_000;

/** What the store needs from the records layer. */
export interface AggregateStoreOptions {
  /** Reads a question's answers (through the read gate's `whenFree`), aborted with `signal`. */
  readonly ask: (workspace: string, question: AggregateQuestion, signal: AbortSignal) => Promise<AggregateAnswers>;
  /** Runs `run` after `ms`; the answer cancels it. */
  readonly later: (run: () => void, ms: number) => () => void;
  /** Unix milliseconds now. */
  readonly now: () => number;
  /** `value` as JSON with every object's keys in order, so two spellings of one filter key alike. */
  readonly canonical: (value: unknown) => string;
  /** The attribute ids a filter names, at any depth. */
  readonly filterAttributes: (filter: FilterGroup | undefined) => readonly string[];
  readonly keepMs?: number;
}

interface Entry {
  readonly key: string;
  readonly workspace: string;
  readonly question: AggregateQuestion;
  /** What the answers depend on: the asks' attributes, the filter's, and a board's grouping attribute. */
  readonly attributes: ReadonlySet<string>;
  readonly listeners: Set<() => void>;
  readonly source: AggregateSource;
  state: AggregateState;
  holders: number;
  stale: boolean;
  firstStaleAt: number | undefined;
  cancelTimer: (() => void) | undefined;
  cancelDrop: (() => void) | undefined;
  controller: AbortController | undefined;
  /** Marked stale while a read was out: read once more when it lands. */
  again: boolean;
}

const askOrder = (left: AggregateAskSpec, right: AggregateAskSpec): number => {
  const a = `${left.attributeId}:${left.fn}`;
  const b = `${right.attributeId}:${right.fn}`;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** The question as the store keys it: the asks sorted and each once, an empty filter as none. */
export function normalQuestion(question: AggregateQuestion): AggregateQuestion {
  const seen = new Set<string>();
  const asks = [...question.asks].sort(askOrder).filter((ask) => {
    const key = `${ask.attributeId}:${ask.fn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const filter = question.filter === undefined || question.filter.conditions.length === 0 ? undefined : question.filter;
  return {
    objectId: question.objectId,
    ...(filter === undefined ? {} : { filter }),
    asks,
    ...(question.groupBy === undefined ? {} : { groupBy: question.groupBy, groupIds: question.groupIds ?? [] }),
  };
}

/** The view's calculations store (see the file's header). */
export function createAggregateStore({
  ask,
  later,
  now,
  canonical,
  filterAttributes,
  keepMs = KEEP_MS,
}: AggregateStoreOptions) {
  const entries = new Map<string, Entry>();

  const emit = (entry: Entry) => {
    for (const listener of entry.listeners) listener();
  };
  const setState = (entry: Entry, state: AggregateState) => {
    entry.state = state;
    emit(entry);
  };

  const read = (entry: Entry) => {
    if (entry.controller !== undefined) {
      entry.again = true;
      return;
    }
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
    entry.stale = false;
    entry.firstStaleAt = undefined;
    const controller = new AbortController();
    entry.controller = controller;
    const answers = entry.state.answers;
    // The answers shown stay until the next ones are in.
    setState(entry, answers === undefined ? { status: 'loading' } : { status: 'ready', answers, isRefreshing: true });
    ask(entry.workspace, entry.question, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        entry.controller = undefined;
        setState(entry, { status: 'ready', answers: next });
        settled(entry);
      },
      () => {
        if (controller.signal.aborted) return;
        entry.controller = undefined;
        setState(entry, { status: 'error' });
        settled(entry);
      },
    );
  };

  /** A read landed: one more when a change came while it was out. */
  const settled = (entry: Entry) => {
    if (!entry.again) return;
    entry.again = false;
    if (entry.holders > 0) read(entry);
    else entry.stale = true;
  };

  /** Stale: read again after the trailing wait, never past the longest wait; unheld, only noted. */
  const markStale = (entry: Entry) => {
    entry.stale = true;
    if (entry.holders === 0) return;
    const at = now();
    entry.firstStaleAt ??= at;
    entry.cancelTimer?.();
    const wait = Math.max(0, Math.min(AGGREGATE_SETTLE_MS, entry.firstStaleAt + AGGREGATE_SETTLE_MAX_MS - at));
    entry.cancelTimer = later(() => {
      entry.cancelTimer = undefined;
      read(entry);
    }, wait);
  };

  const drop = (entry: Entry) => {
    entry.controller?.abort();
    entry.cancelTimer?.();
    entries.delete(entry.key);
  };

  const open = (workspace: string, question: AggregateQuestion): Entry => {
    const asked = normalQuestion(question);
    const key = canonical({ workspace, ...asked });
    const held = entries.get(key);
    if (held !== undefined) return held;
    const listeners = new Set<() => void>();
    const entry: Entry = {
      key,
      workspace,
      question: asked,
      attributes: new Set([
        ...asked.asks.map((each) => each.attributeId),
        ...filterAttributes(asked.filter),
        ...(asked.groupBy === undefined ? [] : [asked.groupBy]),
      ]),
      listeners,
      state: { status: 'loading' },
      holders: 0,
      stale: true,
      firstStaleAt: undefined,
      cancelTimer: undefined,
      cancelDrop: undefined,
      controller: undefined,
      again: false,
      source: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => entry.state,
        retain: () => {
          entry.holders += 1;
          entry.cancelDrop?.();
          entry.cancelDrop = undefined;
          if (entry.stale && entry.controller === undefined && entry.cancelTimer === undefined) read(entry);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            entry.holders -= 1;
            if (entry.holders > 0) return;
            entry.cancelTimer?.();
            entry.cancelTimer = undefined;
            entry.cancelDrop = later(() => {
              drop(entry);
            }, keepMs);
          };
        },
      },
    };
    entries.set(key, entry);
    return entry;
  };

  return {
    /** A question's answers for a screen to hold (`useAggregates`), shared by every screen asking the same one. */
    source: (workspace: string, question: AggregateQuestion): AggregateSource => open(workspace, question).source,

    /**
     * Something changed that may move answers: records of `objectId` (every
     * object of the workspace when undefined) naming `attributeIds` (any
     * when undefined), or with `lifecycle` a record made, deleted or
     * restored, which moves every count and sum. The entries it touches read
     * again after the wait.
     */
    touched: (
      workspace: string,
      objectId: string | undefined,
      attributeIds: readonly string[] | undefined,
      lifecycle: boolean,
    ): void => {
      for (const entry of entries.values()) {
        if (entry.workspace !== workspace) continue;
        if (objectId !== undefined && entry.question.objectId !== objectId) continue;
        const touches = lifecycle || attributeIds === undefined || attributeIds.some((id) => entry.attributes.has(id));
        if (touches) markStale(entry);
      }
    },

    /** Forgets every entry (sign out). */
    clear: () => {
      for (const entry of [...entries.values()]) {
        entry.cancelDrop?.();
        drop(entry);
      }
    },

    /** How many questions the store holds (for tests). */
    size: () => entries.size,
  };
}

/** The calculations store, as the records layer holds it. */
export type AggregateStore = ReturnType<typeof createAggregateStore>;
