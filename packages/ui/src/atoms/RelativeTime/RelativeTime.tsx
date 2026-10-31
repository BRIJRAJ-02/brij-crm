import { formatExactTime, formatRelative } from '../../lib/format.ts';
import { formatMoment } from '../../lib/moment.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './RelativeTime.module.css';
import { strings } from './strings.ts';

/** Under this many milliseconds a moment reads "just now". */
const MINUTE = 60_000;

/** Props for RelativeTime. */
export interface RelativeTimeProps {
  /** The instant, ISO 8601 in UTC (`2026-10-08T11:30:00.000Z`). */
  readonly value: string;
  /**
   * `moment` reads a date and time someone set (the field types pass): "Today 14:30" near today, else
   * "8 Oct 2026, 14:30", never "3 hours ago". `relative` (the default) is how long ago something happened.
   */
  readonly variant?: 'relative' | 'moment';
}

/**
 * A moment as "3 hours ago", in the provider's language, kept current by the
 * shared clock (every 30 seconds). Past a week it shows the date. The exact
 * time, with its time zone, is in a tooltip for a pointer, and read after the
 * relative time by screen readers, so it never needs a hover.
 */
export function RelativeTime({ value, variant = 'relative' }: RelativeTimeProps) {
  const { locale, timeZone, dateFormat } = useFormatSettings();
  const now = useNow();
  const exact = formatExactTime(value, locale, timeZone);
  return (
    <Tooltip content={exact} isTextTrigger>
      <>
        <time className={styles.root} dateTime={value}>
          {/* "just now" is English; other languages keep their own word for now from Intl. */}
          {variant === 'moment'
            ? formatMoment(value, now, locale, timeZone, dateFormat)
            : locale.startsWith('en') && Math.abs(new Date(value).getTime() - now) < MINUTE
              ? strings.justNow
              : formatRelative(value, now, locale, timeZone, dateFormat)}
        </time>
        <VisuallyHidden>{strings.exact(exact)}</VisuallyHidden>
      </>
    </Tooltip>
  );
}
