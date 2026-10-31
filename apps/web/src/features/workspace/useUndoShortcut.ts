// The workspace frame's keyboard (spec 0006, AC-48): Cmd+Z on Apple
// platforms and Ctrl+Z elsewhere undoes this tab's last change, and ? opens
// the shortcut list, unless the key belongs to a text field, an editor or an
// open dialog; Cmd+, (Ctrl+,) opens Settings (spec 0026) on the same terms.
// One listener on the document while the frame is mounted.
import type { DataLayer } from '@crm/data';
import { sharedStrings, type Toasts, useKeyboardPlatform } from '@crm/ui';
import { useEffect } from 'react';
import { belongsElsewhere, isHelpKey, isSettingsKey, isUndoKey, undoToast, type KeyTarget } from './undo.ts';

/**
 * Undoes the last change in the workspace (with `only`, that action alone,
 * while it is the newest) and says what happened in a toast.
 */
export function runUndo(data: DataLayer, toasts: Toasts, slug: string, only?: string): void {
  data.undo.run(slug, only).then(
    async (result) => {
      // A bulk edit undone is said in its object's words, as its own toast said it ("Undid the edit of 2 people.").
      const names =
        result.kind === 'undone' && result.action === 'bulk'
          ? (await data.objects.list(slug).catch(() => [])).find((object) => object.id === result.objectId)
          : undefined;
      const toast = undoToast(result, names);
      if (toast !== undefined) toasts.toast(toast);
    },
    // A refused write already raised its own toast in the data layer; this is the layer failing to load.
    () => {
      toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
    },
  );
}

/** Listens for undo, ? and ⌘, on the document while the frame shows `slug`; `onHelp` opens the shortcut list, `onSettings` Settings. */
export function useUndoShortcut(
  data: DataLayer,
  toasts: Toasts,
  slug: string,
  onHelp: () => void,
  onSettings: () => void,
): void {
  const platform = useKeyboardPlatform();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      if (belongsElsewhere(target)) return;
      // A text field, an editor (a draft in a cell) or a dialog keeps its keys, so ⌘, never leaves one behind.
      if (isSettingsKey(event, platform)) {
        event.preventDefault();
        onSettings();
      } else if (isUndoKey(event, platform)) {
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
  }, [data, toasts, slug, platform, onHelp, onSettings]);
}
