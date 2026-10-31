import { useContext } from 'react';
import { ProviderArtContext } from './art-context.ts';
import styles from './ProviderMark.module.css';
import { strings } from './strings.ts';

/** The brands a mark is drawn for: Google sign in, the calendars, Timefix itself, and the social networks a profile link goes to. */
export type ProviderName =
  | 'google'
  | 'google-calendar'
  | 'outlook'
  | 'apple-calendar'
  | 'timefix'
  | 'linkedin'
  | 'x'
  | 'instagram'
  | 'github'
  | 'facebook'
  | 'youtube'
  | 'angellist'
  | 'tiktok'
  | 'threads';

/**
 * `sm` (14px) beside a 26px button's label, `md` (16px, the default) beside a
 * 30px one or in a row, `lg` (20px, `size-chip`) where a workspace's square
 * avatar would sit: the product's mark at the top of the sidebar.
 */
export type ProviderMarkSize = 'sm' | 'md' | 'lg';

/** Props for ProviderMark. */
export interface ProviderMarkProps {
  readonly provider: ProviderName;
  readonly size?: ProviderMarkSize;
  /**
   * Names the mark for screen readers ("Google Calendar"), for a mark that
   * stands alone, such as a row tagged by where it came from. Leave it off
   * beside a label that already names the brand: the mark is then decoration.
   */
  readonly isLabelled?: boolean;
  /**
   * `brand` (the default) draws the artwork as published. `mono` draws only its shape, in the text colour around it:
   * a row of marks that must read as one set (a link page's social links, from the owner's design, 25 October 2026).
   */
  readonly tone?: 'brand' | 'mono';
}

/**
 * A brand's own mark, as its owner publishes it: Google's G on Continue with
 * Google, the Google Calendar, Outlook and Apple Calendar marks on calendar
 * actions and synced events, the Timefix mark on what Timefix made, and a
 * social network's mark on a profile link (LinkedIn, X, GitHub). The
 * one exception to the Lucide only rule (owner approval, 20 October 2026):
 * the artwork is never recoloured or redrawn, so it is an image, not an Icon,
 * except as `tone="mono"`: its own shape in one colour, as the owner's link
 * page design draws a person's social links (25 October 2026).
 */
export function ProviderMark({ provider, size = 'md', isLabelled = false, tone = 'brand' }: ProviderMarkProps) {
  const art = useContext(ProviderArtContext)?.[provider];
  // Outside UiProvider (under UiProviderBase, the hosted form's) the artwork isn't loaded, so there is no mark.
  if (art === undefined) return null;
  const alt = isLabelled ? strings.names[provider] : strings.unnamed;
  if (tone === 'mono') {
    // The artwork as a mask over the text colour: its shape only, the same file in either theme.
    const shape = typeof art === 'string' ? art : art.light;
    return (
      <span
        className={styles.mono}
        data-size={size}
        style={{ '--mark': `url("${shape}")` }}
        {...(isLabelled ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      />
    );
  }
  if (typeof art === 'string') {
    return <img className={styles.mark} data-size={size} src={art} alt={alt} />;
  }
  // Both are in the page; CSS shows the one for the theme, and the other is out of the accessibility tree.
  return (
    <span className={styles.pair} {...(isLabelled ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}>
      <img className={styles.mark} data-size={size} data-scheme="light" src={art.light} alt={strings.unnamed} />
      <img className={styles.mark} data-size={size} data-scheme="dark" src={art.dark} alt={strings.unnamed} />
    </span>
  );
}
