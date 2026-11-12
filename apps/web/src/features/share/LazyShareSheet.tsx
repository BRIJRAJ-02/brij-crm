// The one share sheet (spec 0074) loaded apart from a screen that opens it on a press, as Bookings' lazy parts are:
// no code until it first opens or the screen goes idle (`usePreload`), then mounted for good, so its exit plays.
// The screen passes its own `import()`, which then sits in its route chunk beside the route's other lazy imports,
// rather than in a small chunk of its own with its own list of files to preload (AC-7419).
import type { ShareSheetProps } from '@crm/ui';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';

type Sheet = ComponentType<ShareSheetProps>;

/** ShareSheet as `load` brings it in, and the hook that loads it once the screen is idle. */
export function lazyShareSheet(load: () => Promise<{ readonly ShareSheet: Sheet }>) {
  const Lazy = lazy(() => load().then((module) => ({ default: module.ShareSheet })));
  function ShareSheet(props: ShareSheetProps) {
    const [hasOpened, setHasOpened] = useState(props.isOpen);
    if (props.isOpen && !hasOpened) setHasOpened(true);
    return hasOpened ? (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    ) : null;
  }
  function usePreload(): void {
    useEffect(() => {
      const start = () => void load().catch(() => undefined);
      if (typeof window.requestIdleCallback !== 'function') {
        const timer = window.setTimeout(start, 2_000);
        return () => window.clearTimeout(timer);
      }
      const id = window.requestIdleCallback(start, { timeout: 5_000 });
      return () => window.cancelIdleCallback(id);
    }, []);
  }
  return { ShareSheet, usePreload };
}
