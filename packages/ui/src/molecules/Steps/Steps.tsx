import { Button as AriaButton } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './Steps.module.css';
import { strings } from './strings.ts';

/** One step. */
export interface Step {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * `list` (the default): every step named, with its marker. `count`: one
 * quiet line, "Step 2 of 3", where the flow's own title names the step
 * (first run's split card).
 */
export type StepsVariant = 'list' | 'count';

/**
 * The list's direction: `vertical` (the default), a column; `horizontal`, one
 * row joined by hairlines across the top of a page (import), which turns back
 * into the column when its slot is under 480px wide (a phone).
 */
export type StepsOrientation = 'vertical' | 'horizontal';

/** Props for Steps. */
export interface StepsProps {
  /** What the steps are for ("Import progress"). */
  readonly label: string;
  readonly steps: readonly Step[];
  /** The step under way; those before it are done. */
  readonly current: string;
  /** The step that failed, if one did. */
  readonly failed?: string;
  /** `list` (the default) or `count`. */
  readonly variant?: StepsVariant;
  /** The list's direction: `vertical` (the default) or `horizontal`. */
  readonly orientation?: StepsOrientation;
  /** Makes each done step a button that goes back to it (import's earlier steps); done steps are plain text without it. */
  readonly onStepPress?: (id: string) => void;
}

type StepState = 'done' | 'current' | 'upcoming' | 'failed';

/** Numbered steps through a flow (import, two factor setup, onboarding): done, current and still to come, or failed. */
export function Steps({
  label,
  steps,
  current,
  failed,
  variant = 'list',
  orientation = 'vertical',
  onStepPress,
}: StepsProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);
  if (variant === 'count') {
    // One line, read where it stands; the flow's title names the step. A step not in the list counts from the first.
    // A span, so it can sit in a heading's line (Card's eyebrow).
    return <span className={styles.count}>{strings.count(Math.max(currentIndex, 0) + 1, steps.length)}</span>;
  }
  const stateOf = (index: number, id: string): StepState => {
    if (id === failed) return 'failed';
    if (index < currentIndex) return 'done';
    return index === currentIndex ? 'current' : 'upcoming';
  };
  const list = (
    <ol className={styles.root} aria-label={label} data-orientation={orientation}>
      {steps.map((step, index) => {
        const state = stateOf(index, step.id);
        const body = (
          <>
            <span className={styles.marker} aria-hidden="true">
              {state === 'done' ? (
                <Icon name="check" size="xs" />
              ) : state === 'failed' ? (
                <Icon name="x" size="xs" />
              ) : (
                index + 1
              )}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{step.label}</span>
              {step.description !== undefined && <span className={styles.description}>{step.description}</span>}
            </span>
            {state !== 'current' && state !== 'upcoming' && <VisuallyHidden> {strings[state]}</VisuallyHidden>}
          </>
        );
        return (
          <li
            key={step.id}
            className={styles.step}
            data-state={state}
            {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
          >
            {state === 'done' && onStepPress !== undefined ? (
              <AriaButton className={styles.press} onPress={() => onStepPress(step.id)}>
                {body}
              </AriaButton>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
  // The row reads its slot's width, so the frame is the container its query asks.
  return orientation === 'horizontal' ? <div className={styles.frame}>{list}</div> : list;
}
