// The gradient behind a Wallet pass: three pools of colour from one hue, blended so the card looks poured
// rather than ramped. Wallet blurs a pass's background heavily, so what matters is where the warmth sits, not
// any edge; the three anchors below put the light in the middle and the depth in the corners.
//
// Drawn rather than shipped as a file: the colour comes from the person's page hue, and a PNG per hue in the
// repo would be nine pictures to keep in step with the tokens.
import { luminanceOf, turn, type Channels } from './colour.ts';
import { writePng } from './png.ts';

/** The size Wallet asks a background for, in points: it scales and blurs from there. */
const WIDTH = 180;
const HEIGHT = 220;

/** One pool of colour: where it sits in the picture (0 to 1), how far it reaches, and its colour. */
interface Pool {
  readonly x: number;
  readonly y: number;
  readonly reach: number;
  readonly colour: Channels;
}

/**
 * The three pools for one hue: the colour itself in the middle, a warmer and lighter one up the wheel towards
 * the top, and a deeper one down the wheel in the corner. Turning the hue rather than only lightening it is
 * what keeps a gradient from reading as a grey wash of one colour: a poured orange runs through yellow and red,
 * never through brown.
 */
function poolsOf(colour: Channels): readonly Pool[] {
  return [
    { x: 0.34, y: 0.58, reach: 0.78, colour: turn(colour, 14, 1.12, 0.1) },
    { x: 0.9, y: 0.06, reach: 0.95, colour: turn(colour, -16, 1.06, -0.12) },
    { x: 0.04, y: 1.0, reach: 0.92, colour: turn(colour, -8, 1.02, -0.04) },
  ];
}

/**
 * The gradient as a PNG, at `scale` times the point size (1, 2 and 3 for the three files a pass carries).
 * Each pixel is the pools' colours weighted by distance, so the blend is smooth everywhere and has no banding
 * of the kind a two stop ramp shows on a large screen.
 */
export function gradientPng(colour: Channels, scale: number): Uint8Array {
  const pools = poolsOf(colour);
  const width = WIDTH * scale;
  const height = HEIGHT * scale;
  return writePng(width, height, (x, y) => {
    const across = x / (width - 1);
    const down = y / (height - 1);
    let red = 0;
    let green = 0;
    let blue = 0;
    let total = 0;
    for (const pool of pools) {
      const distance = Math.hypot(across - pool.x, down - pool.y) / pool.reach;
      // A soft falloff: close to the pool it is nearly all that colour, far away it still counts a little, so
      // there is never a seam between two of them.
      const weight = 1 / (0.02 + distance ** 2.4);
      red += pool.colour[0] * weight;
      green += pool.colour[1] * weight;
      blue += pool.colour[2] * weight;
      total += weight;
    }
    return [red / total, green / total, blue / total];
  });
}

/**
 * The lightest colour the gradient reaches, which is its lifted middle pool. The pass's colour rule reads it:
 * what white text has to survive is the brightest part of the card, not the hue it started from.
 */
export function brightestOf(colour: Channels): Channels {
  let brightest = colour;
  for (const pool of poolsOf(colour)) {
    if (luminanceOf(pool.colour) > luminanceOf(brightest)) brightest = pool.colour;
  }
  return brightest;
}
