import type { ReactNode } from 'react';
import styles from './Stage.module.css';

/** Props for Stage. */
export interface StageProps {
  /** `row` wraps pieces side by side (the default); `column` stacks them. */
  readonly direction?: 'row' | 'column';
  /** `narrow` holds the pieces to the sidebar's width, to show how they cut long text. */
  readonly width?: 'auto' | 'narrow';
  /** `grid` gives a table a fixed height to scroll in: a header and twelve rows. */
  readonly height?: 'auto' | 'grid';
  readonly children: ReactNode;
}

/**
 * Lays out a story's pieces with the artifact's stage spacing. Stories and
 * artifact previews only: it is not exported from `@crm/ui`, and screens lay
 * out with real modules.
 */
export function Stage({ direction = 'row', width = 'auto', height = 'auto', children }: StageProps) {
  return (
    <div className={styles.root} data-direction={direction} data-width={width} data-height={height}>
      {children}
    </div>
  );
}
