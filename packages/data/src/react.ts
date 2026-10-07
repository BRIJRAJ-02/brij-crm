// `@crm/data/react`: the data layer's React binding (spec 0005). Screens read
// a view through it, so they never subscribe to the store themselves.
import { useSyncExternalStore } from 'react';
import type { RecordsView, ViewState } from './records/layer.ts';

/**
 * A view's current state (its rows, status and cell refusals), re-rendering
 * when it changes: at most once a frame, and only for records it shows.
 */
export function useView(view: RecordsView): ViewState {
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}
