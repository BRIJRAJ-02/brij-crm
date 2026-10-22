import type { ReactNode } from 'react';
import styles from './SiteFrame.module.css';

/** Props for SiteFrame. */
export interface SiteFrameProps {
  readonly children: ReactNode;
}

/**
 * Every page's frame, dark in every theme (the tokens' dark values, set by `data-theme`): the ink, and the hairlines
 * on the content's edges with a cross where they meet the bar's.
 */
export function SiteFrame({ children }: SiteFrameProps) {
  return (
    <div className={styles.root} data-theme="dark">
      {children}
    </div>
  );
}
