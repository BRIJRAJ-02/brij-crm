import { useContext, type ReactNode } from 'react';
import { LoadingTimingContext } from './useDelayedLoading.ts';

/** Props for LoadingNow. */
export interface LoadingNowProps {
  readonly children: ReactNode;
}

/**
 * Inside it, a loading state shows its skeleton at once, keeping the minimum time it stays. For a page that only
 * appears once the loading delay has already passed (the router's pending page shows after `LOADING_TIMING.delayMs`),
 * so its skeletons don't wait out the delay a second time behind a blank area.
 */
export function LoadingNow({ children }: LoadingNowProps) {
  const timing = useContext(LoadingTimingContext);
  return <LoadingTimingContext.Provider value={{ ...timing, delayMs: 0 }}>{children}</LoadingTimingContext.Provider>;
}
