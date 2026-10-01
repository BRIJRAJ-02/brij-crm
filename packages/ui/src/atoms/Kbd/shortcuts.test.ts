// Keycaps show symbols to sight; aria-keyshortcuts names the same keys for
// screen readers, so a button's name stays its label (AC-6).
import { describe, expect, it } from 'vitest';
import { keyShortcuts } from './shortcuts.ts';

describe('keyShortcuts', () => {
  it.each([
    [['ESC'], 'Escape'],
    [['⌘↵'], 'Meta+Enter'],
    [['⌘K'], 'Meta+K'],
    [['⌘', 'K'], 'Meta+K'],
    [['⇧⌘P'], 'Shift+Meta+P'],
    [['/'], '/'],
    [['↑'], 'ArrowUp'],
  ])('names %j as %s', (caps, expected) => {
    expect(keyShortcuts(caps)).toBe(expected);
  });
});
