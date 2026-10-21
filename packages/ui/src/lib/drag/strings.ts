/** The drag wrapper's built in copy: what a screen reader hears while something moves. */
export const strings = {
  /** Read with every grip, through dnd-kit's described-by text. */
  instructions:
    'Press Space or Enter to pick it up, the arrow keys to move it, Space or Enter to drop it, or Escape to put it back.',
  /** The focus holder's name while a keyboard move is under way. */
  moving: (name: string) => `Moving ${name}`,
  lifted: (name: string, position: number, count: number) =>
    `${name} picked up, at position ${String(position)} of ${String(count)}.`,
  position: (name: string, position: number, count: number) =>
    `${name}, position ${String(position)} of ${String(count)}.`,
  moved: (name: string, position: number, count: number) =>
    `${name}, moved to position ${String(position)} of ${String(count)}.`,
  stayed: (name: string, position: number, count: number) =>
    `${name}, dropped where it was, at position ${String(position)} of ${String(count)}.`,
  cancelled: (name: string, position: number, count: number) =>
    `${name}, put back at position ${String(position)} of ${String(count)}.`,
} as const;
