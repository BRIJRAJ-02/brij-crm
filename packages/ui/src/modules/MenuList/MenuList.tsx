// The guest menu (spec 0065, H1, AC-6528 to AC-6533): a place's published menus as a guest reads them on a phone. The
// Warm look (after the checklabs guest app): one column a thumb reaches, the business on top with open now, a glass
// bar that sticks with the menus and the section chips, search and dietary filters, items as rows or a photo grid,
// a bottom sheet per item with its sizes, options, allergens in words and calories, and Your picks kept only in the
// guest's browser. Everything comes in through props: the page's entry reads the menu and keeps the picks.
import { DIET_FILTERS, formatPrice, nextOpening, openAt, servingAt, type DietMark } from '@crm/contracts/menu';
import type { PublicMenu, SnapshotItem, SnapshotSection, SnapshotSubsection } from '@crm/contracts';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { ChoiceChips } from '../../molecules/ChoiceChips/ChoiceChips.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Tabs } from '../../molecules/Tabs/Tabs.tsx';
import { ItemSheet, PicksSheet, picksTotal, type GuestPick, type MenuPhotoHref } from '../ItemSheet/ItemSheet.tsx';
import { useNow } from '../../provider/context.ts';
import styles from './MenuList.module.css';
import { strings } from './strings.ts';

export type { GuestPick, MenuPhotoHref } from '../ItemSheet/ItemSheet.tsx';

export interface MenuListProps {
  /** The published menu, as `GET /api/public/menu/:key` answers it. */
  readonly menu: PublicMenu;
  /** The business's logo, when it has one. */
  readonly logoHref?: string;
  /** Where each photo is served; without it no photo draws. */
  readonly photoHref?: MenuPhotoHref;
  /** The table a QR code opened the menu at ("4"), shown in the header (H2). */
  readonly table?: string;
  /** The picks kept in the guest's browser (AC-6530); without `onPicksChange` the menu has no picks. */
  readonly picks?: readonly GuestPick[];
  readonly onPicksChange?: (picks: readonly GuestPick[]) => void;
  /** The foot: the Powered by Timefix card the page puts there. */
  readonly foot?: ReactNode;
  /** Opens this item's sheet when it mounts (a story, a link). */
  readonly openItemId?: string;
}

const lower = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The item's price line: its own price, its smallest size's "from", or its price note. */
function priceLine(item: SnapshotItem, currency: string, locale: string): string | undefined {
  if (item.priceMinor !== undefined) return formatPrice(item.priceMinor, currency, locale);
  const [first, ...rest] = item.sizes;
  if (first !== undefined) {
    const least = rest.reduce((min, size) => Math.min(min, size.priceMinor), first.priceMinor);
    return item.sizes.length === 1
      ? formatPrice(least, currency, locale)
      : strings.priceFrom(formatPrice(least, currency, locale));
  }
  return item.priceNote;
}

/** Every item id a section shows, its sub sections' too. */
const sectionItems = (section: SnapshotSection): readonly string[] => [
  ...section.itemIds,
  ...section.sections.flatMap((sub) => sub.itemIds),
];

/** The guest menu's page (spec 0065, H1): the bar, the venue, the menus and their dishes, and Your picks. */
export function MenuList({ menu, logoHref, photoHref, table, picks, onPicksChange, foot, openItemId }: MenuListProps) {
  const now = new Date(useNow());
  const { place, business } = menu;
  const { currency } = menu.menu;
  const locale = place.locale;
  const soldOut = useMemo(() => new Set(menu.soldOut), [menu.soldOut]);
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone: place.timeZone, hour: '2-digit', minute: '2-digit' }),
    [locale, place.timeZone],
  );
  const day = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone: place.timeZone, weekday: 'short' }),
    [locale, place.timeZone],
  );
  const dayOf = (instant: Date) => day.format(instant);
  /** "18:00" today, else "Sat 10:00". */
  const when = (instant: Date) =>
    dayOf(instant) === dayOf(now) ? time.format(instant) : `${dayOf(instant)} ${time.format(instant)}`;

  // Menus serving now come first (AC-6528); the rest wait behind the switcher with when they start. A minute's
  // precision is enough for which menu leads.
  const minute = Math.floor(now.getTime() / 60_000);
  const menus = useMemo(() => {
    const at = new Date(minute * 60_000);
    const serving = menu.menu.menus.map((each) => ({
      menu: each,
      serving: servingAt(each.serving, at, place.timeZone),
    }));
    return [...serving.filter((each) => each.serving.now), ...serving.filter((each) => !each.serving.now)];
  }, [menu.menu.menus, place.timeZone, minute]);
  const [menuId, setMenuId] = useState<string | undefined>(menus[0]?.menu.id);
  const current = menus.find((each) => each.menu.id === menuId) ?? menus[0];

  const [query, setQuery] = useState('');
  const [diets, setDiets] = useState<ReadonlySet<DietMark>>(new Set());
  const offered = useMemo(
    () => DIET_FILTERS.filter((mark) => Object.values(menu.menu.items).some((item) => item.diet.includes(mark))),
    [menu.menu.items],
  );
  const matches = (item: SnapshotItem) =>
    [...diets].every((mark) => item.diet.includes(mark)) &&
    (query.trim() === '' || lower(`${item.name} ${item.description ?? ''}`).includes(lower(query.trim())));
  const isFiltering = query.trim() !== '' || diets.size > 0;

  const [open, setOpen] = useState<string | undefined>(openItemId);
  const [picksOpen, setPicksOpen] = useState(false);
  const opened = open === undefined ? undefined : menu.menu.items[open];

  const status = openAt(place.hours, now, place.timeZone);
  const next = status.open ? undefined : nextOpening(place.hours, now, place.timeZone);
  const address = [place.addressLine, place.city, place.postcode].filter((part) => part !== undefined).join(', ');

  const sections = current?.menu.sections ?? [];
  const shownSections = sections.filter(
    (section) =>
      sectionItems(section).some((id) => {
        const item = menu.menu.items[id];
        return item !== undefined && matches(item);
      }) ||
      (!isFiltering && sectionItems(section).length === 0),
  );
  const active = useScrollSpy(shownSections.map((section) => section.id));
  const headingId = useId();
  const pickCount = (picks ?? []).reduce((sum, pick) => sum + pick.quantity, 0);

  return (
    <div className={styles.root} data-menu-list="">
      {/* The dark bar: the venue and the section tabs, stuck to the top; the active tab in the accent, underlined. */}
      <div className={styles.bar} data-sticky="">
        <div className={styles.barTop}>
          {logoHref === undefined ? null : (
            <img className={styles.logo} src={logoHref} alt={strings.decorative} width={32} height={32} />
          )}
          <p className={styles.barName}>{business.name}</p>
          {table === undefined ? null : <span className={styles.table}>{strings.table(table)}</span>}
        </div>
        {shownSections.length < 2 ? null : (
          <nav aria-label={strings.sections} className={styles.tabs}>
            {shownSections.map((section) => (
              <a
                key={section.id}
                href={`#s-${section.id}`}
                className={styles.tab}
                aria-current={active === section.id ? 'true' : undefined}
                data-active-chip={active === section.id ? '' : undefined}
              >
                {section.name}
              </a>
            ))}
          </nav>
        )}
      </div>

      <header className={styles.head}>
        <h1 className={styles.name} id={headingId}>
          {business.name}
        </h1>
        {business.description === undefined ? null : <p className={styles.about}>{business.description}</p>}
        <p className={styles.facts}>
          <span className={styles.open} data-open={status.open ? 'yes' : 'no'}>
            <span className={styles.dot} aria-hidden="true" />
            {status.open
              ? status.closesAt === undefined
                ? strings.openNow
                : strings.openUntil(time.format(status.closesAt))
              : next === undefined
                ? strings.closed
                : strings.opensAt(when(next.at))}
          </span>
          {address === '' ? null : (
            <span className={styles.line}>
              <Icon name="map-pin" size="sm" />
              {address}
            </span>
          )}
          {place.phone === undefined ? null : (
            <a
              className={styles.line}
              href={`tel:${place.phone.replace(/[^0-9+]/g, '')}`}
              aria-label={strings.call(place.phone)}
            >
              <Icon name="phone" size="sm" />
              {place.phone}
            </a>
          )}
        </p>
        {menus.length > 1 ? (
          <Tabs
            label={strings.menus}
            tabs={menus.map(({ menu: each }) => ({ id: each.id, label: each.name }))}
            selectedKey={current?.menu.id ?? ''}
            onSelectionChange={setMenuId}
          />
        ) : null}
        <div className={styles.search}>
          <Icon name="search" size="sm" />
          <input
            className={styles.searchInput}
            type="search"
            aria-label={strings.search}
            placeholder={strings.searchPlaceholder}
            value={query}
            maxLength={60}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query === '' ? null : (
            <button
              type="button"
              className={styles.clear}
              aria-label={strings.clearSearch}
              onClick={() => setQuery('')}
            >
              <Icon name="x" size="sm" />
            </button>
          )}
        </div>
        {offered.length === 0 ? null : (
          <ChoiceChips
            label={strings.filters}
            isLabelHidden
            choices={offered.map((mark) => ({ id: mark, label: strings.diet[mark] }))}
            selected={[...diets]}
            onChange={(next) => setDiets(new Set(offered.filter((mark) => next.includes(mark))))}
          />
        )}
      </header>

      <main className={styles.body} aria-labelledby={headingId}>
        {current !== undefined && !current.serving.now ? (
          <p className={styles.notice}>
            <Icon name="clock" size="sm" />
            {current.serving.next === undefined ? strings.notServing : strings.servingFrom(when(current.serving.next))}
          </p>
        ) : null}
        {shownSections.length === 0 ? (
          <div className={styles.empty}>
            <p>{isFiltering ? strings.noMatches : strings.noMenu}</p>
            {isFiltering ? (
              <Button
                onPress={() => {
                  setQuery('');
                  setDiets(new Set());
                }}
              >
                {strings.showAll}
              </Button>
            ) : null}
          </div>
        ) : (
          shownSections.map((section) => (
            <section
              key={section.id}
              id={`s-${section.id}`}
              className={styles.section}
              aria-labelledby={`h-${section.id}`}
            >
              <Section
                section={section}
                level={2}
                menu={menu}
                now={now}
                soldOut={soldOut}
                matches={matches}
                photoHref={photoHref}
                onOpen={setOpen}
                when={when}
              />
              {section.sections.map((sub) =>
                sub.itemIds.some((id) => {
                  const item = menu.menu.items[id];
                  return item !== undefined && matches(item);
                }) ? (
                  <div key={sub.id} className={styles.sub}>
                    <Section
                      section={sub}
                      level={3}
                      menu={menu}
                      now={now}
                      soldOut={soldOut}
                      matches={matches}
                      photoHref={photoHref}
                      onOpen={setOpen}
                      when={when}
                    />
                  </div>
                ) : null,
              )}
            </section>
          ))
        )}
        {current?.menu.note === undefined ? null : <p className={styles.note}>{current.menu.note}</p>}
      </main>

      {foot === undefined ? null : <footer className={styles.foot}>{foot}</footer>}

      {onPicksChange === undefined || pickCount === 0 ? null : (
        <button type="button" className={styles.picksBar} onClick={() => setPicksOpen(true)}>
          <span className={styles.picksCount}>{pickCount}</span>
          <span className={styles.picksLabel}>
            {strings.picksPill(formatPrice(picksTotal(menu, picks ?? []), currency, locale))}
          </span>
        </button>
      )}

      <Modal
        variant="sheet"
        title={opened?.name ?? strings.close}
        isOpen={opened !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(undefined);
        }}
      >
        {opened === undefined ? null : (
          <ItemSheet
            item={opened}
            menu={menu}
            isSoldOut={soldOut.has(opened.id)}
            photoHref={photoHref}
            {...(onPicksChange === undefined
              ? {}
              : {
                  onPick: (pick: Omit<GuestPick, 'key'>) => {
                    const key = `${pick.itemId}|${String(pick.size ?? '')}|${[...pick.optionIds].sort().join(',')}`;
                    const was = picks ?? [];
                    const same = was.find((each) => each.key === key);
                    onPicksChange(
                      same === undefined
                        ? [...was, { ...pick, key }]
                        : was.map((each) =>
                            each.key === key ? { ...each, quantity: each.quantity + pick.quantity } : each,
                          ),
                    );
                    setOpen(undefined);
                  },
                })}
          />
        )}
      </Modal>

      {onPicksChange === undefined ? null : (
        <Modal variant="sheet" title={strings.yourPicks} isOpen={picksOpen} onOpenChange={setPicksOpen}>
          <PicksSheet menu={menu} picks={picks ?? []} onPicksChange={onPicksChange} />
        </Modal>
      )}
    </div>
  );
}

/** Which section is under the sticky bar now: the last whose top passed the bar (the chips follow the scroll). */
function useScrollSpy(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(',');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id.slice(2), entry.isIntersecting);
        const first = ids.find((id) => seen.get(id) === true);
        if (first !== undefined) setActive(first);
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    for (const id of ids) {
      const element = document.getElementById(`s-${id}`);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The active chip scrolls into the chip row's view, never the page's.
  useEffect(() => {
    const chip = document.querySelector<HTMLElement>('[data-active-chip]');
    if (chip === null) return;
    const row = chip.parentElement;
    if (row === null) return;
    row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
  }, [active]);
  return active;
}

interface SectionProps {
  readonly section: SnapshotSubsection;
  readonly level: 2 | 3;
  readonly menu: PublicMenu;
  readonly now: Date;
  readonly soldOut: ReadonlySet<string>;
  readonly matches: (item: SnapshotItem) => boolean;
  readonly photoHref: MenuPhotoHref | undefined;
  readonly onOpen: (itemId: string) => void;
  readonly when: (instant: Date) => string;
}

/** A section's heading and its items, as a list or a photo grid. */
function Section({ section, level, menu, now, soldOut, matches, photoHref, onOpen, when }: SectionProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const serving = servingAt(section.serving, now, menu.place.timeZone);
  const items = section.itemIds
    .map((id) => menu.menu.items[id])
    .filter((item): item is SnapshotItem => item !== undefined && matches(item));
  return (
    <>
      <Heading className={styles.heading} data-level={level} id={`h-${section.id}`}>
        {section.name}
      </Heading>
      {section.description === undefined ? null : <p className={styles.sectionAbout}>{section.description}</p>}
      {serving.now ? null : (
        <p className={styles.sectionNote}>
          {serving.next === undefined ? strings.notServing : strings.servingFrom(when(serving.next))}
        </p>
      )}
      <ul className={styles.items} data-layout={section.layout}>
        {items.map((item) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              layout={section.layout}
              price={priceLine(item, menu.menu.currency, menu.place.locale)}
              isSoldOut={soldOut.has(item.id)}
              photoHref={photoHref}
              onOpen={() => onOpen(item.id)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/** One dish as a row or a grid card: the whole card opens its sheet. */
function ItemCard({
  item,
  layout,
  price,
  isSoldOut,
  photoHref,
  onOpen,
}: {
  readonly item: SnapshotItem;
  readonly layout: 'list' | 'grid';
  readonly price: string | undefined;
  readonly isSoldOut: boolean;
  readonly photoHref: MenuPhotoHref | undefined;
  readonly onOpen: () => void;
}) {
  const photo = item.photo === undefined || photoHref === undefined ? undefined : item.photo;
  const marks = item.diet.map((mark) => strings.diet[mark]);
  return (
    <button
      type="button"
      className={styles.item}
      data-layout={layout}
      data-sold-out={isSoldOut ? '' : undefined}
      data-has-photo={photo === undefined ? undefined : ''}
      onClick={onOpen}
    >
      {photo === undefined || photoHref === undefined ? null : (
        <img
          className={styles.thumb}
          src={photoHref(photo.id, 'small', photo.version)}
          alt={strings.decorative}
          loading="lazy"
          decoding="async"
          width={400}
          height={layout === 'grid' ? 300 : 400}
        />
      )}
      <span className={styles.itemText}>
        <span className={styles.itemName}>
          {item.name}
          {item.featured ? <span className={styles.badge}>{strings.featured}</span> : null}
        </span>
        <span className={styles.itemMeta}>
          {price === undefined ? null : <span className={styles.price}>{price}</span>}
          {isSoldOut ? <span className={styles.soldOut}>{strings.soldOut}</span> : null}
        </span>
        {item.description === undefined ? null : <span className={styles.itemAbout}>{item.description}</span>}
        {marks.length === 0 ? null : <span className={styles.marks}>{marks.join(' · ')}</span>}
      </span>
    </button>
  );
}
