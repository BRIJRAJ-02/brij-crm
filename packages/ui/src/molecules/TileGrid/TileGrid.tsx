import type { ReactNode } from 'react';
import styles from './TileGrid.module.css';

/** Props for TileGrid. */
export interface TileGridProps {
  /** The tiles, usually Cards. A tile that renders nothing leaves no gap: the rest close up. */
  readonly children: ReactNode;
  /**
   * `fit` (the default) shares the width among the tiles there are, so two tiles fill a wide page (Home).
   * `fill` keeps empty tracks, so every tile is the same width however many there are (SettingsGrid: one card
   * per calendar).
   */
  readonly fill?: 'fit' | 'fill';
  /**
   * `auto` (the default) fits as many columns as the width holds. `two` holds at most two, each at least the
   * panel's width: two on a wide page, one on a phone or a narrow window (Home's sections).
   */
  readonly columns?: 'auto' | 'two';
}

/**
 * Cards side by side that wrap (Home's Today, Tasks due and Team today): as many columns as fit at
 * the panel's width or more, one column on a phone, each tile as tall as its own content.
 */
export function TileGrid({ children, fill = 'fit', columns = 'auto' }: TileGridProps) {
  return (
    <div
      className={styles.root}
      data-fill={fill === 'fill' ? fill : undefined}
      data-columns={columns === 'two' ? columns : undefined}
    >
      {children}
    </div>
  );
}
