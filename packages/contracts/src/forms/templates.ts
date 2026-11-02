// Form templates (spec 0063, AC-6323, AC-6324): the ready forms New form
// offers as picture tiles. The ids and the tile's shape live here, because the
// gallery, the `forms.templates` read and the `forms.createFromTemplate`
// mutation all have to agree on them; each template's own questions and
// filing live in code, in `packages/core/src/forms/templates/`, and never on
// the wire. A template id is untrusted input, so it is checked against this
// list and never used to look anything up.
import * as z from 'zod';
import { FORM_LAYOUTS } from './path.ts';

/**
 * The templates the gallery offers, in the order AC-6323 names them: Blank
 * first, then one per kind of form.
 *
 * Two of AC-6323's twelve are missing on purpose. **Lead qualification (with
 * score)** needs points and a score (**AC-6316**) and **Booking intake (ends
 * with Book a meeting)** needs a custom ending (**AC-6315**), and both land
 * with slice 5 of this spec. Both templates are already written in
 * `packages/core/src/forms/templates/catalog.ts`, and both are covered by the
 * AC-6324 test; they are only held out of what a person can pick, because a
 * tile that quietly drops the thing it is named after is worse than one not
 * offered yet. To release them once slice 5 lands: give each template its
 * `points`/`scoreFiledOn` or its ending, then move its id out of
 * `HELD_FORM_TEMPLATE_IDS` into this list, `lead_qualification` after
 * `demo_request` and `booking_intake` after `job_application`, where AC-6323
 * puts them.
 */
export const OFFERED_FORM_TEMPLATE_IDS = [
  'blank',
  'contact_us',
  'demo_request',
  'event_signup',
  'feedback',
  'nps',
  'job_application',
  'newsletter',
  'support_request',
  'customer_onboarding',
] as const;

/** The templates written in code but not offered yet; see `OFFERED_FORM_TEMPLATE_IDS` for what each one is waiting for. */
export const HELD_FORM_TEMPLATE_IDS = ['lead_qualification', 'booking_intake'] as const;

/** Every template that exists in code, offered or not: what the AC-6324 test covers. */
export const FORM_TEMPLATE_IDS = [...OFFERED_FORM_TEMPLATE_IDS, ...HELD_FORM_TEMPLATE_IDS] as const;

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
  rows: z.array(FormTemplatePreviewRow).min(1).max(FORM_TEMPLATE_PREVIEW_ROWS_MAX),
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
});
/** One tile in the gallery. */
export type FormTemplateSummary = z.infer<typeof FormTemplateSummary>;
