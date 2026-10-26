import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import { Avatar, AvatarStack, type AvatarStackPerson } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { poweredByHref, type PoweredByPage } from '../../lib/powered-by.ts';
import { SocialLinks, type SocialLinkItem } from '../../molecules/SocialLinks/SocialLinks.tsx';
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
  /** The host's social links (booking socials, 25 Oct 2026), the last line of their block; never on a team page. */
  readonly socials?: readonly SocialLinkItem[];
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
  // Only a view changed after the first paint moves: the page's first view is simply there. One chosen from the
  // keyboard (the switch's arrows, Enter on Book or Back) shows at once, decided as it changes: keys never wait.
  const { isFocusVisible } = useFocusVisible();
  const [shown, setShown] = useState({ view, isMoved: false, isInstant: false });
  if (shown.view !== view) setShown({ view, isMoved: true, isInstant: isFocusVisible });
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
              {/* Last in the block (booking socials): it arrives with the facts, and on a wide page nothing under it
                  moves, since the foot is pinned to the rail's end. */}
              {host.team === undefined && host.socials !== undefined && (
                <SocialLinks links={host.socials} label={strings.socials(host.name)} />
              )}
            </div>
          )}
          <BookingFoot placement="rail" logo={logo} {...claim} />
        </aside>
        <div className={styles.main}>
          {banner}
          <section
            className={styles.card}
            // Covered whole (the details step), the step's own form names what the card holds.
            {...(isCardCovered ? {} : { 'aria-label': heading ?? title ?? strings.loading })}
            data-instant={shown.isInstant || undefined}
            data-place={isCardCovered ? 'card' : undefined}
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
              data-instant={shown.isInstant || undefined}
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
  /**
   * Which wordmark to draw, where the page pins its own look rather than following the visitor's (the link page,
   * whose owner chooses light or dark: spec 0054). Left out, the mark follows the visitor's app or system choice,
   * which is right for a booking or form page and wrong for a page with a look of its own: a light page read on a
   * phone in dark mode drew the white mark on white and showed nothing (the owner, 26 October 2026).
   */
  readonly scheme?: 'light' | 'dark';
}

/** "Powered by Timefix", tagged with the page it sits on, and "Claim your free page" for a visitor we don't know. */
export function BookingFoot({
  placement = 'always',
  page = 'booking_page',
  claimHref,
  logo = TIMEFIX_LOGO,
  scheme,
}: BookingFootProps) {
  return (
    <footer className={styles.foot} data-placement={placement}>
      <a className={styles.brand} href={poweredByHref(page)} rel="noopener noreferrer">
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

/** The person a profile page is (22 Oct 2026): their name, picture and one line bio. */
export interface BookingProfilePerson {
  readonly name: string;
  /** What the avatar's colour is keyed on when there is no picture (their handle). */
  readonly id: string;
  readonly image?: string;
  readonly bio?: string;
  /** Their social links (booking socials, 25 Oct 2026), under the bio. */
  readonly socials?: readonly SocialLinkItem[];
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
              {person.socials !== undefined && (
                <SocialLinks links={person.socials} label={strings.socials(person.name)} />
              )}
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

/**
 * The longest handle the action quotes back. Past it the button names the address instead: a handle can be 40
 * characters, and quoting one of those pushes the button past the card on a phone, while the headline above
 * carries the whole address anyway.
 */
const ACTION_HANDLE_MAX = 18;

/** Props for BookingHandleOffer. */
export interface BookingHandleOfferProps {
  /** The address as the visitor reads it in the bar, host and all: "timefix.com/ada". */
  readonly address: string;
  /** The handle alone, as the action quotes it back: "ada". */
  readonly handle: string;
  /** Where the action goes: the sign in page carrying this handle (`signInPath` in `@crm/contracts/brand`). */
  readonly claimHref: string;
}

/**
 * A `/<handle>` nobody holds (25 Oct 2026): the dead end turned into an offer,
 * laid out as Cal.com's version of the same page and dressed as ours. The
 * quiet fact first ("Page not found"), then the headline with the address
 * itself as its subject and the accent on what is being offered
 * ("timefix.com/ada is free"), then one bordered card that is the action, with
 * the address quoted back on its button so the visitor reads it twice.
 *
 * Nothing else: no list of other places to go, and no claim link in the foot,
 * since the card already is the claim. Only an address nobody holds reaches
 * this page; a word kept for Timefix and a handle somebody holds both read as
 * BookingMessage's plain not found, so this page can never say that a private
 * account exists.
 */
export function BookingHandleOffer({ address, handle, claimHref }: BookingHandleOfferProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const leadId = useId();
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className={styles.root}>
      <div className={styles.narrow}>
        <div className={styles.offerHead}>
          {/* The quiet label a section heading uses: the same quiet line, in the same place above a block. */}
          <p id={leadId} className={styles.sectionTitle}>
            {strings.offerLead}
          </p>
          {/* The heading takes focus, so the fact follows the offer rather than being left above it unread. */}
          <h1 ref={heading} tabIndex={-1} aria-describedby={leadId} className={styles.offerTitle}>
            {address} <span className={styles.offerFree}>{strings.offerFree}</span>
          </h1>
        </div>
        <div className={styles.message}>
          <p className={styles.description}>{strings.offerText}</p>
          <div className={styles.offerAction}>
            <ButtonLink variant="primary" size="lg" isFullWidth="center" href={claimHref}>
              {handle.length > ACTION_HANDLE_MAX ? strings.offerActionLong : strings.offerAction(handle)}
            </ButtonLink>
          </div>
        </div>
        <BookingFoot page="booking_profile" />
      </div>
    </main>
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
