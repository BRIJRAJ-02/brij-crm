import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar, AvatarStack, type AvatarStackPerson } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { poweredByHref, type PoweredByPage } from '../../lib/powered-by.ts';
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
  /**
   * Missing while the page loads: the rail draws as skeletons in the shape the
   * host will take, and a pane with nothing in it does the same.
   */
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
  /**
   * Another view of the times (List, Book by chat), drawn over the month: the panes and the footer stay underneath,
   * hidden and inert, and the cover takes exactly their box. So every view is the month view's size, and switching
   * views moves nothing on the page (the owner, 25 October 2026).
   */
  readonly cover?: ReactNode;
  /** A band at the cover's foot, drawn as `footer` is: the List view's Book bar. */
  readonly coverFooter?: ReactNode;
  /**
   * `body` (the default): the cover takes the panes' and the footer's box, under the heading row (List, Book by chat).
   * `card`: it takes the whole card, its heading row too (the details step), which hides with the month.
   */
  readonly coverPlace?: 'body' | 'card';
  /** What the card shows (`month`, `list`, `chat`, `details`): a change crossfades the card's content. Never at first paint. */
  readonly view?: string;
  /**
   * Which way the step went, when it did: `forward` slides the cover in from the end (the details step), `back` the
   * month in from the start (Back, or a time someone just took). Reduced motion keeps the fade alone.
   */
  readonly enter?: 'forward' | 'back';
  /**
   * Where "Claim your free page" goes: `claimPageHref('booking_page')`, tagged as the wordmark beside it is. Leave
   * it off to show the wordmark alone (a recognised visitor).
   */
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
  cover,
  coverFooter,
  coverPlace = 'body',
  view,
  enter,
  claimHref,
  logo = TIMEFIX_LOGO,
}: BookingFrameProps) {
  const isLoading = host === undefined || title === undefined;
  // Only a view changed after the first paint fades: the page's first view is simply there.
  const [shown, setShown] = useState({ view, isMoved: false });
  if (shown.view !== view) setShown({ view, isMoved: true });
  const isCovered = cover !== undefined;
  const isCardCovered = isCovered && coverPlace === 'card';
  const claim = claimHref === undefined ? {} : { claimHref };
  return (
    <main className={styles.root}>
      <div className={styles.layout}>
        <aside className={styles.rail} aria-label={strings.about} aria-busy={isLoading || undefined}>
          {isLoading ? (
            /* The shape the host will take, line for line, so nothing moves when the page's facts arrive. */
            <div className={styles.identity}>
              <Skeleton shape="circle" size="xl" />
              <div className={styles.names}>
                <p className={styles.host}>
                  <Skeleton shape="text" width="medium" />
                </p>
                <p className={styles.title}>
                  <Skeleton shape="text" width="short" />
                </p>
              </div>
              <p className={styles.description}>
                <Skeleton shape="text" lines={2} />
              </p>
              <ul className={styles.facts}>
                <li className={styles.fact}>
                  <span className={styles.factIcon}>
                    <Skeleton shape="tile" />
                  </span>
                  <span className={styles.factBody} data-loading="">
                    <Skeleton shape="field" width="medium" />
                  </span>
                </li>
                <li className={styles.fact}>
                  <span className={styles.factIcon}>
                    <Skeleton shape="tile" />
                  </span>
                  <span className={styles.factBody} data-loading="">
                    <Skeleton shape="text" width="long" />
                  </span>
                </li>
              </ul>
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
              <div className={styles.head} inert={isCardCovered}>
                {heading !== undefined && <h2 className={styles.heading}>{heading}</h2>}
                {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}
              </div>
            )}
            <div
              className={styles.stage}
              data-moved={shown.isMoved || undefined}
              data-place={isCovered ? coverPlace : undefined}
              data-enter={enter}
            >
              {/* Covered, the month still sets the card's size: hidden, out of the reading order and out of reach. */}
              <div className={styles.under} inert={isCovered}>
                <div className={styles.panes} data-panes={aside === undefined ? 'one' : 'two'}>
                  {/* A pane draws what it is given, loading or not: the page hands its own month and times, already
                      in their shape, so the card is the right height from the first paint. */}
                  <div className={styles.pane}>{children ?? <Skeleton shape="block" lines={6} />}</div>
                  {aside !== undefined && <div className={styles.aside}>{aside}</div>}
                </div>
                {footer !== undefined && <div className={styles.footer}>{footer}</div>}
              </div>
              {isCovered && (
                <div key={view} className={styles.cover}>
                  <div className={styles.coverBody}>{cover}</div>
                  {coverFooter !== undefined && <div className={styles.footer}>{coverFooter}</div>}
                </div>
              )}
            </div>
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
  /**
   * Which public page this is, which the wordmark's link carries as its `utm_medium`: the booking page (the
   * default, the frame's own), a person's profile, or the guest's page. The claim link comes tagged in `claimHref`.
   */
  readonly page?: PoweredByPage;
  /** Where "Claim your free page" goes (`claimPageHref` with the same page); leave it off for the wordmark alone. */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
}

/** "Powered by Timefix", tagged with the page it sits on, and "Claim your free page" for a visitor we don't know. */
export function BookingFoot({
  placement = 'always',
  page = 'booking_page',
  claimHref,
  logo = TIMEFIX_LOGO,
}: BookingFootProps) {
  return (
    <footer className={styles.foot} data-placement={placement}>
      <a className={styles.brand} href={poweredByHref(page)} rel="noopener noreferrer">
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
  /** Where "Claim your free page" goes: `claimPageHref('booking_profile')`. */
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
            /* The picture's own size and the lines' own line boxes, so the name and the bio land where
               their places were rather than pushing the links down the page. */
            <>
              <Skeleton shape="circle" size="xl" />
              <div className={styles.names}>
                <p className={styles.host}>
                  <Skeleton shape="text" width="medium" />
                </p>
                {/* One row: a bio stands on a card as wide as the list, where most fit a line. */}
                <p className={styles.description}>
                  <Skeleton shape="text" width="long" />
                </p>
              </div>
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
        <BookingFoot page="booking_profile" {...(claimHref === undefined ? {} : { claimHref })} />
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
  /** Which public page shows the message, for the wordmark link's tags: the booking page (the default), a profile, or the guest's page. */
  readonly page?: PoweredByPage;
}

/**
 * A booking page with nothing to book: still loading, an address that names
 * no page, a paused page, or a load that failed with Try again. One small
 * card, centred, with the foot under it.
 */
export function BookingMessage({
  title,
  children,
  onRetry,
  isLoading = false,
  page = 'booking_page',
}: BookingMessageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!isLoading) heading.current?.focus();
  }, [isLoading]);
  return (
    <main className={styles.root}>
      <div className={styles.narrow}>
        <div className={styles.message} aria-busy={isLoading || undefined}>
          {isLoading ? (
            /* The heading's and the line's own places. No picture: a message never has one, so a circle
               here would be a shape that never arrives. */
            <>
              <p className={styles.messageTitle}>
                <Skeleton shape="text" width="medium" />
              </p>
              <p className={styles.description}>
                <Skeleton shape="text" lines={2} />
              </p>
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
        <BookingFoot page={page} />
      </div>
    </main>
  );
}
