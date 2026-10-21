// The stat strip under a record's header and over a record panel's tabs (13
// Oct reference batch 4): a few counts and the last activity, each a label
// over its value, side by side.
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import { useId, type ReactNode } from 'react';
import styles from './RecordStats.module.css';
import { strings } from './strings.ts';

/**
 * One stat: a count (`count`, a floor with `isCountAtLeast`), a moment
 * (`time`, shown as "3 hours ago"), or a value the screen draws (`value`).
 * None of them, and not loading, reads "None".
 * With `onPress` it is a button that goes where the stat comes from (its tab).
 */
export interface RecordStat {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly count?: number;
  readonly isCountAtLeast?: boolean;
  /** An instant, ISO 8601 in UTC: shown as "3 hours ago", or "in 2 days" ahead. */
  readonly time?: string;
  /** Any other value, drawn by the screen through its field's one display (a deal's value: `AttributeDisplay`). */
  readonly value?: ReactNode;
  /** Still coming: a skeleton in place of the value. */
  readonly isLoading?: boolean;
  readonly onPress?: () => void;
}

/** Props for RecordStats. */
export interface RecordStatsProps {
  /** What the strip sums up, for screen readers ("About Northwind Traders"). */
  readonly label: string;
  readonly stats: readonly RecordStat[];
}

/**
 * A row of a record's stats in a hairline box, split by hairlines: each a
 * label (with its icon) over its value in the heading type. A stat that goes
 * somewhere is pressed anywhere on its tile (its label is the button, its
 * value read with it); the strip wraps in a narrow slot.
 */
export function RecordStats({ label, stats }: RecordStatsProps) {
  const { locale } = useFormatSettings();
  const idBase = useId();
  if (stats.length === 0) return null;
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  return (
    <div className={styles.frame} role="group" aria-label={label}>
      <dl className={styles.root}>
        {stats.map((stat) => {
          let value;
          if (stat.isLoading === true) value = <Skeleton width="short" />;
          else if (stat.count !== undefined)
            value = stat.isCountAtLeast === true ? strings.atLeast(number(stat.count)) : number(stat.count);
          else if (stat.time !== undefined) value = <RelativeTime value={stat.time} />;
          else if (stat.value !== undefined && stat.value !== null) value = stat.value;
          else value = <span className={styles.none}>{strings.none}</span>;
          const head = (
            <>
              {stat.icon !== undefined && <Icon name={stat.icon} size="sm" tone="muted" />}
              {stat.label}
            </>
          );
          const valueId = `${idBase}-${stat.id}`;
          return (
            <div key={stat.id} className={styles.stat} data-goes={stat.onPress === undefined ? undefined : ''}>
              <dt className={styles.label}>
                {stat.onPress === undefined ? (
                  head
                ) : (
                  // The label is the button, stretched over the tile, so the value (a time with its own tooltip)
                  // never sits inside it; the value is read with it.
                  <button type="button" className={styles.go} aria-describedby={valueId} onClick={stat.onPress}>
                    {head}
                  </button>
                )}
              </dt>
              <dd id={valueId} className={styles.value} aria-busy={stat.isLoading === true || undefined}>
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
