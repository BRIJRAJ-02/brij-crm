// AC-13: confirmations leave after 5 seconds, errors and toasts with an action
// stay until dismissed, and at most three show at once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToasts, MAX_VISIBLE_TOASTS, TOAST_TIMEOUT_MS, toastTimeout } from './toasts.tsx';

describe('toastTimeout', () => {
  it('gives a confirmation 5 seconds', () => {
    expect(toastTimeout({ tone: 'success', message: 'Record added' })).toBe(TOAST_TIMEOUT_MS);
    expect(TOAST_TIMEOUT_MS).toBe(5_000);
  });

  it('keeps an error until it is dismissed', () => {
    expect(toastTimeout({ tone: 'danger', message: "Couldn't save. Try again." })).toBeUndefined();
  });

  it('keeps a toast with an action until it is dismissed', () => {
    const action = { label: 'Undo', onAction: () => undefined };
    expect(toastTimeout({ tone: 'success', message: 'Record deleted', action })).toBeUndefined();
  });
});

describe('createToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows at most three toasts and queues the rest', () => {
    const toasts = createToasts();
    for (const n of [1, 2, 3, 4, 5]) toasts.toast({ tone: 'danger', message: `Error ${String(n)}` });
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(toasts.queue.visibleToasts).toHaveLength(3);
    const [first] = toasts.queue.visibleToasts;
    if (first === undefined) throw new Error('expected a visible toast');
    toasts.dismiss(first.key);
    expect(toasts.queue.visibleToasts).toHaveLength(3);
    expect(toasts.queue.visibleToasts.map((toast) => toast.content.message)).toContain('Error 4');
  });

  it('closes a confirmation after 5 seconds, and leaves an error', () => {
    const toasts = createToasts();
    const unsubscribe = toasts.queue.subscribe(() => undefined);
    toasts.toast({ tone: 'success', message: 'Record added' });
    toasts.toast({ tone: 'danger', message: "Couldn't import 3 rows." });
    for (const toast of toasts.queue.visibleToasts) toast.timer?.resume();
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    expect(toasts.queue.visibleToasts.map((toast) => toast.content.message)).toEqual(["Couldn't import 3 rows."]);
    unsubscribe();
  });

  it('keeps each queue to itself, with nothing shared at module level', () => {
    const one = createToasts();
    const two = createToasts();
    one.toast({ tone: 'danger', message: 'Only in one' });
    expect(two.queue.visibleToasts).toHaveLength(0);
  });
});
