// "Powered by Timefix" at the foot of every public page (spec 0058, AC-26), in a file of its own beside BookingFrame, so
// a page that draws only the foot (the guest menu) loads none of the frame's code or styles. On a booking page's rail
// the frame puts it in a card of its own, which stretches it across (`--booking-foot-align`).
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { poweredByHref, type PoweredByPage } from '../../lib/powered-by.ts';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import styles from './BookingFoot.module.css';
import { strings } from './strings.ts';

/** The web app's own wordmark files (apps/web/public/brand). */
export const TIMEFIX_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};

/** Props for BookingFoot. */
export interface BookingFootProps {
  /**
   * `rail`: a small card at the rail's foot, on wide screens only. `page`:
   * centred at the page's end, on phones only. `always` (the default): centred,
   * on every screen, for a page with no rail.
   */
  readonly placement?: 'rail' | 'page' | 'always';
  /**
   * Which public page this is, which the wordmark's link carries as its `utm_medium`: the booking page (the
   * default, the frame's own), a person's profile, or the guest's page. The claim link comes tagged in `claimHref`.
   */
  readonly page?: PoweredByPage;
  /** Where "Claim your free page" goes (`claimPageHref` with the same page); leave it off for the wordmark alone. */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
  /**
   * Which wordmark to draw, where the page pins its own look rather than following the visitor's (the link page,
   * whose owner chooses light or dark: spec 0054). Left out, the mark follows the visitor's app or system choice,
   * which is right for a booking or form page and wrong for a page with a look of its own: a light page read on a
   * phone in dark mode drew the white mark on white and showed nothing (the owner, 26 October 2026).
   */
  readonly scheme?: 'light' | 'dark';
  /**
   * Where the wordmark goes when the page tags it itself (the guest's page names the workspace:
   * `poweredByHref(page, slug)`). Left out, `poweredByHref(page)`.
   */
  readonly href?: string;
  /** Opens the wordmark's link in a new tab, under this name ("Powered by Timefix (opens in a new tab)"). */
  readonly newTabLabel?: string;
}

/**
 * "Powered by Timefix", tagged with the page it sits on, and "Claim your free page" for a visitor we don't know.
 * Every public page ends with it (spec 0058, AC-26), and nothing can take it off.
 */
export function BookingFoot({
  placement = 'always',
  page = 'booking_page',
  claimHref,
  logo = TIMEFIX_LOGO,
  scheme,
  href,
  newTabLabel,
}: BookingFootProps) {
  return (
    <footer className={styles.foot} data-placement={placement}>
      <a
        className={styles.brand}
        href={href ?? poweredByHref(page)}
        rel="noopener noreferrer"
        {...(newTabLabel === undefined ? {} : { target: '_blank', 'aria-label': newTabLabel })}
      >
        <span className={styles.powered}>{strings.poweredBy}</span>
        {scheme === undefined ? (
          <>
            <img className={styles.wordmark} data-scheme="light" src={logo.light} alt={strings.product} />
            <img className={styles.wordmark} data-scheme="dark" src={logo.dark} alt={strings.product} />
          </>
        ) : (
          // Pinned: one mark, drawn whatever the visitor's own setting is, so the page's look decides.
          <img
            className={styles.wordmark}
            data-scheme="pinned"
            src={scheme === 'dark' ? logo.dark : logo.light}
            alt={strings.product}
          />
        )}
      </a>
      {claimHref !== undefined && (
        <a className={styles.claim} href={claimHref} rel="noopener noreferrer">
          {strings.claim}
          <Icon name="arrow-right" size="xs" />
        </a>
      )}
    </footer>
  );
}
