// The guest menu (spec 0065, H1, AC-6528 to AC-6533): a place's published menus as a guest reads them on a phone. The
// layout and flow follow the checklabs guest app (owner, 4 Nov 2026), rebuilt from library parts: a glass brand bar
// stuck to the top with the logo (or the name's initial) and the section pills that follow the scroll; the header
// (cover photo, the place as an eyebrow, the business, its line, open now); the menus, search and dietary filters;
// each section's dishes as rows (words, then the photo with a + at its corner) or a two column photo grid; a dish's
// sheet (a bottom sheet on a phone, a centred card on a wider screen); and Your picks behind a bar that rises once
// there is a pick. Everything comes in through props: the page's entry reads the menu and keeps the picks.
import {
  DIET_FILTERS,
  EU_ALLERGENS,
  formatPrice,
  nextOpening,
  openAt,
  servingAt,
  type DietMark,
} from '@crm/contracts/menu';
import type { PublicMenu, SnapshotItem, SnapshotSection, SnapshotSubsection } from '@crm/contracts';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import { Reveal } from '../../atoms/Reveal/Reveal.tsx';
import { ChoiceChips } from '../../molecules/ChoiceChips/ChoiceChips.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { SectionTabs } from '../../molecules/SectionTabs/SectionTabs.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import {
  ItemSheet,
  PicksSheet,
  pickKey,
  picksBill,
  type GuestPick,
  type MenuPhotoHref,
} from '../ItemSheet/ItemSheet.tsx';
import { useNow } from '../../provider/context.ts';
import styles from './MenuList.module.css';
import { strings } from './strings.ts';

export type { GuestPick, MenuPhotoHref } from '../ItemSheet/ItemSheet.tsx';

export interface MenuListProps {
  /** The published menu, as `GET /api/public/menu/:key` answers it. */
  readonly menu: PublicMenu;
  /** A wide photo at the head of the menu (the business's cover), when there is one. */
  readonly coverHref?: string;
  /** The business's logo, when it has one; without it the bar shows the name's first letter. */
  readonly logoHref?: string;
  /** Where each photo is served; without it no photo draws. */
  readonly photoHref?: MenuPhotoHref;
  /** The table a QR code opened the menu at, as the guest reads it ("Table 4", "Bar 2"), shown in the bar (H2). */
  readonly table?: string;
  /** The picks kept in the guest's browser (AC-6530); without `onPicksChange` the menu has no picks. */
  readonly picks?: readonly GuestPick[];
  readonly onPicksChange?: (picks: readonly GuestPick[]) => void;
  /** The foot: the Powered by Timefix card the page puts there. */
  readonly foot?: ReactNode;
  /** Opens this item's sheet when it mounts (a story, a link). */
  readonly openItemId?: string;
  /** Opens Your picks when it mounts (a story). */
  readonly isPicksOpen?: boolean;
  /**
   * The live page's once only entrance: the header and the first dishes rise in, a stagger apart, as the page first
   * draws (spec 0068, AC-6803). Off in a preview, where the menu redraws as the owner types.
   */
  readonly hasEntrance?: boolean;
  /**
   * The instant the menu is read at, in place of now: the editor's "Preview at" (spec 0065, AC-6520, after checklabs'
   * `?at=`), so an owner sees which menus and sections serve on Saturday at 11:00. Left out, the provider's clock.
   */
  readonly at?: number;
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

/** Whether a dish adds straight from its row: priced, one size at most, and no choices to make. */
const isQuickAdd = (item: SnapshotItem) =>
  (item.priceMinor !== undefined || item.sizes.length === 1) && item.sizes.length < 2 && item.groupIds.length === 0;

/** A place in the entrance's run for the n-th thing drawn (1 to 6): the rest arrive with the sixth. */
const placeOf = (index: number) => Math.min(6, Math.max(1, index)) as 1 | 2 | 3 | 4 | 5 | 6;

/** The guest menu's page (spec 0065, H1): the bar, the venue, the menus and their dishes, and Your picks. */
export function MenuList({
  menu,
  logoHref,
  coverHref,
  photoHref,
  table,
  picks,
  onPicksChange,
  foot,
  openItemId,
  isPicksOpen = false,
  hasEntrance = false,
  at,
}: MenuListProps) {
  const clock = useNow();
  const now = new Date(at ?? clock);
  // Taken down for now (Live or Hidden): the menu's own look, header and foot, a plain line, and the ways still open.
  const isUnavailable = menu.hidden === true;
  const reservePath =
    menu.reservePath !== undefined && /^\/r\/[A-Za-z0-9_-]{16}$/.test(menu.reservePath) ? menu.reservePath : undefined;
  const phoneHref = menu.place.phone === undefined ? undefined : `tel:${menu.place.phone.replace(/[^0-9+]/g, '')}`;
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

  // The dish whose sheet is open, kept while the sheet leaves so its words stay as it goes.
  const [opened, setOpened] = useState<{ readonly id: string; readonly isOpen: boolean } | undefined>(
    openItemId === undefined ? undefined : { id: openItemId, isOpen: true },
  );
  const [picksOpen, setPicksOpen] = useState(isPicksOpen);
  const openedItem = opened === undefined ? undefined : menu.menu.items[opened.id];
  const open = (itemId: string) => setOpened({ id: itemId, isOpen: true });

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
  const isNameShown = useScrolledPast(headingId);
  // The allergens this menu's dishes name, in the EU list's order (ported from checklabs' allergen footer).
  const menuAllergens = EU_ALLERGENS.filter((code) =>
    sections.some((section) =>
      sectionItems(section).some((id) => menu.menu.items[id]?.allergens.some((each) => each.code === code) === true),
    ),
  );
  const chosen = picks ?? [];
  const pickCount = chosen.reduce((sum, pick) => sum + pick.quantity, 0);
  const bill = picksBill(menu, chosen);

  /** Adds a pick, onto the line with the same choices when there is one. */
  const addPick = (pick: Omit<GuestPick, 'key'>) => {
    if (onPicksChange === undefined) return;
    const key = pickKey(pick);
    const same = chosen.find((each) => each.key === key);
    onPicksChange(
      same === undefined
        ? [...chosen, { ...pick, key }]
        : chosen.map((each) => (each.key === key ? { ...each, quantity: each.quantity + pick.quantity } : each)),
    );
  };
  /** A dish's plain pick: no options, and its one size when it has one. */
  const plainPick = (itemId: string) => {
    const sizeId = menu.menu.items[itemId]?.sizes[0]?.id;
    return { itemId, ...(sizeId === undefined ? {} : { sizeId }), optionIds: [] };
  };
  /** Takes one of a plain pick (no choices) away, the line with it at its last. */
  const removeOne = (itemId: string) => {
    if (onPicksChange === undefined) return;
    const key = pickKey(plainPick(itemId));
    onPicksChange(
      chosen.flatMap((each) =>
        each.key !== key ? [each] : each.quantity <= 1 ? [] : [{ ...each, quantity: each.quantity - 1 }],
      ),
    );
  };
  const plainCount = (itemId: string) => chosen.find((each) => each.key === pickKey(plainPick(itemId)))?.quantity ?? 0;

  // The page's overlays (the dish's sheet, Your picks) open inside this root, so they wear the menu's look too.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const initial = Array.from(business.name.trim())[0]?.toLocaleUpperCase(locale) ?? '';
  const entering = (node: ReactNode, place: number, display: 'block' | 'inline' = 'block') =>
    hasEntrance ? (
      <Reveal order={placeOf(place)} display={display}>
        {node}
      </Reveal>
    ) : (
      node
    );
  let drawn = 2;

  return (
    <div className={styles.root} data-menu-list="">
      <div className={styles.look} ref={setHost}>
        <UNSAFE_PortalProvider getContainer={() => host}>
          {/* The glass bar: the brand, the name once the heading has gone, the table, and the section pills. */}
          <div className={styles.bar} data-sticky="">
            <div className={styles.barTop}>
              {logoHref === undefined ? (
                <span className={styles.mark} aria-hidden="true">
                  {initial}
                </span>
              ) : (
                <img className={styles.logo} src={logoHref} alt={strings.decorative} width={64} height={64} />
              )}
              <p className={styles.barName} data-shown={isNameShown ? '' : undefined} aria-hidden={!isNameShown}>
                {business.name}
              </p>
              {table === undefined ? null : <span className={styles.table}>{table}</span>}
            </div>
            {shownSections.length < 2 ? null : (
              <div className={styles.barTabs}>
                <SectionTabs
                  label={strings.sections}
                  sections={shownSections.map((section) => ({
                    id: section.id,
                    label: section.name,
                    href: `#s-${section.id}`,
                  }))}
                  current={active}
                />
              </div>
            )}
          </div>

          <header className={styles.head}>
            {coverHref === undefined ? null : (
              <img className={styles.cover} src={coverHref} alt={strings.decorative} width={1200} height={400} />
            )}
            <div className={styles.titles}>
              {place.name === business.name ? null : (
                <p className={styles.eyebrow}>{entering(place.name, 1, 'inline')}</p>
              )}
              <h1 className={styles.name} id={headingId}>
                {entering(business.name, 1, 'inline')}
              </h1>
              {business.description === undefined ? null : (
                <p className={styles.about}>{entering(business.description, 2, 'inline')}</p>
              )}
            </div>
            <p className={styles.facts}>
              <span className={styles.openNow} data-open={status.open ? 'yes' : 'no'}>
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
            {isUnavailable ? null : menus.length > 1 ? (
              <SegmentedControl
                label={strings.menus}
                segments={menus.map(({ menu: each }) => ({ value: each.id, label: each.name }))}
                value={current?.menu.id ?? ''}
                onChange={setMenuId}
                isFitted
              />
            ) : null}
            {isUnavailable ? null : (
              <Field
                variant="search"
                type="search"
                label={strings.search}
                isLabelHidden
                placeholder={strings.searchPlaceholder}
                value={query}
                maxLength={60}
                onChange={setQuery}
                {...(query === ''
                  ? {}
                  : {
                      suffix: (
                        <Button
                          variant="ghost"
                          icon="x"
                          isRound
                          label={strings.clearSearch}
                          onPress={() => setQuery('')}
                        />
                      ),
                    })}
              />
            )}
            {isUnavailable || offered.length === 0 ? null : (
              <ChoiceChips
                label={strings.filters}
                isLabelHidden
                choices={offered.map((mark) => ({ id: mark, label: strings.diet[mark] }))}
                selected={[...diets]}
                onChange={(picked) => setDiets(new Set(offered.filter((mark) => picked.includes(mark))))}
              />
            )}
          </header>

          <main className={styles.body} aria-labelledby={headingId}>
            {isUnavailable ? (
              <div className={styles.unavailable}>
                <span className={styles.unavailableMark} aria-hidden="true">
                  <Icon name="utensils" />
                </span>
                <h2 className={styles.unavailableTitle}>{strings.unavailable}</h2>
                <p>{strings.unavailableWays(reservePath !== undefined, phoneHref !== undefined)}</p>
                {reservePath !== undefined || phoneHref !== undefined ? (
                  <div className={styles.unavailableActions}>
                    {reservePath === undefined ? null : (
                      <ButtonLink href={reservePath} variant="primary" icon="calendar-check">
                        {strings.reserve}
                      </ButtonLink>
                    )}
                    {phoneHref === undefined || place.phone === undefined ? null : (
                      <ButtonLink href={phoneHref} icon="phone" label={strings.call(place.phone)}>
                        {strings.callShort}
                      </ButtonLink>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!isUnavailable && current !== undefined && !current.serving.now ? (
              <p className={styles.notice}>
                <Icon name="clock" size="sm" />
                {current.serving.next === undefined
                  ? strings.notServing
                  : strings.servingFrom(when(current.serving.next))}
              </p>
            ) : null}
            {isUnavailable ? null : shownSections.length === 0 ? (
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
              shownSections.map((section) => {
                const blocks = [
                  section as SnapshotSubsection,
                  ...section.sections.filter((sub) =>
                    sub.itemIds.some((id) => {
                      const item = menu.menu.items[id];
                      return item !== undefined && matches(item);
                    }),
                  ),
                ];
                return (
                  <section
                    key={section.id}
                    id={`s-${section.id}`}
                    className={styles.section}
                    aria-labelledby={`h-${section.id}`}
                  >
                    {blocks.map((block, index) => (
                      <div key={block.id} className={index === 0 ? styles.block : styles.sub}>
                        <SectionHead section={block} level={index === 0 ? 2 : 3} menu={menu} now={now} when={when} />
                        <ul className={styles.items} data-layout={block.layout}>
                          {block.itemIds
                            .map((id) => menu.menu.items[id])
                            .filter((item): item is SnapshotItem => item !== undefined && matches(item))
                            .map((item) => {
                              drawn += 1;
                              const isOut = soldOut.has(item.id);
                              const canAdd =
                                onPicksChange !== undefined &&
                                !isOut &&
                                (item.priceMinor !== undefined || item.sizes.length > 0);
                              return (
                                <li key={item.id} className={styles.cell}>
                                  {entering(
                                    <ItemCard
                                      item={item}
                                      layout={block.layout}
                                      price={priceLine(item, currency, locale)}
                                      isSoldOut={isOut}
                                      photoHref={photoHref}
                                      onOpen={() => open(item.id)}
                                      add={
                                        canAdd ? (
                                          <AddControl
                                            item={item}
                                            count={isQuickAdd(item) ? plainCount(item.id) : 0}
                                            onAdd={() =>
                                              isQuickAdd(item)
                                                ? addPick({ ...plainPick(item.id), quantity: 1 })
                                                : open(item.id)
                                            }
                                            onRemove={() => removeOne(item.id)}
                                          />
                                        ) : undefined
                                      }
                                    />,
                                    drawn,
                                  )}
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    ))}
                  </section>
                );
              })
            )}
            {current?.menu.note === undefined ? null : <p className={styles.note}>{current.menu.note}</p>}
            {menuAllergens.length === 0 ? null : (
              <p className={styles.note}>
                {strings.allergenFooter(menuAllergens.map((code) => strings.allergen[code]))}
              </p>
            )}
          </main>

          {foot === undefined ? null : <footer className={styles.foot}>{foot}</footer>}

          {onPicksChange === undefined || pickCount === 0 ? null : (
            <div className={styles.picksDock}>
              <button type="button" className={styles.picksBar} onClick={() => setPicksOpen(true)}>
                <span className={styles.picksCount}>
                  <NumberPop value={String(pickCount)} />
                </span>
                <span className={styles.picksLabel}>{strings.viewPicks}</span>
                <span className={styles.picksTotal}>
                  <NumberPop value={formatPrice(bill.total, currency, locale)} />
                </span>
              </button>
            </div>
          )}

          <Modal
            variant="sheet-card"
            title={openedItem?.name ?? strings.close}
            isOpen={opened?.isOpen === true && openedItem !== undefined}
            onOpenChange={(isOpen) => {
              if (!isOpen) setOpened((was) => (was === undefined ? was : { ...was, isOpen: false }));
            }}
          >
            {openedItem === undefined ? null : (
              <ItemSheet
                key={openedItem.id}
                item={openedItem}
                menu={menu}
                isSoldOut={soldOut.has(openedItem.id)}
                photoHref={photoHref}
                {...(onPicksChange === undefined
                  ? {}
                  : {
                      onPick: (pick: Omit<GuestPick, 'key'>) => {
                        addPick(pick);
                        setOpened((was) => (was === undefined ? was : { ...was, isOpen: false }));
                      },
                    })}
              />
            )}
          </Modal>

          {onPicksChange === undefined ? null : (
            <Modal variant="sheet-side" title={strings.yourPicks} isOpen={picksOpen} onOpenChange={setPicksOpen}>
              <PicksSheet menu={menu} picks={chosen} onPicksChange={onPicksChange} photoHref={photoHref} />
            </Modal>
          )}
        </UNSAFE_PortalProvider>
      </div>
    </div>
  );
}

/** Whether the element with `id` has scrolled up out of the view (the bar then shows the venue's name). */
function useScrolledPast(id: string): boolean {
  const [isPast, setPast] = useState(false);
  useEffect(() => {
    const element = document.getElementById(id);
    if (element === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry !== undefined) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [id]);
  return isPast;
}

/** Which section is under the sticky bar now: the first one in the band under the bar (the pills follow it). */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `ids`, a new array every render
  }, [key]);
  return ids.includes(active ?? '') ? active : ids[0];
}

/** A section's or sub section's heading, its line and when it serves. */
function SectionHead({
  section,
  level,
  menu,
  now,
  when,
}: {
  readonly section: SnapshotSubsection;
  readonly level: 2 | 3;
  readonly menu: PublicMenu;
  readonly now: Date;
  readonly when: (instant: Date) => string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const serving = servingAt(section.serving, now, menu.place.timeZone);
  return (
    <div className={styles.sectionHead}>
      <Heading className={styles.heading} data-level={level} id={`h-${section.id}`}>
        {section.name}
      </Heading>
      {section.description === undefined ? null : <p className={styles.sectionAbout}>{section.description}</p>}
      {serving.now ? null : (
        <p className={styles.sectionNote}>
          <Icon name="clock" size="sm" />
          {serving.next === undefined ? strings.notServing : strings.servingFrom(when(serving.next))}
        </p>
      )}
    </div>
  );
}

/** A dish's + : adds one (a dish with no choices), or opens its sheet; once picked, a small stepper takes its place. */
function AddControl({
  item,
  count,
  onAdd,
  onRemove,
}: {
  readonly item: SnapshotItem;
  readonly count: number;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
}) {
  if (count === 0)
    return (
      <span className={styles.add}>
        <Button variant="secondary" icon="plus" isRound label={strings.addOne(item.name)} onPress={onAdd} />
      </span>
    );
  return (
    <span className={styles.add} role="group" aria-label={strings.quantityOf(item.name)}>
      <Button variant="ghost" icon="minus" isRound label={strings.removeOne(item.name)} onPress={onRemove} />
      <span className={styles.addCount}>
        <NumberPop value={String(count)} />
      </span>
      <Button variant="ghost" icon="plus" isRound label={strings.addAnother(item.name)} onPress={onAdd} />
    </span>
  );
}

/** One dish as a row or a grid card: the card opens its sheet; the + beside it adds. */
function ItemCard({
  item,
  layout,
  price,
  isSoldOut,
  photoHref,
  onOpen,
  add,
}: {
  readonly item: SnapshotItem;
  readonly layout: 'list' | 'grid';
  readonly price: string | undefined;
  readonly isSoldOut: boolean;
  readonly photoHref: MenuPhotoHref | undefined;
  readonly onOpen: () => void;
  readonly add: ReactNode;
}) {
  const photo = item.photo === undefined || photoHref === undefined ? undefined : item.photo;
  const marks = item.diet.map((mark) => strings.diet[mark]);
  return (
    <div
      className={styles.item}
      data-layout={layout}
      data-sold-out={isSoldOut ? '' : undefined}
      data-has-photo={photo === undefined ? undefined : ''}
    >
      <button type="button" className={styles.press} onClick={onOpen}>
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
            {isSoldOut ? <span className={styles.soldOut}>{strings.soldOut}</span> : null}
          </span>
          {item.description === undefined ? null : <span className={styles.itemAbout}>{item.description}</span>}
          {price === undefined ? null : <span className={styles.price}>{price}</span>}
          {marks.length === 0 ? null : <span className={styles.marks}>{marks.join(' · ')}</span>}
        </span>
      </button>
      {add}
    </div>
  );
}
