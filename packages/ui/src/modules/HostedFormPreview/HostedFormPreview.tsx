import type { PublicForm } from '@crm/contracts/forms';
import { useEffect, useRef } from 'react';
import { mountHostedForm, type HostedFormHandle } from '../../public-form/hosted-form.ts';

/** Props for HostedFormPreview. */
export interface HostedFormPreviewProps {
  /** The form as a visitor gets it: the builder's draft, turned into the public shape. */
  readonly form: PublicForm;
  /**
   * `preview` (the default) is the builder's column: inert, never focusable or
   * submittable, hidden from assistive tech but for a note that it is a
   * preview. `page` draws it as its own page that checks answers and thanks,
   * but sends nothing: a draft opened to try.
   */
  readonly mode?: 'preview' | 'page';
}

/**
 * The form a visitor fills in, drawn by the hosted page's own renderer, so
 * the builder shows exactly what goes live. It redraws as the form changes.
 */
export function HostedFormPreview({ form, mode = 'preview' }: HostedFormPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HostedFormHandle | undefined>(undefined);

  // Drawn once, then redrawn in place as the form changes.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    if (handleRef.current === undefined) handleRef.current = mountHostedForm(root, form, { mode });
    else handleRef.current.update(form);
  }, [form, mode]);

  // Removed when the mode changes (drawn again above) and when the preview goes.
  useEffect(
    () => () => {
      handleRef.current?.destroy();
      handleRef.current = undefined;
    },
    [mode],
  );

  return <div ref={rootRef} />;
}
