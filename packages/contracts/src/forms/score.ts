// A form's score (spec 0063, AC-6316): the points its answers carry, added up. Plain TypeScript, no Zod and no
// I/O, so the hosted page, the builder's preview and the submit endpoint all work it out the same way. The server
// runs it again over the stored answers and never trusts a number the page sent: the page's score is only what the
// visitor was shown. The Zod schemas live in `document.ts`.
import { pathOf, type PathForm, type PathQuestion } from './path.ts';

/**
 * A question's points (AC-6316): one number per choice, in the order of `choices` (a choice question, a multi
 * select, and a yes or no, whose two numbers are yes then no); or, for a rating and a scale, one number per point
 * it offers, lowest first, or `'value'` for the answer itself (a scale of 0 to 10 worth 0 to 10).
 */
export type FormPoints = readonly number[] | 'value';

/** The furthest a question's points may go either way, so a form's score stays a number worth reading. */
export const POINTS_LIMIT = 1_000;

/** What the score reads of a question: its type, its choices, a scale's ends, and its points. */
export interface ScoreQuestion extends PathQuestion {
  readonly answerType: string;
  readonly choices?: readonly string[] | undefined;
  readonly options?: { readonly from?: number | undefined } | undefined;
  readonly points?: FormPoints | undefined;
}

/** What `scoreOf` needs of a form: its layout, steps and questions, as the path reads them, with their points. */
export interface ScoreForm extends PathForm {
  readonly questions: readonly ScoreQuestion[];
}

/** The types whose answers may carry points (AC-6316). */
export const SCORED_TYPES: readonly string[] = ['choice', 'dropdown', 'multi_select', 'yes_no', 'rating', 'scale'];

/** The lowest point a rating or a scale offers: a rating starts at one star, a scale at its own `from`. */
function lowestOf(question: ScoreQuestion): number {
  return question.answerType === 'rating' ? 1 : (question.options?.from ?? 0);
}

/** One number from a points list, or zero when the list is shorter than the answer's place. */
function pointAt(points: readonly number[], at: number): number {
  const value = at < 0 ? undefined : points[at];
  return value === undefined || !Number.isFinite(value) ? 0 : value;
}

/** The choices an answer picked, by their words: one for a choice question, several for a multi select. */
function pickedOf(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  const { picked } = value as { readonly picked?: unknown };
  return Array.isArray(picked) ? picked.filter((each): each is string => typeof each === 'string') : [];
}

/** What one question's answer is worth (AC-6316); zero when it carries no points or the answer fits none of them. */
export function pointsOf(question: ScoreQuestion, answer: unknown): number {
  const { points } = question;
  if (points === undefined || answer === undefined || answer === null) return 0;
  if (!SCORED_TYPES.includes(question.answerType)) return 0;
  if (question.answerType === 'rating' || question.answerType === 'scale') {
    if (typeof answer !== 'number' || !Number.isFinite(answer)) return 0;
    // `'value'` makes the answer its own points: a scale of 0 to 10 is worth 0 to 10 with nothing to key in.
    return points === 'value' ? answer : pointAt(points, answer - lowestOf(question));
  }
  if (points === 'value') return 0;
  if (question.answerType === 'yes_no') return typeof answer === 'boolean' ? pointAt(points, answer ? 0 : 1) : 0;
  const choices = question.choices ?? [];
  const words = (text: string) => text.trim().toLowerCase();
  const at = new Map(choices.map((choice, index) => [words(choice), index]));
  // Other's own words are worth nothing: they are no choice of the question's, so they carry no points (AC-6310).
  return pickedOf(answer).reduce((sum, choice) => sum + pointAt(points, at.get(words(choice)) ?? -1), 0);
}

/**
 * A form's score for these answers (AC-6316): the points of every scored answer on the visitor's path, added up.
 * Questions off the path score nothing, so a forged submission carrying answers to skipped questions can never
 * raise the score, and neither can the number the page itself worked out: the server adds the stored answers up
 * again and uses only that.
 */
export function scoreOf(form: ScoreForm, answers: Readonly<Record<string, unknown>>): number {
  const path = pathOf(form, answers);
  const total = form.questions.reduce(
    (sum, question) => (path.keys.has(question.key) ? sum + pointsOf(question, answers[question.key]) : sum),
    0,
  );
  // Rounded to the nearest hundredth: fractional points add up in binary floating point, and a score reads as a number.
  return Math.round(total * 100) / 100;
}
