// Whether the window is a phone's width: Bookings' Calendar opens on Day there, and its view switches fold into one
// View menu (the bookings critique, A14). Read from the window, not a container: it picks a default and a control,
// not a layout, which the library's container queries keep doing.
import { useSyncExternalStore } from 'react';

/** Under 600px: a phone held upright, where seven days and two switches don't fit one row. */
const PHONE_QUERY = '(max-width: 599.98px)';

const subscribe = (onChange: () => void) => {
  const query = globalThis.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};

const isPhoneNow = () => globalThis.matchMedia(PHONE_QUERY).matches;

/** True while the window is under 600px wide, following it as it changes. */
export function useIsPhoneWidth(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, () => false);
}
