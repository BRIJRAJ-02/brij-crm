// A panel's ↑ and ↓: they step only where nothing else owns the arrows.
import { describe, expect, it } from 'vitest';
import { stepOf, type StepKey, type StepTarget } from './step-keys.ts';

const press = (key: string, overrides: Partial<StepKey> = {}): StepKey => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...overrides,
});

const element = (tagName: string, role: string | null = null, isContentEditable = false): StepTarget => ({
  tagName,
  role,
  isContentEditable,
});

const button = [element('BUTTON'), element('DIV', 'dialog')];

describe('stepOf', () => {
  it('steps up and down from a button in the panel', () => {
    expect(stepOf(press('ArrowUp'), button)).toBe('previous');
    expect(stepOf(press('ArrowDown'), button)).toBe('next');
  });

  it('ignores other keys and any modifier', () => {
    expect(stepOf(press('ArrowLeft'), button)).toBeUndefined();
    expect(stepOf(press('ArrowDown', { shiftKey: true }), button)).toBeUndefined();
    expect(stepOf(press('ArrowDown', { metaKey: true }), button)).toBeUndefined();
    expect(stepOf(press('ArrowDown', { defaultPrevented: true }), button)).toBeUndefined();
  });

  it('leaves the arrows to typing, tabs, lists and menus', () => {
    expect(stepOf(press('ArrowDown'), [element('INPUT')])).toBeUndefined();
    expect(stepOf(press('ArrowDown'), [element('TEXTAREA')])).toBeUndefined();
    expect(stepOf(press('ArrowDown'), [element('P', null, true)])).toBeUndefined();
    expect(stepOf(press('ArrowDown'), [element('BUTTON', 'tab'), element('DIV', 'tablist')])).toBeUndefined();
    expect(stepOf(press('ArrowDown'), [element('DIV'), element('DIV', 'listbox')])).toBeUndefined();
    expect(stepOf(press('ArrowUp'), [element('DIV', 'menuitem')])).toBeUndefined();
    expect(stepOf(press('ArrowDown'), [element('DIV', 'tabpanel')])).toBeUndefined();
  });

  it('steps from a button inside a tab’s panel', () => {
    expect(stepOf(press('ArrowDown'), [element('BUTTON'), element('DIV', 'tabpanel')])).toBe('next');
  });
});
