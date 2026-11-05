import type { ReactNode } from 'react';
import { QrCode } from '../../atoms/QrCode/QrCode.tsx';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './QrSheet.module.css';
import { strings } from './strings.ts';

/** One card on the sheet: a table's name as guests read it ("T4") and the address its code opens. */
export interface QrSheetCard {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  /** The table's code as printed under its name, so staff can match a card to its table (checklabs prints it). */
  readonly code?: string;
}

/** How the sheet lays its cards out: `tents` fold to stand on a table, `tiles` (stickers) are cut out flat. */
export type QrSheetLayout = 'tents' | 'tiles';

/** How many tiles an A4 sheet holds: two across, three down (the spec's stickers, six an A4). */
const TILES_PER_PAGE = 6;

/** Props for QrSheet. */
export interface QrSheetProps {
  /** The venue's name, on every card. */
  readonly venue: string;
  /** The venue's logo, from our own origin; without one, the venue's initial in a round mark. */
  readonly logoSrc?: string;
  /** The cards in order, one per table. */
  readonly cards: readonly QrSheetCard[];
  /**
   * `tents` (the default) fold in half to stand on a table, two or four a sheet (`perPage`); `tiles` are flat
   * stickers to cut out and stick on, six a sheet: the name, the venue and code, the code and the scan line.
   */
  readonly layout?: QrSheetLayout;
  /** How many tent cards an A4 sheet holds: two (each half the sheet) or four (each a quarter). Tents only. */
  readonly perPage: 2 | 4;
  /** The modules' colour (`#rrggbb`), drawn only while it keeps its contrast on white (QrCode's own rule). */
  readonly colour?: string;
  /** The line under the table's name; "Scan for the menu" unless given. */
  readonly scanLine?: string;
  /** What sits above the sheets on screen, at the start (a way back): never printed. */
  readonly controls?: ReactNode;
  /** A quiet line after the controls on screen, saying what prints ("8 tables · scan-ready"): never printed. */
  readonly summary?: string;
  /** The sheet's own actions above it on screen, at the end (the per page choice, Print): never printed. */
  readonly actions?: ReactNode;
  /** A notice above the sheets on screen (the menu isn't live yet): never printed. */
  readonly notice?: ReactNode;
}

/** The cards split into sheets of `size`. */
function sheetsOf<T>(cards: readonly T[], size: number): readonly (readonly T[])[] {
  const sheets: T[][] = [];
  for (let at = 0; at < cards.length; at += size) sheets.push(cards.slice(at, at + size));
  return sheets;
}

/** One face of a tent card: the code, then the brand, the venue, the table and the scan line. */
function Face({
  card,
  venue,
  logo,
  colour,
  scanLine,
  isBack,
}: {
  readonly card: QrSheetCard;
  readonly venue: string;
  readonly logo: string | undefined;
  readonly colour: string | undefined;
  readonly scanLine: string;
  readonly isBack: boolean;
}) {
  return (
    <div className={styles.face} data-side={isBack ? 'back' : 'front'} aria-hidden={isBack || undefined}>
      <div className={styles.code}>
        <QrCode
          value={card.value}
          label={strings.code(card.name)}
          size="fill"
          ground="paper"
          {...(colour === undefined ? {} : { colour })}
          {...(logo === undefined ? {} : { picture: logo })}
        />
      </div>
      <div className={styles.words}>
        {logo === undefined ? (
          <span className={styles.mark} aria-hidden="true">
            {venue.trim().slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img className={styles.logo} src={logo} alt={strings.decorative} />
        )}
        <p className={styles.venue}>{venue}</p>
        <p className={styles.table}>{card.name}</p>
        {card.code === undefined ? null : <p className={styles.key}>{card.code}</p>}
        <p className={styles.scan}>{scanLine}</p>
      </div>
    </div>
  );
}

/** One flat tile (a sticker): the table's name, the venue and code, the code, then the scan line, centred. */
function Tile({
  card,
  venue,
  logo,
  colour,
  scanLine,
}: {
  readonly card: QrSheetCard;
  readonly venue: string;
  readonly logo: string | undefined;
  readonly colour: string | undefined;
  readonly scanLine: string;
}) {
  return (
    <article className={styles.tile} aria-label={card.name}>
      <p className={styles.table}>{card.name}</p>
      <p className={styles.meta}>{strings.meta(venue, card.code)}</p>
      <div className={styles.code}>
        <QrCode
          value={card.value}
          label={strings.code(card.name)}
          size="fill"
          ground="paper"
          {...(colour === undefined ? {} : { colour })}
          {...(logo === undefined ? {} : { picture: logo })}
        />
      </div>
      <p className={styles.scan}>{scanLine}</p>
    </article>
  );
}

/**
 * A printable sheet of table tent cards (spec 0065, H2): A4 pages of two or four cards, each folded in half along
 * its dashed line so it stands on the table, with the same face on both sides (the back is drawn upside down, so it
 * reads the right way up once folded). Light on white whatever the app's theme. Prints with the browser's own print
 * and print CSS: one sheet a page, no margins, nothing else of the page.
 */
export function QrSheet({
  venue,
  logoSrc,
  cards,
  layout = 'tents',
  perPage,
  colour,
  scanLine = strings.scan,
  controls,
  summary,
  actions,
  notice,
}: QrSheetProps) {
  const logo = safeImageSrc(logoSrc);
  const isTiles = layout === 'tiles';
  const sheets = sheetsOf(cards, isTiles ? TILES_PER_PAGE : perPage);
  return (
    <div className={styles.root} data-theme="light">
      {controls === undefined && summary === undefined && actions === undefined ? null : (
        <div className={styles.controls}>
          <div className={styles.group}>
            {controls}
            {summary === undefined ? null : <p className={styles.summary}>{summary}</p>}
          </div>
          <div className={styles.group}>{actions}</div>
        </div>
      )}
      {notice === undefined ? null : <div className={styles.notice}>{notice}</div>}
      {sheets.map((sheet, index) => (
        <section
          key={sheet[0]?.id ?? index}
          className={styles.sheet}
          data-layout={isTiles ? 'tiles' : undefined}
          data-per-page={isTiles ? undefined : perPage}
          aria-label={strings.page(index + 1, sheets.length)}
        >
          {sheet.map((card) =>
            isTiles ? (
              <Tile key={card.id} card={card} venue={venue} logo={logo} colour={colour} scanLine={scanLine} />
            ) : (
              <article key={card.id} className={styles.card} aria-label={card.name}>
                <Face card={card} venue={venue} logo={logo} colour={colour} scanLine={scanLine} isBack />
                <Face card={card} venue={venue} logo={logo} colour={colour} scanLine={scanLine} isBack={false} />
              </article>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
