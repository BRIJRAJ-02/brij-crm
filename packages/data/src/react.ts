// `@crm/data/react`: the data layer's React binding (spec 0005). Screens read
// a view through it, so they never subscribe to the store themselves.
import { useEffect, useSyncExternalStore } from 'react';
import type { RecordsView, ViewState } from './records/layer.ts';

/**
 * A view's current state (its rows, status and cell refusals), re-rendering
 * when it changes: at most once a frame, and only for records it shows. While
 * the screen is mounted it holds the view, so the view keeps its rows; once
 * no screen shows it for a while, the layer lets them go.
 */
export function useView(view: RecordsView): ViewState {
  useEffect(() => view.retain(), [view]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}
