import styles from './Mention.module.css';

/** Props for Mention. */
export interface MentionProps {
  /** Who is mentioned, as shown ("@Ada Lovelace"). */
  readonly children: string;
}

/** A mention of a member in a note or a comment, in the accent's soft tint. */
export function Mention({ children }: MentionProps) {
  return <span className={styles.root}>{children}</span>;
}
