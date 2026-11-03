// The business page at `/<company-handle>` and `/<company-handle>/<place-slug>` (spec 0066, B4 lite, after Fresha's
// venue page): the gallery, the logo (or the name's initials), the name and the place on its own line, kind and open
// status with the address and Directions, section tabs that follow the scroll, then the Menu, About (with amenities),
// Opening hours, Location and the business's other places; a sticky side panel on a wide screen and a sticky bar on a
// phone carrying the page's one action (Reserve a table, or until it opens Call to book, else Directions), shown only
// when there is one; the foot. Times read in the place's own country's clock style ("18:00" in London, "6:00 pm" in
// Bengaluru), in the visitor's language.
// Built from the library's parts and its own block parts (BusinessGallery, BusinessMenu, BusinessHours,
// BusinessLocation, BusinessReserve). Nothing here touches the network: the page's client reads and passes props.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AMENITY_LABELS, type BusinessAmenity } from '@crm/contracts/business-page';
import type { PlaceHoursShape } from '@crm/contracts/hospitality';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { BusinessGallery, type BusinessPhotoItem } from './BusinessGallery.tsx';
import { BusinessHours } from './BusinessHours.tsx';
import { BusinessLocation } from './BusinessLocation.tsx';
import { BusinessMenu, type BusinessMenuSection } from './BusinessMenu.tsx';
import styles from './BusinessPage.module.css';
import { businessAction, BusinessReserve, type BusinessReserveState } from './BusinessReserve.tsx';
import { currentSection, openStatus, placeLocale } from './hours.ts';
import { strings } from './strings.ts';

export { BusinessGallery, type BusinessGalleryProps, type BusinessPhotoItem } from './BusinessGallery.tsx';
export { BusinessHours, type BusinessHoursProps } from './BusinessHours.tsx';
export { BusinessLocation, type BusinessLocationProps } from './BusinessLocation.tsx';
export { BusinessMenu, type BusinessMenuProps, type BusinessMenuSection } from './BusinessMenu.tsx';
export {
  businessAction,
  BusinessReserve,
  type BusinessAction,
  type BusinessReserveProps,
  type BusinessReserveState,
} from './BusinessReserve.tsx';

/** Each amenity's mark. */
const AMENITY_ICONS: Readonly<Record<BusinessAmenity, IconName>> = {
  wifi: 'wifi',
  parking: 'car',
  wheelchair: 'accessibility',
  cards: 'credit-card',
  kids: 'baby',
  outdoor: 'tree-pine',
  pets: 'paw-print',
  air_conditioning: 'snowflake',
  vegetarian: 'leaf',
  private_dining: 'utensils',
};

/** The place the page shows. */
export interface BusinessPagePlace {
  readonly name: string;
  readonly addressLine?: string | undefined;
  readonly city?: string | undefined;
  readonly postcode?: string | undefined;
  readonly phone?: string | undefined;
  /** Its country (ISO 3166 alpha 2): times read in its clock style, in the visitor's language. */
  readonly country?: string | undefined;
  readonly timeZone: string;
  readonly hours: PlaceHoursShape;
}

/** Props for BusinessPage. */
export interface BusinessPageProps {
  readonly name: string;
  /** The place's own name, on its own line under the business's, when the business has several places. */
  readonly placeName?: string | undefined;
  /** What the business is, in words ("Restaurant"). */
  readonly kind: string;
  /** Its one line (the business profile's description). */
  readonly description?: string | undefined;
  /** The longer About text, kept with its line breaks. */
  readonly about?: string | undefined;
  /** The workspace's logo, on our own origin; without one the name's initials stand in. */
  readonly logo?: string | undefined;
  readonly photos: readonly BusinessPhotoItem[];
  readonly amenities: readonly BusinessAmenity[];
  readonly place: BusinessPagePlace;
  /** Every place of the business, the one shown marked; the picker shows only with more than one. */
  readonly places?: readonly { readonly name: string; readonly href: string; readonly isCurrent: boolean }[];
  /** The place's published menu (the Menu app); no Menu section without one. */
  readonly menu?: readonly BusinessMenuSection[] | undefined;
  /** Reserve a table (Table seating); absent without the app. */
  readonly reserve?: BusinessReserveState | undefined;
  readonly directions?: { readonly google: string; readonly apple: string } | undefined;
  readonly website?: string | undefined;
  /** The foot: the public page passes BookingFoot. */
  readonly foot?: ReactNode;
  /** While the page's read is on its way: its shape, empty. */
  readonly isLoading?: boolean;
}

/** One section the tabs reach. */
interface Section {
  readonly id: string;
  readonly label: string;
}

/**
 * Which section the reader is in: the last whose top has passed under the tabs, or the last section once the page
 * is scrolled to its end (where the last sections can never reach the tabs). Watched with an IntersectionObserver on
 * each section's top edge, and a passive scroll listener for the end.
 */
function useCurrentSection(
  ids: readonly string[],
  barRef: RefObject<HTMLElement | null>,
): [string | undefined, (id: string) => void] {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  // A tab pressed is current until the reader scrolls on: the page's end may never bring its section to the top.
  const chosenAt = useRef(0);
  const key = ids.join(' ');
  // The tabs' own height, measured: the line a section's top crosses to become current sits just under them.
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return undefined;
    setBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      setBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
  }, [barRef]);
  useEffect(() => {
    const sections = key
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const passed = new Set<string>();
    // At the page's end the last sections can never reach the tabs, so the last one is current there.
    const atEnd = () =>
      globalThis.innerHeight + globalThis.scrollY >= document.documentElement.scrollHeight - END_SLACK_PX;
    const pick = () => {
      if (performance.now() - chosenAt.current < CHOSEN_HOLD_MS) return;
      setCurrent(
        currentSection(
          sections.map((section) => section.id),
          passed,
          atEnd(),
        ),
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // A section whose top went above the line is passed; one back below it is not.
          if (entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + 1) passed.add(entry.target.id);
          else passed.delete(entry.target.id);
        }
        pick();
      },
      // The line is just under the sticky tabs: a section is current once its heading reaches them.
      { rootMargin: `-${String(barHeight)}px 0px 0px 0px`, threshold: [0, 1] },
    );
    for (const section of sections) observer.observe(section);
    // Reaching the end (and leaving it) crosses no section's edge, so a passive scroll listener notices it.
    globalThis.addEventListener('scroll', pick, { passive: true });
    // Already at the end when the watch starts (a reload there, or a scroll while the tabs were being measured).
    if (globalThis.scrollY > 0 && atEnd()) pick();
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('scroll', pick);
    };
  }, [key, barHeight]);
  const choose = (id: string) => {
    chosenAt.current = performance.now();
    setCurrent(id);
  };
  return [current, choose];
}

/** How long a pressed tab stays current while the page scrolls to its section. */
const CHOSEN_HOLD_MS = 1200;

/** How near the page's end counts as the end, in CSS pixels (a fractional scroll never quite reaches it). */
const END_SLACK_PX = 2;

/**
 * The section tabs (AC-6641): links to each section, the current one underlined by an indicator that slides between
 * them (positioned through the CSS object model, as React Aria's own tab indicator is, so the page's style policy is
 * unchanged), still under reduced motion, where the row of tabs also jumps rather than glides to the current one.
 */
function SectionTabs({ sections }: { readonly sections: readonly Section[] }) {
  const navRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useCurrentSection(
    sections.map((section) => section.id),
    navRef,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (list === null || indicator === null) return;
    const link = list.querySelector<HTMLElement>(`[data-section="${current ?? ''}"]`);
    if (link === null) return;
    indicator.style.setProperty('translate', `${String(link.offsetLeft)}px 0`);
    indicator.style.setProperty('width', `${String(link.offsetWidth)}px`);
    indicator.dataset.shown = '';
    // The current tab stays in view on a phone, where the tabs scroll sideways.
    const left = link.offsetLeft - list.clientWidth / 2 + link.offsetWidth / 2;
    if (typeof list.scrollTo === 'function')
      list.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [current]);
  if (sections.length < 2) return null;
  return (
    <nav ref={navRef} className={styles.tabs} aria-label={strings.sections}>
      <div ref={listRef} className={styles.tabTrack}>
        <ul className={styles.tabList}>
          {sections.map((section) => (
            <li key={section.id}>
              <a
                className={styles.tab}
                href={`#${section.id}`}
                data-section={section.id}
                aria-current={current === section.id ? 'location' : undefined}
                onClick={() => {
                  setCurrent(section.id);
                }}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
        <span ref={indicatorRef} className={styles.indicator} aria-hidden />
      </div>
    </nav>
  );
}

/** Whether the visitor asked for less motion. */
const prefersReducedMotion = () =>
  typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "Open now · Closes at 23:00", with its dot, on the place's own clock. */
function OpenLine({ place, locale }: { readonly place: BusinessPagePlace; readonly locale: string }) {
  const now = useNow();
  const status = openStatus(place.hours, now, place.timeZone, locale);
  return (
    <span className={styles.open} data-open={status.isOpen || undefined}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.state}>{status.state}</span>
      {status.detail !== undefined && <span className={styles.detail}>{status.detail}</span>}
    </span>
  );
}

/** The address on one line ("12 MG Road, Bengaluru"). */
const shortAddress = (place: BusinessPagePlace) =>
  [place.addressLine, place.city].filter((part) => part !== undefined && part !== '').join(', ');

/** The address's lines for Location. */
const addressLines = (place: BusinessPagePlace) =>
  [
    place.addressLine,
    [place.city, place.postcode].filter((part) => part !== undefined && part !== '').join(' '),
  ].filter((line): line is string => line !== undefined && line !== '');

/** The page while its read is on its way: the gallery's and the header's shapes. */
function LoadingPage() {
  return (
    <div className={styles.root} aria-busy aria-label={strings.loading}>
      <div className={styles.frame}>
        <BusinessGallery photos={[]} name="" isLoading />
        <div className={styles.head}>
          <Skeleton shape="line" width="medium" />
          <Skeleton shape="text" lines={2} width="long" />
        </div>
      </div>
    </div>
  );
}

/** The business page (AC-6640 to AC-6643). */
export function BusinessPage(props: BusinessPageProps) {
  const { name, kind, description, about, photos, amenities, place, places = [], menu, reserve, directions } = props;
  const { locale: visitorLocale } = useFormatSettings();
  if (props.isLoading === true) return <LoadingPage />;
  const locale = placeLocale(visitorLocale, place.country);
  const logo = props.logo === undefined ? undefined : safeImageSrc(props.logo);
  const website = props.website === undefined ? undefined : safeHref(props.website);
  const hasMenu = menu !== undefined && menu.some((section) => section.items.length > 0);
  const hasAbout = about !== undefined || amenities.length > 0;
  const sections: Section[] = [
    ...(hasMenu ? [{ id: 'menu', label: strings.menu }] : []),
    ...(hasAbout ? [{ id: 'about', label: strings.about }] : []),
    { id: 'hours', label: strings.hours },
    { id: 'location', label: strings.location },
  ];
  const address = shortAddress(place);
  const others = places.length > 1 ? places.filter((other) => !other.isCurrent) : [];
  const action = businessAction(reserve, place.phone, directions?.google);
  return (
    <div className={styles.root}>
      <div className={styles.frame}>
        <BusinessGallery photos={photos} name={name} />
        <header className={styles.head}>
          {/* The logo, or the name's initials on the brand's own tile: the name beside it says whose it is. */}
          <Avatar
            name={name}
            {...(logo === undefined ? { hue: 'ink' as const } : { src: logo, fit: 'contain' as const })}
            shape="square"
            size="title"
            isDecorative
          />
          <div className={styles.titles}>
            <h1 className={styles.name}>{name}</h1>
            {props.placeName !== undefined && props.placeName !== '' && (
              <p className={styles.placeName}>{props.placeName}</p>
            )}
          </div>
          <p className={styles.facts}>
            <span>{kind}</span>
            <OpenLine place={place} locale={locale} />
          </p>
          {description !== undefined && <p className={styles.description}>{description}</p>}
          {address !== '' && (
            <p className={styles.where}>
              <Icon name="map-pin" />
              <span>{address}</span>
              {directions !== undefined && (
                <a className={styles.directions} href={directions.google} target="_blank" rel="noopener noreferrer">
                  {strings.directions}
                </a>
              )}
            </p>
          )}
        </header>
        <SectionTabs sections={sections} />
        <div className={styles.body} data-panel={action === undefined ? undefined : ''}>
          <main className={styles.main}>
            {hasMenu && (
              <section id="menu" className={styles.section} aria-labelledby="business-menu">
                <h2 id="business-menu" className={styles.heading}>
                  {strings.menu}
                </h2>
                <BusinessMenu sections={menu} />
              </section>
            )}
            {hasAbout && (
              <section id="about" className={styles.section} aria-labelledby="business-about">
                <h2 id="business-about" className={styles.heading}>
                  {strings.about}
                </h2>
                {about !== undefined && <p className={styles.about}>{about}</p>}
                {amenities.length > 0 && (
                  <>
                    <h3 className={styles.subheading}>{strings.amenities}</h3>
                    <ul className={styles.amenities}>
                      {amenities.map((amenity) => (
                        <li key={amenity} className={styles.amenity}>
                          <Icon name={AMENITY_ICONS[amenity]} />
                          {AMENITY_LABELS[amenity]}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
            <section id="hours" className={styles.section} aria-labelledby="business-hours">
              <h2 id="business-hours" className={styles.heading}>
                {strings.hours}
              </h2>
              <BusinessHours hours={place.hours} timeZone={place.timeZone} locale={locale} />
            </section>
            <section id="location" className={styles.section} aria-labelledby="business-location">
              <h2 id="business-location" className={styles.heading}>
                {strings.location}
              </h2>
              <BusinessLocation
                lines={addressLines(place)}
                phone={place.phone}
                directions={directions}
                website={website}
              />
            </section>
            {others.length > 0 && (
              <section id="places" className={styles.section} aria-labelledby="business-places">
                <h2 id="business-places" className={styles.heading}>
                  {strings.otherPlaces}
                </h2>
                <ul className={styles.places}>
                  {others.map((other) => (
                    <li key={other.href}>
                      <a className={styles.placeLink} href={safeHref(other.href)}>
                        <Icon name="map-pin" />
                        {other.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>
          {/* A wide screen: the panel that stays beside the page as it scrolls, while it has an action to carry. */}
          {action !== undefined && (
            <aside className={styles.panel} aria-label={name}>
              <div className={styles.panelCard}>
                <p className={styles.panelName}>{name}</p>
                <OpenLine place={place} locale={locale} />
                <BusinessReserve action={action} />
                {directions !== undefined && action.kind !== 'directions' && (
                  <a className={styles.directions} href={directions.google} target="_blank" rel="noopener noreferrer">
                    <Icon name="map-pin" />
                    {strings.directions}
                  </a>
                )}
              </div>
            </aside>
          )}
        </div>
        {props.foot}
      </div>
      {/* A phone: the bar that stays at the foot of the screen with the one action. */}
      {action !== undefined && (
        <div className={styles.bar}>
          <div className={styles.barText}>
            <span className={styles.barName}>{name}</span>
            <OpenLine place={place} locale={locale} />
          </div>
          <div className={styles.barAction}>
            <BusinessReserve action={action} />
          </div>
        </div>
      )}
    </div>
  );
}
