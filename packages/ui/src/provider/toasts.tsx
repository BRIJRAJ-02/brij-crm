// The one file that touches React Aria's toast, still UNSTABLE_ in 1.21, so its
// rename changes this file only. The queue is made by createToasts() and handed
// to UiProvider and the data layer; nothing here lives at module level.
import { flushSync } from 'react-dom';
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
} from 'react-aria-components';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import '../lib/custom-properties.ts';
import { strings } from './strings.ts';
import styles from './Toast.module.css';

/** How long a confirmation stays. Toasts with an action stay until dismissed. */
export const TOAST_TIMEOUT_MS = 5_000;

/** Each tone's icon. */
const TONE_ICONS = { success: 'circle-check', danger: 'circle-alert', info: 'info' } as const;

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
}

/** The app's toasts: raise and dismiss them, and the queue the region draws. Made once in main.tsx. */
export interface Toasts {
  /** Shows a toast and returns its key. */
  readonly toast: (content: ToastContent) => string;
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
  if (content.action !== undefined) return undefined;
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
    toast: (content) => {
      const timeout = toastTimeout(content);
      return queue.add(content, timeout === undefined ? {} : { timeout });
    },
    dismiss: (key) => {
      queue.close(key);
    },
    queue,
  };
}

/** Draws the toasts at the bottom right. UiProvider renders it once; screens never do. */
export function ToastRegion({ toasts }: { readonly toasts: Toasts }) {
  return (
    <AriaToastRegion
      queue={toasts.queue}
      className={styles.region}
      aria-label={strings.notifications}
      // A screen's own shortcuts tell the region apart from a modal dialog (each toast is an alertdialog).
      data-toast-region=""
    >
      {({ toast }) => (
        <AriaToast
          toast={toast}
          className={styles.toast}
          data-tone={toast.content.tone}
          style={{ '--toast-name': `toast-${toast.key.replaceAll(/[^\w-]/g, '')}` }}
        >
          <span className={styles.icon} data-tone={toast.content.tone}>
            <Icon name={TONE_ICONS[toast.content.tone]} size="sm" />
          </span>
          <AriaToastContent className={styles.content}>
            <Text slot="title">{toast.content.message}</Text>
          </AriaToastContent>
          {toast.content.action !== undefined && (
            <Button
              variant="ghost"
              onPress={() => {
                toast.content.action?.onAction();
                toasts.dismiss(toast.key);
              }}
            >
              {toast.content.action.label}
            </Button>
          )}
          <Button slot="close" variant="ghost" icon="x" label={strings.dismiss} />
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
