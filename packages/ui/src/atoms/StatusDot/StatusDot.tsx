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
  /**
   * In a narrow container (under 480px, a phone's bar) only the dot shows; the label stays for screen readers. For a
   * status beside a name that must keep its room: an editor's Draft or Live in the TopBar.
   */
  readonly isLabelCollapsible?: boolean;
}

/** A status as a dot in its hue and its label: the status attribute's one display. */
export function StatusDot({ children, hue, isArchived = false, isLabelCollapsible = false }: StatusDotProps) {
  return (
    <span className={styles.root} data-archived={isArchived || undefined}>
      <span className={styles.dot} data-hue={isArchived ? 'gray' : hue} aria-hidden="true" />
      {isLabelCollapsible ? (
        // The words are read from the hidden copy at every width; the shown one is for sight and goes on a phone.
        <>
          <span className={styles.label} data-truncated="" data-collapsible="" aria-hidden="true">
            {children}
          </span>
          <VisuallyHidden>{children}</VisuallyHidden>
        </>
      ) : (
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      )}
      {isArchived && <VisuallyHidden> {strings.archived}</VisuallyHidden>}
    </span>
  );
}
