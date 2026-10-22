import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Avatar, AvatarStack, type AvatarStackPerson } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import styles from './BookingFrame.module.css';
import { strings } from './strings.ts';

/** One line of the rail's facts: an icon and what it says ("Video call"), or a control (the time zone). */
export interface BookingFact {
  readonly id: string;
  readonly icon: IconName;
  readonly children: ReactNode;
}

/** Who is booked, as the rail heads it. */
export interface BookingHost {
  /** The host: the line above the meeting. A team page's is the workspace, named in its title instead. */
  readonly name: string;
  readonly image?: string;
  /** A team page's hosts (spec 0037, AC-1339): their faces stack in place of the one picture. */
  readonly team?: BookingTeam;
}

/** A team page's stack: up to 4 faces, everyone it stands for, and its accessible name ("Team of 6"). */
export interface BookingTeam {
  readonly people: readonly AvatarStackPerson[];
  readonly total: number;
  readonly label: string;
}

/** The most faces a team page's rail shows before "+N". */
const TEAM_FACES = 4;

/** Props for BookingFrame. */
export interface BookingFrameProps {
  /** Missing while the page loads: the rail and the card draw as skeletons. */
  readonly host?: BookingHost;
  /** The meeting ("Intro call"), the page's `h1`, under the host's name. */
  readonly title?: string;
  readonly description?: string;
  readonly facts?: readonly BookingFact[];
  /** A bar above the card: the visitor's calendar ("See when you're both free"). */
  readonly banner?: ReactNode;
  /** The card's heading: "Choose a time". */
  readonly heading?: string;
  /** At the heading's end: Month or List. */
  readonly toolbar?: ReactNode;
  /** The card's first pane: the month, the days, or the details form. */
  readonly children?: ReactNode;
  /** The card's end pane: the chosen day's times. Leave it off for one wide pane. */
  readonly aside?: ReactNode;
  /** A band across the card's foot: the Book bar. */
  readonly footer?: ReactNode;
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
 * A booking page's frame (spec 0025, 0025-experience.md; laid out as the
 * timefix booking page): the host in a rail of their own (the picture, the
 * name, the meeting and its facts, and "Powered by Timefix" pinned at its
 * foot), beside one card: its heading with Month or List, the month and the
 * day's times side by side, and the Book bar across its foot. On a phone
 * everything stacks and Timefix moves to the page's end.
 */
export function BookingFrame({
  host,
  title,
  description,
  facts = [],
  banner,
  heading,
  toolbar,
  children,
  aside,
  footer,
  claimHref,
  logo = TIMEFIX_LOGO,
}: BookingFrameProps) {
  const isLoading = host === undefined || title === undefined;
  const claim = claimHref === undefined ? {} : { claimHref };
  return (
    <main className={styles.root}>
      <div className={styles.layout}>
        <aside className={styles.rail} aria-label={isLoading ? strings.loading : strings.about}>
          {isLoading ? (
            <div className={styles.identity}>
              <Skeleton shape="circle" />
              <Skeleton lines={3} width="medium" />
            </div>
          ) : (
            <div className={styles.identity}>
              {host.team === undefined ? (
                <Avatar
                  name={host.name}
                  size="xl"
                  isDecorative
                  {...(host.image === undefined ? {} : { src: host.image })}
                />
              ) : (
                <AvatarStack
                  people={host.team.people}
                  total={host.team.total}
                  label={host.team.label}
                  max={TEAM_FACES}
                  size="lg"
                />
              )}
              <div className={styles.names} data-team={host.team === undefined ? undefined : ''}>
                {/* A team page's title already names the workspace ("Intro call with Acme"). */}
                {host.team === undefined && <p className={styles.host}>{host.name}</p>}
                <h1 className={styles.title}>{title}</h1>
              </div>
              {description !== undefined && description !== '' && <p className={styles.description}>{description}</p>}
              {facts.length > 0 && (
                <ul className={styles.facts}>
                  {facts.map((fact) => (
                    <li key={fact.id} className={styles.fact}>
                      <span className={styles.factIcon}>
                        <Icon name={fact.icon} size="sm" tone="muted" />
                      </span>
                      <span className={styles.factBody}>{fact.children}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <BookingFoot placement="rail" logo={logo} {...claim} />
        </aside>
        <div className={styles.main}>
          {banner}
          <section
            className={styles.card}
            aria-label={heading ?? title ?? strings.loading}
            aria-busy={isLoading || undefined}
          >
            {(heading !== undefined || toolbar !== undefined) && (
              <div className={styles.head}>
                {heading !== undefined && <h2 className={styles.heading}>{heading}</h2>}
                {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}
              </div>
            )}
            <div className={styles.panes} data-panes={aside === undefined ? 'one' : 'two'}>
              <div className={styles.pane}>{isLoading ? <Skeleton shape="block" lines={6} /> : children}</div>
              {aside !== undefined && <div className={styles.aside}>{isLoading ? <Skeleton lines={6} /> : aside}</div>}
            </div>
            {footer !== undefined && <div className={styles.footer}>{footer}</div>}
          </section>
          <BookingFoot placement="page" logo={logo} {...claim} />
        </div>
      </div>
    </main>
  );
}

/** Props for BookingFoot. */
export interface BookingFootProps {
  /**
   * `rail`: a small card at the rail's foot, on wide screens only. `page`:
   * centred at the page's end, on phones only. `always` (the default): centred,
   * on every screen, for a page with no rail.
   */
  readonly placement?: 'rail' | 'page' | 'always';
  /** Where "Claim your free page" goes; leave it off for the wordmark alone. */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
}

/** "Powered by Timefix", and "Claim your free page" for a visitor we don't know. */
export function BookingFoot({ placement = 'always', claimHref, logo = TIMEFIX_LOGO }: BookingFootProps) {
  return (
    <footer className={styles.foot} data-placement={placement}>
      <a className={styles.brand} href="https://timefix.ai" rel="noopener noreferrer">
        <span className={styles.powered}>{strings.poweredBy}</span>
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

/** The person a profile page is (22 Oct 2026): their name, picture and one line bio. */
export interface BookingProfilePerson {
  readonly name: string;
  /** What the avatar's colour is keyed on when there is no picture (their handle). */
  readonly id: string;
  readonly image?: string;
  readonly bio?: string;
}

/** Props for BookingProfile. */
export interface BookingProfileProps {
  /** Missing while the profile loads: the card draws as a skeleton. */
  readonly person?: BookingProfilePerson;
  /** Under the card: the person's booking links (LinkList), with their section headings and search. */
  readonly children?: ReactNode;
  /** Where "Claim your free page" goes. */
  readonly claimHref?: string;
}

/**
 * A person's public profile page, `/<handle>` (22 Oct 2026, the Cal.com profile): one card with their picture,
 * name (the page's `h1`) and bio, their links under it, and the foot. The booking pages' own page, so it keeps
 * their background, column and foot.
 */
export function BookingProfile({ person, children, claimHref }: BookingProfileProps) {
  return (
    <main className={styles.root}>
      <div className={styles.narrow} data-width="profile">
        <header className={styles.message} data-kind="profile" aria-busy={person === undefined || undefined}>
          {person === undefined ? (
            <>
              <Skeleton shape="circle" />
              <Skeleton lines={2} />
            </>
          ) : (
            <>
              <Avatar
                name={person.name}
                id={person.id}
                size="xl"
                isDecorative
                {...(person.image === undefined ? {} : { src: person.image })}
              />
              <div className={styles.names}>
                <h1 className={styles.host}>{person.name}</h1>
                {person.bio !== undefined && person.bio !== '' && <p className={styles.description}>{person.bio}</p>}
              </div>
            </>
          )}
        </header>
        {children}
        <BookingFoot {...(claimHref === undefined ? {} : { claimHref })} />
      </div>
    </main>
  );
}

/** Props for BookingProfileSection. */
export interface BookingProfileSectionProps {
  /** The small heading the person put these links under; left out for links with none. */
  readonly title?: string;
  readonly children: ReactNode;
}

/** One group of a profile's links, under its small heading when it has one. */
export function BookingProfileSection({ title, children }: BookingProfileSectionProps) {
  const headingId = useId();
  return (
    <section className={styles.section} {...(title === undefined ? {} : { 'aria-labelledby': headingId })}>
      {title !== undefined && (
        <h2 id={headingId} className={styles.sectionTitle}>
          {title}
        </h2>
      )}
      {children}
    </section>
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
      <div className={styles.narrow}>
        <div className={styles.message} aria-busy={isLoading || undefined}>
          {isLoading ? (
            <>
              <Skeleton shape="circle" />
              <Skeleton lines={3} />
            </>
          ) : (
            <>
              <h1 ref={heading} tabIndex={-1} className={styles.messageTitle}>
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
