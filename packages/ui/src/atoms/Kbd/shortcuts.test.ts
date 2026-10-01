// Keycaps show symbols to sight; aria-keyshortcuts names the same keys for
// screen readers, so a button's name stays its label (AC-6).
import { describe, expect, it } from 'vitest';
import { keycapText, keyShortcuts } from './shortcuts.ts';

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

describe('on keyboards that are not a Mac', () => {
  it.each([
    ['⌘K', 'Ctrl+K'],
    ['⇧⌘P', 'Shift+Ctrl+P'],
    ['⌘↵', 'Ctrl+↵'],
    ['⌥↑', 'Alt+↑'],
    ['ESC', 'ESC'],
    ['↵', '↵'],
  ])('shows %s as %s', (cap, expected) => {
    expect(keycapText(cap, 'other')).toBe(expected);
    expect(keycapText(cap, 'mac')).toBe(cap);
  });

  it('names ⌘ as Control for screen readers', () => {
    expect(keyShortcuts(['⌘↵'], 'other')).toBe('Control+Enter');
    expect(keyShortcuts(['⌘↵'], 'mac')).toBe('Meta+Enter');
  });
});
