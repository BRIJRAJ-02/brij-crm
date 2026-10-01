// Shortcuts are written once, with Mac symbols (⌘K, ⇧⌘P). On other platforms
// the keycaps show Ctrl, Shift and Alt instead, and aria-keyshortcuts names
// Control rather than Meta, so one shortcut reads right everywhere.

/** Which keyboard the viewer has: `mac` shows ⌘ ⇧ ⌥, `other` shows Ctrl, Shift and Alt. */
export type KeyboardPlatform = 'mac' | 'other';

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

// What the modifier symbols become on a keyboard that isn't a Mac's.
const OTHER_MODIFIERS: Readonly<Record<string, string>> = {
  '⌘': 'Ctrl',
  '⌃': 'Ctrl',
  '⇧': 'Shift',
  '⌥': 'Alt',
};

// Keycap symbols are single code points, so a code point split is enough.
function charactersOf(cap: string): readonly string[] {
  return cap.match(/./gu) ?? [];
}

/**
 * The text a keycap shows on this platform: `⌘K` stays `⌘K` on a Mac and
 * becomes `Ctrl+K` elsewhere; `⇧⌘P` becomes `Shift+Ctrl+P`. Caps without
 * modifiers (`ESC`, `↵`) are the same everywhere.
 */
export function keycapText(cap: string, platform: KeyboardPlatform): string {
  if (platform === 'mac') return cap;
  const characters = charactersOf(cap);
  if (!characters.some((character) => character in OTHER_MODIFIERS)) return cap;
  const keys: string[] = [];
  let rest = '';
  for (const character of characters) {
    const modifier = OTHER_MODIFIERS[character];
    if (modifier === undefined) rest += character;
    else keys.push(modifier);
  }
  return [...keys, ...(rest === '' ? [] : [rest])].join('+');
}

/**
 * The `aria-keyshortcuts` value for keycaps showing one shortcut: `['⌘↵']`
 * gives `Meta+Enter` on a Mac and `Control+Enter` elsewhere, `['ESC']` gives
 * `Escape`. A control shows its keycaps to sight and states its shortcut this
 * way, so a screen reader hears "Cancel", not "Cancel ESC".
 */
export function keyShortcuts(caps: readonly string[], platform: KeyboardPlatform = 'mac'): string {
  const keys = caps.flatMap((cap) => {
    const word = WORD_NAMES[cap.toUpperCase()];
    if (word !== undefined) return [word];
    return charactersOf(cap).map((character) => {
      if (character === '⌘' && platform === 'other') return 'Control';
      return KEY_NAMES[character] ?? character.toUpperCase();
    });
  });
  return keys.join('+');
}
