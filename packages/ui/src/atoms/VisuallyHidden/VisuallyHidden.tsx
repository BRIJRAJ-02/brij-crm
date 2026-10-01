import type { ReactNode } from 'react';
import { VisuallyHidden as AriaVisuallyHidden } from 'react-aria-components';

/** Props for VisuallyHidden. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
}

/** Text for screen readers only: it is in the page and read aloud, but takes no space on screen. */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <AriaVisuallyHidden>{children}</AriaVisuallyHidden>;
}
