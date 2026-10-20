import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import styles from './BookingFrame.module.css';
import { strings } from './strings.ts';

/** One line of the rail's facts: an icon and what it says ("30 min", "Video call"), or a control (the time zone). */
export interface BookingFact {
  readonly id: string;
  readonly icon: IconName;
  readonly children: ReactNode;
}

/** Who is booked, as the rail heads it. */
export interface BookingHost {
  readonly name: string;
  readonly image?: string;
}

/** Props for BookingFrame. */
export interface BookingFrameProps {
  /** Missing while the page loads: the rail and panes draw as skeletons. */
  readonly host?: BookingHost;
  /** The meeting's name, the page's `h1`. */
  readonly title?: string;
  readonly description?: string;
  readonly facts?: readonly BookingFact[];
  /** A bar above the card: the visitor's calendar ("See when you're both free"). */
  readonly banner?: ReactNode;
  /** Controls at the card's top end, above it: Month or List. */
  readonly toolbar?: ReactNode;
  /** The middle pane: the month, the days, or the details form. */
  readonly children?: ReactNode;
  /** The end pane: the chosen day's times. Leave it off for one wide pane (the details step). */
  readonly aside?: ReactNode;
  /** Where "Claim your free page" goes. Leave it off to show the wordmark alone (a recognised visitor). */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
}

/** The web app's own wordmark files (apps/web/public/brand). */
const TIMEFIX_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};

/**
 * A booking page's frame (spec 0025, 0025-experience.md; layout after the
 * timefix booking page and calendars' scheduling pages): one card, the host
 * and the meeting's facts in a rail at its start, the month in the middle and
 * the day's times at its end, each pane divided by a hairline. Under it the
 * Timefix wordmark and "Claim your free page". On a phone the panes stack.
 */
export function BookingFrame({
  host,
  title,
  description,
  facts = [],
  banner,
  toolbar,
  children,
  aside,
  claimHref,
  logo = TIMEFIX_LOGO,
}: BookingFrameProps) {
  const isLoading = host === undefined || title === undefined;
  return (
    <main className={styles.root}>
      <div className={styles.column}>
        {(banner !== undefined || toolbar !== undefined) && (
          <div className={styles.top}>
            <div className={styles.banner}>{banner}</div>
            {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}
          </div>
        )}
        <div
          className={styles.card}
          data-panes={aside === undefined ? 'two' : 'three'}
          aria-busy={isLoading || undefined}
        >
          <aside className={styles.rail} aria-label={isLoading ? strings.loading : strings.about}>
            {isLoading ? (
              <>
                <Skeleton shape="circle" />
                <Skeleton lines={3} width="medium" />
              </>
            ) : (
              <>
                <Avatar
                  name={host.name}
                  size="lg"
                  isDecorative
                  {...(host.image === undefined ? {} : { src: host.image })}
                />
                <p className={styles.host}>{host.name}</p>
                <h1 className={styles.title}>{title}</h1>
                {description !== undefined && description !== '' && <p className={styles.description}>{description}</p>}
                {facts.length > 0 && (
                  <ul className={styles.facts}>
                    {facts.map((fact) => (
                      <li key={fact.id} className={styles.fact}>
                        <span className={styles.factIcon}>
                          <Icon name={fact.icon} size="md" tone="muted" />
                        </span>
                        <span className={styles.factBody}>{fact.children}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
          <div className={styles.main}>{isLoading ? <Skeleton shape="block" lines={6} /> : children}</div>
          {aside !== undefined && <div className={styles.aside}>{isLoading ? <Skeleton lines={6} /> : aside}</div>}
        </div>
        <BookingFoot {...(claimHref === undefined ? {} : { claimHref })} logo={logo} />
      </div>
    </main>
  );
}

/** Props for BookingFoot. */
export interface BookingFootProps {
  /** Where "Claim your free page" goes; leave it off for the wordmark alone. */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
}

/** The foot under every booking view: the Timefix wordmark, and "Claim your free page" for a visitor we don't know. */
export function BookingFoot({ claimHref, logo = TIMEFIX_LOGO }: BookingFootProps) {
  return (
    <footer className={styles.foot}>
      <a className={styles.brand} href="https://timefix.ai" rel="noopener noreferrer">
        <img className={styles.wordmark} data-scheme="light" src={logo.light} alt={strings.product} />
        <img className={styles.wordmark} data-scheme="dark" src={logo.dark} alt={strings.product} />
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

/** Props for BookingMessage. */
export interface BookingMessageProps {
  /** The message's heading, the page's `h1`: "Page not found". */
  readonly title: string;
  readonly children?: string;
  /** Shows Try again. */
  readonly onRetry?: () => void;
  /** While the page's facts load: a skeleton in the card. */
  readonly isLoading?: boolean;
}

/**
 * A booking page with nothing to book: still loading, an address that names
 * no page, a paused page, or a load that failed with Try again. One small
 * card, centred, with the foot under it.
 */
export function BookingMessage({ title, children, onRetry, isLoading = false }: BookingMessageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!isLoading) heading.current?.focus();
  }, [isLoading]);
  return (
    <main className={styles.root}>
      <div className={styles.column} data-width="narrow">
        <div className={styles.message} aria-busy={isLoading || undefined}>
          {isLoading ? (
            <>
              <Skeleton shape="circle" />
              <Skeleton lines={3} />
            </>
          ) : (
            <>
              <h1 ref={heading} tabIndex={-1} className={styles.title}>
                {title}
              </h1>
              {children !== undefined && <p className={styles.description}>{children}</p>}
              {onRetry !== undefined && (
                <div>
                  <Button icon="refresh-cw" onPress={onRetry}>
                    {strings.retry}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        <BookingFoot />
      </div>
    </main>
  );
}
