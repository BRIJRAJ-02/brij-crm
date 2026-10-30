import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
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
  /** Where the records behind the figure are (Home's New people opens People): its label becomes a link there. */
  readonly href?: string;
}

/** How many figures loading draws when none are known yet: Home's row holds five. */
const LOADING_COUNT = 5;

/** Props for Stats. */
export interface StatsProps {
  /** What the figures are, for screen readers ("This week"). */
  readonly label: string;
  readonly items: readonly StatItem[];
  /** Draws `items.length` (or 5) figures as skeletons while they load. */
  readonly isLoading?: boolean;
}

/** A row of figures that wraps: Home's metrics, this week against last. Nothing at all with no figures. */
export function Stats({ label, items, isLoading = false }: StatsProps) {
  if (!isLoading && items.length === 0) return null;
  return (
    <div role="group" aria-label={label} aria-busy={isLoading || undefined}>
      {isLoading ? (
        <div className={styles.root}>
          {Array.from({ length: Math.max(items.length, LOADING_COUNT) }, (_, index) => (
            <div key={index} className={styles.stat}>
              <Skeleton width="short" />
              <div className={styles.value}>
                <Skeleton width="medium" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <dl className={styles.root}>
          {items.map((item) => (
            <div key={item.id} className={styles.stat}>
              <dt className={styles.label}>
                {item.href === undefined ? item.label : <Link href={item.href}>{item.label}</Link>}
              </dt>
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
      )}
    </div>
  );
}
