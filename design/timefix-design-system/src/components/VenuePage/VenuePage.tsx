import { useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { ArrowLeft, Check, ChevronRight, Clock, Images, MapPin, Share2, Star, Users } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { StatusDot } from '../Tag/Tag.tsx';
import { cx } from '../../lib/cx.ts';
import { OpeningHours, type OpeningDay } from './OpeningHours.tsx';
import './VenuePage.css';

export { OpeningHours, openStatus, type OpeningDay, type OpeningHoursProps } from './OpeningHours.tsx';

/** The business a public page is for. */
export interface Venue {
  readonly name: string;
  /** "Hair salon", "Mediterranean restaurant". */
  readonly kind: string;
  readonly rating?: number;
  readonly reviews?: number;
  readonly address: string;
  readonly area?: string;
  readonly phone?: string;
  /** "Open now · closes at 8:00 PM"; `isOpen` colours the dot. */
  readonly status: string;
  readonly isOpen: boolean;
  /** One large and two small photos show; the rest open from "See all". */
  readonly photos: ReadonlyArray<string>;
  readonly about?: string;
  readonly amenities?: ReadonlyArray<string>;
  /** Monday first, with each day's open times: drawn by OpeningHours (a live Open or Closed pill, today picked out). */
  readonly hours?: ReadonlyArray<OpeningDay>;
  /** Meets online only: no directions or map. */
  readonly isOnline?: boolean;
  /** The business's logo; its initials on a tile when there is none. */
  readonly logo?: string;
}
/** A dish or product shown on the page (not booked from it). */
export interface VenueMenuItem { readonly name: string; readonly description?: string; readonly price: string; readonly tag?: string }
/** One thing a guest can book from the page: a service, a meeting, a table. */
export interface VenueItem { readonly id: string; readonly name: string; readonly meta: string; readonly price?: string; readonly description?: string; readonly categoryId?: string }
/** Someone on the team. */
export interface VenuePerson { readonly id: string; readonly name: string; readonly title: string }

/** Props for VenuePage. */
export interface VenuePageProps {
  readonly venue: Venue;
  /** The menu: what's bookable, grouped by `categories` when given. Leave out for a page whose booking is the side card alone (a table). */
  readonly items?: ReadonlyArray<VenueItem>;
  readonly categories?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** What the menu section is called ("Services", "Meetings"). */
  readonly itemsTitle?: string;
  readonly team?: ReadonlyArray<VenuePerson>;
  /** Book one item. */
  readonly onBook?: (id: string) => void;
  /** The side card's main action ("Book now"); or `aside` to replace the card's body (a table picker). */
  readonly bookLabel?: string;
  readonly onBookNow?: () => void;
  readonly aside?: ReactNode;
  /** The foot under the page (Powered by). */
  readonly foot?: ReactNode;
  /** A menu to read (a restaurant's dishes), shown before About. */
  readonly menu?: ReadonlyArray<VenueMenuItem>;
  /** Opens the whole menu (its own link); shown under the dishes. */
  readonly onFullMenu?: () => void;
}

/** A public business page in the shape guests know from Fresha and OpenTable: name, rating and where; a photo grid; the menu by category with Book on each;
 *  the team; about and opening hours; a side card with the main action that stays in view. Shared by every module that books (services, tables, meetings). */
export function VenuePage({ venue, items = [], categories, itemsTitle = 'Services', team = [], onBook, bookLabel = 'Book now', onBookNow, aside, foot, menu = [], onFullMenu }: VenuePageProps) {
  const cats = categories?.filter((c) => items.some((i) => i.categoryId === c.id)) ?? [];
  const [cat, setCat] = useState<string>(cats[0]?.id ?? 'all');
  const [allPhotos, setAllPhotos] = useState(false);
  const shown = cats.length ? items.filter((i) => i.categoryId === cat) : items;
  return (
    <div className="tf-venue">
      {venue.photos.length > 0 && (
        <div className={cx('tf-venue__photos', venue.photos.length < 3 && 'is-single')}>
          {venue.photos.slice(0, allPhotos ? undefined : 3).map((src, n) => <img key={n} src={src} alt="" className="tf-venue__photo" />)}
          {!allPhotos && venue.photos.length > 3 && <Button size="sm" variant="secondary" className="tf-venue__allphotos" icon={<Images size={14} strokeWidth={1.75} />} onPress={() => setAllPhotos(true)}>See all photos</Button>}
        </div>
      )}

      <header className={cx('tf-venue__head', venue.photos.length > 0 && 'tf-venue__head--cover')}>
        {/* A profile header (owner's 11 Nov reference): the photos are the cover, the logo sits over their edge, then name, kind and the meta line. */}
        <span className="tf-venue__logo"><Avatar name={venue.name} src={venue.logo} size={64} shape="square" /></span>
        <div className="tf-venue__id">
        <h1 className="tf-venue__name">{venue.name}</h1>
        <p className="tf-venue__kind">{venue.kind}</p>
        <p className="tf-venue__line">
          {[
            venue.rating !== undefined ? <span key="r" className="tf-venue__rating" role="img" aria-label={`Rated ${venue.rating.toFixed(1)} out of 5${venue.reviews !== undefined ? ` from ${venue.reviews.toLocaleString('en-IN')} reviews` : ''}`}><span className="tf-num">{venue.rating.toFixed(1)}</span><span className="tf-venue__stars" aria-hidden="true">{Array.from({ length: 5 }, (_, n) => <Star key={n} size={13} strokeWidth={0} fill="currentColor" />)}</span>{venue.reviews !== undefined && <span className="tf-venue__muted tf-num">({venue.reviews.toLocaleString('en-IN')})</span>}</span> : null,
            <StatusDot key="s" hue={venue.isOpen ? 'green' : 'gray'}>{venue.status}</StatusDot>,
            <span key="a" className="tf-venue__muted">{venue.area ?? venue.address}</span>,
          ].filter(Boolean).flatMap((el, n) => (n === 0 ? [el] : [<span key={`d${n}`} aria-hidden="true">·</span>, el]))}
          {!venue.isOnline && <a className="tf-venue__link" href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`} target="_blank" rel="noreferrer">Get directions</a>}
        </p>
        </div>
        <IconButton label="Share this page" className="tf-venue__share"><Share2 size={16} strokeWidth={1.75} /></IconButton>
      </header>

      <div className="tf-venue__body">
        <main className="tf-venue__main">
          {items.length > 0 && (
            <section className="tf-venue__section" aria-labelledby="tf-venue-items">
              <h2 id="tf-venue-items" className="tf-venue__h2">{itemsTitle}</h2>
              {cats.length > 1 && (
                <div className="tf-venue__pills" role="group" aria-label="Categories">
                  {cats.map((c) => <AriaButton key={c.id} className="tf-venue__pill" aria-pressed={cat === c.id} onPress={() => setCat(c.id)}>{c.name}</AriaButton>)}
                </div>
              )}
              <ul className="tf-venue__items" key={cat}>
                {shown.map((i) => (
                  <li key={i.id}>
                    <AriaButton className="tf-venue__item" onPress={() => onBook?.(i.id)} aria-label={`Book ${i.name}`}>
                      <span className="tf-venue__item-text">
                        <span className="tf-venue__item-name">{i.name}</span>
                        <span className="tf-venue__item-meta tf-num">{i.meta}</span>
                        {i.description && <span className="tf-venue__item-desc">{i.description}</span>}
                        {i.price && <span className="tf-venue__item-price tf-num">{i.price}</span>}
                      </span>
                      <span className="tf-venue__item-book">Book</span>
                    </AriaButton>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {menu.length > 0 && (
            <section className="tf-venue__section" aria-labelledby="tf-venue-menu">
              <h2 id="tf-venue-menu" className="tf-venue__h2">Menu</h2>
              <ul className="tf-venue__menu">
                {menu.map((d) => (
                  <li key={d.name} className="tf-venue__dish">
                    <span className="tf-venue__dish-text"><span className="tf-venue__dish-name">{d.name}{d.tag && <span className="tf-venue__dish-tag">{d.tag}</span>}</span>{d.description && <span className="tf-venue__muted">{d.description}</span>}</span>
                    <span className="tf-venue__dish-price tf-num">{d.price}</span>
                  </li>
                ))}
              </ul>
              {onFullMenu && <Button variant="secondary" className="tf-venue__fullmenu" onPress={onFullMenu}>See the full menu</Button>}
            </section>
          )}
          {team.length > 0 && (
            <section className="tf-venue__section" aria-labelledby="tf-venue-team">
              <h2 id="tf-venue-team" className="tf-venue__h2">Team</h2>
              <ul className="tf-venue__team">
                {team.map((p) => <li key={p.id} className="tf-venue__person"><Avatar name={p.name} size={64} /><strong>{p.name.split(' ')[0]}</strong><span className="tf-venue__muted">{p.title}</span></li>)}
              </ul>
            </section>
          )}
          {(venue.about || venue.hours) && (
            <section className="tf-venue__section" aria-labelledby="tf-venue-about">
              <h2 id="tf-venue-about" className="tf-venue__h2">About</h2>
              {venue.about && <p className="tf-venue__about">{venue.about}</p>}
              {!venue.isOnline && <VenueMap label={venue.area ?? venue.address} />}
              {!venue.isOnline && <p className="tf-venue__muted">{venue.address} · <a className="tf-venue__link" href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`} target="_blank" rel="noreferrer">Get directions</a></p>}
              <div className="tf-venue__facts">
                {venue.hours && <OpeningHours week={venue.hours} />}
                {venue.amenities && venue.amenities.length > 0 && (
                  <div>
                    <h3 className="tf-venue__h3">Good to know</h3>
                    <ul className="tf-venue__amen">{venue.amenities.map((a) => <li key={a}><Check size={14} strokeWidth={2} aria-hidden="true" />{a}</li>)}</ul>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
        <aside className="tf-venue__aside" aria-label={`Book at ${venue.name}`}>
          <div className="tf-venue__card">
            <strong className="tf-venue__card-name">{venue.name}</strong>
            {venue.rating !== undefined && <span className="tf-venue__rating" role="img" aria-label={`Rated ${venue.rating.toFixed(1)} out of 5${venue.reviews !== undefined ? ` from ${venue.reviews.toLocaleString('en-IN')} reviews` : ''}`}><span className="tf-num">{venue.rating.toFixed(1)}</span><span className="tf-venue__stars" aria-hidden="true">{Array.from({ length: 5 }, (_, n) => <Star key={n} size={13} strokeWidth={0} fill="currentColor" />)}</span>{venue.reviews !== undefined && <span className="tf-venue__muted tf-num">({venue.reviews.toLocaleString('en-IN')})</span>}</span>}
            {aside ?? (onBookNow && <Button variant="primary" size="lg" className="tf-venue__cta" onPress={onBookNow}>{bookLabel}</Button>)}
            <hr className="tf-venue__rule" />
            <span className="tf-venue__cardline"><Clock size={16} strokeWidth={1.75} aria-hidden="true" /><StatusDot hue={venue.isOpen ? 'green' : 'gray'}>{venue.status}</StatusDot></span>
            <span className="tf-venue__cardline"><MapPin size={16} strokeWidth={1.75} aria-hidden="true" /><span>{venue.address}</span></span>
          </div>
        </aside>
      </div>
      {foot}
      {onBookNow && <div className="tf-venue__bar"><Button variant="primary" size="lg" className="tf-venue__cta" onPress={onBookNow}>{bookLabel}</Button></div>}
    </div>
  );
}

/** Props for VenueCheckout. */
export interface VenueCheckoutProps {
  /** The steps by name, in order ("Services", "Professional", "Time", "Confirm"). */
  readonly steps: ReadonlyArray<string>;
  readonly step: number;
  readonly title: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
  /** The summary card on the right: the venue, what's chosen, the total, and the step's main button. */
  readonly summary: ReactNode;
}

/** The booking steps after the page, as on Fresha: a breadcrumb of steps, the choice on the left, a summary card with the main button on the right. */
export function VenueCheckout({ steps, step, title, onBack, children, summary }: VenueCheckoutProps) {
  return (
    <div className="tf-venue-co">
      <div className="tf-venue-co__grid">
        <div className="tf-venue-co__main">
          <div className="tf-venue-co__nav">
          <IconButton label="Back" size="sm" onPress={onBack}><ArrowLeft size={16} strokeWidth={1.75} /></IconButton>
          <ol className="tf-venue-co__crumbs" aria-label="Steps">
            {steps.map((s, n) => <li key={s} className={cx(n === step && 'is-current', n < step && 'is-done')} aria-current={n === step ? 'step' : undefined}>{s}{n < steps.length - 1 && <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />}</li>)}
          </ol>
          </div>
          <h2 className="tf-venue-co__title" tabIndex={-1}>{title}</h2>
          <div className="tf-venue-co__body" key={step}>{children}</div>
        </div>
        <aside className="tf-venue-co__summary">{summary}</aside>
      </div>
    </div>
  );
}

/** A tile to pick a person (or "Any professional"). */
export function PersonTile({ name, title, isSelected, onPress, any = false }: { readonly name: string; readonly title: string; readonly isSelected: boolean; readonly onPress: () => void; readonly any?: boolean }) {
  return (
    <AriaButton className="tf-venue-tile" aria-pressed={isSelected} onPress={onPress}>
      {any ? <span className="tf-venue-tile__any" aria-hidden="true"><Users size={20} strokeWidth={1.75} /></span> : <Avatar name={name} size={48} />}
      <strong>{name}</strong><span className="tf-venue__muted">{title}</span>
    </AriaButton>
  );
}

/** A drawn neighbourhood map (the page can't load a real one): blocks, two main roads, a park, the sea, and the pin with the area's name. */
function VenueMap({ label }: { readonly label: string }) {
  return (
    <div className="tf-venue__map" role="img" aria-label={`Map of ${label}`}>
      <svg className="tf-venue__map-art" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect className="tf-venue__map-land" width="600" height="240" />
        <path className="tf-venue__map-water" d="M600 0 L600 240 L470 240 C490 190 450 150 490 110 C520 80 500 30 530 0 Z" />
        <rect className="tf-venue__map-park" x="60" y="140" width="110" height="70" rx="12" />
        {[[30, 20, 120, 80], [180, 20, 110, 90], [310, 20, 120, 60], [200, 140, 90, 80], [310, 110, 110, 100], [30, 230, 10, 10]].map(([x = 0, y = 0, w = 0, h = 0], n) => <rect key={n} className="tf-venue__map-block" x={x} y={y} width={w} height={h} rx="8" />)}
        <path className="tf-venue__map-road" d="M0 120 C150 115 300 125 470 100" />
        <path className="tf-venue__map-road" d="M300 0 C295 80 305 160 290 240" />
        <path className="tf-venue__map-lane" d="M0 60 L300 55 M170 120 L175 240 M300 190 L450 180" />
      </svg>
      <span className="tf-venue__pin"><MapPin size={18} strokeWidth={2} /></span>
      <span className="tf-venue__map-label">{label}</span>
    </div>
  );
}
