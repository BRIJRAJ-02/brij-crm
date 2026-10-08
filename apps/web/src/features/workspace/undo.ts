// Undo and the replaced notice on screen (spec 0006, milestone 1): which
// keys undo on this platform, which key presses belong to a text field or a
// dialog instead, and the words of each toast. Pure, so the node tests cover
// them; the frame and main.tsx do the listening and the raising.
import type { EditOutcome, ReplacedValue, UndoKind, UndoResult } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { strings } from './strings.ts';

/** What the platform check reads of `navigator`: User-Agent Client Hints where the browser has them. */
export interface PlatformSource {
  readonly platform?: string;
  readonly userAgentData?: { readonly platform?: string };
}

/** Whether this is macOS, iOS or iPadOS, where Cmd+Z undoes; Ctrl+Z everywhere else. */
export function isApplePlatform(source: PlatformSource): boolean {
  const platform = source.userAgentData?.platform ?? source.platform ?? '';
  return /mac|iphone|ipad|ipod|ios/i.test(platform);
}

/** A key press as the shortcut reads it. */
export interface KeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Whether a key press is undo here: Cmd+Z on Apple platforms, Ctrl+Z elsewhere, never with Shift (redo) or Alt. */
export function isUndoKey(press: KeyPress, isApple: boolean): boolean {
  if (press.key.toLowerCase() !== 'z' || press.shiftKey || press.altKey) return false;
  return isApple ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
}

/** Whether a key press asks for the shortcut list: ? with no Cmd, Ctrl or Alt. */
export function isHelpKey(press: KeyPress): boolean {
  return press.key === '?' && !press.metaKey && !press.ctrlKey && !press.altKey;
}

/** What the shortcut reads of a key press's target (an Element in the browser). */
export interface KeyTarget {
  readonly isContentEditable?: boolean;
  readonly closest: (selector: string) => unknown;
}

/** Text fields and editors keep their own undo; a selector for them and anything inside one. */
const TEXT_FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** The library's Modal renders a React Aria dialog; focus stays inside it while it is open. */
const DIALOGS = '[role="dialog"], [role="alertdialog"]';

/**
 * Whether a key press belongs to something else: a text field or an editor
 * (their own undo wins), or anything inside an open dialog.
 */
export function belongsElsewhere(target: KeyTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  return target.closest(TEXT_FIELDS) !== null || target.closest(DIALOGS) !== null;
}

/** Undo's keycaps for the shortcut list, written as ShortcutHelp takes them. */
export function undoKeys(isApple: boolean): readonly string[] {
  return isApple ? ['⌘', 'Z'] : ['Ctrl', 'Z'];
}

/** What an action undid, in words: the cell, or the paste or clear and how many cells. */
function undidWords(result: Extract<UndoResult, { kind: 'undone' }>): string {
  if (result.action === 'paste') return strings.undidPaste(result.cells);
  if (result.action === 'clear') return strings.undidClear(result.cells);
  if (result.cells > 1) return strings.undidCells(result.cells);
  return strings.undidCell(result.attributeTitle, result.first.recordName);
}

/**
 * The toast after an undo (AC-48, AC-49): what it undid, and how many cells
 * it kept because they changed since; "Nothing to undo." when the stack is
 * empty. Nothing when every cell was refused for another reason: those
 * already raised their own toast.
 */
export function undoToast(result: UndoResult): ToastContent | undefined {
  if (result.kind === 'nothing') return { tone: 'success', message: strings.nothingToUndo };
  const kept = result.kept > 0 ? strings.keptSince(result.kept) : undefined;
  if (result.undone === 0) return kept === undefined ? undefined : { tone: 'success', message: kept };
  const undid = undidWords(result);
  return { tone: 'success', message: kept === undefined ? undid : `${undid}. ${kept}` };
}

/**
 * The toast after an edit of several cells lands (AC-48, AC-50): "Pasted into
 * 40 cells" with Undo; a paste too big for one write says so. Nothing for one
 * cell, or when nothing landed (the refusal toast covers that).
 */
export function editToast(outcome: EditOutcome, kind: UndoKind, onUndo: () => void): ToastContent | undefined {
  if (outcome.kind === 'too-many') return { tone: 'danger', message: strings.pasteTooBig(outcome.limit) };
  if (outcome.cells <= 1 || outcome.landed === 0) return undefined;
  const message = kind === 'clear' ? strings.cleared(outcome.landed) : strings.pasted(outcome.landed);
  return { tone: 'success', message, action: { label: strings.undo, onAction: onUndo } };
}

/** Whether a grid's change of several cells clears them all (a range clear) rather than pasting. */
export function isClear(values: readonly unknown[]): boolean {
  return values.every((value) => value === null || (Array.isArray(value) && value.length === 0));
}

/**
 * The "your value was replaced" toast (AC-46): who changed what on which
 * record just after the person, with Use mine. It stays until dismissed.
 */
export function replacedToast(replaced: ReplacedValue): ToastContent {
  const who =
    replaced.by.kind === 'api_key'
      ? strings.anApiKey
      : replaced.by.kind === 'automation'
        ? strings.anAutomation
        : replaced.by.name === undefined || replaced.by.name === ''
          ? strings.someone
          : replaced.by.name;
  return {
    tone: 'danger',
    message: strings.replaced(who, replaced.attributeTitle, replaced.others, replaced.recordName),
    action: { label: strings.useMine, onAction: replaced.useMine },
  };
}
