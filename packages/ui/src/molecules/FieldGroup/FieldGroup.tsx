import { useId, type ReactNode } from 'react';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
import styles from './FieldGroup.module.css';

/** Props for FieldGroup. */
export interface FieldGroupProps {
  /** The label over the content, in a Field's label style. */
  readonly label: string;
  /** A short fact after the label on its line, in the same quiet colour ("Kolkata time (GMT+5:30)"). */
  readonly meta?: string;
  /** A quiet control at the label row's end (a ghost "Edit" or "Manage" Button). */
  readonly action?: ReactNode;
  /** One short line under the content. */
  readonly hint?: string;
  /** `row` sets the content in a wrapping row, `space-6` apart (a few Badges, then a Button); `block` stacks it. */
  readonly layout?: 'block' | 'row';
  /** `heading` draws the label as a section's heading over labelled values (a submission's Answers in a Panel). */
  readonly tone?: 'label' | 'heading';
  /** Draws the label as a heading of this level, so screen readers can move between sections by heading. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly children: ReactNode;
}

/**
 * A labelled block of read only content in a form's rhythm: a Field's label above, a quiet action at that row's
 * end, the content, then one hint line. For what a form shows but doesn't edit in place (a schedule's week, the
 * calendars checked for conflicts), so it lines up with the fields around it.
 */
export function FieldGroup({
  label,
  meta,
  action,
  hint,
  layout = 'block',
  tone = 'label',
  headingLevel,
  children,
}: FieldGroupProps) {
  const labelId = useId();
  const hintId = useId();
  // The meta stays outside the label, so the group's name is the label alone.
  const name = (
    <span className={styles.title}>
      <FieldLabel as="text" id={labelId} label={label} tone={tone} />
      {meta !== undefined && <span className={styles.meta}> · {meta}</span>}
    </span>
  );
  return (
    <div
      className={styles.root}
      data-tone={tone === 'heading' ? 'heading' : undefined}
      role="group"
      aria-labelledby={labelId}
      {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
    >
      <div className={styles.head}>
        {headingLevel === undefined ? name : <Heading level={headingLevel}>{name}</Heading>}
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

/** The label as a heading of the asked level; the reset gives it the label's own font and no margin. */
function Heading({ level, children }: { readonly level: 2 | 3 | 4; readonly children: ReactNode }) {
  if (level === 2) return <h2>{children}</h2>;
  if (level === 3) return <h3>{children}</h3>;
  return <h4>{children}</h4>;
}
