// What a screen holds for a view's calculations (the CRM flow pass): the
// source shape `useAggregates` reads, the key each answer sits under, a source
// that asks nothing, and a source that waits for the records layer. In the
// first load (tiny, types and a few functions); the store itself
// (`aggregates.ts`) loads with the records layer.
import type { RecordAggregate } from '@crm/contracts';
import type { AggregateFn, FilterGroup } from '@crm/contracts/values';

/** One calculation a screen asks for: an attribute, and what to work out over it. */
export interface AggregateAskSpec {
  readonly attributeId: string;
  readonly fn: AggregateFn;
}

/**
 * A view's calculations: its object and filter and the asks (a table's
 * footer), or with `groupBy` and `groupIds` the same asks per board column
 * (amounts only). Two screens asking the same question, in any ask order,
 * share one answer.
 */
export interface AggregateQuestion {
  readonly objectId: string;
  readonly filter?: FilterGroup | undefined;
  readonly asks: readonly AggregateAskSpec[];
  readonly groupBy?: string;
  readonly groupIds?: readonly (string | null)[];
}

/** Each answer by `aggregateKey`. */
export type AggregateAnswers = ReadonlyMap<string, RecordAggregate>;

/**
 * Where a question's answers stand: `loading` before the first, `ready` with
 * them (kept on screen while a newer read is out, `isRefreshing`), `error`
 * when the last read failed, or `idle` for a source that asks nothing.
 */
export interface AggregateState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly answers?: AggregateAnswers;
  readonly isRefreshing?: boolean;
}

/** A question's answers as a screen reads them (`useAggregates`): held while shown, so they stay current. */
export interface AggregateSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => AggregateState;
  /** Holds the answers while a screen shows them; the answer lets go. */
  readonly retain: () => () => void;
}

/** The key an answer sits under: the ask's attribute and calculation, and for a board its column (`null`: no value). */
export function aggregateKey(attributeId: string, fn: AggregateFn, groupId?: string | null): string {
  const ask = `${attributeId}:${fn}`;
  return groupId === undefined ? ask : `${groupId ?? ''}|${ask}`;
}

const IDLE: AggregateState = { status: 'idle' };

/** A source that asks nothing (no column has a calculation, no board total). */
export const NO_AGGREGATES: AggregateSource = {
  subscribe: () => () => undefined,
  getSnapshot: () => IDLE,
  retain: () => () => undefined,
};

const LOADING: AggregateState = { status: 'loading' };

/**
 * A source that answers `loading` until the records layer has loaded, then
 * reads the store's own source (`load`), holding it if a screen already does.
 */
export function lazyAggregateSource(load: Promise<AggregateSource>): AggregateSource {
  let inner: AggregateSource | undefined;
  let holders = 0;
  let releaseInner: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  void load.then(
    (source) => {
      inner = source;
      // Forwarded for this source's life: the store drops the entry itself once nobody holds it.
      source.subscribe(emit);
      if (holders > 0) releaseInner = source.retain();
      emit();
    },
    () => undefined,
  );
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => inner?.getSnapshot() ?? LOADING,
    retain: () => {
      holders += 1;
      if (holders === 1 && inner !== undefined) releaseInner = inner.retain();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) {
          releaseInner?.();
          releaseInner = undefined;
        }
      };
    },
  };
}
