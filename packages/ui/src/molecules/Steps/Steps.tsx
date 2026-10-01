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

/** Props for Steps. */
export interface StepsProps {
  /** What the steps are for ("Import progress"). */
  readonly label: string;
  readonly steps: readonly Step[];
  /** The step under way; those before it are done. */
  readonly current: string;
  /** The step that failed, if one did. */
  readonly failed?: string;
}

type StepState = 'done' | 'current' | 'upcoming' | 'failed';

/** Numbered steps through a flow (import, two factor setup, onboarding): done, current and still to come, or failed. */
export function Steps({ label, steps, current, failed }: StepsProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);
  const stateOf = (index: number, id: string): StepState => {
    if (id === failed) return 'failed';
    if (index < currentIndex) return 'done';
    return index === currentIndex ? 'current' : 'upcoming';
  };
  return (
    <ol className={styles.root} aria-label={label}>
      {steps.map((step, index) => {
        const state = stateOf(index, step.id);
        return (
          <li
            key={step.id}
            className={styles.step}
            data-state={state}
            {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
          >
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
          </li>
        );
      })}
    </ol>
  );
}
