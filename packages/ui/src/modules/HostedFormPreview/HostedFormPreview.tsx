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
  /**
   * Steps and One at a time: which step, or which question, the preview shows (from 0), the one being edited beside
   * it (spec 0063). The inert preview can't be stepped through, so the builder points it.
   */
  readonly step?: number;
}

/**
 * The form a visitor fills in, drawn by the hosted page's own component, so
 * the builder shows exactly what goes live: the same tree, the same controls,
 * in the form's own layout (Classic, Steps or One at a time, spec 0063).
 */
export function HostedFormPreview({ form, mode = 'preview', logo, step }: HostedFormPreviewProps) {
  const layout = form.layout ?? 'classic';
  const logoProps = logo === undefined ? {} : { logo };
  // A change of layout starts the preview again, from its first step.
  if (layout === 'classic') return <HostedForm key={`${mode}-${layout}`} form={form} mode={mode} {...logoProps} />;
  return (
    <HostedFormSteps
      key={`${mode}-${layout}`}
      form={form}
      mode={mode}
      {...logoProps}
      {...(step === undefined ? {} : { previewStep: step })}
    />
  );
}
