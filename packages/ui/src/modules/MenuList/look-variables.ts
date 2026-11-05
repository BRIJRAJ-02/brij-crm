// What a guest look may set on a preview's root (spec 0065, AC-6570 as amended). On the live page the same custom
// properties arrive in a stylesheet from our own origin. Here they go through the CSSOM, and only the look's own names
// pass with a whole hex, a font token, the device's face or a number, so nothing a person typed reaches CSS.
import { MENU_FACE, MENU_LOOK_PROPERTIES } from '@crm/contracts/menu';
import type { PageVariables } from '../../lib/page-variables.ts';

const COLOUR_NAMES: ReadonlySet<string> = new Set(Object.values(MENU_LOOK_PROPERTIES));
const HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const FONT_TOKEN = /^var\(--font-[a-z-]+\)$/;
const NUMBER = /^\d(?:\.\d+)?$/;

/** Whether one pair is a pair the look can make. */
function isLookPair(name: string, value: string): boolean {
  if (COLOUR_NAMES.has(name)) return HEX.test(value);
  if (name === '--menu-face' || name === '--menu-display-face') return value === MENU_FACE || FONT_TOKEN.test(value);
  return name === '--menu-round' && NUMBER.test(value);
}

/** The pairs that pass; everything else is dropped. */
export function checkedLookVariables(variables: PageVariables | undefined): PageVariables {
  return (variables ?? []).filter(([name, value]) => isLookPair(name, value));
}
