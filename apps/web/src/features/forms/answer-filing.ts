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
 * the CRM saves the filed answers on the record and marks the answers not saved, the same group on every submission.
 */
export function answerFiling(
  answers: readonly SubmissionAnswer[],
  crm: SubmissionCrm,
  isFiling: boolean,
  /** The answers filing refused or skipped (late trap #50): filed on a field, but not saved on the record. */
  refused: readonly { readonly questionId: string }[] = [],
): AnswerFiling {
  const none: ReadonlySet<string> = new Set();
  if (!isFiling) return { note: strings.answersKeptOnly, marked: none, mark: '' };
  // While it is being added, the Records section says so; the answers need no line of their own.
  if (crm.state === 'filing') return { marked: none, mark: '' };
  if (crm.state === 'not_in_crm') return { note: strings.answersNotInCrm, marked: none, mark: '' };
  const notSaved = new Set(refused.map((each) => each.questionId));
  const isSaved = (answer: SubmissionAnswer) => answer.attributeId !== undefined && !notSaved.has(answer.questionId);
  const filed = answers.filter(isSaved);
  const kept = answers.filter((answer) => !isSaved(answer));
  if (kept.length === 0) return { note: strings.answersAllSaved, marked: none, mark: '' };
  if (filed.length === 0) return { note: strings.answersNoneSaved, marked: none, mark: '' };
  // The ones not saved are marked, whichever group is larger: never mapped to a field, or refused when filed (the
  // panel's Callout says why for those).
  return {
    note: strings.answersSomeSaved(filed.length, answers.length),
    marked: new Set(kept.map((each) => each.questionId)),
    mark: strings.notSavedMark,
  };
}

/** One reason filing gave, and the questions it covers: answers refused for the same cause read as one line. */
export interface NotSavedReason {
  readonly message: string;
  readonly labels: readonly string[];
}

/** The refused answers grouped by reason, in the order they came, each with its questions' labels. */
export function notSavedReasons(
  answers: readonly SubmissionAnswer[],
  refused: readonly { readonly questionId: string; readonly message: string }[],
): readonly NotSavedReason[] {
  const labelOf = new Map(answers.map((answer) => [answer.questionId, answer.label]));
  const byMessage = new Map<string, string[]>();
  for (const each of refused) {
    const label = labelOf.get(each.questionId);
    if (label === undefined) continue;
    byMessage.set(each.message, [...(byMessage.get(each.message) ?? []), label]);
  }
  return [...byMessage].map(([message, labels]) => ({ message, labels }));
}
