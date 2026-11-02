// The small shared motion the whole app borrows: a changed row washed once, a
// new line dropping in at the top of a feed, a row closing up as it leaves,
// and a value fading in place rather than swapping. They run through the Web
// Animations API rather than CSS, because the element that moves belongs to
// the caller (a table row, a list item), and a CSS module may only style its
// own component. Every duration and curve still comes from a token, and
// reduced motion keeps the fade and drops the movement.
import { useEffect, useRef, useSyncExternalStore, type RefCallback } from 'react';
import { durationToken, easingToken, spaceToken } from '../token-values.ts';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the person asked for less motion: drags drop in place, rows jump rather than slide, fades stay. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = globalThis.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    },
    () => globalThis.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** The same question outside React, for the one shot helpers below. */
function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(REDUCED_MOTION).matches;
}

/** Whether this browser can run a Web Animation on it at all (a server render and old engines can't). */
function canAnimate(element: Element | null | undefined): element is HTMLElement {
  return typeof HTMLElement !== 'undefined' && element instanceof HTMLElement && typeof element.animate === 'function';
}

/** The wash is slow on purpose: long enough to catch the eye, gone before the next change. */
const WASH_MS = durationToken('duration-move') * 4;

/**
 * A one shot highlight over a row that just changed, whoever changed it (an
 * edit made here, or a patch arriving over realtime). Pass something that
 * changes with the row's content: its `updatedAt`, or the values object
 * itself, which the record store hands back unchanged until the record
 * changes. The wash runs on every change after the row is first drawn and
 * never on the first draw, so a list that has just loaded doesn't light up all
 * at once. Reduced motion keeps it: it is a fade, and it is the only sign a
 * row changed.
 */
export function useRowWash<T extends HTMLElement>(stamp: unknown): RefCallback<T> {
  const element = useRef<T | null>(null);
  const seen = useRef<unknown>(stamp);
  useEffect(() => {
    if (seen.current === stamp) return;
    seen.current = stamp;
    const row = element.current;
    if (!canAnimate(row)) return;
    // The wash colour is a token, so it has to be read where the row sits: light and dark hold different values.
    const style = getComputedStyle(row);
    const wash = style.getPropertyValue('--accent-soft').trim();
    if (wash === '') return;
    // It fades back to the row's own background, not to nothing: a row with a surface would otherwise flash
    // through to the page behind it on the last frame.
    const own = style.backgroundColor;
    row.animate([{ backgroundColor: wash }, { backgroundColor: own }], {
      duration: WASH_MS,
      easing: easingToken('ease-out'),
    });
  }, [stamp]);
  return (node) => {
    element.current = node;
  };
}

/**
 * A new line dropping in at the top of a feed or an inbox. The ref goes on the
 * list, not the row: pass the key of whatever is first, and the first child
 * drops in whenever that key becomes one the list hasn't seen. Reduced motion
 * fades it in without the drop.
 */
export function useDropIn<T extends HTMLElement>(topKey: string | undefined): RefCallback<T> {
  const element = useRef<T | null>(null);
  const seen = useRef<string | undefined>(topKey);
  useEffect(() => {
    if (seen.current === topKey) return;
    const isFirstKey = seen.current === undefined;
    seen.current = topKey;
    // The key a list learns as it loads is not an arrival: only a key replacing one already on screen is.
    if (isFirstKey || topKey === undefined) return;
    const list = element.current;
    // The row the key belongs to, when the list says which is which (a virtual list draws a window, so its
    // first child is whatever is in view); otherwise the first child, for a plain list.
    const first = list?.querySelector('[data-drop-in]') ?? list?.firstElementChild;
    if (!canAnimate(first)) return;
    const still = prefersReducedMotion();
    first.animate(
      [
        { opacity: 0, transform: still ? 'none' : 'translateY(-50%)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: durationToken('duration-popover'), easing: easingToken('ease-out') },
    );
  }, [topKey]);
  return (node) => {
    element.current = node;
  };
}

/** The sizes a row holds, so it can be closed up to nothing from exactly where it stood. */
function boxOf(element: HTMLElement): Keyframe {
  const style = getComputedStyle(element);
  return {
    height: `${element.getBoundingClientRect().height}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: 1,
  };
}

/** The same box, closed: nothing left of it, so the rows below glide into its place. */
const CLOSED: Keyframe = {
  height: '0px',
  paddingTop: '0px',
  paddingBottom: '0px',
  marginTop: '0px',
  marginBottom: '0px',
  opacity: 0,
};

/**
 * A row leaving a list: it fades while the rows below glide up into the space
 * it held, and only then is it taken out. Call it with the row's element and
 * the removal itself. The removal always runs, even when the element is gone
 * or the browser can't animate it, so a row is never stranded on screen.
 * Reduced motion removes it at once. Whatever it set on the element is cleared
 * before `remove` runs, so a removal that is refused leaves the row exactly as
 * it was rather than a strip of nothing in the tab order.
 */
export function collapseAway(element: HTMLElement | null | undefined, remove: () => void): void {
  if (!canAnimate(element) || prefersReducedMotion()) {
    remove();
    return;
  }
  const row = element;
  const overflowWas = row.style.overflow;
  row.style.overflow = 'hidden';
  const animation = row.animate([boxOf(row), CLOSED], {
    duration: durationToken('duration-move'),
    easing: easingToken('ease-in-out'),
    fill: 'forwards',
  });
  let isDone = false;
  const finish = (): void => {
    if (isDone) return;
    isDone = true;
    // The row is handed back whole: if the removal doesn't take, nothing of the closing is left on it.
    animation.cancel();
    row.style.overflow = overflowWas;
    remove();
  };
  animation.addEventListener('finish', finish);
  animation.addEventListener('cancel', finish);
}

/**
 * A value that changes while it is being looked at: the new one fades in where
 * the old one stood, rather than appearing mid sentence. The ref goes on the
 * element that holds the value, and the value itself says when it changed.
 * Reduced motion keeps the fade and drops the lift.
 */
export function useValueFade<T extends HTMLElement>(value: string | number | undefined): RefCallback<T> {
  const element = useRef<T | null>(null);
  const seen = useRef<string | number | undefined>(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    const node = element.current;
    if (!canAnimate(node)) return;
    const still = prefersReducedMotion();
    node.animate(
      [
        { opacity: 0, transform: still ? 'none' : `translateY(${String(spaceToken('space-2'))}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: durationToken('duration-popover'), easing: easingToken('ease-out') },
    );
  }, [value]);
  return (node) => {
    element.current = node;
  };
}
