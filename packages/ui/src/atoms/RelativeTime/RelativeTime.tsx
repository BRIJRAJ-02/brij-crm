import { formatExactTime, formatRelative } from '../../lib/format.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import styles from './RelativeTime.module.css';

/** Props for RelativeTime. */
export interface RelativeTimeProps {
  /** The instant, ISO 8601 in UTC (`2026-10-08T11:30:00.000Z`). */
  readonly value: string;
}

/**
 * A moment as "3 hours ago", in the provider's language, kept current by the
 * shared clock (every 30 seconds). Past a week it shows the date. The exact
 * time, with its time zone, is in a tooltip.
 */
export function RelativeTime({ value }: RelativeTimeProps) {
  const { locale, timeZone } = useFormatSettings();
  const now = useNow();
  return (
    <Tooltip content={formatExactTime(value, locale, timeZone)} isTextTrigger>
      <time className={styles.root} dateTime={value}>
        {formatRelative(value, now, locale, timeZone)}
      </time>
    </Tooltip>
  );
}
