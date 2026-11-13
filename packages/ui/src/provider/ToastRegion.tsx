// The toasts drawn, apart from their queue (toasts.tsx), so a page that raises none (the hosted form, under
// UiProviderBase) doesn't load React Aria's toast region, this file's CSS or its buttons. UiProvider draws it.
import { useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';
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
import { layoutBox, ToastClearanceContext, toastLift, type ToastClearance } from './toast-clearance.ts';
import styles from './Toast.module.css';
import type { Toasts } from './toasts.tsx';

/** Each tone's icon. */
const TONE_ICONS = { success: 'circle-check', danger: 'circle-alert', info: 'info' } as const;

/** No footers to keep clear of: under no provider's store. */
const NO_FOOTERS: readonly HTMLElement[] = [];

function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * How far the toasts rise to clear the open overlays' footers (a drawer's Save and Cancel), measured again as the
 * region or a footer changes size and as the window resizes.
 */
function useLift(region: HTMLElement | null, clearance: ToastClearance | undefined): number {
  const footers = useSyncExternalStore(
    clearance?.subscribe ?? subscribeToNothing,
    clearance?.current ?? (() => NO_FOOTERS),
  );
  const [lift, setLift] = useState(0);
  const isClear = region === null || footers.length === 0;
  useLayoutEffect(() => {
    if (region === null || footers.length === 0) return;
    const measure = () => {
      setLift(toastLift(layoutBox(region), footers.map(layoutBox)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    for (const footer of footers) observer.observe(footer);
    globalThis.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('resize', measure);
    };
  }, [region, footers]);
  // With no region or no footer there is nothing to clear, whatever was last measured.
  return isClear ? 0 : lift;
}

/**
 * Draws the toasts at the bottom right, risen above an open drawer's, sheet's or panel's footer, or a floating bar,
 * when they would cover it. UiProvider renders it once; screens never do.
 */
export function ToastRegion({ toasts }: { readonly toasts: Toasts }) {
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const lift = useLift(region, useContext(ToastClearanceContext));
  return (
    <AriaToastRegion
      ref={setRegion}
      queue={toasts.queue}
      className={styles.region}
      aria-label={strings.notifications}
      // A screen's own shortcuts tell the region apart from a modal dialog (each toast is an alertdialog).
      data-toast-region=""
      data-lifted={lift > 0 || undefined}
      style={{ '--toast-lift': `${String(lift)}px` }}
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
