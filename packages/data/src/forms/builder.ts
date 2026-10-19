// `@crm/data/forms`: the form rules the builder screens share with the
// server (spec 0023, 0023-experience.md), so a screen checks a draft the way
// a publish will and never imports `@crm/contracts` itself. Plain TypeScript
// with no Zod: the builder's route loads it.
import type { FormDocument, FormLanguage, PublicForm } from '@crm/contracts/forms';

export {
  ANSWER_TYPES,
  CHOICE_TYPES,
  FILES_ONTO,
  FORM_CHOICES_MAX,
  FORM_QUESTIONS_MAX,
  FORM_SLUG,
  fitsAttribute,
  freeKey,
  keyFromLabel,
  NO_PLACEHOLDER_TYPES,
  publishProblem,
  QUESTION_PRESETS,
  slugFromName,
  type PublishAttribute,
  type PublishProblem,
  type QuestionPreset,
} from '@crm/contracts/forms';
export type { FormAfter, FormLanguage, FormLook, PublicQuestion } from '@crm/contracts/forms';

/**
 * A draft as its visitor would get it, for the builder's preview: what the
 * server's `publicFormOf` makes of a published version, from the same
 * document. Empty choices are left out; a blank placeholder or sub heading
 * is none.
 */
export function previewOf(
  document: FormDocument,
  context: { readonly key: string; readonly versionNumber?: number; readonly language?: FormLanguage },
): PublicForm {
  return {
    key: context.key,
    status: 'live',
    versionNumber: context.versionNumber ?? 1,
    headline: document.headline,
    ...(document.subheading === undefined || document.subheading === '' ? {} : { subheading: document.subheading }),
    buttonText: document.buttonText,
    language: context.language ?? document.language,
    look: document.look,
    questions: document.questions.map((question) => ({
      id: question.id,
      key: question.key,
      label: question.label,
      answerType: question.answerType,
      ...(question.choices === undefined ? {} : { choices: question.choices.filter((choice) => choice.trim() !== '') }),
      ...(question.placeholder === undefined || question.placeholder === ''
        ? {}
        : { placeholder: question.placeholder }),
      required: question.required,
    })),
    ...(document.after.kind === 'message' && document.after.message !== '' ? { thanks: document.after.message } : {}),
    offersMeeting: false,
  };
}
