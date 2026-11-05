// The business page's opening hours (spec 0066, AC-6641): the week from today on, a line a day, each day's ranges in the visitor's
// language, today marked, closed days said so. Times are the place's own; a visitor in another zone is told whose.
import type { PlaceHoursShape } from '@crm/contracts/hospitality';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import styles from './BusinessHours.module.css';
import { fromToday, weekRows, zoneCity } from './hours.ts';
import { strings } from './strings.ts';

/** Props for BusinessHours. */
export interface BusinessHoursProps {
  readonly hours: PlaceHoursShape;
  /** The place's time zone: the hours are its wall clock's. */
  readonly timeZone: string;
  /** The language and clock style to read times in (the place's, `placeLocale`); the visitor's when absent. */
  readonly locale?: string;
}

/** The week's hours as a description list, a line a day from today on, today in weight and marked "Today". */
export function BusinessHours({ hours, timeZone, locale: given }: BusinessHoursProps) {
  const { locale: visitorLocale, timeZone: visitorZone } = useFormatSettings();
  const locale = given ?? visitorLocale;
  const now = useNow();
  const rows = fromToday(weekRows(hours, now, timeZone, locale));
  return (
    <div className={styles.root}>
      <dl className={styles.list}>
        {rows.map((row) => (
          <div key={row.day} className={styles.row} data-today={row.isToday || undefined}>
            <dt className={styles.day}>
              {row.name}
              {/* Neutral: the guest look's accent is the ink, and today is a mark, not a call to act. */}
              {row.isToday && <Badge text={strings.today} />}
            </dt>
            <dd className={styles.ranges}>
              {row.ranges.length === 0 ? (
                <span className={styles.closed}>{strings.closedAllDay}</span>
              ) : (
                row.ranges.map((range, index) => (
                  <span key={range} className={styles.range}>
                    {index < row.ranges.length - 1 ? `${range},` : range}
                  </span>
                ))
              )}
            </dd>
          </div>
        ))}
      </dl>
      {visitorZone !== timeZone && <p className={styles.zone}>{strings.timesIn(zoneCity(timeZone))}</p>}
    </div>
  );
}
