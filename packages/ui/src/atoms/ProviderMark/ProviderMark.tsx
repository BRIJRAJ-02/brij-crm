import appleCalendar from '../../assets/apple-calendar.svg';
import googleCalendar from '../../assets/google-calendar.svg';
import googleG from '../../assets/google-g.svg';
import outlook from '../../assets/outlook.svg';
import timefixDark from '../../assets/timefix-mark-dark.svg';
import timefixLight from '../../assets/timefix-mark-light.svg';
import styles from './ProviderMark.module.css';
import { strings } from './strings.ts';

/** The brands a mark is drawn for: Google sign in, the calendars, and Timefix itself. */
export type ProviderName = 'google' | 'google-calendar' | 'outlook' | 'apple-calendar' | 'timefix';

/** `sm` (14px) beside a 26px button's label, `md` (16px, the default) beside a 30px one or in a row. */
export type ProviderMarkSize = 'sm' | 'md';

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

/** One image per brand; Timefix's has a light and a dark one, shown by theme like the wordmark. */
const ART: Readonly<Record<ProviderName, string | { readonly light: string; readonly dark: string }>> = {
  google: googleG,
  'google-calendar': googleCalendar,
  outlook,
  'apple-calendar': appleCalendar,
  timefix: { light: timefixLight, dark: timefixDark },
};

/**
 * A brand's own mark, as its owner publishes it: Google's G on Continue with
 * Google, the Google Calendar, Outlook and Apple Calendar marks on calendar
 * actions and synced events, and the Timefix mark on what Timefix made. The
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
