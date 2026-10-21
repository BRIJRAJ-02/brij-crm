import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { Hue } from '../../hue.ts';
import styles from './TeamList.module.css';

/** Where a member stands right now: free, taken, or neither (their day is clear or over). */
export type TeamPresence = 'free' | 'busy' | 'clear';

/** The hue each presence's dot takes. */
const HUE: Readonly<Record<TeamPresence, Hue>> = { free: 'green', busy: 'orange', clear: 'gray' };

/** One member's row. */
export interface TeamRow {
  readonly id: string;
  readonly name: string;
  /** Their picture; initials without one. */
  readonly avatarSrc?: string;
  readonly presence: TeamPresence;
  /** The presence in words ("Free now", "In a meeting", "Busy"). */
  readonly status: string;
  /** One quiet line after the status ("Until 3:30 PM · Next: Intro call, 4:00 PM"). */
  readonly detail?: string;
}

/** Props for TeamList. */
export interface TeamListProps {
  /** What the rows are ("Team today"). */
  readonly label: string;
  readonly rows: readonly TeamRow[];
  /** Draws three skeleton rows. */
  readonly isLoading?: boolean;
}

/** Members as rows, each with their picture, name, where they stand now and what is next: Home's Team today. */
export function TeamList({ label, rows, isLoading = false }: TeamListProps) {
  if (isLoading) {
    return (
      <ul className={styles.root} aria-label={label} aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.row}>
            <Skeleton shape="circle" />
            <span className={styles.text}>
              <Skeleton width="medium" />
              <Skeleton width="long" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={styles.root} aria-label={label}>
      {rows.map((row) => (
        <li key={row.id} className={styles.row}>
          <Avatar
            name={row.name}
            id={row.id}
            {...(row.avatarSrc === undefined ? {} : { src: row.avatarSrc })}
            isDecorative
          />
          <span className={styles.text}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.line}>
              <StatusDot hue={HUE[row.presence]}>{row.status}</StatusDot>
              {row.detail !== undefined && <span className={styles.detail}>{row.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
