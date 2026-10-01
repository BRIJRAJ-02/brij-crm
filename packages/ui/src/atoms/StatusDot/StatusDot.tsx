import type { Hue } from '../../hue.ts';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { strings } from '../Tag/strings.ts';
import styles from './StatusDot.module.css';

/** Props for StatusDot. */
export interface StatusDotProps {
  /** The status's label. */
  readonly children: string;
  /** The status's hue. */
  readonly hue: Hue;
  /** An archived status, still on old values: gray, with "(archived)" for screen readers. */
  readonly isArchived?: boolean;
}

/** A status as a dot in its hue and its label: the status attribute's one display. */
export function StatusDot({ children, hue, isArchived = false }: StatusDotProps) {
  return (
    <span className={styles.root} data-archived={isArchived || undefined}>
      <span className={styles.dot} data-hue={isArchived ? 'gray' : hue} aria-hidden="true" />
      <span className={styles.label} data-truncated="">
        {children}
      </span>
      {isArchived && <VisuallyHidden> {strings.archived}</VisuallyHidden>}
    </span>
  );
}
