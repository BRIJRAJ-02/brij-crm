import { useMemo, useState, type ReactNode } from 'react';
import { I18nProvider, RouterProvider } from 'react-aria-components';
import type { KeyboardPlatform } from '../atoms/Kbd/shortcuts.ts';
import { createClock, type Clock } from './clock.ts';
import { ClockContext, FormatContext, PlatformContext, ToastsContext, type FormatSettings } from './context.ts';
<<<<<<< HEAD
<<<<<<< HEAD
import type { Toasts } from './toasts.tsx';
=======
import { ToastRegion, type Toasts } from './toasts.tsx';
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
import type { Toasts } from './toasts.tsx';
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
import { LOADING_TIMING, LoadingTimingContext, type LoadingTiming } from './useDelayedLoading.ts';

export { useFormatSettings, useKeyboardPlatform, useNow, useToasts, type FormatSettings } from './context.ts';

/** Reads the viewer's keyboard from the browser: a Mac, iPhone or iPad shows ⌘, anything else Ctrl. */
export function detectKeyboardPlatform(navigator: {
  readonly platform: string;
  readonly userAgent: string;
}): KeyboardPlatform {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other';
}

/** Props for UiProvider. apps/web passes the browser's language and time zone until #23 adds them to the profile. */
export interface UiProviderProps extends FormatSettings {
  /** Moves to an href inside the app (the router's `history.push`). Library links route through it. */
  readonly navigate: (href: string) => void;
  /** Turns an app href into the one the browser shows (the router's `history.createHref`). */
  readonly useHref?: (href: string) => string;
  /** The app's toasts, from `createToasts()`, also handed to the data layer. */
  readonly toasts: Toasts;
  /** The shared clock. Defaults to one that ticks every 30 seconds; stories pass a fixed one. */
  readonly clock?: Clock;
  /** When skeletons appear. Defaults to the product timing; Storybook turns the delay off. */
  readonly loadingTiming?: LoadingTiming;
  /** The keyboard shortcuts are shown for: ⌘ on a Mac, Ctrl elsewhere. Defaults to the browser's; stories pin one. */
  readonly platform?: KeyboardPlatform;
  readonly children: ReactNode;
}

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
/** Props for UiProviderBase: UiProvider's, and what draws the toasts. */
export interface UiProviderBaseProps extends UiProviderProps {
  /** UiProvider's ToastRegion. The hosted form raises no toasts, so it gives none and loads no toast region. */
  readonly toastRegion?: ReactNode;
}

<<<<<<< HEAD
/**
 * UiProvider without the icon registry, the brand marks' artwork or the toast region: React Aria's language and
 * router, the shared clock and the toast queue. Only the hosted form mounts it directly, so its first load carries
 * the base icons alone (`atoms/Icon/base-icons.ts`) and no toast region; everything else wraps itself in UiProvider.
=======
/**
 * UiProvider without the icon registry or the brand marks' artwork: React Aria's language and router, the shared
 * clock and the toasts. Only the hosted form mounts it directly, so its first load carries the base icons alone
 * (`atoms/Icon/base-icons.ts`); everything else wraps itself in UiProvider.
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
/**
 * UiProvider without the icon registry, the brand marks' artwork or the toast region: React Aria's language and
 * router, the shared clock and the toast queue. Only the hosted form mounts it directly, so its first load carries
 * the base icons alone (`atoms/Icon/base-icons.ts`) and no toast region; everything else wraps itself in UiProvider.
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
 */
export function UiProviderBase({
  locale,
  timeZone,
  navigate,
  useHref,
  toasts,
  clock,
  loadingTiming = LOADING_TIMING,
  platform,
  children,
<<<<<<< HEAD
<<<<<<< HEAD
  toastRegion,
}: UiProviderBaseProps) {
=======
}: UiProviderProps) {
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
  toastRegion,
}: UiProviderBaseProps) {
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
  const [ownClock] = useState(() => clock ?? createClock({ visibility: document }));
  const [ownPlatform] = useState(() => platform ?? detectKeyboardPlatform(navigator));
  const settings = useMemo<FormatSettings>(() => ({ locale, timeZone }), [locale, timeZone]);

  return (
    <I18nProvider locale={locale}>
      <RouterProvider navigate={navigate} {...(useHref === undefined ? {} : { useHref })}>
        <FormatContext value={settings}>
          <ClockContext value={clock ?? ownClock}>
            <ToastsContext value={toasts}>
              <LoadingTimingContext value={loadingTiming}>
                <PlatformContext value={platform ?? ownPlatform}>
                  {children}
<<<<<<< HEAD
<<<<<<< HEAD
                  {toastRegion}
=======
                  <ToastRegion toasts={toasts} />
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
                  {toastRegion}
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
                </PlatformContext>
              </LoadingTimingContext>
            </ToastsContext>
          </ClockContext>
        </FormatContext>
      </RouterProvider>
    </I18nProvider>
  );
}
