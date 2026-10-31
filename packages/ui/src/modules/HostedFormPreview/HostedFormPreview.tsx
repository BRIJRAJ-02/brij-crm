import type { PublicForm } from '@crm/contracts/forms';
import { HostedForm } from '../../public-form/HostedForm.tsx';
import { HostedFormSteps } from '../../public-form/HostedFormSteps.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';

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
  /** The Timefix wordmark under the form; defaults to the web app's own files, as on the hosted page. */
  readonly logo?: ProductLogo;
}

/**
 * The form a visitor fills in, drawn by the hosted page's own component, so
 * the builder shows exactly what goes live: the same tree, the same controls,
 * in the form's own layout (Classic, Steps or One at a time, spec 0063).
 */
export function HostedFormPreview({ form, mode = 'preview', logo }: HostedFormPreviewProps) {
  const layout = form.layout ?? 'classic';
  // A change of layout starts the preview again, from its first step.
  const Drawn = layout === 'classic' ? HostedForm : HostedFormSteps;
  return <Drawn key={`${mode}-${layout}`} form={form} mode={mode} {...(logo === undefined ? {} : { logo })} />;
}
