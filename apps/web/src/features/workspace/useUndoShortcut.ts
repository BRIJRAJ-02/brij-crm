// The workspace frame's keyboard (spec 0006, AC-48): Cmd+Z on Apple
// platforms and Ctrl+Z elsewhere undoes this tab's last change, and ? opens
// the shortcut list, unless the key belongs to a text field, an editor or an
// open dialog. One listener on the document while the frame is mounted.
import type { DataLayer } from '@crm/data';
import type { Toasts } from '@crm/ui';
import { useEffect, useState } from 'react';
import { belongsElsewhere, isApplePlatform, isHelpKey, isUndoKey, undoToast, type KeyTarget } from './undo.ts';

/** Whether this browser runs on macOS, iOS or iPadOS, read once. */
export function useIsApple(): boolean {
  const [isApple] = useState(() => isApplePlatform(navigator as Navigator & { userAgentData?: { platform?: string } }));
  return isApple;
}

/** Undoes the last change in the workspace and says what happened in a toast. */
export function runUndo(data: DataLayer, toasts: Toasts, slug: string): void {
  data.undo.run(slug).then(
    (result) => {
      const toast = undoToast(result);
      if (toast !== undefined) toasts.toast(toast);
    },
    // A refusal already raised its own toast in the data layer.
    () => undefined,
  );
}

/** Listens for undo and ? on the document while the frame shows `slug`; `onHelp` opens the shortcut list. */
export function useUndoShortcut(data: DataLayer, toasts: Toasts, slug: string, onHelp: () => void): void {
  const isApple = useIsApple();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      if (belongsElsewhere(target)) return;
      if (isUndoKey(event, isApple)) {
        event.preventDefault();
        runUndo(data, toasts, slug);
      } else if (isHelpKey(event)) {
        event.preventDefault();
        onHelp();
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, [data, toasts, slug, isApple, onHelp]);
}
