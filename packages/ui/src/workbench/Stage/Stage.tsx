import type { ReactNode } from 'react';
import styles from './Stage.module.css';

/** Props for Stage. */
export interface StageProps {
  /** `row` wraps pieces side by side (the default); `column` stacks them. */
  readonly direction?: 'row' | 'column';
  readonly children: ReactNode;
}

/**
 * Lays out a story's pieces with the artifact's stage spacing. Stories and
 * artifact previews only: it is not exported from `@crm/ui`, and screens lay
 * out with real modules.
 */
export function Stage({ direction = 'row', children }: StageProps) {
  return (
    <div className={styles.root} data-direction={direction}>
      {children}
    </div>
  );
}
