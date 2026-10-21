import { Separator as AriaSeparator } from 'react-aria-components';
import styles from './Separator.module.css';

/** Props for Separator. */
export interface SeparatorProps {
  /** `horizontal` (the default) between stacked groups, `vertical` between toolbar groups. */
  readonly orientation?: 'horizontal' | 'vertical';
  /**
   * A word between two hairlines, across only: "or" between two ways to go
   * on (Continue with Google, then the email, on sign in). The word is read
   * as plain text where it stands; the lines are drawn, not announced.
   */
  readonly label?: string;
}

/**
 * A hairline between groups of content or controls, announced as a
 * separator. With `label`, a word between two hairlines ("or"), read in
 * place as text.
 */
export function Separator({ orientation = 'horizontal', label }: SeparatorProps) {
  if (label !== undefined) {
    return (
      <div className={styles.labelled}>
        <span className={styles.word}>{label}</span>
      </div>
    );
  }
  return <AriaSeparator className={styles.root} orientation={orientation} />;
}
