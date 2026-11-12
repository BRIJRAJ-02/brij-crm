// The few token numbers JavaScript needs (a virtual list's row height, a
// keyboard resize step, the compact page width, a drag's settle time), read from
// the generated values module so they can never drift from the CSS. Sizes, spaces
// and radii draw smaller in the app (`<html data-scale="app">`, spec 0071), so every
// read looks at the document's scale when it's called: call these while drawing,
// never once into a module level constant.
import { appValues, fullValues } from '@crm/tokens/values';

/** The value tokens.css gives `name` in the document's current scale. Throws for a name it doesn't have. */
function tokenValue(name: string, family: string): string {
  const isApp = typeof document !== 'undefined' && document.documentElement.dataset.scale === 'app';
  const value = (isApp ? appValues[name] : undefined) ?? fullValues[name];
  if (value === undefined) throw new Error(`No ${family} token called ${name} in tokens.json or legacy.json.`);
  return value;
}

/** A size token's value in pixels, such as `size-nav-item` (34 on a public page, 30 in the app). Throws for a name tokens.json doesn't have. */
export function sizeToken(name: string): number {
  return Number.parseFloat(tokenValue(name, 'size'));
}

/** A spacing token's value in pixels, such as `space-8` (8 on a public page, 7 in the app). Throws for a name tokens.json doesn't have. */
export function spaceToken(name: string): number {
  return Number.parseFloat(tokenValue(name, 'spacing'));
}

/** A breakpoint token's value in pixels, such as `bp-page-compact` (1024). Throws for a name tokens.json doesn't have. */
export function breakpointToken(name: string): number {
  return Number.parseFloat(tokenValue(name, 'breakpoint'));
}

/** A duration token's value in milliseconds, such as `duration-fast` (250). Throws for a name tokens.json doesn't have. */
export function durationToken(name: string): number {
  return Number.parseFloat(tokenValue(name, 'duration'));
}

/** An easing token's curve, such as `ease-in-out`, for motion JavaScript runs (the Web Animations API takes no `var()`). */
export function easingToken(name: string): string {
  return tokenValue(name, 'easing');
}
