// The grid's keys as the shortcut list shows them, kept beside the grid so the
// list and the keyboard model in DataGrid.tsx change together. Plain data in
// the main entry, so a frame can list them without loading the grid.
import type { ShortcutGroup } from '../ShortcutHelp/ShortcutHelp.tsx';
import { strings } from './strings.ts';

/** "In the table": the DataGrid's keys, written with Mac symbols as ShortcutHelp takes them (Kbd shows Ctrl elsewhere). */
export const GRID_SHORTCUTS: ShortcutGroup = {
  title: strings.shortcutsTitle,
  shortcuts: [
    { label: strings.shortcutMove, keys: ['↑', '↓', '←', '→'] },
    { label: strings.shortcutEdit, keys: ['↵'] },
    { label: strings.shortcutCancel, keys: ['ESC'] },
    { label: strings.shortcutClear, keys: ['⌫'] },
    { label: strings.shortcutTick, keys: ['SPACE'] },
    { label: strings.shortcutRange, keys: ['⇧', '↓'] },
    { label: strings.shortcutAll, keys: ['⌘', 'A'] },
    { label: strings.shortcutCopy, keys: ['⌘', 'C'] },
    { label: strings.shortcutPaste, keys: ['⌘', 'V'] },
    { label: strings.shortcutLink, keys: ['⌘', '↵'] },
    { label: strings.shortcutMenu, keys: ['⌥', '↓'] },
    { label: strings.shortcutResize, keys: ['⌥', '←', '→'] },
  ],
};
