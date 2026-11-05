// A form's picture on its list card (5 November 2026, the owner, pointing at the booking page cards: "make something
// like this for forms as well"): its first visible questions as shapes, never their words, so the card draws an
// abstract form beside the booking cards' abstract month. No Zod at run time: the server's list and the browser's data
// layer both make it from a document.
import { CHOICE_TYPES } from './answer-types.ts';
import type { FormDocument } from './document.ts';
import type { FormPicture, FormPictureQuestion } from './forms.ts';

/** How many questions a card's picture draws: what its sheet shows above the button. */
export const FORM_PICTURE_QUESTIONS = 2;

/** One question as the picture draws it: its type, and its choices' count when it is answered by a pick. */
function pictureQuestionOf(question: FormDocument['questions'][number]): FormPictureQuestion {
  if (!CHOICE_TYPES.includes(question.answerType)) return { answerType: question.answerType };
  const choices = (question.choices ?? []).filter((choice) => choice.trim() !== '');
  return { answerType: question.answerType, choiceCount: choices.length };
}

/** A draft's picture: its first visible questions (a hidden one is a link's tag, never drawn). */
export function formPictureOf(document: FormDocument): FormPicture {
  return {
    questions: document.questions
      .filter((question) => question.answerType !== 'hidden')
      .slice(0, FORM_PICTURE_QUESTIONS)
      .map(pictureQuestionOf),
  };
}
