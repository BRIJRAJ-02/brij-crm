// A calendar's colour as the design system draws it (spec 0024 milestone 5,
// AC-993, AC-1001): the member's pick (one of the nine data hues), else the
// provider's colour mapped to the nearest hue, so no raw provider colour is
// ever drawn and every pairing keeps its tokens' contrast. Pure.
import { HUES, type Hue } from '@crm/contracts/values';

/** Each hue's place on the colour wheel, in degrees; gray has none. */
const ANGLES: readonly (readonly [Hue, number])[] = [
  ['red', 0],
  ['orange', 28],
  ['yellow', 52],
  ['lime', 85],
  ['green', 135],
  ['sky', 195],
  ['blue', 222],
  ['purple', 275],
];

/** Below this saturation (or nearly black or white) a colour reads as gray. */
const GRAY_SATURATION = 0.18;

/** The nearest data hue to a `#rrggbb` colour; blue when there is none or it won't parse. */
export function nearestHue(hex: string | undefined | null): Hue {
  if (hex === undefined || hex === null || !/^#[0-9a-f]{6}$/i.test(hex)) return 'blue';
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * light - 1));
  if (saturation < GRAY_SATURATION || light < 0.08 || light > 0.95) return 'gray';
  let angle: number;
  if (max === r) angle = 60 * (((g - b) / chroma) % 6);
  else if (max === g) angle = 60 * ((b - r) / chroma + 2);
  else angle = 60 * ((r - g) / chroma + 4);
  if (angle < 0) angle += 360;
  let best: Hue = 'blue';
  let distance = Number.POSITIVE_INFINITY;
  for (const [hue, at] of ANGLES) {
    const apart = Math.min(Math.abs(angle - at), 360 - Math.abs(angle - at));
    if (apart < distance) {
      distance = apart;
      best = hue;
    }
  }
  return best;
}

/** A stored override when it is one of the nine hues, else undefined. */
export function hueOverride(value: string | null | undefined): Hue | undefined {
  return (HUES as readonly string[]).includes(value ?? '') ? (value as Hue) : undefined;
}

/** The hue a calendar draws in: the member's pick, else the provider's colour's nearest. */
export function calendarHue(row: {
  readonly colourOverride?: string | null;
  readonly providerColour?: string | null;
}): Hue {
  return hueOverride(row.colourOverride) ?? nearestHue(row.providerColour);
}
