import type { PublicForm } from '@crm/contracts/forms';
import { HostedForm } from '../../public-form/HostedForm.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import type { PageBrand } from '../BookingFrame/BookingFrame.tsx';

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
  /** A brand kit to wear in place of the one the form's read names (Settings › Brand's preview, spec 0060). */
  readonly brand?: PageBrand;
}

/**
 * The form a visitor fills in, drawn by the hosted page's own component, so
 * the builder shows exactly what goes live: the same tree, the same controls.
 */
export function HostedFormPreview({ form, mode = 'preview', logo, brand }: HostedFormPreviewProps) {
  return (
    <HostedForm
      key={mode}
      form={form}
      mode={mode}
      {...(logo === undefined ? {} : { logo })}
      {...(brand === undefined ? {} : { brand })}
    />
  );
}
