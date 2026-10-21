// The Customise sidebar dialog, loaded the first time it opens (behind a section menu, or Settings › Preferences).
// A dialog whose code didn't load (a deploy moved it, the connection dropped) doesn't take the page down: it closes
// and a toast says so each time it is opened, until the page reloads.
import { useRouteContext } from '@tanstack/react-router';
import { lazy, useEffect, type ComponentType } from 'react';
import type { CustomiseSidebarDialogProps } from './CustomiseSidebarDialog.tsx';
import { strings } from './strings.ts';

/** Stands in for a dialog whose code didn't load: closes it and says why, each time it opens. */
function CustomiseSidebarUnavailable({ isOpen, onOpenChange }: CustomiseSidebarDialogProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  useEffect(() => {
    if (!isOpen) return;
    toasts.toast({ tone: 'danger', message: strings.customiseUnavailable });
    onOpenChange(false);
  }, [isOpen, onOpenChange, toasts]);
  return null;
}

const load = (): Promise<{ default: ComponentType<CustomiseSidebarDialogProps> }> =>
  import('./CustomiseSidebarDialog.tsx').then(
    (module) => ({ default: module.CustomiseSidebarDialog }),
    () => ({ default: CustomiseSidebarUnavailable }),
  );

/** Customise sidebar, lazily loaded; render it inside a `Suspense`. */
export const LazyCustomiseSidebarDialog = lazy(load);
