// Form templates (spec 0063, AC-6323, AC-6324): the ready forms New form
// offers as picture tiles. The ids and the tile's shape live here, because the
// gallery, the `forms.templates` read and the `forms.createFromTemplate`
// mutation all have to agree on them; each template's own questions and
// filing live in code, in `packages/core/src/forms/templates/`, and never on
// the wire. A template id is untrusted input, so it is checked against this
// list and never used to look anything up.
import * as z from 'zod';
import { FORM_LAYOUTS } from './path.ts';
import { PublicQuestion } from './public.ts';

/**
 * The templates the gallery offers, in the order AC-6323 names them: Blank
 * first, then one per kind of form.
 *
 * **Booking intake (ends with Book a meeting)** was released on 3 November
 * 2026. Its ending needs a booking page, which a template cannot know: every
 * workspace's pages are its own and a new workspace has none. So the draft
 * resolves one at the time it is made, the way `filesOnto` resolves an
 * attribute: the maker's own first live personal page they can use, else the
 * first live page of the workspace's they can use, and with none at all the
 * form simply thanks the visitor (core's `createFormFromTemplate`).
 *
 * **Lead qualification (with score)** was released with slice 5: its three
 * choice questions carry points, so the form scores. Where that score is filed
 * is left to the member, since no workspace is guaranteed a number attribute
 * to file it on (`scoreFiledOn` is theirs to set, not the template's to guess).
 */
export const OFFERED_FORM_TEMPLATE_IDS = [
  'blank',
  'contact_us',
  'demo_request',
  'lead_qualification',
  'event_signup',
  'feedback',
  'nps',
  'job_application',
  'booking_intake',
  'newsletter',
  'support_request',
  'customer_onboarding',
] as const;

/** Every template that exists in code (AC-6324): all of them are offered now. */
export const FORM_TEMPLATE_IDS = OFFERED_FORM_TEMPLATE_IDS;

/** One template that exists in code. */
export const FormTemplateId = z.enum(FORM_TEMPLATE_IDS, { error: 'That is not one of the form templates.' });
/** One template that exists in code. */
export type FormTemplateId = z.infer<typeof FormTemplateId>;

/** One template a person may actually start from: the only ids `forms.createFromTemplate` accepts. */
export const OfferedFormTemplateId = z.enum(OFFERED_FORM_TEMPLATE_IDS, {
  error: 'That is not one of the form templates.',
});
/** One template a person may actually start from. */
export type OfferedFormTemplateId = z.infer<typeof OfferedFormTemplateId>;

/** True when an id names a template the gallery offers (the check `createFromTemplate` makes before anything else). */
export function isOfferedTemplate(id: string): id is OfferedFormTemplateId {
  return (OFFERED_FORM_TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * One line of a tile's little preview, a shape rather than a control: a one
 * line box (`field`), a taller box (`long`), stacked choices, stars, a row of
 * numbers, a day, or a drop area. The tile draws these in the form's own
 * tokens, so a glance tells a feedback form from a signup one.
 */
export const FormTemplatePreviewRow = z.enum(['field', 'long', 'choices', 'rating', 'scale', 'date', 'upload']);
/** One line of a tile's little preview. */
export type FormTemplatePreviewRow = z.infer<typeof FormTemplatePreviewRow>;

/**
 * The most rows a preview draws. The tile's picture slot is `size-column-min` (80px) with `overflow: hidden`, and
 * three rows plus the button come to 78px in the tallest case (three `long` boxes); a fourth row is clipped, and
 * what gets clipped is the button at the foot. Raising this needs the slot to grow with it.
 */
export const FORM_TEMPLATE_PREVIEW_ROWS_MAX = 3;

/** A tile's little preview of the form it would make: the layout it uses, and the first few answers' shapes. */
export const FormTemplatePreview = z.object({
  layout: z.enum(FORM_LAYOUTS),
  // Blank shows no rows: it starts empty.
  rows: z.array(FormTemplatePreviewRow).max(FORM_TEMPLATE_PREVIEW_ROWS_MAX),
});
/** A tile's little preview of the form it would make. */
export type FormTemplatePreview = z.infer<typeof FormTemplatePreview>;

/**
 * One tile in the gallery (AC-6323): its name, its one line purpose, and a
 * small preview of its look. Its id is an *offered* one, because the gallery
 * only ever lists templates a person may actually start from, which is what
 * lets `createFromTemplate` take a tile's id straight from a tile.
 */
export const FormTemplateSummary = z.object({
  id: OfferedFormTemplateId,
  name: z.string(),
  /** Why you would pick it, in one line. */
  purpose: z.string(),
  preview: FormTemplatePreview,
  /**
   * The form it makes, as a visitor would see it: the gallery's big preview beside the list draws it with the hosted
   * page's own component. Its words and questions only, never filing, which is the workspace's.
   */
  sample: z.object({
    headline: z.string(),
    buttonText: z.string(),
    questions: z.array(PublicQuestion),
  }),
  /**
   * Keeps its submissions only (spec 0063, AC-6323): an anonymous form (Feedback, NPS) asks no name or email and
   * adds nobody to the CRM. Absent: its answers go to the CRM as every form's do.
   */
  keepsSubmissionsOnly: z.boolean().optional(),
});
/** One tile in the gallery. */
export type FormTemplateSummary = z.infer<typeof FormTemplateSummary>;
