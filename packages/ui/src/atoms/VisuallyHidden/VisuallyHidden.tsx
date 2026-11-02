import type { ReactNode } from 'react';
import { VisuallyHidden as AriaVisuallyHidden } from 'react-aria-components';

/** Props for VisuallyHidden. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Shows what it holds while focus is inside it: a skip link. */
  readonly isFocusable?: boolean;
  /** Its `id`, so a control can name it in `aria-describedby`: why a button is off, said only to screen readers. */
  readonly id?: string;
  /**
   * `span` where only phrasing content is allowed: inside a `p`, an `a`, a `button` or a heading. The default
   * `div` nested in a paragraph is invalid HTML, which React reports as a hydration error and browsers repair
   * by closing the paragraph early, moving the rest of the sentence out of it.
   */
  readonly elementType?: 'div' | 'span';
}

/** Text for screen readers only: it is in the page and read aloud, but takes no space on screen. */
export function VisuallyHidden({ children, isFocusable = false, id, elementType = 'div' }: VisuallyHiddenProps) {
  return (
    <AriaVisuallyHidden isFocusable={isFocusable} elementType={elementType} {...(id === undefined ? {} : { id })}>
      {children}
    </AriaVisuallyHidden>
  );
}
