// A template's first draft (spec 0063, AC-6323): one pure function that turns
// a template into a `FormDocument` against one workspace's own schema. Its
// dependencies come in as arguments and it reads nothing — no database, no
// env — so the AC-6324 test can parse every template without a workspace and
// the service can file them onto a real one.
import { fitsAttribute, type AttributeType, type FormDocument, type FormQuestion, type FormStep } from '@crm/contracts';
import type { FormTemplate, FormTemplateQuestion } from './catalog.ts';

/** An attribute as the filing needs it: enough to match a slug and check the answer fits. */
export interface TemplateAttribute {
  readonly id: string;
  readonly apiSlug: string;
  readonly type: AttributeType;
}

/** The object a template's answers file onto, with the attribute each submission is matched on. */
export interface TemplateTarget {
  readonly objectId: string;
  /** The object's live, non system attributes: what a question may be filed on. */
  readonly attributes: readonly TemplateAttribute[];
  /** The attribute a submission finds its record by (the first unique email), when the object has one. */
  readonly matchAttributeId?: string;
}

/**
 * The attribute a template question belongs on, or undefined: the target's
 * attribute with that slug, when the answer's type fits it. Matched by slug
 * and never by title, so a workspace that renamed "Job title" still gets the
 * filing, and a workspace that archived or never had the field gets none.
 */
function matchBySlug(question: FormTemplateQuestion, target: TemplateTarget | undefined): string | undefined {
  if (target === undefined || question.filesOnto === undefined) return undefined;
  const attribute = target.attributes.find((each) => each.apiSlug === question.filesOnto);
  if (attribute === undefined || !fitsAttribute(question.answerType, attribute.type)) return undefined;
  return attribute.id;
}

/**
 * One question as the document holds it. A matched slug becomes `filedOn`; an
 * answer that matches nothing is `kept`, which is what keeps it with the
 * submission and stops Save or Publish giving it a field of its own
 * (AC-6323: no field is created until publish, and then only for what the
 * member asks for).
 */
function questionOf(question: FormTemplateQuestion, target: TemplateTarget | undefined): FormQuestion {
  const attributeId = matchBySlug(question, target);
  return {
    id: question.id,
    key: question.key,
    label: question.label,
    answerType: question.answerType,
    required: question.required,
    update: 'fill',
    ...(question.placeholder === undefined ? {} : { placeholder: question.placeholder }),
    ...(question.choices === undefined ? {} : { choices: [...question.choices] }),
    ...(question.options === undefined ? {} : { options: question.options }),
    ...(question.points === undefined ? {} : { points: question.points }),
    ...(attributeId === undefined
      ? { kept: true as const }
      : { filedOn: { objectRole: 'main' as const, attributeId } }),
  };
}

/** The template's step breaks, in the questions' order: each question that starts one becomes a `FormStep`. */
function stepsOf(template: FormTemplate): FormStep[] {
  return template.questions.flatMap((question) =>
    question.step === undefined ? [] : [{ id: question.step.id, title: question.step.title, startsAt: question.id }],
  );
}

/**
 * The draft a template makes on one workspace: its questions filed onto the
 * target's matching standard attributes, everything else kept with the
 * submission, and the rest of the document at its defaults. With no target
 * (the member may write no object), the form keeps its submissions only and
 * files nothing, exactly as `forms.create` does.
 */
export function templateDocument(template: FormTemplate, target: TemplateTarget | undefined): FormDocument {
  const steps = stepsOf(template);
  return {
    questions: template.questions.map((question) => questionOf(question, target)),
    targets:
      target === undefined
        ? {}
        : {
            main: {
              objectId: target.objectId,
              ...(target.matchAttributeId === undefined ? {} : { matchAttributeId: target.matchAttributeId }),
            },
          },
    layout: template.layout,
    // Breaks are kept with every layout, but only a Steps template has any to keep.
    steps: template.layout === 'steps' ? steps : [],
    look: { colour: 'light', corners: 'rounded' },
    headline: template.headline,
    buttonText: template.buttonText,
    language: 'en',
    after: { kind: 'message', message: '' },
    routing: { rules: [] },
    spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
  };
}
