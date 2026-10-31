// How a block moves and resizes on the week's grid, as pure maths: where a drag's pixels or a key press land it,
// snapped to the grid and kept inside the week and the day. The component owns the pointer, the keys and the
// drawing; this owns the numbers, so they can be tested without a browser. Day keys are the grid's own columns,
// and minutes count from the day's midnight on the member's clock, as the rest of the week does.

/** A stretch of one day: minutes from its midnight, the end exclusive (1440 is the next midnight). */
export interface BlockSpan {
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** What a pointer's pixels mean on the grid. */
export interface MoveGeometry {
  /** The columns on screen, left to right. One entry in the day view. */
  readonly dayKeys: readonly string[];
  /** One column's width in pixels; 0 when nothing moves sideways. */
  readonly dayWidth: number;
  /** The grid's height for one minute, in pixels. */
  readonly pxPerMinute: number;
}

/** How far a move and a change of length snap, in minutes. */
export interface MoveSteps {
  readonly move: number;
  readonly length: number;
}

/** No block is drawn shorter than this by a resize (an even shorter one it already is stays as it is). */
export const MIN_LENGTH = 15;

const DAY = 1440;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Whole steps of `size` in `amount`, nearest first; never a negative zero. */
const stepsOf = (amount: number, size: number): number => Math.round(amount / size) || 0;

/** The span a move by `travel` pixels lands on: snapped to `steps.move` from where it began, in the day and the columns. */
export function movedBy(
  from: BlockSpan,
  travel: { readonly x: number; readonly y: number },
  geometry: MoveGeometry,
  steps: MoveSteps,
): BlockSpan {
  const length = from.endMinute - from.startMinute;
  const minutes = stepsOf(travel.y / geometry.pxPerMinute, steps.move) * steps.move;
  const startMinute = clamp(from.startMinute + minutes, 0, Math.max(0, DAY - length));
  const at = geometry.dayKeys.indexOf(from.dayKey);
  const columns = geometry.dayWidth > 0 && at !== -1 ? stepsOf(travel.x, geometry.dayWidth) : 0;
  const dayKey = geometry.dayKeys[clamp(at + columns, 0, geometry.dayKeys.length - 1)] ?? from.dayKey;
  return { dayKey, startMinute, endMinute: startMinute + length };
}

/** The span an edge pulled `travelY` pixels lands on: the end snapped to `steps.length` from where it began, its start kept. */
export function resizedBy(from: BlockSpan, travelY: number, geometry: MoveGeometry, steps: MoveSteps): BlockSpan {
  const length = from.endMinute - from.startMinute;
  const wanted = length + stepsOf(travelY / geometry.pxPerMinute, steps.length) * steps.length;
  const fewest = Math.min(length, MIN_LENGTH);
  const most = DAY - from.startMinute;
  return { ...from, endMinute: from.startMinute + clamp(wanted, fewest, most) };
}

/** An arrow key's meaning on a block. */
export type MoveKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Whether `key` is one of the four arrows. */
export const isMoveKey = (key: string): key is MoveKey =>
  key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

/**
 * Where an arrow key puts a block: Up and Down move it a step earlier or later, Left and Right a day (never in the
 * day view, where `dayKeys` holds the one day). With `isResize` Up and Down shorten or lengthen it by a step and
 * sideways does nothing. A key that would leave the grid answers the span it was given.
 */
export function keyedFrom(
  from: BlockSpan,
  key: MoveKey,
  isResize: boolean,
  dayKeys: readonly string[],
  steps: MoveSteps,
): BlockSpan {
  const direction = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (isResize) {
      const length = from.endMinute - from.startMinute + direction * steps.length;
      const fewest = Math.min(from.endMinute - from.startMinute, MIN_LENGTH);
      return { ...from, endMinute: from.startMinute + clamp(length, fewest, DAY - from.startMinute) };
    }
    const length = from.endMinute - from.startMinute;
    const startMinute = clamp(from.startMinute + direction * steps.move, 0, Math.max(0, DAY - length));
    return { ...from, startMinute, endMinute: startMinute + length };
  }
  if (isResize) return from;
  const at = dayKeys.indexOf(from.dayKey);
  const dayKey = at === -1 ? undefined : dayKeys[at + direction];
  return dayKey === undefined ? from : { ...from, dayKey };
}

/** Whether two spans are the same stretch of the same day. */
export const sameSpan = (a: BlockSpan, b: BlockSpan): boolean =>
  a.dayKey === b.dayKey && a.startMinute === b.startMinute && a.endMinute === b.endMinute;

/**
 * How far a span has shifted from where it began, for the block's `translate`: whole columns across and minutes
 * down, so the stylesheet turns them into the grid's own lengths.
 */
export function shiftOf(
  from: BlockSpan,
  to: BlockSpan,
  dayKeys: readonly string[],
): { readonly columns: number; readonly minutes: number } {
  const a = dayKeys.indexOf(from.dayKey);
  const b = dayKeys.indexOf(to.dayKey);
  return { columns: a === -1 || b === -1 ? 0 : b - a, minutes: to.startMinute - from.startMinute };
}
