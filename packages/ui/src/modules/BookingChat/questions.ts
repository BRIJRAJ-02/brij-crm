// A booking page's own questions asked in Book by chat (4 Nov 2026, chat parity): which ones show now, what a typed or
// tapped reply means as an answer, and whether the form's own check takes it. The same rules as the details step:
// `visibleQuestions` for Show when, `checkAnswers` for each answer, `answerOf` for a phone's shape.
import { checkAnswers, visibleQuestions, type PublicQuestion } from '@crm/contracts/forms';
import { countriesIn } from '../../lib/countries.ts';
import { answerOf } from '../../public-form/Question.tsx';

/** The questions that show for these answers, in the page's order (Show when reads only earlier ones). */
export function chatQuestions(
  questions: readonly PublicQuestion[],
  answers: Readonly<Record<string, unknown>>,
): readonly PublicQuestion[] {
  if (questions.length === 0) return questions;
  const shown = visibleQuestions(questions, answers);
  return questions.filter((question) => shown.has(question.key));
}

/** The chips a question is answered with in chat, or undefined for one answered by typing. */
export function chatChipsOf(question: PublicQuestion, words: ChatAnswerWords): readonly string[] | undefined {
  switch (question.answerType) {
    case 'choice':
    case 'dropdown':
      return question.choices ?? [];
    case 'yes_no':
      return [words.yes, words.no];
    case 'checkbox':
      // A tick box is usually agreeing to something: required, only the agreeing chip.
      return question.required ? [words.agree] : [words.agree, words.noThanks];
    default:
      return undefined;
  }
}

/** The words the chips and checks above use, from the page's strings. */
export interface ChatAnswerWords {
  readonly yes: string;
  readonly no: string;
  readonly agree: string;
  readonly noThanks: string;
  readonly unknownCountry: string;
}

/** A reply as a question's answer: the value the booking sends, or the reason it can't be one. */
export type ChatAnswer = { readonly value: unknown } | { readonly problem: string };

/**
 * What `text` (typed, or a chip's words) answers `question` with, checked as the details step checks it. A phone is
 * read in the visitor's guessed country unless it starts with a +, and a country by its name or its code.
 */
export function chatAnswerOf(
  question: PublicQuestion,
  text: string,
  words: ChatAnswerWords,
  countryGuess: string | undefined,
): ChatAnswer {
  const said = text.trim();
  const value = ((): unknown => {
    switch (question.answerType) {
      case 'yes_no':
      case 'checkbox':
        return said === words.yes || said === words.agree;
      case 'phone':
        return answerOf(question, { country: countryGuess ?? 'US', national: said });
      case 'country': {
        const lower = said.toLowerCase();
        return countriesIn('en').find(
          (country) => country.code.toLowerCase() === lower || country.name.toLowerCase() === lower,
        )?.code;
      }
      default:
        return said;
    }
  })();
  if (question.answerType === 'country' && value === undefined) return { problem: words.unknownCountry };
  const checked = checkAnswers({ language: 'en', questions: [question] }, { [question.key]: value });
  if (checked.ok) return { value };
  return { problem: checked.fields[question.key] ?? words.unknownCountry };
}
