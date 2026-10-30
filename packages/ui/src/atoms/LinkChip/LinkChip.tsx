import { useState, type ReactNode } from 'react';
import { Button as AriaButton, Link as AriaLink } from 'react-aria-components';
import { isAppPath, safeHref } from '../../lib/safe-href.ts';
import { linkTarget } from '../Link/Link.tsx';
import { ProviderMark, type ProviderName } from '../ProviderMark/ProviderMark.tsx';
import styles from './LinkChip.module.css';
import { strings } from './strings.ts';

/** Props for LinkChip. */
export interface LinkChipProps {
  /** Where it goes: `mailto:`, `tel:`, `https://`. Anything `safeHref` refuses renders as a plain chip. */
  readonly href: string;
  /** What it shows: the address, the domain, the formatted number. */
  readonly children: string;
  /**
   * No edge and no fill: the link's text alone, on a card or in a line of the
   * timeline, where a blue chip read heavier than the words around it.
   */
  readonly isFlat?: boolean;
  /**
   * The brand whose mark leads the words: a social profile's network
   * (LinkedIn, X), so the chip reads "[mark] ada-lovelace". The mark is
   * labelled, so the link's name is "LinkedIn ada-lovelace".
   */
  readonly mark?: ProviderName;
  /**
   * The site's own icon (a domain's or a link's favicon), from our own origin.
   * While it loads, or when the site has none, the chip's first letter stands
   * in its place, so chips keep one width and a missing icon never shows broken.
   */
  readonly iconSrc?: string;
  /** A country's flag (an emoji, from `flagOf`) before a phone number, read by its number alone. */
  readonly flag?: string;
  /**
   * A button with the chip's look, never its link: a value inside its own
   * editor (a list of emails being edited), where a press opens the value's
   * menu (inside a MenuTrigger, which supplies the press) or calls `onPress`,
   * and must never leave the page. One focus ring, the chip's.
   */
  readonly isPressable?: boolean;
  /** What a pressable chip does when pressed, outside a MenuTrigger. */
  readonly onPress?: () => void;
  /** A pressable chip's name for screen readers, when it says more than its words ("Actions for ada@x.com"). */
  readonly label?: string;
  /** A pressable chip that takes no press while the form around it sends. */
  readonly isDisabled?: boolean;
}

/** The site's icon, or its first letter while it loads and when there is none. */
function SiteIcon({ src, label }: { readonly src: string; readonly label: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'missing'>('loading');
  return (
    <span className={styles.icon} aria-hidden="true" data-state={state}>
      {state !== 'shown' && <span className={styles.letter}>{label.charAt(0).toLocaleUpperCase()}</span>}
      {state !== 'missing' && (
        <img
          className={styles.image}
          src={src}
          alt={strings.iconAlt}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setState('shown');
          }}
          onError={() => {
            setState('missing');
          }}
        />
      )}
    </span>
  );
}

/** An email, phone, domain or URL value as a link chip: the one display for those types. */
export function LinkChip({
  href,
  children,
  isFlat = false,
  mark,
  iconSrc,
  flag,
  isPressable = false,
  onPress,
  label,
  isDisabled = false,
}: LinkChipProps) {
  const safe = isPressable ? undefined : safeHref(href);
  const flat = isFlat ? { 'data-flat': '' } : {};
  const lead: ReactNode = (
    <>
      {mark !== undefined && <ProviderMark provider={mark} size="sm" isLabelled />}
      {mark === undefined && iconSrc !== undefined && <SiteIcon src={iconSrc} label={children} />}
      {flag !== undefined && flag !== '' && (
        <span className={styles.flag} aria-hidden="true">
          {flag}
        </span>
      )}
    </>
  );
  if (isPressable) {
    return (
      <AriaButton
        className={styles.root}
        data-pressable=""
        isDisabled={isDisabled}
        {...(onPress === undefined ? {} : { onPress })}
        {...(label === undefined ? {} : { 'aria-label': label })}
        {...flat}
      >
        {lead}
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      </AriaButton>
    );
  }
  if (safe === undefined) {
    return (
      <span className={styles.root} data-plain="" {...flat}>
        {lead}
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      </span>
    );
  }
  // A link out is a plain anchor: no router to go through, and no React Aria
  // hooks for each of the hundreds a table draws. App paths go through the router.
  if (!isAppPath(safe)) {
    return (
      <a className={styles.root} href={safe} {...linkTarget(safe)} {...flat}>
        {lead}
        <span className={styles.label} data-truncated="">
          {children}
        </span>
      </a>
    );
  }
  return (
    <AriaLink className={styles.root} href={safe} {...flat}>
      {lead}
      <span className={styles.label} data-truncated="">
        {children}
      </span>
    </AriaLink>
  );
}
