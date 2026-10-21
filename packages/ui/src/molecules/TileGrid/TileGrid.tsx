import type { ReactNode } from 'react';
import styles from './TileGrid.module.css';

/** Props for TileGrid. */
export interface TileGridProps {
  /** The tiles, usually Cards. A tile that renders nothing leaves no gap: the rest close up. */
  readonly children: ReactNode;
}

/**
 * Cards side by side that wrap (Home's Today, Tasks due and Needs attention): as many columns as fit at
 * the panel's width or more, one column on a phone, each tile as tall as its own content.
 */
export function TileGrid({ children }: TileGridProps) {
  return <div className={styles.root}>{children}</div>;
}
