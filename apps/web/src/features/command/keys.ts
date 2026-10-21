// The command menu's keys (spec 0039, AC-1071): ⌘K (Ctrl+K elsewhere) from
// anywhere in a workspace, text fields included, and pressed again it closes
// the menu; `/` opens it in search mode, but never from a text field, an
// editor or a dialog, which keep their slash. Pure, so the node tests cover it.
import type { KeyboardPlatform } from '@crm/ui';
import { belongsElsewhere, type KeyPress, type KeyTarget } from '../workspace/undo.ts';
import type { CommandMode } from './commands.ts';

/** The command menu's keycaps for the shortcut list, with Mac symbols (Kbd shows Ctrl elsewhere). */
export const COMMAND_MENU_KEYS: readonly string[] = ['⌘', 'K'];
/** Search's keycap. */
export const SEARCH_KEYS: readonly string[] = ['/'];

/** Whether a key press is ⌘K on a Mac keyboard, Ctrl+K on any other, with no Shift or Alt, never a held key's repeats. */
export function isCommandMenuKey(press: KeyPress, platform: KeyboardPlatform): boolean {
  if (press.key.toLowerCase() !== 'k' || press.shiftKey || press.altKey || press.repeat === true) return false;
  return platform === 'mac' ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
}

/** Whether a key press is `/` with no Cmd, Ctrl or Alt. */
export function isSearchKey(press: KeyPress): boolean {
  return press.key === '/' && !press.metaKey && !press.ctrlKey && !press.altKey && press.repeat !== true;
}

/** Whether a target sits inside a dialog (the menu's own, or another). */
function inDialog(target: KeyTarget | null): boolean {
  if (target === null) return false;
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
  return dialog !== null && dialog !== undefined;
}

/**
 * What a key press does to the menu: `open` in commands mode (⌘K), `close` (⌘K again),
 * `open` in search mode (`/` outside text fields, editors and
 * dialogs, when closed), or nothing. ⌘K from inside another dialog does
 * nothing, so the menu never stacks on a dialog the person is in.
 */
export function commandKey(
  press: KeyPress,
  target: KeyTarget | null,
  platform: KeyboardPlatform,
  isOpen: boolean,
): { readonly kind: 'close' } | { readonly kind: 'open'; readonly mode: CommandMode } | undefined {
  if (isCommandMenuKey(press, platform)) {
    if (isOpen) return { kind: 'close' };
    return inDialog(target) ? undefined : { kind: 'open', mode: 'commands' };
  }
  if (!isOpen && isSearchKey(press) && !belongsElsewhere(target)) return { kind: 'open', mode: 'search' };
  return undefined;
}
