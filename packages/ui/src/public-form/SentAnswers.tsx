// What a visitor sent, read back on the thank you (spec 0058, AC-19). Its own chunk, loaded after the form draws:
// the hosted page's first load has no room for it, and nobody needs it before they send.
import type { PublicForm } from '@crm/contracts/forms';
import { Fragment } from 'react';
import styles from './SentAnswers.module.css';
import type { HostedFormState } from './use-hosted-form.ts';

/**
 * An answer as words. It reads the held value itself rather than through Question's helpers, so this chunk shares
 * no module with the form's first load (sharing one splits it into a chunk of its own, which the first load pays
 * for): a file's name, a phone as typed, the rest as given.
 */
function textOf(answerType: string, value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object' || value === null) return '';
  const field = answerType === 'file' ? 'name' : answerType === 'phone' ? 'national' : '';
  const text: unknown = field === '' ? undefined : (value as Readonly<Record<string, unknown>>)[field];
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * Each shown question that has an answer, its label beside the answer, from the answers the page already holds. A
 * tick box or a yes or no is left out (its label is the whole answer, and "true" is nobody's word); a file shows its
 * name, a phone its number as typed. Nothing at all when nothing was answered.
 */
export function SentAnswers({
  form,
  state,
}: {
  readonly form: PublicForm;
  readonly state: Pick<HostedFormState, 'answers' | 'shown' | 'words'>;
}) {
  const sent = form.questions.flatMap((question) => {
    if (!state.shown.has(question.key)) return [];
    const text = textOf(question.answerType, state.answers[question.key]);
    return text === ''
      ? []
      : [
          {
            key: question.key,
            label: question.label.trim() === '' ? state.words.untitledQuestion : question.label,
            text,
          },
        ];
  });
  if (sent.length === 0) return null;
  return (
    <dl className={styles.root}>
      {sent.map((answer) => (
        <Fragment key={answer.key}>
          <dt className={styles.label}>{answer.label}</dt>
          <dd className={styles.text}>{answer.text}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
