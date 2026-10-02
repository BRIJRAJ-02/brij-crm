// Virtualised lists built on React Aria's Virtualizer (async menus, task
// lists) draw each row as it comes on screen; this tells their ListSource which
// range that is, once per batch of mounts and unmounts.
import { useCallback, useEffect, useRef } from 'react';
import type { ListSource } from './list-source.ts';

/** A stable callback each drawn row calls with its index on mount; its cleanup runs on unmount. Reports the drawn range to `source.onRangeChange`. */
export function useRangeReporter<T>(source: ListSource<T> | undefined): (index: number) => () => void {
  const shown = useRef(new Set<number>());
  const pending = useRef(false);
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  });
  // Stable, so each row's effect runs once per mount, not on every render.
  return useCallback((index: number) => {
    const report = () => {
      if (pending.current) return;
      pending.current = true;
      queueMicrotask(() => {
        pending.current = false;
        const onRangeChange = latest.current?.onRangeChange;
        if (onRangeChange === undefined || shown.current.size === 0) return;
        const indexes = [...shown.current];
        onRangeChange({ start: Math.min(...indexes), end: Math.max(...indexes) + 1 });
      });
    };
    shown.current.add(index);
    report();
    return () => {
      shown.current.delete(index);
      report();
    };
  }, []);
}

/** Drawn inside a row: reports its index while it is on screen. */
export function RowShown({
  index,
  onShown,
}: {
  readonly index: number;
  readonly onShown: (index: number) => () => void;
}) {
  useEffect(() => onShown(index), [index, onShown]);
  return null;
}
