import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './Stats.module.css';
import { strings } from './strings.ts';

/** One figure: what it counts, its value now, and what it was before. */
export interface StatItem {
  readonly id: string;
  /** What it counts ("Meetings booked"). */
  readonly label: string;
  /** The figure, formatted ("12", "$4,200"). */
  readonly value: string;
  /** The figure it is read against, in words ("8 last week"). */
  readonly comparison?: string;
  /** Which way it moved against `comparison`: an arrow, in no colour, since up isn't always good. */
  readonly trend?: 'up' | 'down' | 'same';
}

/** Props for Stats. */
export interface StatsProps {
  /** What the figures are, for screen readers ("This week"). */
  readonly label: string;
  readonly items: readonly StatItem[];
  /** Draws `items.length` (or 4) figures as skeletons while they load. */
  readonly isLoading?: boolean;
}

/** A row of figures that wraps: Home's metrics, this week against last. */
export function Stats({ label, items, isLoading = false }: StatsProps) {
  if (isLoading) {
    const count = Math.max(items.length, 4);
    return (
      <div className={styles.root} aria-busy="true" aria-label={label} role="group">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={styles.stat}>
            <Skeleton width="short" />
            <Skeleton width="medium" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className={styles.root} aria-label={label}>
      {items.map((item) => (
        <div key={item.id} className={styles.stat}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
          {item.comparison !== undefined && (
            <dd className={styles.comparison}>
              {item.trend === 'up' || item.trend === 'down' ? (
                <>
                  <Icon name={item.trend === 'up' ? 'arrow-up' : 'arrow-down'} size="xs" />
                  <VisuallyHidden>{item.trend === 'up' ? strings.up : strings.down}</VisuallyHidden>
                </>
              ) : null}
              {item.comparison}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
