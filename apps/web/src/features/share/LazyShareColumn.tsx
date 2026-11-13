// The share sheet's column for a Share tab (spec 0074), loaded apart from the editor that draws it: a Share tab is never
// an editor's first view. Its own file, so the screens that only open the sheet (`LazyShareSheet.tsx`) don't carry it.
import { Skeleton, useDelayedLoading, type ShareColumnProps } from '@crm/ui';
import { lazy, Suspense, type ComponentType } from 'react';

type Column = ComponentType<ShareColumnProps>;

/**
 * The column's shape while its code is on the way: the link row, the ways under it and the code's tile, shown only
 * after the loading delay (a fast load never flashes it), and the card's slot marked busy meanwhile.
 */
function ColumnLoading() {
  const isShown = useDelayedLoading(true);
  return (
    <div aria-busy="true">
      {isShown && (
        <>
          <Skeleton shape="field" width="full" />
          <Skeleton lines={2} />
          <Skeleton shape="tile" size="xl" />
        </>
      )}
    </div>
  );
}

/**
 * ShareColumn as `load` brings it in, for a Share tab: the tab is never the editor's first view, so the column's code
 * stays off the editor's first load. Until it lands the card holds the column's shape (`ColumnLoading`); the screen's `usePreload`
 * (from `lazyShareSheet` with the same `load`) usually has it in before the tab is opened.
 */
export function lazyShareColumn(load: () => Promise<{ readonly ShareColumn: Column }>) {
  const Lazy = lazy(() => load().then((module) => ({ default: module.ShareColumn })));
  return function ShareColumn(props: ShareColumnProps) {
    return (
      <Suspense fallback={<ColumnLoading />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
