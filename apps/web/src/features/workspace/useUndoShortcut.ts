// The workspace frame's keyboard (spec 0006, AC-48): Cmd+Z on Apple
// platforms and Ctrl+Z elsewhere undoes this tab's last change, and ? opens
// the shortcut list, unless the key belongs to a text field, an editor or an
// open dialog. One listener on the document while the frame is mounted.
import type { DataLayer } from '@crm/data';
import { useKeyboardPlatform, type Toasts } from '@crm/ui';
import { useEffect } from 'react';
import { strings } from './strings.ts';
import { belongsElsewhere, isHelpKey, isUndoKey, undoToast, type KeyTarget } from './undo.ts';

/**
 * Undoes the last change in the workspace (with `only`, that action alone,
 * while it is the newest) and says what happened in a toast.
 */
export function runUndo(data: DataLayer, toasts: Toasts, slug: string, only?: string): void {
  data.undo.run(slug, only).then(
    (result) => {
      const toast = undoToast(result);
      if (toast !== undefined) toasts.toast(toast);
    },
    // A refused write already raised its own toast in the data layer; this is the layer failing to load.
    () => {
      toasts.toast({ tone: 'danger', message: strings.somethingWrong });
    },
  );
}

/** Listens for undo and ? on the document while the frame shows `slug`; `onHelp` opens the shortcut list. */
export function useUndoShortcut(data: DataLayer, toasts: Toasts, slug: string, onHelp: () => void): void {
  const platform = useKeyboardPlatform();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      if (belongsElsewhere(target)) return;
      if (isUndoKey(event, platform)) {
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
  }, [data, toasts, slug, platform, onHelp]);
}
