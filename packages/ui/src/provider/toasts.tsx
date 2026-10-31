// With ToastRegion.tsx, the only files that touch React Aria's toast, still
// UNSTABLE_ in 1.21, so its rename changes these two only. The queue is made by
// createToasts() and handed to UiProvider and the data layer; ToastRegion draws
// it. Nothing here lives at module level.
import { flushSync } from 'react-dom';
import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';

/** How long a confirmation stays. Toasts with an action stay until dismissed. */
export const TOAST_TIMEOUT_MS = 5_000;

/** How long an error with no action stays: longer than a confirmation, since it asks to be read. */
export const ERROR_TOAST_TIMEOUT_MS = 8_000;

/** At most this many toasts show at once; the rest wait their turn. */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * A toast's colour and icon: `success` for confirmations, `danger` for
 * errors, `info` for news about something someone else did ("Bea changed the
 * filters on this view.") or a quiet notice.
 */
export type ToastTone = 'success' | 'danger' | 'info';

/** An action a toast offers, such as Undo. A toast with one stays until dismissed. */
export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

/** What a toast says. `message` is one sentence: past tense for a confirmation, what failed and what to do for an error. */
export interface ToastContent {
  readonly tone: ToastTone;
  readonly message: string;
  readonly action?: ToastAction;
  /**
   * Work under way (an export being written): a spinner in the icon's place, and it stays until the screen
   * dismisses it, usually for the toast that says how the work ended.
   */
  readonly isBusy?: boolean;
}

/** How long one toast stays, when its kind's rule isn't the one wanted. */
export interface ToastOptions {
  readonly timeout?: number;
}

/** The app's toasts: raise and dismiss them, and the queue the region draws. Made once in main.tsx. */
export interface Toasts {
  /**
   * Shows a toast and returns its key. `timeout` (milliseconds) gives a toast
   * with an action a life of its own (an Undo that lasts 10 seconds); like
   * every timer here it pauses while the toast is hovered or focused.
   */
  readonly toast: (content: ToastContent, options?: ToastOptions) => string;
  /** Closes the toast with this key. */
  readonly dismiss: (key: string) => void;
  /** The queue ToastRegion draws from. */
  readonly queue: ToastQueue<ToastContent>;
}

/**
 * How long a toast stays: confirmations 5 seconds, errors 8, both paused while
 * hovered or focused; a toast with an action (Undo, Retry, Use mine) until
 * dismissed, so its action can't vanish before it is reached.
 */
export function toastTimeout(content: ToastContent): number | undefined {
  if (content.action !== undefined || content.isBusy === true) return undefined;
  return content.tone === 'danger' ? ERROR_TOAST_TIMEOUT_MS : TOAST_TIMEOUT_MS;
}

/**
 * Runs a change to the toasts as a view transition, so a toast rises in and
 * the others slide to make room (the CSS is in the base layer). Browsers
 * without view transitions, and reduced motion, just change.
 */
function withViewTransition(update: () => void): void {
  const canTransition = typeof document !== 'undefined' && 'startViewTransition' in document;
  if (!canTransition || globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  // A newer change starting before this one finished skips its animation: the
  // update still runs, but `ready` and `finished` reject with an AbortError
  // nobody waits for. Those rejections are expected, so they are let go.
  const letGo = (): void => undefined;
  transition.ready.catch(letGo);
  transition.finished.catch(letGo);
}

/** Makes the app's toast queue: at most three at once, each timed by `toastTimeout`. Timers pause while hovered or focused. */
export function createToasts(): Toasts {
  const queue = new ToastQueue<ToastContent>({ maxVisibleToasts: MAX_VISIBLE_TOASTS, wrapUpdate: withViewTransition });
  return {
    toast: (content, options) => {
      const timeout = options?.timeout ?? toastTimeout(content);
      return queue.add(content, timeout === undefined ? {} : { timeout });
    },
    dismiss: (key) => {
      queue.close(key);
    },
    queue,
  };
}
