import type { ReactNode } from 'react';
import { FieldError as AriaFieldError } from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import styles from './FieldError.module.css';

/** Props for FieldError. */
export interface FieldErrorProps {
  /** The message: what to do, in one short sentence ("Pick one of the choices."). */
  readonly children: ReactNode;
  /**
   * `field` (the default) is React Aria's own error inside a field (a radio group, a checkbox, a Select): shown
   * while the field is invalid, and the field is described by it. `standalone` is a plain line with `id` for a
   * control that names its error itself (ChoiceChips, `aria-describedby`).
   */
  readonly kind?: 'field' | 'standalone';
  /** The line's id: a radio group's own, or the one a standalone control is described by. */
  readonly id?: string;
  /** `check` starts the line under a checkbox's words, past the box. */
  readonly inset?: 'check';
}

/**
 * The one error line every control draws under itself (the design critique, 5 November 2026): the alert mark,
 * then the message, in the danger colour at the label size. Field keeps its own (it fades in and can float under a
 * grid cell); every other control draws this one, so a Rating's or a choice's error reads like a text field's.
 */
export function FieldError({ children, kind = 'field', id, inset }: FieldErrorProps) {
  const body = (
    <>
      <Icon name="circle-alert" size="xs" />
      {children}
    </>
  );
  if (kind === 'standalone') {
    return (
      <p className={styles.root} id={id} data-inset={inset}>
        {body}
      </p>
    );
  }
  return (
    <AriaFieldError className={styles.root} data-inset={inset} {...(id === undefined ? {} : { id })}>
      {body}
    </AriaFieldError>
  );
}
