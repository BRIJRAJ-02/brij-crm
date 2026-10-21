import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { breakpointToken, sizeToken } from '../../lib/token-values.ts';
import { Panel } from '../../molecules/Panel/Panel.tsx';
import styles from './AsideLayout.module.css';

/**
 * The width (px) below which the aside leaves the page for a sheet: the aside's own width (`size-measure`) plus a
 * main column of `bp-container-md`, so the main never gets less than a medium container beside it.
 */
const NARROW_BELOW = breakpointToken('bp-container-md') + sizeToken('size-measure');

/** Props for AsideLayout. */
export interface AsideLayoutProps {
  /** What sits beside the main column: the calendars list. */
  readonly aside: ReactNode;
  /** The aside's name: its region's label, and its sheet's title on a narrow page ("Calendars"). */
  readonly asideLabel: string;
  /** Wide: the aside shows beside the main column. Narrow: its sheet is open. */
  readonly isAsideOpen: boolean;
  /** The sheet asks to close (its close button, Escape). */
  readonly onAsideClose: () => void;
  /** Says when the layout turns narrow or wide, so the caller's toggle opens a sheet or folds the column. */
  readonly onNarrowChange?: (isNarrow: boolean) => void;
  /** Fills the height its parent gives it, so a main column that fills (the week grid) reaches the view's foot. */
  readonly isFill?: boolean;
  readonly children: ReactNode;
}

/**
 * A main column with an aside at its start (the Bookings calendars, as Google Calendar keeps its calendars beside
 * the grid). It follows its own width: wide, the aside is a `size-measure` column the caller folds; narrower than a
 * medium container beside it, the aside leaves the page and opens as a sheet (Panel) instead.
 */
export function AsideLayout({
  aside,
  asideLabel,
  isAsideOpen,
  onAsideClose,
  onNarrowChange,
  isFill = false,
  children,
}: AsideLayoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isNarrow, setNarrow] = useState(false);
  const told = useRef(onNarrowChange);
  const last = useRef(false);
  useEffect(() => {
    told.current = onNarrowChange;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (width: number) => {
      // Not laid out yet (a story before its frame): keep what it was.
      if (width <= 0) return;
      const next = width < NARROW_BELOW;
      if (next === last.current) return;
      last.current = next;
      setNarrow(next);
      told.current?.(next);
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const isBeside = !isNarrow && isAsideOpen;
  return (
    <div ref={ref} className={styles.root} data-aside={isBeside || undefined} data-fill={isFill || undefined}>
      {isBeside && (
        <aside className={styles.aside} aria-label={asideLabel}>
          {aside}
        </aside>
      )}
      <div className={styles.main}>{children}</div>
      {isNarrow && (
        <Panel title={asideLabel} isOpen={isAsideOpen} onClose={onAsideClose}>
          {aside}
        </Panel>
      )}
    </div>
  );
}
