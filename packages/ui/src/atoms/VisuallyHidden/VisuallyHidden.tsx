import type { ReactNode } from 'react';
import { VisuallyHidden as AriaVisuallyHidden } from 'react-aria-components';

/** Props for VisuallyHidden. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Shows what it holds while focus is inside it: a skip link. */
  readonly isFocusable?: boolean;
}

/** Text for screen readers only: it is in the page and read aloud, but takes no space on screen. */
export function VisuallyHidden({ children, isFocusable = false }: VisuallyHiddenProps) {
  return <AriaVisuallyHidden isFocusable={isFocusable}>{children}</AriaVisuallyHidden>;
}
