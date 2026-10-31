// The arithmetic a chart draws with, pure so it is tested on its own: round axis ticks, the width of a bar and its
// slot, how many x labels fit, a label cut to a width, and a line's path. No React, no DOM.

/** The axis for values from zero to `max`: round ticks, 0 first, and the top one at or above `max`. */
export function niceTicks(max: number, wanted = 4): { readonly ticks: readonly number[]; readonly top: number } {
  if (!Number.isFinite(max) || max <= 0) return { ticks: [0, 1], top: 1 };
  const rough = max / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  const count = Math.ceil(max / step - 1e-9);
  // Multiply rather than add, so 0.1 steps carry no floating point dust.
  const ticks = Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)));
  return { ticks, top: ticks.at(-1) ?? step };
}

/** The most a bar is thick (the mark spec): the rest of its slot is air. */
export const BAR_MAX_THICKNESS = 24;

/** Where bar `index` of `count` sits in a plot `width` wide: its slot's start and width, and the bar centred in it. */
export function barSlot(
  index: number,
  count: number,
  width: number,
): { readonly slot: number; readonly start: number; readonly bar: number; readonly x: number } {
  const slot = count > 0 ? width / count : width;
  const bar = Math.max(2, Math.min(BAR_MAX_THICKNESS, slot - 8));
  const start = index * slot;
  return { slot, start, bar, x: start + (slot - bar) / 2 };
}

/** How many characters of 11px type fit in `width` pixels, at an average of 6.2px a character. */
export function charsThatFit(width: number): number {
  return Math.max(0, Math.floor(width / 6.2));
}

/** `text` cut to `max` characters with an ellipsis; whole when it fits. */
export function cutLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Every how-many-th label to draw so labels of the widest one's length never touch: 1 draws them all. `slot` is
 * the room each point has along the axis.
 */
export function labelStep(count: number, slot: number, widest: number): number {
  if (count <= 1) return 1;
  const needed = widest * 6.2 + 12;
  return Math.max(1, Math.ceil(needed / Math.max(slot, 1)));
}

/** A line through `points` as an SVG path. */
export function linePath(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`).join(' ');
}

/** The area under a line down to `baseline`, as an SVG path. */
export function areaPath(points: readonly { readonly x: number; readonly y: number }[], baseline: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return '';
  return `${linePath(points)} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The rounded data end of a bar (the mark spec): 4px corners at the top, square where it stands on the baseline. */
export const BAR_CORNER = 4;

/** A column from `y` down `height` pixels, `width` wide, its top corners rounded and its foot square; empty with no height. */
export function barPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(BAR_CORNER, height, width / 2);
  const bottom = y + height;
  return [
    `M${round(x)} ${round(bottom)}`,
    `L${round(x)} ${round(y + r)}`,
    `Q${round(x)} ${round(y)} ${round(x + r)} ${round(y)}`,
    `L${round(x + width - r)} ${round(y)}`,
    `Q${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)}`,
    `L${round(x + width)} ${round(bottom)}`,
    'Z',
  ].join(' ');
}

/** Which of `count` points a pointer at `x` is nearest, in a plot `width` wide whose points sit at slot centres. */
export function nearestIndex(x: number, count: number, width: number): number {
  if (count <= 0) return -1;
  const slot = width / count;
  return Math.max(0, Math.min(count - 1, Math.floor(x / Math.max(slot, 1))));
}
