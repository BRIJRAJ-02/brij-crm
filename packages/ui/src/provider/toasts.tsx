// The one file that touches React Aria's toast, still UNSTABLE_ in 1.21, so its
// rename changes this file only. The queue is made by createToasts() and handed
// to UiProvider and the data layer; nothing here lives at module level.
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
} from 'react-aria-components';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { strings } from './strings.ts';
import styles from './Toast.module.css';

/** How long a confirmation stays. Errors and toasts with an action stay until dismissed. */
export const TOAST_TIMEOUT_MS = 5_000;

/** At most this many toasts show at once; the rest wait their turn. */
export const MAX_VISIBLE_TOASTS = 3;

/** A toast's colour and icon: `success` for confirmations, `danger` for errors. */
export type ToastTone = 'success' | 'danger';

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

/** How long a toast stays: confirmations 5 seconds, errors and toasts with an action until dismissed. */
export function toastTimeout(content: ToastContent): number | undefined {
  return content.tone === 'danger' || content.action !== undefined ? undefined : TOAST_TIMEOUT_MS;
}

/** Makes the app's toast queue: at most three at once, each timed by `toastTimeout`. Timers pause while hovered or focused. */
export function createToasts(): Toasts {
  const queue = new ToastQueue<ToastContent>({ maxVisibleToasts: MAX_VISIBLE_TOASTS });
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
    <AriaToastRegion queue={toasts.queue} className={styles.region} aria-label={strings.notifications}>
      {({ toast }) => (
        <AriaToast toast={toast} className={styles.toast} data-tone={toast.content.tone}>
          <span className={styles.icon} data-tone={toast.content.tone}>
            <Icon name={toast.content.tone === 'danger' ? 'circle-alert' : 'circle-check'} size="sm" />
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
