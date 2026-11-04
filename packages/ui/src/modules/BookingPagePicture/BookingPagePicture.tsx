import type { Hue } from '../../hue.ts';
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

/** Cells before the first of the month in the drawn month, so it reads as a calendar rather than a grid. */
const LEAD_CELLS = 2;
/** The drawn month's days. */
const MONTH_DAYS = 30;
/** The day drawn as picked, an open one near the month's middle, as a guest would have it on the real page. */
const PICKED_FROM = 12;

/**
 * A booking page in miniature for LinkCard's picture (5 November 2026): its mark, title and lengths over a month
 * whose open days (from the page's own weekly hours) are tinted in its colour, one picked, as Calendly's and Cal.com's
 * pickers draw them. Shapes and the page's own words only; hidden from screen readers by the card's stage.
 */
export function BookingPagePicture({ title, lengths, openDays, hue }: BookingPagePictureProps) {
  const cells = Array.from({ length: LEAD_CELLS + MONTH_DAYS }, (_, at) => {
    if (at < LEAD_CELLS) return 'blank' as const;
    return openDays[at % 7] === true ? ('open' as const) : ('closed' as const);
  });
  const picked = cells.findIndex((cell, at) => at >= PICKED_FROM && cell === 'open');
  return (
    <div className={styles.root} data-hue={hue}>
      <div className={styles.head}>
        <span className={styles.mark} />
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          <span className={styles.lengths}>{lengths}</span>
        </span>
      </div>
      <div className={styles.month}>
        {cells.map((cell, at) => (
          // A fixed drawing: its cells never move, so their place is their key.
          <span key={at} className={styles.day} data-day={at === picked ? 'picked' : cell} />
        ))}
      </div>
    </div>
  );
}
