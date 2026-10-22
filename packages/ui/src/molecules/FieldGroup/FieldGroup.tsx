import { useId, type ReactNode } from 'react';
import styles from './FieldGroup.module.css';

/** Props for FieldGroup. */
export interface FieldGroupProps {
  /** The label over the content, in a Field's label style. */
  readonly label: string;
  /** A quiet control at the label row's end (a ghost "Edit" or "Manage" Button). */
  readonly action?: ReactNode;
  /** One short line under the content. */
  readonly hint?: string;
  /** `row` sets the content in a wrapping row, `space-6` apart (a few Badges, then a Button); `block` stacks it. */
  readonly layout?: 'block' | 'row';
  readonly children: ReactNode;
}

/**
 * A labelled block of read only content in a form's rhythm: a Field's label above, a quiet action at that row's
 * end, the content, then one hint line. For what a form shows but doesn't edit in place (a schedule's week, the
 * calendars checked for conflicts), so it lines up with the fields around it.
 */
export function FieldGroup({ label, action, hint, layout = 'block', children }: FieldGroupProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div
      className={styles.root}
      role="group"
      aria-labelledby={labelId}
      {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
    >
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {action !== undefined && <span className={styles.action}>{action}</span>}
      </div>
      <div className={styles.content} data-layout={layout === 'row' ? 'row' : undefined}>
        {children}
      </div>
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
