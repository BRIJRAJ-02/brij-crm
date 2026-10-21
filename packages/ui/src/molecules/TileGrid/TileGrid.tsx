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
}

/**
 * Cards side by side that wrap (Home's Today, Tasks due and Team today): as many columns as fit at
 * the panel's width or more, one column on a phone, each tile as tall as its own content.
 */
export function TileGrid({ children, fill = 'fit' }: TileGridProps) {
  return (
    <div className={styles.root} data-fill={fill === 'fill' ? fill : undefined}>
      {children}
    </div>
  );
}
