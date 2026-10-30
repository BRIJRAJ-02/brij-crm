// Brief
// Purpose: reads the filter of the saved view a report was just pointed at, then hands it over and goes.
// Main task: turn "use this view's filter" into a filter snapshot the report keeps.
// Leaves out: drawing anything, and following the view afterwards (the report keeps what it read).
import { useSavedView } from '@crm/data/react';
import { effectiveQuery } from '@crm/contracts/views';
import type { ReportAttribute } from '@crm/contracts/reports';
import type { FilterGroup } from '@crm/contracts/values';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';

/** Props for PickedFilter. */
export interface PickedFilterProps {
  readonly slug: string;
  readonly viewId: string;
  /** The view's object's attributes, so a condition naming an archived or hidden one is left out. */
  readonly attributes: readonly ReportAttribute[];
  /** The view's name and its filter as it runs now (none when the view filters nothing). */
  readonly onRead: (viewId: string, name: string, filter: FilterGroup | undefined) => void;
  /** The view couldn't be read: nothing was applied. */
  readonly onFailed: (viewId: string) => void;
}

/** Renders nothing. It holds the view while it is read, calls `onRead` once it has it, and `onFailed` when it can't. */
export function PickedFilter({ slug, viewId, attributes, onRead, onFailed }: PickedFilterProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const source = useMemo(() => data.views.get(slug, viewId), [data, slug, viewId]);
  const saved = useSavedView(source);
  useEffect(() => {
    if (saved.status === 'ready' && saved.view !== undefined) {
      const query = effectiveQuery(saved.view.config, attributes);
      onRead(viewId, saved.view.name, query.status === 'ready' ? query.filter : undefined);
    } else if (saved.status === 'error' || saved.status === 'not-found') {
      onFailed(viewId);
    }
  }, [saved, attributes, viewId, onRead, onFailed]);
  return null;
}
