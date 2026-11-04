import type { ReactNode } from 'react';
import styles from './Sentence.module.css';

/** Props for Sentence. */
export interface SentenceProps {
  /**
   * The muted word that opens the line: "When", "Then", "Only if". Left out, the line has no lead column and starts
   * at its own edge: a line that says where everyone else goes ("Otherwise → Step 3", "Everyone else sees …"), so on
   * a phone it isn't indented by an empty column (critique 9, 5 November 2026). An empty string keeps the column, for
   * a rule's second condition under its "If".
   */
  readonly lead?: string;
  /** Words and inline controls, in reading order: text, and Selects or Fields with their labels hidden. */
  readonly children: ReactNode;
  /** Something at the line's end, outside the sentence: a remove button. */
  readonly end?: ReactNode;
}

/**
 * One line of a rule read as a sentence (parity #53): a muted lead word, then words and small inline controls that
 * wrap together, as a sentence does. The controls bring their own look; the line gives them one baseline, one gap and
 * a row's height, so a Select, a Field and a plain word sit as if typed.
 */
export function Sentence({ lead, children, end }: SentenceProps) {
  return (
    <div className={styles.root} data-bare={lead === undefined || undefined}>
      {lead !== undefined && <span className={styles.lead}>{lead}</span>}
      <div className={styles.words}>{children}</div>
      <span className={styles.end}>{end}</span>
    </div>
  );
}
