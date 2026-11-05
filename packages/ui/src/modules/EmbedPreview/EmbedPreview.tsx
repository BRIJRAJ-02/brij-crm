import { contrastRatio } from '@crm/contracts/brand-colour';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { usePageVariables } from '../../lib/page-variables.ts';
import styles from './EmbedPreview.module.css';

/** Props for EmbedPreview. */
export interface EmbedPreviewProps {
  /** How the site shows the form: in the page, from the site's own button, or from a corner button we draw. */
  readonly mode: 'inline' | 'popup' | 'floating';
  /**
   * What sits in the page: `form` (the default) a form's box with its fields and button; `booking` a booking page's
   * box, its headline over a fortnight of days with the open ones tinted, as the page shows its month.
   */
  readonly kind?: 'form' | 'booking';
  /** The form's headline, drawn in the page's form unless `isTitleHidden`. */
  readonly headline: string;
  /** The button's words (popup: the site's own button; floating: the corner button). */
  readonly words: string;
  /** The corner button's colour as `#rrggbb`; left out, the accent. */
  readonly colour?: string;
  /** The corner button's mark before its words (floating only), as the embed script draws one; left out, words alone. */
  readonly mark?: IconName;
  /** Inline: the form's ground left clear, so the site's own background shows. */
  readonly isTransparent?: boolean;
  /** Inline: the headline left to the site. */
  readonly isTitleHidden?: boolean;
  /** What the picture shows, for screen readers ("How the form sits on your site"). */
  readonly label: string;
}

/** A booking page's fortnight, Sunday first: the weekdays open, as a page with working hours shows them. */
const FORTNIGHT: readonly boolean[] = [
  false,
  true,
  true,
  true,
  true,
  true,
  false,
  false,
  true,
  true,
  true,
  true,
  true,
  false,
];

/** A colour the preview may draw: a 3 or 6 digit hex, as six lowercase digits, or nothing. */
function sixDigits(colour: string | undefined): string | undefined {
  if (colour === undefined || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) return undefined;
  const hex = colour.slice(1).toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex}`;
}

/**
 * A made up site with the form on it (T44's Share tab, after Tally): a browser bar, the site's lines of text, and
 * the form as the chosen embed draws it: a block in the page (clear or on its own ground, with or without its
 * headline), the site's own button, or our corner button in its colour and words. A picture, never a control.
 */
export function EmbedPreview({
  mode,
  kind = 'form',
  headline,
  words,
  colour,
  mark,
  isTransparent = false,
  isTitleHidden = false,
  label,
}: EmbedPreviewProps) {
  const hex = sixDigits(colour);
  // The words on it in whichever of white or ink reads better, as the embed script picks them on the real site.
  const on =
    hex === undefined
      ? undefined
      : contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#111318')
        ? '#ffffff'
        : '#111318';
  const variables = usePageVariables(
    hex === undefined || on === undefined
      ? undefined
      : [
          ['--brand-accent', hex],
          ['--brand-on-accent', on],
        ],
  );
  return (
    <div ref={variables} className={styles.root} role="img" aria-label={label} data-mode={mode}>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.address} />
      </div>
      <div className={styles.page} aria-hidden="true">
        <Skeleton shape="text" width="medium" />
        <Skeleton lines={2} />
        {mode === 'inline' && (
          <div className={styles.form} data-ground={isTransparent ? 'none' : undefined}>
            {!isTitleHidden && <span className={styles.headline}>{headline}</span>}
            {kind === 'booking' ? (
              <span className={styles.month}>
                {FORTNIGHT.map((isOpen, day) => (
                  // A fixed fortnight that never reorders: its place is its key.
                  <span key={day} className={styles.day} data-open={isOpen || undefined} />
                ))}
              </span>
            ) : (
              <>
                <Skeleton shape="field" width="full" />
                <Skeleton shape="field" width="full" />
                <span className={styles.send} />
              </>
            )}
          </div>
        )}
        {mode === 'popup' && <span className={styles.siteButton}>{words}</span>}
        <Skeleton lines={2} />
        {mode === 'floating' && (
          <span className={styles.corner} data-marked={mark === undefined ? undefined : ''}>
            {mark !== undefined && <Icon name={mark} size="sm" />}
            <span className={styles.words}>{words}</span>
          </span>
        )}
      </div>
    </div>
  );
}
