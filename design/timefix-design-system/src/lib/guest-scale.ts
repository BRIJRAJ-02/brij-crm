import { useEffect } from 'react';

/**
 * The app pages draw the dashboard at 80% (owner, 11 Nov). Guest views, a form seen as a visitor and the sign in screens are
 * public pages and keep their full size: while one shows, the root carries data-guest and the scale steps back to 100%.
 */
export function useGuestScale(isOn: boolean): void {
  useEffect(() => {
    if (!isOn) return undefined;
    const root = document.documentElement;
    const n = Number(root.dataset.guest || '0') + 1;
    root.dataset.guest = String(n);
    return () => {
      const left = Number(root.dataset.guest || '1') - 1;
      if (left > 0) root.dataset.guest = String(left); else delete root.dataset.guest;
    };
  }, [isOn]);
}
