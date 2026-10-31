import { useLayoutEffect, useState, type RefObject } from 'react';

/** The width of an element, kept current as it resizes: 0 until it is measured. */
export function useChartWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
