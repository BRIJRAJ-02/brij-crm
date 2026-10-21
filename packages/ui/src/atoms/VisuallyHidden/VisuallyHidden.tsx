import type { ReactNode } from 'react';
import { VisuallyHidden as AriaVisuallyHidden } from 'react-aria-components';

/** Props for VisuallyHidden. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Shows what it holds while focus is inside it: a skip link. */
  readonly isFocusable?: boolean;
  /** Its `id`, so a control can name it in `aria-describedby`: why a button is off, said only to screen readers. */
  readonly id?: string;
}

/** Text for screen readers only: it is in the page and read aloud, but takes no space on screen. */
export function VisuallyHidden({ children, isFocusable = false, id }: VisuallyHiddenProps) {
  return (
    <AriaVisuallyHidden isFocusable={isFocusable} {...(id === undefined ? {} : { id })}>
      {children}
    </AriaVisuallyHidden>
  );
}
