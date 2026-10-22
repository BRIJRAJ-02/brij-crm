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
   * A word or two shown in place of the label in a narrow container (under 480px, a phone's bar), so the dot never
   * stands alone; screen readers still read the full label. For a status beside a name that must keep its room: an
   * editor's "Live · edited" becomes Edited in the TopBar.
   */
  readonly shortLabel?: string;
  /**
   * Takes its colour and type from where it sits rather than its own: a dot inside a control that sets them (a
   * SegmentedControl's segment, a menu item), so it reads like the words beside it, chosen or not.
   */
  readonly isInherited?: boolean;
}

/** A status as a dot in its hue and its label: the status attribute's one display. */
export function StatusDot({ children, hue, isArchived = false, shortLabel, isInherited = false }: StatusDotProps) {
  return (
    <span
      className={styles.root}
      data-archived={isArchived || undefined}
      data-inherit={isInherited || undefined}
      data-short={shortLabel === undefined ? undefined : ''}
    >
      <span className={styles.dot} data-hue={isArchived ? 'gray' : hue} aria-hidden="true" />
      {shortLabel !== undefined ? (
        // The full words are read from the hidden copy at every width; the shown ones are for sight: the label in a
        // wide container, the short word in a narrow one.
        <>
          <span className={styles.label} data-truncated="" data-width="wide" aria-hidden="true">
            {children}
          </span>
          <span className={styles.label} data-width="narrow" aria-hidden="true">
            {shortLabel}
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
