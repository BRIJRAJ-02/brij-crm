// `@crm/data/forms`: the form rules the builder screens share with the
// server (spec 0023, 0023-experience.md), so a screen checks a draft the way
// a publish will and never imports `@crm/contracts` itself. Plain TypeScript
// with no Zod: the builder's route loads it.
import {
  formStrings,
  stepsOfBreaks as breaksToSteps,
  type FormDocument,
  type FormLanguage,
  type PublicForm,
} from '@crm/contracts/forms';

export {
  ANSWER_TYPES,
  answerWords,
  BOOKING_ANSWER_TYPES,
  CHOICE_TYPES,
  // The visitor's copy's own limits (forms fix b1: Settings' Email them a copy).
  CONFIRMATION_LINE_MAX,
  CONFIRMATION_SUBJECT_MAX,
  choiceKeysOf,
  FILES_ONTO,
  FORM_CHOICES_MAX,
  FORM_LAYOUTS,
  FORM_QUESTIONS_MAX,
  FORM_ENDINGS_MAX,
  FORM_STEP_TITLE_MAX,
  pathOf,
  // Jumps, the score and recall (spec 0063 slice 5): the builder's Flow view, its points rows and its preview.
  recall,
  recalledKeys,
  SCORE_FACT,
  SCORED_TYPES,
  scoreOf,
  STEP_JUMPS_MAX,
  stepsOfBreaks,
  type FormLayout,
  FORM_SLUG,
  fitsAttribute,
  freeKey,
  // The own form snippet's honeypot: a name autofill leaves alone, and the password managers' skip marks.
  HONEYPOT_IGNORE_ATTRIBUTES,
  HONEYPOT_INPUT_NAME,
  keyFromLabel,
  NO_PLACEHOLDER_TYPES,
  publishProblem,
  questionsProblem,
  QUESTION_PRESETS,
  slugFromName,
  type PublishAttribute,
  type PublishProblem,
  type QuestionPreset,
  // Show when and routing conditions (spec 0043): the editor's comparisons, summaries and the preview's hiding,
  // and the visit's hidden fields (UTM tags, page, referrer) a rule may read.
  CONDITION_OPS,
  CONDITIONS_MAX,
  HIDDEN_FIELDS,
  hiddenFactKey,
  isRecordFact,
  // Routing's shared layer (spec 0037, L7): skills, members with skills, and Known.
  KNOWN_FACT,
  KNOWN_VALUES,
  namedHosts,
  REQUIRED_SKILLS_MAX,
  requiredSkills,
  // A form's rules, at most (spec 0043): After they send stops offering a new one at the most.
  ROUTING_RULES_MAX,
  SKILL_GROUPS,
  SKILL_NAME_MAX,
  SKILLS_MAX,
  type KnownValue,
  matchesShowWhen,
  NUMBER_OPS,
  summarizeShowWhen,
  VALUELESS_OPS,
  visibleQuestions,
  type Condition,
  type ConditionOp,
  type HiddenField,
  type ShowWhen,
} from '@crm/contracts/forms';
export type {
  FormAfter,
  FormEnding,
  FormJump,
  FormLanguage,
  FormLook,
  FormLookTheme,
  FormQuestionPoints,
  FormStep,
  JumpTarget,
  PublicQuestion,
} from '@crm/contracts/forms';

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
      ...(question.showWhen === undefined ? {} : { showWhen: question.showWhen }),
      ...(question.options === undefined ? {} : { options: question.options }),
      // Jumps and points, as the server sends them (spec 0063): the preview jumps and scores as a visitor would.
      ...(question.jumps === undefined ? {} : { jumps: question.jumps }),
      ...(question.points === undefined ? {} : { points: question.points }),
    })),
    // As the server's `layoutOf`: nothing for Classic, the steps only with Steps, each with its own jumps.
    ...(document.layout === 'classic' ? {} : { layout: document.layout }),
    ...(document.layout === 'steps'
      ? {
          steps: breaksToSteps(document.questions, document.steps).map((step) => {
            const jumps = document.steps.find((each) => each.id === step.id)?.jumps;
            return { ...step, ...(jumps === undefined ? {} : { jumps }) };
          }),
        }
      : {}),
    // The endings a jump may land on (AC-6315); a booking button is the server's own, so the preview shows none.
    ...((document.endings ?? []).length === 0
      ? {}
      : {
          endings: (document.endings ?? []).map((ending) => ({
            id: ending.id,
            heading: ending.heading,
            ...(ending.line === undefined || ending.line === '' ? {} : { line: ending.line }),
            ...(ending.button?.kind === 'url'
              ? {
                  button: {
                    url: ending.button.url,
                    label: ending.button.label ?? formStrings(context.language ?? document.language).endingButton,
                  },
                }
              : {}),
          })),
        }),
    ...(document.after.kind === 'message' && document.after.message !== '' ? { thanks: document.after.message } : {}),
    offersMeeting: false,
  };
}
