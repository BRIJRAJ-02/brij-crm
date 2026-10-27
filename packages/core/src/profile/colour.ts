// The colour arithmetic the Wallet pass needs: hue, saturation and lightness, and WCAG contrast. Small and
// dependency free, because the pass is drawn on the server and a colour library would be the only reason to add
// one. The pass's gradient and its text colours both read from here, so they can never disagree.

/** A colour as its three channels, 0 to 255. */
export type Channels = readonly [number, number, number];

/** A `#rrggbb` as its three channels. */
export function channelsOf(colour: string): Channels {
  const hex = colour.replace('#', '');
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as Channels;
}

/** A channel's share of relative luminance (WCAG 2). */
function channelLuminance(value: number): number {
  const part = value / 255;
  return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
}

/** A colour's relative luminance (WCAG 2). */
export function luminanceOf(colour: Channels): number {
  const [red, green, blue] = colour;
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/** The contrast between two colours (WCAG 2). */
export function contrastOf(one: Channels, other: Channels): number {
  const [lighter, darker] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** A colour as hue (0 to 1), saturation and lightness. */
export function hslOf(colour: Channels): Channels {
  const [red, green, blue] = colour.map((value) => value / 255) as unknown as Channels;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  if (high === low) return [0, 0, lightness];
  const span = high - low;
  const saturation = span / (lightness > 0.5 ? 2 - high - low : high + low);
  const hue =
    high === red
      ? (green - blue) / span + (green < blue ? 6 : 0)
      : high === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4;
  return [hue / 6, saturation, lightness];
}

/** One channel of an HSL colour back as RGB. */
function channelOf(p: number, q: number, t: number): number {
  const at = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (at < 1 / 6) return p + (q - p) * 6 * at;
  if (at < 1 / 2) return q;
  if (at < 2 / 3) return p + (q - p) * (2 / 3 - at) * 6;
  return p;
}

/** An HSL colour as RGB, each channel 0 to 255. */
export function rgbOf([hue, saturation, lightness]: Channels): Channels {
  if (saturation === 0) return [lightness * 255, lightness * 255, lightness * 255];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [channelOf(p, q, hue + 1 / 3) * 255, channelOf(p, q, hue) * 255, channelOf(p, q, hue - 1 / 3) * 255];
}

/** The same colour, turned around the wheel and moved in saturation and lightness. */
export function turn(colour: Channels, degrees: number, saturation: number, lightness: number): Channels {
  const [hue, s, l] = hslOf(colour);
  return rgbOf([
    (hue + degrees / 360 + 1) % 1,
    Math.max(0, Math.min(1, s * saturation)),
    Math.max(0, Math.min(1, l + lightness)),
  ]);
}

/**
 * The same colour taken down in lightness until white text on it reaches `contrast`, with its saturation lifted
 * as it goes so it deepens rather than greys: a dot colour darkened by multiplying its channels turns brown,
 * and the same colour taken down the lightness axis stays the colour it was.
 */
export function deepen(colour: Channels, contrast: number): Channels {
  const white: Channels = [255, 255, 255];
  const [hue, saturation, lightness] = hslOf(colour);
  let found = colour;
  for (let step = 0; step <= 60; step += 1) {
    found = rgbOf([hue, Math.min(1, saturation * (1 + step * 0.004)), Math.max(0, lightness - step * 0.01)]);
    if (contrastOf(found, white) >= contrast) break;
  }
  return found;
}
