import { useCallback, useEffect, useState } from 'react';

/** Which inline ends of a sideways scroller have more to see past them. */
export interface ScrollEdges {
  /** Content is scrolled past the start: there is more before it. */
  readonly start: boolean;
  /** Content runs past the end: there is more after it. */
  readonly end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/**
 * Reads where a sideways scroller stands: whether its content runs past the start or the end. Pure, so a
 * test can hand it numbers. `scrollLeft` is negative in a right to left frame, so it reads its size only.
 */
export function scrollEdgesOf(frame: {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}): ScrollEdges {
  const past = Math.abs(frame.scrollLeft);
  const room = frame.scrollWidth - frame.clientWidth;
  // A pixel of slack: zoomed layouts round widths to fractions.
  if (room <= 1) return NONE;
  return { start: past > 1, end: past < room - 1 };
}

/**
 * Watches a sideways scroller (a scrollable Table's frame) and says which ends hide content, so it can fade
 * them and show it scrolls. Off (`isOn` false), it reports nothing and listens to nothing.
 */
export function useScrollEdges(isOn: boolean): {
  readonly edges: ScrollEdges;
  readonly ref: (element: HTMLElement | null) => void;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  const ref = useCallback((next: HTMLElement | null) => {
    setElement(next);
  }, []);
  useEffect(() => {
    if (!isOn || element === null) return undefined;
    const measure = () => {
      const next = scrollEdgesOf(element);
      setEdges((was) => (was.start === next.start && was.end === next.end ? was : next));
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    const first = element.firstElementChild;
    if (first !== null) observer?.observe(first);
    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [isOn, element]);
  return { edges: isOn ? edges : NONE, ref };
}
