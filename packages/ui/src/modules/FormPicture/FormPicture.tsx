import type { Hue } from '../../hue.ts';
import styles from './FormPicture.module.css';

/**
 * One question as the picture draws it, as a shape, never its words: a field (`text`), a taller field (`long`), two
 * or three pills (`choices`, `count` of them), a row of dots (`rating`) or a box and a line (`check`).
 */
export type FormPictureField =
  { readonly kind: 'text' | 'long' | 'rating' | 'check' } | { readonly kind: 'choices'; readonly count: number };

/** Props for FormPicture. */
export interface FormPictureProps {
  /** The form's name, as its list names it. */
  readonly title: string;
  /** Its questions, already worded ("3 questions"). */
  readonly count: string;
  /** Its first questions as shapes, top to bottom. The picture draws the first two. */
  readonly fields: readonly FormPictureField[];
  /** The form's colour (`linkHue(form.id)`: a form has none of its own): its mark, a picked choice and its button. */
  readonly hue: Hue;
}

/** The most questions the sheet draws before its button: what shows above the stage's foot. */
const MOST_FIELDS = 2;
/** The most pills a choice question draws, and the fewest, so it always reads as a choice. */
const MOST_PILLS = 3;
const FEWEST_PILLS = 2;
/** A rating's dots, and how many of them are lit. */
const RATING_DOTS = 5;
const RATING_LIT = 3;

/**
 * A form in miniature for LinkCard's picture (5 November 2026, the booking page card's sibling): its mark, name and
 * question count over its first questions as shapes (a label bar over a field, pills for a choice, dots for a
 * rating) and a button in its colour. Shapes and the form's own name only; hidden from screen readers by the card's
 * stage.
 */
export function FormPicture({ title, count, fields, hue }: FormPictureProps) {
  return (
    <div className={styles.root} data-hue={hue}>
      <div className={styles.head}>
        <span className={styles.mark} />
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          <span className={styles.count}>{count}</span>
        </span>
      </div>
      <div className={styles.body}>
        {fields.slice(0, MOST_FIELDS).map((field, at) => (
          // A fixed drawing: its rows never move, so their place is their key.
          <span key={at} className={styles.field} data-kind={field.kind}>
            <span className={styles.label} />
            <FieldShape field={field} />
          </span>
        ))}
        <span className={styles.button} />
      </div>
    </div>
  );
}

/** The answer's shape under its label bar. */
function FieldShape({ field }: { readonly field: FormPictureField }) {
  if (field.kind === 'choices') {
    const pills = Math.min(Math.max(field.count, FEWEST_PILLS), MOST_PILLS);
    return (
      <span className={styles.row}>
        {Array.from({ length: pills }, (_, at) => (
          <span key={at} className={styles.pill} data-picked={at === 0 ? '' : undefined} />
        ))}
      </span>
    );
  }
  if (field.kind === 'rating') {
    return (
      <span className={styles.row}>
        {Array.from({ length: RATING_DOTS }, (_, at) => (
          <span key={at} className={styles.star} data-lit={at < RATING_LIT ? '' : undefined} />
        ))}
      </span>
    );
  }
  if (field.kind === 'check') {
    return (
      <span className={styles.row}>
        <span className={styles.box} />
        <span className={styles.line} />
      </span>
    );
  }
  return <span className={styles.input} data-long={field.kind === 'long' ? '' : undefined} />;
}
