// The perf project runs React's production build, which has no development
// JSX runtime, while the React plugin still compiles JSX to `jsxDEV` in tests.
// This maps those calls onto the production runtime. Perf project only.
import { Fragment, jsx } from 'react/jsx-runtime';

export { Fragment };

/** `jsxDEV(type, props, key)` as the production `jsx` (the source and self arguments are development only). */
export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key?: Parameters<typeof jsx>[2],
) {
  return jsx(type, props, key);
}
