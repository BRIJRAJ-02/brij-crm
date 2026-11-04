// Whether the Menus screen is at a phone's width, so its top bar keeps to what fits (UX review should-fix 10): New
// menu moves into More. Read from the media query itself, so it follows a rotated phone; no window is "wide".
import { useSyncExternalStore } from 'react';

/** The width under which the editor's top bar folds New menu into More. */
const NARROW = '(width < 640px)';

const subscribe = (onChange: () => void) => {
  const query = globalThis.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** True at a phone's width. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(NARROW).matches,
    () => false,
  );
}
