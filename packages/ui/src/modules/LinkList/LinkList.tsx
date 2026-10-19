import type { ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import styles from './LinkList.module.css';

/** One link's row. */
export interface LinkRow {
  readonly id: string;
  readonly title: string;
  /** A quiet tag after the title ("Off"). */
  readonly tag?: string;
  /** Its address ("/b/Xy12…"). */
  readonly address: string;
  /** Short facts as chips ("30 min", "Own hours", "In person"). */
  readonly chips: readonly string[];
  /** Copy link and the row menu. */
  readonly actions: ReactNode;
}

/** Props for LinkList. */
export interface LinkListProps {
  /** What the rows are ("Booking pages"). */
  readonly label: string;
  readonly rows: readonly LinkRow[];
  /** Opens a row's editor (its title is the button). */
  readonly onOpen: (id: string) => void;
  /** Shown with no rows: usually an EmptyState. */
  readonly emptyState?: ReactNode;
}

/**
 * Links as rows, not a table (spec 0025 experience, the host's list): the
 * title as a button that opens it, a quiet tag, the address, chips for its
 * facts, and its actions at the end. Rows part with a hairline and wrap their
 * chips on a narrow screen.
 */
export function LinkList({ label, rows, onOpen, emptyState }: LinkListProps) {
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <ul className={styles.root} aria-label={label}>
      {rows.map((row) => (
        <li key={row.id} className={styles.row}>
          <div className={styles.main}>
            <div className={styles.titleLine}>
              <Button variant="ghost" onPress={() => onOpen(row.id)}>
                {row.title}
              </Button>
              {row.tag !== undefined && <Badge text={row.tag} />}
            </div>
            <span className={styles.address}>{row.address}</span>
            {row.chips.length > 0 && (
              <ul className={styles.chips}>
                {row.chips.map((chip) => (
                  <li key={chip}>
                    <Badge text={chip} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.actions}>{row.actions}</div>
        </li>
      ))}
    </ul>
  );
}
