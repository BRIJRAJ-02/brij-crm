import type { Hue } from '../../hue.ts';
import '../../lib/custom-properties.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './BookingPagePicture.module.css';

/** Props for BookingPagePicture. */
export interface BookingPagePictureProps {
  /** The page's title, as its guests read it. */
  readonly title: string;
  /** Its lengths, already worded ("30 min", "30 or 60 min"). */
  readonly lengths: string;
  /** Which days of the week it books, Monday first: seven of them, from its schedule's weekly hours. */
  readonly openDays: readonly boolean[];
  /** The page's colour: its mark and its open days. */
  readonly hue: Hue;
}

/** The week the picture draws, Monday first: 1 January 2024 was a Monday. */
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((day) => Date.UTC(2024, 0, day));

/**
 * A booking page in miniature for LinkCard's picture (5 November 2026; the Timefix prototype's look, spec 0072): its
 * mark, title and lengths over a week whose open days (from the page's own weekly hours) wear its colour, the first
 * one picked, each day's letter in the reader's language. Shapes and the page's own words only; hidden from screen
 * readers by the card's stage.
 */
export function BookingPagePicture({ title, lengths, openDays, hue }: BookingPagePictureProps) {
  const { locale } = useFormatSettings();
  const letter = memoIntl(
    `page-picture-day:${locale}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }),
  );
  const picked = openDays.indexOf(true);
  return (
    <div
      className={styles.root}
      style={{
        '--picture-mark': `var(--dot-${hue})`,
        '--picture-soft': `var(--tag-${hue}-bg)`,
        '--picture-ink': `var(--tag-${hue}-text)`,
      }}
    >
      <div className={styles.head}>
        <span className={styles.mark} />
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          <span className={styles.lengths}>{lengths}</span>
        </span>
      </div>
      <div className={styles.week}>
        {WEEK.map((day, at) => (
          // A fixed week: its days never move, so their place is their key.
          <span
            key={at}
            className={styles.day}
            data-day={at === picked ? 'picked' : openDays[at] === true ? 'open' : 'closed'}
          >
            {letter.format(day)}
          </span>
        ))}
      </div>
    </div>
  );
}
