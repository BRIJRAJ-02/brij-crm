// Recall (spec 0063, AC-6317): an earlier answer, or the score, inside a question's label, its help line or an
// ending's words, written `{{key}}`. Plain TypeScript, no Zod and no I/O, so the hosted page, the builder's preview
// and the server all read the same words. Text in, text out: an answer is what a visitor typed, so a name holding
// `<b>` comes back with its angle brackets and is drawn as the characters they are, never as markup. Nothing here
// escapes or builds HTML, because nothing here ever produces any.
import { answerWords } from './answer-words.ts';

/** The fact key a recall reads for the form's score (AC-6316): `{{score}}`. */
export const SCORE_FACT = 'score';

/** What a recall may read: the answers by question key, and the score. */
export interface RecallFacts {
  readonly answers?: Readonly<Record<string, unknown>> | undefined;
  readonly score?: number | undefined;
  /** How a yes or no, and a signature, read; `answerWords`' own words otherwise. */
  readonly words?: { readonly yes?: string; readonly no?: string; readonly signed?: string } | undefined;
  /** Each question's answer type by key, where a shape alone can't say how it reads (a ranking, a signature). */
  readonly answerTypes?: Readonly<Record<string, string>> | undefined;
}

/** A recall, as it is written in a label or an ending: `{{key}}`, the key a question's or `score`. */
const RECALL = /\{\{\s*([a-z0-9_]{1,40})\s*\}\}/gi;

/** Every key a text recalls, in the order it reads them, each once (AC-6317): what publish checks. */
export function recalledKeys(text: string): readonly string[] {
  return [...new Set([...text.matchAll(RECALL)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])))];
}

/**
 * A text with each `{{key}}` replaced by the answer it names, as plain text (AC-6317): the score for
 * `{{score}}`, an answer's words through `answerWords` otherwise, and nothing at all for a key with no answer
 * yet, so a label never shows its own braces to a visitor. The result is text, never HTML: a caller draws it as
 * text (React does by default), and no caller may ever pass it to `innerHTML`.
 */
export function recall(text: string, facts: RecallFacts): string {
  const { answers = {}, score, words = {}, answerTypes = {} } = facts;
  return text.replaceAll(RECALL, (_whole, key: string) => {
    const fact = key.toLowerCase();
    if (fact === SCORE_FACT) return score === undefined ? '' : String(score);
    if (!Object.hasOwn(answers, key)) return '';
    const answerType = answerTypes[key];
    return answerWords(answers[key], { ...words, ...(answerType === undefined ? {} : { answerType }) });
  });
}
