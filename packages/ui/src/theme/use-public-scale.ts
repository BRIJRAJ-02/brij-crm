import { useEffect } from 'react';
import { holdPublicScale } from './scale.ts';

/**
 * Draws the whole page at full size while `on` (spec 0071, AC-6): for a guest view shown full screen inside the app,
 * such as a form seen as a visitor. Nested uses count, so the app's scale returns only when the last one turns off.
 */
export function usePublicScale(on: boolean): void {
  useEffect(() => (on ? holdPublicScale(document.documentElement) : undefined), [on]);
}
