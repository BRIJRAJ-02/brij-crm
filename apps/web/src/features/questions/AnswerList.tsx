// Brief
// Purpose: a visitor's answers, label then answer (spec 0023's submission panel; spec 0057's booking card, AC-5714).
// Main task: read each answer as its words, a phone through the field set, and copy the ones worth copying.
// Leaves out: where the answers went (the caller says it once), editing them.
import type { SubmissionAnswer } from '@crm/data';
import { AttributeDisplay, DescriptionList } from '@crm/ui';
import type { ReactNode } from 'react';
import { answerWords } from '@crm/data/forms';
import { FileValue, PhoneValue } from '@crm/contracts/values';
import { strings } from './strings.ts';

/** An answer as words: text, Yes or No, a phone's number, a file's name, and the newer shapes. Never markup. */
export function answerText(answer: Pick<SubmissionAnswer, 'value'>): string {
  // The shared reading (spec 0063): a file's name, a phone's number, the picks, an address, a date and time.
  return answerWords(answer.value, { yes: strings.yes, no: strings.no });
}

/** Whether an answer holds a stored file (by its value's shape, as `answerText` reads it). */
export function holdsFile(answer: Pick<SubmissionAnswer, 'value'>): boolean {
  return FileValue.safeParse(answer.value).success;
}

/**
 * An answer's value as a panel shows it: a phone through the field set, spaced for reading; everything else as
 * its words, which wrap whole. An email or a website stays plain text, never a link, since a visitor typed it.
 */
function answerValue(answer: SubmissionAnswer): ReactNode {
  const text = answerText(answer);
  if (text === '') return strings.noAnswer;
  if (answer.answerType === 'file') {
    // The stored file through the field set: its icon and name, a download link the api checks on every open.
    const file = FileValue.safeParse(answer.value);
    if (!file.success) return text;
    return (
      <AttributeDisplay
        attribute={{
          id: answer.questionId,
          name: answer.label,
          type: 'file',
          allowMultiple: false,
          isRequired: false,
          isUnique: false,
          isReadOnly: true,
        }}
        value={file.data}
        surface="panel"
      />
    );
  }
  if (answer.answerType !== 'phone') return text;
  // A phone the field set can read is a stored { number, country }; anything else shows as its words.
  const phone = PhoneValue.safeParse(answer.value);
  if (!phone.success) return text;
  return (
    <AttributeDisplay
      attribute={{
        id: answer.questionId,
        name: answer.label,
        type: 'phone',
        allowMultiple: false,
        isRequired: false,
        isUnique: false,
        isReadOnly: true,
      }}
      value={phone.data}
      surface="panel"
    />
  );
}

/** The answers worth copying (an email, a phone, a website), with what copying gives: a phone's full number. */
const COPYABLE: ReadonlySet<string> = new Set(['email', 'phone', 'website']);

/** What copying an answer copies, and its button's name. */
function answerCopy(answer: SubmissionAnswer): { readonly value: string; readonly label: string } | undefined {
  if (!COPYABLE.has(answer.answerType)) return undefined;
  const text = answerText(answer);
  return text === '' ? undefined : { value: text, label: strings.copyAnswer(answer.label) };
}

/** Props for the answers. */
export interface AnswerListProps {
  readonly answers: readonly SubmissionAnswer[];
  /** The words after an answer's label when it is the exception ("Not saved"), by answer; none for the rest. */
  readonly markOf?: (answer: SubmissionAnswer) => string | undefined;
}

/** The answers in their question order, stacked, each label then its answer. */
export function AnswerList({ answers, markOf }: AnswerListProps) {
  return (
    <DescriptionList
      layout="stacked"
      items={answers.map((answer) => {
        const copy = answerCopy(answer);
        const mark = markOf?.(answer);
        return {
          id: answer.questionId,
          term: mark === undefined ? answer.label : `${answer.label} · ${mark}`,
          description: answerValue(answer),
          ...(answerText(answer) === '' ? { isPlaceholder: true } : {}),
          ...(copy === undefined ? {} : { copy }),
        };
      })}
    />
  );
}
