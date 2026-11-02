// The form templates (spec 0063, AC-6323, AC-6324): the catalog, the pure
// draft builder, and the gallery's list. Which templates a person is offered
// is `OFFERED_FORM_TEMPLATE_IDS` in `@crm/contracts`, so the contract, the
// gallery and this module can't disagree about it.
import { OFFERED_FORM_TEMPLATE_IDS, type FormTemplateId, type FormTemplateSummary } from '@crm/contracts';
import { FORM_TEMPLATES } from './catalog.ts';

export { FORM_TEMPLATES, FORM_TEMPLATES_VERSION, type FormTemplate, type FormTemplateQuestion } from './catalog.ts';
export { templateDocument, type TemplateAttribute, type TemplateTarget } from './draft.ts';

/** One template by id. The id is only ever one the contract's enum already accepted, so this never looks up free text. */
export function formTemplate(id: FormTemplateId) {
  return FORM_TEMPLATES[id];
}

/**
 * The gallery's tiles (AC-6323), in the order the contract offers them: each
 * template's name, its one line purpose, and the small preview of its look.
 * A template held back in code is not in this list.
 */
export function offeredFormTemplates(): FormTemplateSummary[] {
  return OFFERED_FORM_TEMPLATE_IDS.map((id) => {
    const template = FORM_TEMPLATES[id];
    return {
      // `id`, not `template.id`: the offered id's own type is what `FormTemplateSummary` carries.
      id,
      name: template.name,
      purpose: template.purpose,
      preview: { layout: template.layout, rows: [...template.preview] },
    };
  });
}
