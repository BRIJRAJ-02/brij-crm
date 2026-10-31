// The toasts drawn, apart from their queue (toasts.tsx), so a page that raises none (the hosted form, under
// UiProviderBase) doesn't load React Aria's toast region, this file's CSS or its buttons. UiProvider draws it.
import {
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
} from 'react-aria-components';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { Spinner } from '../atoms/Spinner/Spinner.tsx';
import '../lib/custom-properties.ts';
import { strings } from './strings.ts';
import styles from './Toast.module.css';
import type { Toasts } from './toasts.tsx';

/** Each tone's icon. */
const TONE_ICONS = { success: 'circle-check', danger: 'circle-alert', info: 'info' } as const;

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
            {toast.content.isBusy === true ? (
              <Spinner label={toast.content.message} />
            ) : (
              <Icon name={TONE_ICONS[toast.content.tone]} size="sm" />
            )}
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
