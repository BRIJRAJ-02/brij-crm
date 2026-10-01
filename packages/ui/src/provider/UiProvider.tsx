import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { I18nProvider, RouterProvider } from 'react-aria-components';
import { createClock, type Clock } from './clock.ts';
import { ToastRegion, type Toasts } from './toasts.tsx';
import { LOADING_TIMING, LoadingTimingContext, type LoadingTiming } from './useDelayedLoading.ts';

/** The language and time zone every date, number and amount formats in. */
export interface FormatSettings {
  /** A BCP 47 tag, such as `en-GB`. */
  readonly locale: string;
  /** An IANA zone, such as `Europe/London`. "Today" is today here. */
  readonly timeZone: string;
}

const FormatContext = createContext<FormatSettings | undefined>(undefined);
const ClockContext = createContext<Clock | undefined>(undefined);
const ToastsContext = createContext<Toasts | undefined>(undefined);

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
  readonly children: ReactNode;
}

/**
 * Wraps the app once: React Aria's language and router, the shared clock and
 * the toast region. Components read the language, time zone and time only from
 * here, never from the browser.
 */
export function UiProvider({
  locale,
  timeZone,
  navigate,
  useHref,
  toasts,
  clock,
  loadingTiming = LOADING_TIMING,
  children,
}: UiProviderProps) {
  const [ownClock] = useState(() => clock ?? createClock({ visibility: document }));
  const settings = useMemo<FormatSettings>(() => ({ locale, timeZone }), [locale, timeZone]);

  return (
    <I18nProvider locale={locale}>
      <RouterProvider navigate={navigate} {...(useHref === undefined ? {} : { useHref })}>
        <FormatContext value={settings}>
          <ClockContext value={clock ?? ownClock}>
            <ToastsContext value={toasts}>
              <LoadingTimingContext value={loadingTiming}>
                {children}
                <ToastRegion toasts={toasts} />
              </LoadingTimingContext>
            </ToastsContext>
          </ClockContext>
        </FormatContext>
      </RouterProvider>
    </I18nProvider>
  );
}

/** The language and time zone from UiProvider. Throws outside it, so a missing provider fails loudly. */
export function useFormatSettings(): FormatSettings {
  const settings = useContext(FormatContext);
  if (settings === undefined) throw new Error('Wrap the app in <UiProvider> to format dates and numbers.');
  return settings;
}

/** The shared clock's time, in milliseconds. Re-renders on each tick (every 30 seconds). */
export function useNow(): number {
  const clock = useContext(ClockContext);
  if (clock === undefined) throw new Error('Wrap the app in <UiProvider> to show relative times.');
  return useSyncExternalStore(clock.subscribe, clock.now);
}

/** The app's toasts, for library components that report something themselves (a failed copy). Screens raise toasts through the data layer. */
export function useToasts(): Toasts {
  const toasts = useContext(ToastsContext);
  if (toasts === undefined) throw new Error('Wrap the app in <UiProvider> to show toasts.');
  return toasts;
}
