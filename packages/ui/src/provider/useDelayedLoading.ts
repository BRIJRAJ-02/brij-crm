import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** When a skeleton appears and how long it stays (AC-13). */
export interface LoadingTiming {
  /** Loading shorter than this never shows a skeleton. */
  readonly delayMs: number;
  /** Once shown, a skeleton stays at least this long, so it never flashes. */
  readonly minimumMs: number;
}

/** The product timing: a skeleton only after 200 ms of loading, then for at least 300 ms. */
export const LOADING_TIMING: LoadingTiming = { delayMs: 200, minimumMs: 300 };

/** Set by UiProvider. Storybook sets both to zero so loading stories render their skeleton at once. */
export const LoadingTimingContext = createContext<LoadingTiming>(LOADING_TIMING);

/** Whether to show a skeleton for `isLoading`: only after the delay, then for at least the minimum. */
export function useDelayedLoading(isLoading: boolean): boolean {
  const timing = useContext(LoadingTimingContext);
  const [shown, setShown] = useState(isLoading && timing.delayMs === 0);
  const shownAt = useRef<number | undefined>(undefined);

  // When the skeleton came up, so it can stay its minimum.
  useEffect(() => {
    if (!shown) shownAt.current = undefined;
    else shownAt.current ??= Date.now();
  }, [shown]);

  useEffect(() => {
    if (isLoading && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, timing.delayMs);
      return () => {
        clearTimeout(timer);
      };
    }
    if (!isLoading && shown) {
      const elapsed = Date.now() - (shownAt.current ?? 0);
      const timer = setTimeout(
        () => {
          setShown(false);
        },
        Math.max(0, timing.minimumMs - elapsed),
      );
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [isLoading, shown, timing]);

  return shown;
}
