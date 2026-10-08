// Undo and the replaced notice on screen (spec 0006, milestone 1): which
// keys undo on this platform, which key presses belong to a text field or a
// dialog instead, and the words of each toast. Pure, so the node tests cover
// them; the frame and main.tsx do the listening and the raising.
import type { EditOutcome, ReplacedValue, UndoKind, UndoResult } from '@crm/data';
import type { KeyboardPlatform, ToastContent } from '@crm/ui';
import { strings } from './strings.ts';

/** A key press as the shortcut reads it. */
export interface KeyPress {
  readonly key: string;
  /** Held down: the browser repeats it, and an undo must not fire once per repeat. */
  readonly repeat?: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a key press is undo here: Cmd+Z on a Mac keyboard, Ctrl+Z on any
 * other (`useKeyboardPlatform`, the platform every Kbd shows), never with
 * Shift (redo) or Alt, and never a held key's repeats.
 */
export function isUndoKey(press: KeyPress, platform: KeyboardPlatform): boolean {
  if (press.key.toLowerCase() !== 'z' || press.shiftKey || press.altKey || press.repeat === true) return false;
  return platform === 'mac' ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
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
/** Each toast is an alertdialog too, but no modal: undo still answers from a toast's buttons. */
const TOASTS = '[data-toast-region]';

/**
 * Whether a key press belongs to something else: a text field or an editor
 * (their own undo wins), or anything inside an open dialog.
 */
export function belongsElsewhere(target: KeyTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  if (target.closest(TEXT_FIELDS) !== null) return true;
  return target.closest(DIALOGS) !== null && target.closest(TOASTS) === null;
}

/** Undo's keycaps for the shortcut list, with Mac symbols as ShortcutHelp takes them (Kbd shows Ctrl elsewhere). */
export const UNDO_KEYS: readonly string[] = ['⌘', 'Z'];

/** A count in the browser's language ("1,500"), as the grid writes its own. */
const count = (value: number): string => new Intl.NumberFormat().format(value);

/** What an action undid, in words: the cell, or the paste or clear and how many cells. */
function undidWords(result: Extract<UndoResult, { kind: 'undone' }>): string {
  if (result.action === 'paste') return strings.undidPaste(count(result.cells));
  if (result.action === 'clear') return strings.undidClear(count(result.cells));
  if (result.cells > 1) return strings.undidCells(count(result.cells));
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
  // A toast's Undo whose change is no longer the newest: nothing was done, and the newer changes come first.
  if (result.kind === 'stale') return { tone: 'danger', message: strings.undoStale };
  const kept = result.kept > 0 ? strings.keptSince(result.kept, count(result.kept)) : undefined;
  if (result.undone === 0) return kept === undefined ? undefined : { tone: 'success', message: kept };
  const undid = undidWords(result);
  return { tone: 'success', message: kept === undefined ? undid : `${undid}. ${kept}` };
}

/**
 * The toast after an edit of several cells lands (AC-48, AC-50): "Pasted into
 * 40 cells" with Undo; a paste too big for one write says so. Nothing for one
 * cell, or when nothing landed (the refusal toast covers that).
 */
export function editToast(
  outcome: EditOutcome,
  kind: UndoKind,
  onUndo: (undoId: string) => void,
): ToastContent | undefined {
  if (outcome.kind === 'too-many') return { tone: 'danger', message: strings.pasteTooMany(count(outcome.limit)) };
  if (outcome.kind === 'too-big') return { tone: 'danger', message: strings.pasteTooBig };
  if (outcome.cells <= 1 || outcome.landed === 0 || outcome.undoId === undefined) return undefined;
  const { undoId } = outcome;
  const message = kind === 'clear' ? strings.cleared(count(outcome.landed)) : strings.pasted(count(outcome.landed));
  // The toast's Undo undoes this action only, and only while it is the newest.
  return {
    tone: 'success',
    message,
    action: {
      label: strings.undo,
      onAction: () => {
        onUndo(undoId);
      },
    },
  };
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
