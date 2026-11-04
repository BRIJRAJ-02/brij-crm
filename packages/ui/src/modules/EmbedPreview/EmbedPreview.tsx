import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { usePageVariables } from '../../lib/page-variables.ts';
import styles from './EmbedPreview.module.css';

/** Props for EmbedPreview. */
export interface EmbedPreviewProps {
  /** How the site shows the form: in the page, from the site's own button, or from a corner button we draw. */
  readonly mode: 'inline' | 'popup' | 'floating';
  /** The form's headline, drawn in the page's form unless `isTitleHidden`. */
  readonly headline: string;
  /** The button's words (popup: the site's own button; floating: the corner button). */
  readonly words: string;
  /** The corner button's colour as `#rrggbb`; left out, the accent. */
  readonly colour?: string;
  /** Inline: the form's ground left clear, so the site's own background shows. */
  readonly isTransparent?: boolean;
  /** Inline: the headline left to the site. */
  readonly isTitleHidden?: boolean;
  /** What the picture shows, for screen readers ("How the form sits on your site"). */
  readonly label: string;
}

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
  headline,
  words,
  colour,
  isTransparent = false,
  isTitleHidden = false,
  label,
}: EmbedPreviewProps) {
  const hex = sixDigits(colour);
  const variables = usePageVariables(hex === undefined ? undefined : [['--brand-accent', hex]]);
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
            <Skeleton shape="field" width="full" />
            <Skeleton shape="field" width="full" />
            <span className={styles.send} />
          </div>
        )}
        {mode === 'popup' && <span className={styles.siteButton}>{words}</span>}
        <Skeleton lines={2} />
        {mode === 'floating' && <span className={styles.corner}>{words}</span>}
      </div>
    </div>
  );
}
