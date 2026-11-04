// Whether the window is a phone's width, for a screen that picks a default or a control by it (Bookings' Calendar
// opens on Day there, and folds its view switches into one menu). Layout itself stays with container queries.
import { useSyncExternalStore } from 'react';
import { breakpointToken } from './token-values.ts';

// A phone held upright. There is no page breakpoint for it yet, so it reads the container one at the same width
// (bp-container-md, 480px), which every phone in portrait falls under; a bp-page-phone token would replace it.
const PHONE_QUERY = `(width < ${String(breakpointToken('bp-container-md'))}px)`;

const subscribe = (onChange: () => void) => {
  const query = globalThis.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

const isPhoneNow = () => globalThis.matchMedia(PHONE_QUERY).matches;

/** True while the window is a phone's width (under `bp-container-md`), following it as it resizes. */
export function usePhoneWidth(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, () => false);
}
