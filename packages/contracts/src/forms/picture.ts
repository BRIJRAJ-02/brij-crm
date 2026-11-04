// A form's picture on its list card (5 November 2026, the owner: "make these cards look much prettier"): the draft's
// headline and first questions, drawn by the hosted page's own component at a thumbnail's size, so each card shows
// its own form. No Zod at run time: the server's list and the browser's data layer both make it from a document.
import type { FormDocument } from './document.ts';
import type { FormPicture } from './forms.ts';
import type { PublicQuestion } from './public.ts';

/** How many questions a card's picture draws: what a thumbnail shows before its foot crops it. */
export const FORM_PICTURE_QUESTIONS = 3;

/** One question as the picture draws it: its words and type, never where its answer is filed or when it shows. */
function pictureQuestionOf(question: FormDocument['questions'][number]): PublicQuestion {
  const choices = (question.choices ?? []).filter((choice) => choice.trim() !== '');
  return {
    id: question.id,
    key: question.key,
    label: question.label,
    answerType: question.answerType,
    ...(choices.length === 0 ? {} : { choices }),
    ...(question.placeholder === undefined || question.placeholder === '' ? {} : { placeholder: question.placeholder }),
    ...(question.options === undefined ? {} : { options: question.options }),
    required: question.required,
  };
}

/**
 * A draft's picture: its headline, line, button and look, and its first visible questions (a hidden one is a link's
 * tag, never drawn). The brand theme is left out: the card draws the form's own Light or Dark, with no stylesheet to
 * load per card.
 */
export function formPictureOf(document: FormDocument): FormPicture {
  return {
    headline: document.headline,
    ...(document.subheading === undefined || document.subheading === '' ? {} : { subheading: document.subheading }),
    buttonText: document.buttonText,
    layout: document.layout,
    colour: document.look.colour,
    corners: document.look.corners,
    questions: document.questions
      .filter((question) => question.answerType !== 'hidden')
      .slice(0, FORM_PICTURE_QUESTIONS)
      .map(pictureQuestionOf),
  };
}
