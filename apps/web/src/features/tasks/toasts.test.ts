// The task toasts: what they say, and what their action does.
import type { Toasts } from '@crm/ui';
import { describe, expect, it, vi } from 'vitest';
import { taskCompletedToast, taskCreatedToast, tickTask } from './toasts.ts';

/** A toast queue that keeps what it was asked to show. */
function fakeToasts() {
  const shown: ReturnType<typeof taskCompletedToast>[] = [];
  const toasts = {
    toast: (content: ReturnType<typeof taskCompletedToast>) => {
      shown.push(content);
      return 'key';
    },
    dismiss: () => undefined,
  } as unknown as Toasts;
  return { toasts, shown };
}

describe('task toasts', () => {
  it('says a task was created, with Open', () => {
    const onOpen = vi.fn();
    const toast = taskCreatedToast(onOpen);
    expect(toast).toMatchObject({ tone: 'success', message: 'Task created', action: { label: 'Open' } });
    toast.action?.onAction();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says a task was completed, with Undo', () => {
    const onUndo = vi.fn();
    const toast = taskCompletedToast(onUndo);
    expect(toast).toMatchObject({ message: 'Task completed', action: { label: 'Undo' } });
    toast.action?.onAction();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('ticks done with an Undo that ticks it open again, and unticks quietly', () => {
    const setDone = vi.fn();
    const { toasts, shown } = fakeToasts();
    tickTask(toasts, setDone, true);
    expect(setDone).toHaveBeenLastCalledWith(true);
    expect(shown).toHaveLength(1);
    shown[0]?.action?.onAction();
    expect(setDone).toHaveBeenLastCalledWith(false);
    tickTask(toasts, setDone, false);
    expect(shown).toHaveLength(1);
  });
});
