// `@crm/data/react`: the data layer's React binding (spec 0005). Screens read
// a view and the live status through it, so they never subscribe to the store
// themselves.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { LiveStatus } from './live/live.ts';
import type { RecordsView, ViewReader, ViewState } from './records/layer.ts';

/**
 * A view's current state (its rows, count, status, cell refusals and row
 * notes), re-rendering when it changes: at most once a frame, and only for
 * records it shows. While the screen is mounted it holds the view, so the
 * view keeps its rows; once no screen shows it for a while, the layer lets
 * them go. `attributeIds` are the columns the screen shows now (spec 0006,
 * AC-55): only those and the primary are read, and a column shown later is
 * fetched for the loaded rows alone.
 */
export function useView(view: RecordsView, attributeIds: readonly string[] = []): ViewState {
  const reader = useRef<ViewReader | undefined>(undefined);
  // One string, so a new array with the same columns changes nothing.
  const columns = attributeIds.join('\u0000');
  useEffect(() => {
    const retained = view.retain(split(columns));
    reader.current = retained;
    return () => {
      retained.release();
      reader.current = undefined;
    };
    // The columns reach a retained view through `columns` below: a new column never retains it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    reader.current?.columns(split(columns));
  }, [columns]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}

const split = (columns: string): readonly string[] => (columns === '' ? [] : columns.split('\u0000'));

/** What `useLiveStatus` reads: the data layer's `live`. */
export interface LiveSource {
  readonly status: () => LiveStatus;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Whether other people's changes are arriving (`live`, `paused` or `off`), re-rendering when it changes. */
export function useLiveStatus(live: LiveSource): LiveStatus {
  return useSyncExternalStore(live.subscribe, live.status);
}
