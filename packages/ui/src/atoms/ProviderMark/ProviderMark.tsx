import appleCalendar from '../../assets/apple-calendar.svg';
import googleCalendar from '../../assets/google-calendar.svg';
import googleG from '../../assets/google-g.svg';
import outlook from '../../assets/outlook.svg';
import angellistDark from '../../assets/social-angellist-dark.svg';
import angellistLight from '../../assets/social-angellist-light.svg';
import facebook from '../../assets/social-facebook.svg';
import githubDark from '../../assets/social-github-dark.svg';
import githubLight from '../../assets/social-github-light.svg';
import instagram from '../../assets/social-instagram.svg';
import linkedin from '../../assets/social-linkedin.svg';
import threadsDark from '../../assets/social-threads-dark.svg';
import threadsLight from '../../assets/social-threads-light.svg';
import tiktokDark from '../../assets/social-tiktok-dark.svg';
import tiktokLight from '../../assets/social-tiktok-light.svg';
import xDark from '../../assets/social-x-dark.svg';
import xLight from '../../assets/social-x-light.svg';
import youtube from '../../assets/social-youtube.svg';
import timefixDark from '../../assets/timefix-mark-dark.svg';
import timefixLight from '../../assets/timefix-mark-light.svg';
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
}

/** One image per brand; a black mark (Timefix, X, GitHub, AngelList, TikTok, Threads) has a light and a dark one, shown by theme like the wordmark. */
const ART: Readonly<Record<ProviderName, string | { readonly light: string; readonly dark: string }>> = {
  google: googleG,
  'google-calendar': googleCalendar,
  outlook,
  'apple-calendar': appleCalendar,
  timefix: { light: timefixLight, dark: timefixDark },
  linkedin,
  x: { light: xLight, dark: xDark },
  instagram,
  github: { light: githubLight, dark: githubDark },
  facebook,
  youtube,
  angellist: { light: angellistLight, dark: angellistDark },
  tiktok: { light: tiktokLight, dark: tiktokDark },
  threads: { light: threadsLight, dark: threadsDark },
};

/**
 * A brand's own mark, as its owner publishes it: Google's G on Continue with
 * Google, the Google Calendar, Outlook and Apple Calendar marks on calendar
 * actions and synced events, the Timefix mark on what Timefix made, and a
 * social network's mark on a profile link (LinkedIn, X, GitHub). The
 * one exception to the Lucide only rule (owner approval, 20 October 2026):
 * the artwork is never recoloured or redrawn, so it is an image, not an Icon.
 */
export function ProviderMark({ provider, size = 'md', isLabelled = false }: ProviderMarkProps) {
  const art = ART[provider];
  const alt = isLabelled ? strings.names[provider] : strings.unnamed;
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
