// The toasts a task's create and tick raise: "Task created" with Open, and
// "Task completed" with Undo (the owner's flow pass, 30 Oct 2026). Kept apart
// from the screens, so the node tests cover them.
import type { ToastContent, Toasts } from '@crm/ui';
import { strings } from './strings.ts';
import { UNDO_MS } from './undo-delete.ts';

/** "Task created", with Open to its dialog. */
export function taskCreatedToast(onOpen: () => void): ToastContent {
  return { tone: 'success', message: strings.taskCreated, action: { label: strings.openTask, onAction: onOpen } };
}

/** "Task completed", with Undo, which ticks it open again. */
export function taskCompletedToast(onUndo: () => void): ToastContent {
  return { tone: 'success', message: strings.taskCompleted, action: { label: strings.undo, onAction: onUndo } };
}

/**
 * Ticks a task done or open through `setDone`; ticked done, the toast offers
 * Undo for 10 seconds. Unticking says nothing: the row shows it.
 */
export function tickTask(toasts: Toasts, setDone: (isDone: boolean) => unknown, isDone: boolean): void {
  void setDone(isDone);
  if (!isDone) return;
  toasts.toast(
    taskCompletedToast(() => {
      void setDone(false);
    }),
    { timeout: UNDO_MS },
  );
}
