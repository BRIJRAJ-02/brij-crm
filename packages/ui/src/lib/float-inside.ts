// Keeps something that floats out of its box (a grid cell's error) inside
// what would clip it: the nearest scrolling ancestors and the window. The
// geometry is pure; `keepInside` reads the page and writes two custom
// properties and a data attribute the element's CSS uses.

/** A run of pixels along one axis, in the window's coordinates. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * How far to move `box` along one axis so it sits inside `room`: nothing when
 * it fits, else in from the edge it crosses. A box wider than the room lines
 * up with the room's start.
 */
export function shiftInside(box: Span, room: Span): number {
  if (box.end > room.end) return Math.max(room.end - box.end, room.start - box.start);
  if (box.start < room.start) return room.start - box.start;
  return 0;
}

/**
 * Whether a box hanging below its anchor should go above it instead: only
 * when it crosses the room's bottom and fits between the room's top and the
 * anchor's top.
 */
export function flipsAbove(box: Span, anchor: Span, room: Span): boolean {
  const height = box.end - box.start;
  return box.end > room.end && anchor.start - height - (box.start - anchor.end) >= room.start;
}

/** The overlap of two spans (empty spans stay where they are). */
function overlap(a: Span, b: Span): Span {
  const start = Math.max(a.start, b.start);
  return { start, end: Math.max(start, Math.min(a.end, b.end)) };
}

/** The window's visible area, intersected with the client box of every ancestor that clips. */
function roomFor(element: HTMLElement): { readonly x: Span; readonly y: Span } {
  const root = element.ownerDocument.documentElement;
  let x: Span = { start: 0, end: root.clientWidth };
  let y: Span = { start: 0, end: root.clientHeight };
  for (let node = element.parentElement; node !== null && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible') {
      const left = node.getBoundingClientRect().left + node.clientLeft;
      x = overlap(x, { start: left, end: left + node.clientWidth });
    }
    if (style.overflowY !== 'visible') {
      const top = node.getBoundingClientRect().top + node.clientTop;
      y = overlap(y, { start: top, end: top + node.clientHeight });
    }
  }
  return { x, y };
}

/**
 * Moves `element`, which floats from `anchor`, inside the room it may show
 * in: `--float-room` caps its width at the room's, `--float-shift` slides it
 * sideways, and `data-float-above` puts it over the anchor when there is no
 * room under it. Run it after each layout that could move either.
 */
export function keepInside(element: HTMLElement, anchor: HTMLElement): void {
  element.style.removeProperty('--float-shift');
  element.removeAttribute('data-float-above');
  const room = roomFor(element);
  element.style.setProperty('--float-room', `${String(room.x.end - room.x.start)}px`);
  const box = element.getBoundingClientRect();
  const shift = shiftInside({ start: box.left, end: box.right }, room.x);
  if (shift !== 0) element.style.setProperty('--float-shift', `${String(shift)}px`);
  const below = anchor.getBoundingClientRect();
  if (flipsAbove({ start: box.top, end: box.bottom }, { start: below.top, end: below.bottom }, room.y)) {
    element.setAttribute('data-float-above', '');
  }
}
