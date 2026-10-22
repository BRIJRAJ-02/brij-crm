// How a submission's panel says which answers went to the CRM (spec 0023, the submission panel): once for the
// section, marking only the answers that differ, rather than "Not filed" on every row.
import type { SubmissionAnswer, SubmissionCrm } from '@crm/data';
import { strings } from './strings.ts';

/** The Answers section's quiet line, and the answers marked as the exception with the mark's words. */
export interface AnswerFiling {
  /** One line for the whole section ("Kept with the submission"); absent when there is nothing to say. */
  readonly note?: string;
  /** The answers marked (by question id), and the words after their label. */
  readonly marked: ReadonlySet<string>;
  readonly mark: string;
}

/**
 * Says filing once: a form that files nothing, or a submission not in the CRM, keeps every answer with it; one in
 * the CRM saves the filed answers on the record and marks whichever group is smaller, so the exceptions stand out.
 */
export function answerFiling(
  answers: readonly SubmissionAnswer[],
  crm: SubmissionCrm,
  isFiling: boolean,
): AnswerFiling {
  const none: ReadonlySet<string> = new Set();
  if (!isFiling) return { note: strings.answersKeptOnly, marked: none, mark: '' };
  // While it is being added, the Records section says so; the answers need no line of their own.
  if (crm.state === 'filing') return { marked: none, mark: '' };
  if (crm.state === 'not_in_crm') return { note: strings.answersNotInCrm, marked: none, mark: '' };
  const filed = answers.filter((answer) => answer.attributeId !== undefined);
  const kept = answers.filter((answer) => answer.attributeId === undefined);
  if (kept.length === 0) return { note: strings.answersAllSaved, marked: none, mark: '' };
  if (filed.length === 0) return { note: strings.answersNoneSaved, marked: none, mark: '' };
  const note = strings.answersSomeSaved(filed.length, answers.length);
  if (kept.length <= filed.length) {
    return { note, marked: new Set(kept.map((each) => each.questionId)), mark: strings.notSavedMark };
  }
  return { note, marked: new Set(filed.map((each) => each.questionId)), mark: strings.savedMark };
}
