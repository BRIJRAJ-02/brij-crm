// The New list dialog, loaded the first time it opens (the sidebar's "+" on Lists), so the frame never carries it.
// A dialog whose code didn't load (a deploy moved it, the connection dropped) closes and a toast says so.
import { useRouteContext } from '@tanstack/react-router';
import { lazy, useEffect, type ComponentType } from 'react';
import type { NewListModalProps } from './NewListModal.tsx';
import { strings } from './strings.ts';

/** Stands in for a dialog whose code didn't load: closes it and says why, each time it opens. */
function NewListUnavailable({ isOpen, onClose }: NewListModalProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  useEffect(() => {
    if (!isOpen) return;
    toasts.toast({ tone: 'danger', message: strings.newListUnavailable });
    onClose();
  }, [isOpen, onClose, toasts]);
  return null;
}

const load = (): Promise<{ default: ComponentType<NewListModalProps> }> =>
  import('./NewListModal.tsx').then(
    (module) => ({ default: module.NewListModal }),
    () => ({ default: NewListUnavailable }),
  );

/** New list, lazily loaded; render it inside a `Suspense`. */
export const LazyNewListModal = lazy(load);
