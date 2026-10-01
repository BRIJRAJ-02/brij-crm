import { Separator as AriaSeparator } from 'react-aria-components';
import styles from './Separator.module.css';

/** Props for Separator. */
export interface SeparatorProps {
  /** `horizontal` (the default) between stacked groups, `vertical` between toolbar groups. */
  readonly orientation?: 'horizontal' | 'vertical';
}

/** A hairline between groups of content or controls, announced as a separator. */
export function Separator({ orientation = 'horizontal' }: SeparatorProps) {
  return <AriaSeparator className={styles.root} orientation={orientation} />;
}
