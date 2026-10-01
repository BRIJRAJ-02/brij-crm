// The names aria-keyshortcuts uses for the symbols keycaps show.
const KEY_NAMES: Readonly<Record<string, string>> = {
  '⌘': 'Meta',
  '⇧': 'Shift',
  '⌥': 'Alt',
  '⌃': 'Control',
  '↵': 'Enter',
  '⌫': 'Backspace',
  '⇥': 'Tab',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
};

const WORD_NAMES: Readonly<Record<string, string>> = {
  ESC: 'Escape',
  ENTER: 'Enter',
  TAB: 'Tab',
  SPACE: 'Space',
  DEL: 'Delete',
};

/**
 * The `aria-keyshortcuts` value for keycaps showing one shortcut: `['⌘↵']`
 * gives `Meta+Enter`, `['ESC']` gives `Escape`, `['⌘', 'K']` gives `Meta+K`.
 * A control shows its keycaps to sight and states its shortcut this way, so a
 * screen reader hears "Cancel", not "Cancel ESC".
 */
export function keyShortcuts(caps: readonly string[]): string {
  const keys = caps.flatMap((cap) => {
    const word = WORD_NAMES[cap.toUpperCase()];
    if (word !== undefined) return [word];
    // Keycap symbols are single code points, so a code point split is enough.
    return (cap.match(/./gu) ?? []).map((character) => KEY_NAMES[character] ?? character.toUpperCase());
  });
  return keys.join('+');
}
