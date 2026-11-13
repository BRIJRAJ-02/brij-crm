// The one share sheet (spec 0074) loaded apart from a screen that opens it on a press, as Bookings' lazy parts are:
// no code until it first opens or the screen goes idle (`usePreload`), then mounted for good, so its exit plays.
// The screen passes its own `import()`, which then sits in its route chunk beside the route's other lazy imports,
// rather than in a small chunk of its own with its own list of files to preload (AC-7419).
import type { ShareSheetProps } from '@crm/ui';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';

type Sheet = ComponentType<ShareSheetProps>;

/**
 * A dialog's component as `load` brings it in: nothing drawn and no code until `isOpen` first says so, then mounted
 * for good, so its exit plays; and the hook that loads it once the screen is idle, so a first open rarely waits.
 */
export function lazyOnOpen<P extends object>(
  load: () => Promise<ComponentType<P>>,
  isOpen: (props: P) => boolean,
): { readonly Component: ComponentType<P>; readonly usePreload: () => void } {
  const Lazy = lazy(() => load().then((component) => ({ default: component })));
  function OnOpen(props: P) {
    const open = isOpen(props);
    const [hasOpened, setHasOpened] = useState(open);
    if (open && !hasOpened) setHasOpened(true);
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
  return { Component: OnOpen, usePreload };
}

/** ShareSheet as `load` brings it in, and the hook that loads it once the screen is idle. */
export function lazyShareSheet(load: () => Promise<{ readonly ShareSheet: Sheet }>) {
  const { Component, usePreload } = lazyOnOpen(
    () => load().then((module) => module.ShareSheet),
    (props: ShareSheetProps) => props.isOpen,
  );
  return { ShareSheet: Component, usePreload };
}
