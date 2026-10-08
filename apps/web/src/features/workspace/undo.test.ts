// Undo and the replaced notice on screen (spec 0006, AC-46, AC-48, AC-50):
// Cmd+Z on Apple platforms and Ctrl+Z elsewhere, ignored in text fields,
// editors and dialogs, and the words of each toast.
import type { ReplacedValue, UndoResult } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  belongsElsewhere,
  editToast,
  isApplePlatform,
  isClear,
  isHelpKey,
  isUndoKey,
  replacedToast,
  undoKeys,
  undoToast,
  type KeyTarget,
} from './undo.ts';

const press = (
  key: string,
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

/** A key target matching the given selectors' parts, as Element.closest would. */
const target = (inside: readonly string[], isContentEditable = false): KeyTarget => ({
  isContentEditable,
  closest: (selector) => (inside.some((part) => selector.includes(part)) ? {} : null),
});

describe('the undo shortcut', () => {
  it('reads the platform from client hints first, then navigator.platform', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true);
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPad' })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false);
    expect(isApplePlatform({ platform: 'Linux x86_64' })).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });

  it('is Cmd+Z on an Apple platform and Ctrl+Z elsewhere, never with Shift or Alt', () => {
    expect(isUndoKey(press('z', { metaKey: true }), true)).toBe(true);
    expect(isUndoKey(press('Z', { metaKey: true }), true)).toBe(true);
    expect(isUndoKey(press('z', { ctrlKey: true }), true)).toBe(false);
    expect(isUndoKey(press('z', { ctrlKey: true }), false)).toBe(true);
    expect(isUndoKey(press('z', { metaKey: true }), false)).toBe(false);
    expect(isUndoKey(press('z', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isUndoKey(press('z', { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isUndoKey(press('y', { ctrlKey: true }), false)).toBe(false);
    expect(undoKeys(true)).toEqual(['⌘', 'Z']);
    expect(undoKeys(false)).toEqual(['Ctrl', 'Z']);
  });

  it('leaves a text field, an editor and anything in an open dialog their own keys', () => {
    expect(belongsElsewhere(null)).toBe(false);
    expect(belongsElsewhere(target([]))).toBe(false);
    expect(belongsElsewhere(target(['input']))).toBe(true);
    expect(belongsElsewhere(target(['textarea']))).toBe(true);
    expect(belongsElsewhere(target([], true))).toBe(true);
    expect(belongsElsewhere(target(['contenteditable']))).toBe(true);
    expect(belongsElsewhere(target(['role="dialog"']))).toBe(true);
    expect(belongsElsewhere(target(['role="alertdialog"']))).toBe(true);
  });

  it('opens the shortcut list on ?', () => {
    expect(isHelpKey(press('?', { shiftKey: true }))).toBe(true);
    expect(isHelpKey(press('?', { metaKey: true }))).toBe(false);
  });
});

describe('the undo toast', () => {
  const undone = (more: Partial<Extract<UndoResult, { kind: 'undone' }>>): UndoResult => ({
    kind: 'undone',
    action: 'cell',
    objectId: 'people',
    cells: 1,
    undone: 1,
    kept: 0,
    failed: 0,
    first: { recordId: 'r1', attributeId: 'email', recordName: 'Jane Doe' },
    attributeTitle: 'Email',
    ...more,
  });

  it('names the one cell, the paste or the clear it undid, and the cells it kept', () => {
    expect(undoToast(undone({}))).toEqual({ tone: 'success', message: 'Undid Email on Jane Doe' });
    expect(undoToast(undone({ action: 'paste', cells: 40, undone: 40 }))?.message).toBe(
      'Undid the paste into 40 cells',
    );
    expect(undoToast(undone({ action: 'clear', cells: 6, undone: 6 }))?.message).toBe('Undid the clear of 6 cells');
    expect(undoToast(undone({ action: 'paste', cells: 40, undone: 38, kept: 2 }))?.message).toBe(
      'Undid the paste into 40 cells. 2 cells were changed since, so they were kept.',
    );
    expect(undoToast(undone({ undone: 0, kept: 1 }))?.message).toBe('1 cell was changed since, so it was kept.');
    expect(undoToast({ kind: 'nothing' })?.message).toBe('Nothing to undo.');
    // Refused for another reason: that refusal already raised its own toast.
    expect(undoToast(undone({ undone: 0, failed: 1 }))).toBeUndefined();
  });
});

describe('the edit toast (AC-48, AC-50)', () => {
  it('offers Undo once a paste or clear of several cells lands, and refuses one too big', () => {
    const onUndo = () => undefined;
    expect(editToast({ kind: 'done', cells: 40, landed: 40 }, 'paste', onUndo)).toEqual({
      tone: 'success',
      message: 'Pasted into 40 cells',
      action: { label: 'Undo', onAction: onUndo },
    });
    expect(editToast({ kind: 'done', cells: 6, landed: 4 }, 'clear', onUndo)?.message).toBe('Cleared 4 cells');
    expect(editToast({ kind: 'done', cells: 1, landed: 1 }, 'cell', onUndo)).toBeUndefined();
    expect(editToast({ kind: 'done', cells: 6, landed: 0 }, 'paste', onUndo)).toBeUndefined();
    expect(editToast({ kind: 'too-many', limit: 500 }, 'paste', onUndo)).toEqual({
      tone: 'danger',
      message: 'Paste into at most 500 records at once.',
    });
    expect(isClear([null, [], null])).toBe(true);
    expect(isClear([null, 'x'])).toBe(false);
  });
});

describe('the replaced notice (AC-46)', () => {
  const replaced = (by: ReplacedValue['by'], others = 0): ReplacedValue => ({
    workspace: 'acme',
    recordId: 'r1',
    recordName: 'Jane Doe',
    attributeTitle: 'Email',
    others,
    by,
    useMine: () => undefined,
  });

  it('says who replaced which value on which record, with Use mine', () => {
    const toast = replacedToast(replaced({ kind: 'member', name: 'Bea' }));
    expect(toast.message).toBe('Bea changed Email on Jane Doe just after you, so your value was replaced.');
    expect(toast.action?.label).toBe('Use mine');
    expect(replacedToast(replaced({ kind: 'member', name: 'Bea' }, 2)).message).toBe(
      'Bea changed Email and 2 more on Jane Doe just after you, so your values were replaced.',
    );
    expect(replacedToast(replaced({ kind: 'api_key' })).message).toMatch(/^An API key changed/);
    expect(replacedToast(replaced({ kind: 'automation' })).message).toMatch(/^An automation changed/);
    expect(replacedToast(replaced({ kind: 'member', name: undefined })).message).toMatch(/^Someone changed/);
  });
});
