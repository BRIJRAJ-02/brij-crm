import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import { Avatar, AvatarStack, type AvatarStackPerson } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { usePageVariables, type PageVariables } from '../../lib/page-variables.ts';
import { poweredByHref, type PoweredByPage } from '../../lib/powered-by.ts';
import { SocialLinks, type SocialLinkItem } from '../../molecules/SocialLinks/SocialLinks.tsx';
import { templateAttributes, type PageTemplate } from '../../lib/page-template.ts';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import { PopupHost } from '../GuestLook/PopupHost.tsx';
import styles from './BookingFrame.module.css';
import { strings } from './strings.ts';

/** One line of the rail's facts: an icon and what it says ("Video call"), or a control (the time zone). */
export interface BookingFact {
  readonly id: string;
  readonly icon: IconName;
  readonly children: ReactNode;
  /**
   * A quiet second part after it, in the time zone picker's own format ("London time" then "GMT · 18:00"), so a fact
   * reads the same on every step (critic C4); or a quiet line of its own (`isQuiet`).
   */
  readonly aside?: string;
  /** The whole line is quiet: a rule the page states plainly ("4 hours’ notice · Up to 60 days ahead"). */
  readonly isQuiet?: boolean;
}

/** Who is booked, as the rail heads it. */
export interface BookingHost {
  /** The host: the line above the meeting. A team page shows faces instead, over the page's own title. */
  readonly name: string;
  readonly image?: string;
  /** The host's job title, under their name, when they show it (3 Nov 2026); never on a team page. */
  readonly role?: string;
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

/**
 * A fact's identity is its id alone (critic C4, 4 November 2026): keyed by its words too, the zone's line, which
 * carries the ticking clock, was drawn anew and blurred in every minute. A fact that changes its words keeps its line.
 */
const factKey = (fact: BookingFact) => fact.id;

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
  /** Above the card in the column, moving it down: a message for this visit (a calendar that didn't connect). */
  readonly banner?: ReactNode;
  /**
   * The small control over the card's end corner: the visitor's calendar ("Connect your calendar"). On a wide page it
   * stands in the room above the card and holds no place in the column, so it never moves the card.
   */
  readonly bar?: ReactNode;
  /** The card's heading: "Choose a time". */
  readonly heading?: string;
  /** At the heading's end, as one compact group: the clock (12h or 24h) and the view (Month, List or Chat). */
  readonly toolbar?: ReactNode;
  /** The card's first pane: the month, the days, or the details form. */
  readonly children?: ReactNode;
  /** The card's end pane: the chosen day's times. Leave it off for one wide pane. */
  readonly aside?: ReactNode;
  /** A band across the card's foot: the Book bar. */
  readonly footer?: ReactNode;
  /**
   * While nothing is chosen yet, what the band says in Book's place ("Pick a time"): a quiet line on a wide page,
   * and no band at all on a phone, where Book arrives as a bar held to the window's foot once a time is picked.
   */
  readonly footerWaiting?: string;
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
   * Keeps the stacked layout however wide the window is (27 October 2026): the page drawn in something narrow
   * that is not a frame of its own, where a media query would read the window and lay out two columns inside a
   * phone. First run's preview of a page that doesn't exist yet, and so cannot be shown in a `PreviewFrame`.
   */
  readonly isCompact?: boolean;
  /**
   * Drawn inside a site's embed (3 November 2026): the page takes its content's height, not the frame's. A page
   * at least as tall as its viewport, inside a frame sized to what the page reports, can only ever grow: the
   * booking details step sat in the calendar's height with a screen of empty card above Confirm.
   */
  readonly isEmbedded?: boolean;
  /**
   * A sketch of the page anchored in a panel that cuts it (first run's preview): it starts from the top however tall
   * the window is, rather than in the window's middle, which it isn't drawn in.
   */
  readonly isAnchored?: boolean;
  /**
   * Where "Claim your free page" goes: `claimPageHref('booking_page')`, tagged as the wordmark beside it is. Leave
   * it off to show the wordmark alone (a recognised visitor).
   */
  readonly claimHref?: string;
  readonly logo?: ProductLogo;
  /**
   * The workspace's brand kit (spec 0060, AC-4): its logo at the head of the rail, on our own origin (the page's
   * `logo?v=` route), named by `alt`. Its accent arrives as the page's brand stylesheet; the app's preview passes
   * the same custom properties as `variables` instead. Nothing the page does changes with it.
   */
  readonly brand?: PageBrand;
  /**
   * `PlaceBookingFrame` passes its stylesheet here: the rail heads with the business's initials on a square ink tile
   * (or its logo, when the brand has one) beside its name on one row, at every width, the title under it in the
   * heading's weight (a restaurant's "Reserve your table"). Left out, the host's round picture over their name.
   */
  readonly placeLook?: Readonly<Record<string, string | undefined>>;
  /** A quiet link closing the rail's block, its arrow after it: a reservation's "Manage booking →". With `placeLook`. */
  readonly railLink?: { readonly label: string; readonly href: string };
}

/** A booking page's or form's brand kit, as the library draws it (spec 0060, AC-4). */
export interface PageBrand {
  /** The logo, on our own origin, and what it says (the workspace's name). */
  readonly logo?: { readonly src: string; readonly alt: string };
  /**
   * Where the logo leads: the company page on our own host (`/<company-handle>`, spec 0066 AC-6646), while one is
   * published. The logo then names the company (its `alt` says where the link goes). Absent, it links nowhere.
   */
  readonly href?: string;
  /** The accent's custom properties, for an app preview (`brandProperties()`); the live page has a stylesheet. */
  readonly variables?: PageVariables;
  /**
   * The template the page wears (spec 0068, AC-6801, AC-6804): the workspace's, from the brand kit. Left out it is
   * Classic. Night pins dark and Studio light; Classic and Split follow the visitor.
   */
  readonly template?: PageTemplate;
}

/** A company page's path on our own host, the only place the rail's logo may lead (`/<company-handle>`). */
const COMPANY_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The workspace's logo at the head of the rail; a link to the company page while one is published (spec 0066,
 * AC-6646), named by the logo's `alt`. Inside a site's embed the link opens a tab of its own, never inside the frame.
 */
function BrandMark({
  src,
  alt,
  href,
  isEmbedded,
  onError,
}: {
  readonly src: string;
  readonly alt: string;
  readonly href: string | undefined;
  readonly isEmbedded: boolean;
  readonly onError: () => void;
}) {
  const logo = <img className={styles.brandLogo} src={src} alt={alt} decoding="async" onError={onError} />;
  if (href === undefined || alt === '' || !COMPANY_PATH.test(href)) return logo;
  return (
    <a
      className={styles.brandLink}
      href={href}
      {...(isEmbedded ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {logo}
    </a>
  );
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
  bar,
  heading,
  toolbar,
  children,
  aside,
  footer,
  footerWaiting,
  cover,
  coverFooter,
  coverPlace = 'body',
  view,
  enter,
  isCompact = false,
  isEmbedded = false,
  isAnchored = false,
  claimHref,
  logo = TIMEFIX_LOGO,
  brand,
  placeLook,
  railLink,
}: BookingFrameProps) {
  const isTile = placeLook !== undefined;
  const isAsideGrowing = isTile;
  const railHref = railLink === undefined ? undefined : safeHref(railLink.href);
  const isLoading = host === undefined || title === undefined;
  const variables = usePageVariables(brand?.variables);
  // A logo that fails (a stale version, a removed file) leaves the rail rather than drawing a broken picture.
  const [failedLogo, setFailedLogo] = useState<string | undefined>(undefined);
  const logoSrc = brand?.logo === undefined ? undefined : safeImageSrc(brand.logo.src);
  const brandLogo = logoSrc === failedLogo ? undefined : logoSrc;
  // Only a view changed after the first paint moves: the page's first view is simply there. One chosen from the
  // keyboard (the switch's arrows, Enter on Book or Back) shows at once, decided as it changes: keys never wait.
  const { isFocusVisible } = useFocusVisible();
  const [shown, setShown] = useState({ view, isMoved: false, isInstant: false });
  if (shown.view !== view) setShown({ view, isMoved: true, isInstant: isFocusVisible });
  // The facts the page first drew are simply there; one that arrives or changes after (the chosen time, on the
  // details step) is drawn anew and resolves in.
  const [firstFacts] = useState(() => new Set(facts.map(factKey)));
  const [firstHeading] = useState(heading);
  // A page that opened on its skeleton: when the host arrives, their block resolves in top down rather than
  // swapping in at once (loading to content). A page that opened with its facts is simply there.
  const [openedLoading] = useState(isLoading);
  const isCovered = cover !== undefined;
  const isCardCovered = isCovered && coverPlace === 'card';
  // A wide page holds the card at the month's height under such a step (CSS); stacked or embedded the step hugs.
  const holdsCard = isCardCovered && !isCompact && !isEmbedded;
  const claim = claimHref === undefined ? {} : { claimHref };
  // The card's foot band: Book, or while nothing is chosen the quiet line in its place (`footerWaiting`).
  const footBand = (content: ReactNode) =>
    footerWaiting === undefined ? (
      <div className={styles.footer}>{content}</div>
    ) : (
      <div className={styles.footer} data-waiting="">
        <p className={styles.footerHint}>{footerWaiting}</p>
      </div>
    );
  return (
    <main
      className={isTile ? `${styles.root ?? ''} ${placeLook.root ?? ''}` : styles.root}
      ref={variables}
      {...templateAttributes(brand?.template)}
      {...(isCompact ? { 'data-compact': true } : {})}
      {...(isEmbedded ? { 'data-embedded': true } : {})}
      {...(isAnchored ? { 'data-anchored': true } : {})}
    >
      {/* The page's popups (the visitor bar's menu, add to calendar, the change dialogs) open inside its themed root,
          in its template and theme (spec 0074, AC-7409). */}
      <PopupHost className={styles.popups}>
        <div className={styles.layout}>
          <aside className={styles.rail} aria-label={strings.about} aria-busy={isLoading || undefined}>
            {/* The workspace's own logo heads the rail (spec 0060, AC-4): its mark, before the host it books with. */}
            {brandLogo !== undefined && brand?.logo !== undefined && (
              <BrandMark
                src={brandLogo}
                alt={brand.logo.alt}
                href={brand.href}
                isEmbedded={isEmbedded}
                onError={() => {
                  setFailedLogo(brandLogo);
                }}
              />
            )}
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
                  {/* The meeting's line, as most pages draw it (one length, "30 min · Video call"): a line of text in
                    the row, so the rows under it and the card under the rail on a phone stand where they will. A
                    page with several lengths draws its switch here, a few pixels taller. */}
                  <li className={styles.fact}>
                    <span className={styles.factIcon}>
                      <Skeleton shape="tile" />
                    </span>
                    <span className={styles.factBody} data-loading="">
                      <Skeleton shape="text" width="medium" />
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
                  {/* The page's rules under them (how soon, how far ahead), which every page with times shows. */}
                  <li className={styles.fact} data-quiet>
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
              <div
                className={isTile ? `${styles.identity ?? ''} ${placeLook.identity ?? ''}` : styles.identity}
                data-arrived={openedLoading || undefined}
                data-identity={isTile ? 'tile' : undefined}
              >
                {isTile ? (
                  // A place: its initials on a square ink tile (its logo already heads the rail when it has one) beside
                  // its name, on one row.
                  <div className={placeLook.tileRow}>
                    {/* The page's accent behind the initials (the brand's, else the guest look's ink), as the business page. */}
                    {brandLogo === undefined && (
                      <Avatar name={host.name} shape="square" hue="accent" size="lg" isDecorative />
                    )}
                    <p className={`${styles.host ?? ''} ${placeLook.host ?? ''}`}>{host.name}</p>
                  </div>
                ) : host.team === undefined ? (
                  <Avatar
                    name={host.name}
                    size="xl"
                    isDecorative
                    {...(host.image === undefined ? {} : { src: host.image })}
                  />
                ) : host.team.people.length === 0 ? null : (
                  <AvatarStack
                    people={host.team.people}
                    total={host.team.total}
                    label={host.team.label}
                    max={TEAM_FACES}
                    size="lg"
                  />
                )}
                <div
                  className={styles.names}
                  data-team={host.team === undefined ? undefined : ''}
                  data-alone={
                    isTile || (host.team === undefined && host.name.trim().toLowerCase() === title.trim().toLowerCase())
                      ? ''
                      : undefined
                  }
                >
                  {/* A team page names nobody before booking: its faces and the page's own title. */}
                  {/* A place named as its business (a restaurant's one place) says its name once, as the h1. */}
                  {!isTile &&
                    host.team === undefined &&
                    host.name.trim().toLowerCase() !== title.trim().toLowerCase() && (
                      <p className={styles.host}>{host.name}</p>
                    )}
                  {!isTile && host.team === undefined && host.role !== undefined && host.role !== '' && (
                    <p className={styles.hostRole}>{host.role}</p>
                  )}
                  <h1 className={styles.title}>{title}</h1>
                </div>
                {description !== undefined && description !== '' && <p className={styles.description}>{description}</p>}
                {facts.length > 0 && (
                  <ul className={styles.facts}>
                    {facts.map((fact) => (
                      <li
                        key={factKey(fact)}
                        className={styles.fact}
                        data-quiet={fact.isQuiet === true || undefined}
                        {...(firstFacts.has(factKey(fact)) ? {} : { 'data-reveal': true })}
                      >
                        <span className={styles.factIcon}>
                          <Icon name={fact.icon} size="sm" tone="muted" />
                        </span>
                        <span className={styles.factBody}>
                          {fact.children}
                          {fact.aside !== undefined && <span className={styles.factAside}>{fact.aside}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Last in the block (booking socials): it arrives with the facts, and on a wide page nothing under it
                  moves, since the foot is pinned to the rail's end. */}
                {host.team === undefined && host.socials !== undefined && (
                  <SocialLinks links={host.socials} label={strings.socials(host.name)} />
                )}
                {railLink !== undefined && railHref !== undefined && (
                  <a className={placeLook?.railLink} href={railHref}>
                    {railLink.label}
                    <Icon name="arrow-right" size="xs" />
                  </a>
                )}
              </div>
            )}
          </aside>
          <div className={styles.main}>
            {banner}
            {bar !== undefined && <div className={styles.bar}>{bar}</div>}
            <section
              className={styles.card}
              // Covered whole (the details step), the step's own form names what the card holds.
              {...(isCardCovered ? {} : { 'aria-label': heading ?? title ?? strings.loading })}
              data-instant={shown.isInstant || undefined}
              data-place={isCardCovered ? 'card' : undefined}
              data-hold={holdsCard || undefined}
              aria-busy={isLoading || undefined}
            >
              {(heading !== undefined || toolbar !== undefined) && (
                <div className={styles.head} inert={isCardCovered}>
                  {heading !== undefined && (
                    // Keyed by its words, so a new heading is drawn anew and resolves in with the step.
                    <h2
                      key={heading}
                      className={styles.heading}
                      {...(heading === firstHeading ? {} : { 'data-reveal': true })}
                    >
                      {heading}
                    </h2>
                  )}
                  {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}
                </div>
              )}
              <div
                className={styles.stage}
                data-moved={shown.isMoved || undefined}
                data-instant={shown.isInstant || undefined}
                data-place={isCovered ? coverPlace : undefined}
                data-hold={holdsCard || undefined}
                // The view over the month: on a phone Book by chat sets the card's height itself (BookingChat).
                data-view={isCovered ? view : undefined}
                data-enter={enter}
              >
                {/* Covered, the month still sets the card's size: hidden, out of the reading order and out of reach. */}
                <div className={styles.under} inert={isCovered}>
                  <div className={styles.panes} data-panes={aside === undefined ? 'one' : 'two'}>
                    {/* A pane draws what it is given, loading or not: the page hands its own month and times, already
                      in their shape, so the card is the right height from the first paint. */}
                    <div className={styles.pane}>{children ?? <Skeleton shape="block" lines={6} />}</div>
                    {aside !== undefined && (
                      <div
                        className={isTile ? `${styles.aside ?? ''} ${placeLook.aside ?? ''}` : styles.aside}
                        data-growing={isAsideGrowing || undefined}
                      >
                        {aside}
                      </div>
                    )}
                  </div>
                  {footer !== undefined && footBand(footer)}
                </div>
                {isCovered && (
                  <div key={view} className={styles.cover}>
                    <div className={styles.coverBody}>{cover}</div>
                    {coverFooter !== undefined && footBand(coverFooter)}
                  </div>
                )}
              </div>
            </section>
          </div>
          {/* After the card in the reading order (critic C7): drawn at the rail's foot on a wide page, under the card on
            a phone. */}
          <BookingFoot placement="rail" logo={logo} {...claim} />
        </div>
      </PopupHost>
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
  /**
   * A way on beside Try again: the reservation page's manage link that opens nothing offers "Find your reservation"
   * (spec 0066 B7), so a bad link is never a dead end. `icon` is the search glass unless named; `null` draws none,
   * for a quiet way back out ("Changed your mind? Unsubscribe", 10 November 2026).
   */
  readonly link?: { readonly label: string; readonly href: string; readonly icon?: IconName | null };
  /** While the page's facts load: a skeleton in the card. */
  readonly isLoading?: boolean;
  /** Which public page shows the message, for the wordmark link's tags: the booking page (the default), a profile, or the guest's page. */
  readonly page?: PoweredByPage;
  /** Whose page it is, when that is known (a paused page, critic B-09): their face over the message. */
  readonly host?: { readonly name: string; readonly image?: string };
  /** Somewhere to go instead: the host's link page ("See Ada's page"). */
  readonly action?: { readonly href: string; readonly label: string };
  /**
   * One thing to do instead, a secondary button beside Try again: the unsubscribed page's "Subscribe again"
   * (10 November 2026). `pendingLabel` shows while `isPending`, when presses are ignored.
   */
  readonly press?: {
    readonly label: string;
    readonly onPress: () => void;
    readonly isPending?: boolean;
    readonly pendingLabel?: string;
  };
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
  link,
  isLoading = false,
  page = 'booking_page',
  host,
  action,
  press,
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
              {host !== undefined && (
                <Avatar
                  name={host.name}
                  size="xl"
                  isDecorative
                  {...(host.image === undefined ? {} : { src: host.image })}
                />
              )}
              <h1 ref={heading} tabIndex={-1} className={styles.messageTitle}>
                {title}
              </h1>
              {children !== undefined && <p className={styles.description}>{children}</p>}
              {action !== undefined && (
                <div>
                  <ButtonLink href={action.href} iconRight="arrow-right">
                    {action.label}
                  </ButtonLink>
                </div>
              )}
              {(onRetry !== undefined || link !== undefined || press !== undefined) && (
                <div className={styles.messageActions}>
                  {press !== undefined && (
                    <Button isPending={press.isPending === true} onPress={press.onPress}>
                      {press.isPending === true && press.pendingLabel !== undefined ? press.pendingLabel : press.label}
                    </Button>
                  )}
                  {onRetry !== undefined && (
                    <Button icon="refresh-cw" onPress={onRetry}>
                      {strings.retry}
                    </Button>
                  )}
                  {link !== undefined && (
                    <ButtonLink
                      href={link.href}
                      variant="ghost"
                      {...(link.icon === null ? {} : { icon: link.icon ?? 'search' })}
                    >
                      {link.label}
                    </ButtonLink>
                  )}
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
