// The guest menu (spec 0065, H1, AC-6528 to AC-6533): a place's published menus as a guest reads them on a phone. The
// layout, flow and words follow the checklabs guest app faithfully (owner, 4 and 5 Nov 2026), rebuilt from library
// parts: a glass brand bar stuck to the top with the logo (or the name's initial); the brand block (the place as an
// eyebrow with the table, the menu's name, its line); the menus when the link holds several; the sections as pills,
// one at a time; each section's dishes as rows (words, the price under them, then the photo with a + at its corner)
// or a two column photo grid; the allergens this menu names; a dish's sheet (a bottom sheet on a phone, a centred
// card on a wider screen); and Your selection behind a bar that rises once something is picked. Everything comes in
// through props: the page's entry reads the menu and keeps the selection.
import { EU_ALLERGENS, formatPrice, nextOpening, openAt, servingAt } from '@crm/contracts/menu';
import type { PublicMenu, SnapshotItem, SnapshotSection, SnapshotSubsection } from '@crm/contracts';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import { Reveal } from '../../atoms/Reveal/Reveal.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Stepper } from '../../molecules/Stepper/Stepper.tsx';
import { TabPanel, Tabs } from '../../molecules/Tabs/Tabs.tsx';
import {
  ItemSheet,
  PicksSheet,
  pickKey,
  picksBill,
  type GuestPick,
  type MenuPhotoHref,
} from '../ItemSheet/ItemSheet.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { usePageVariables, type PageVariables } from '../../lib/page-variables.ts';
import { useNow } from '../../provider/context.ts';
import { checkedLookVariables } from './look-variables.ts';
import '@crm/tokens/packs.css';
import styles from './MenuList.module.css';
import { PopupHost } from '../GuestLook/PopupHost.tsx';
import { TOUCH_TARGET } from '../../atoms/Button/touch-target.ts';
import { strings } from './strings.ts';

export type { GuestPick, MenuPhotoHref } from '../ItemSheet/ItemSheet.tsx';

export interface MenuListProps {
  /** The published menu, as `GET /api/public/menu/:key` answers it. */
  readonly menu: PublicMenu;
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
  /** The cover photo the look names, drawn over the page's title; left out, none. */
  readonly coverHref?: string;
  /**
   * The side the look pins the page to (`data-theme` on its root, so the library's own tokens follow it too). Left
   * out, the page follows the document.
   */
  readonly scheme?: 'light' | 'dark';
  /**
   * The look's custom properties, for an editor's live preview (`menuLookShape` and `menuLookColours`), set on the root
   * through the CSSOM; the live page has a stylesheet. Only the names and values a look can make pass.
   */
  readonly lookVariables?: PageVariables;
}

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
  photoHref,
  table,
  picks,
  onPicksChange,
  foot,
  openItemId,
  isPicksOpen = false,
  hasEntrance = false,
  at,
  coverHref,
  scheme,
  lookVariables,
}: MenuListProps) {
  const lookRef = usePageVariables(lookVariables, checkedLookVariables);
  const clock = useNow();
  const now = new Date(at ?? clock);
  // Taken down for now (Live or Hidden): the menu's own look, header and foot, a plain line, and the ways still open.
  const isUnavailable = menu.hidden === true;
  const reservePath =
    menu.reservePath !== undefined && /^\/r\/[A-Za-z0-9_-]{16}$/.test(menu.reservePath) ? menu.reservePath : undefined;
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
    // A published menu with no dish to show (nothing placed yet) is left out, as checklabs lists only menus with
    // dishes.
    const shown = menu.menu.menus.filter((each) =>
      each.sections.some((section) => sectionItems(section).some((id) => menu.menu.items[id] !== undefined)),
    );
    const serving = shown.map((each) => ({
      menu: each,
      serving: servingAt(each.serving, at, place.timeZone),
    }));
    return [...serving.filter((each) => each.serving.now), ...serving.filter((each) => !each.serving.now)];
  }, [menu.menu.menus, menu.menu.items, place.timeZone, minute]);
  const [menuId, setMenuId] = useState<string | undefined>(menus[0]?.menu.id);
  const current = menus.find((each) => each.menu.id === menuId) ?? menus[0];

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
  // The line under the name, as checklabs chooses it: the business's own words, else the menu's note (its
  // description), else where it is. A hidden menu shows its address and phone below instead.
  const menuNote = isUnavailable ? undefined : current?.menu.note;
  const subtitle = business.description ?? menuNote ?? (isUnavailable ? '' : address);

  // A section with no dish left to show gets no pill (it would open on nothing).
  const sections = useMemo(
    () =>
      (current?.menu.sections ?? []).filter((section) =>
        sectionItems(section).some((id) => menu.menu.items[id] !== undefined),
      ),
    [current, menu.menu.items],
  );
  // One section at a time, chosen from the pills (checklabs' categories); a menu changed under it starts at its first.
  const [sectionId, setSectionId] = useState<string | undefined>(undefined);
  const shownSection = sections.find((section) => section.id === sectionId) ?? sections[0];
  // A link to a section (`#h-<id>`, a section's or sub section's heading) opens its pill and brings it into view with
  // focus (owner, 5 Nov 2026), on the first draw and on every hash change, never on a menu redrawn under the guest; a
  // sub section opens the section that holds it. The scroll waits for the chosen panel to mount (the layout effect).
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const [target, setTarget] = useState<{ readonly id: string; readonly isSection: boolean } | undefined>(undefined);
  useEffect(() => {
    const follow = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#h-')) return;
      const id = decodeURIComponent(hash.slice(3));
      const owner = sectionsRef.current.find(
        (section) => section.id === id || section.sections.some((sub) => sub.id === id),
      );
      if (owner === undefined) return;
      setSectionId(owner.id);
      setTarget({ id, isSection: owner.id === id });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const pillsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (target === undefined) return;
    // A section: the pill row, so the chosen pill shows, and focus on that pill. A sub section: its heading.
    const node = target.isSection
      ? (pillsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? undefined)
      : (document.getElementById(`h-${target.id}`) ?? undefined);
    if (node === undefined) return;
    node.scrollIntoView({ block: 'start', inline: 'nearest' });
    node.focus({ preventScroll: true });
    setTarget(undefined);
  }, [target, shownSection?.id]);
  const headingId = useId();
  // The allergens this menu's dishes contain, in the EU list's order (checklabs' allergen footer lists the allergens
  // its dishes carry; a "may contain" stays on the dish's own sheet).
  const menuAllergens = EU_ALLERGENS.filter((code) =>
    sections.some((section) =>
      sectionItems(section).some(
        (id) => menu.menu.items[id]?.allergens.some((each) => each.code === code && each.level === 'contains') === true,
      ),
    ),
  );
  const chosen = picks ?? [];
  const pickCount = chosen.reduce((sum, pick) => sum + pick.quantity, 0);
  const bill = picksBill(menu, chosen);

  // What the last add or remove did, said politely to a screen reader (the stepper's count changes without a word).
  const [said, setSaid] = useState('');
  const itemCount = (itemId: string) =>
    chosen.reduce((sum, each) => sum + (each.itemId === itemId ? each.quantity : 0), 0);
  const nameOf = (itemId: string) => menu.menu.items[itemId]?.name ?? '';
  /** Adds a pick, onto the line with the same choices when there is one. */
  const addPick = (pick: Omit<GuestPick, 'key'>) => {
    if (onPicksChange === undefined) return;
    setSaid(strings.added(nameOf(pick.itemId), itemCount(pick.itemId) + pick.quantity));
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
    setSaid(strings.removed(nameOf(itemId), Math.max(0, itemCount(itemId) - 1)));
    const key = pickKey(plainPick(itemId));
    onPicksChange(
      chosen.flatMap((each) =>
        each.key !== key ? [each] : each.quantity <= 1 ? [] : [{ ...each, quantity: each.quantity - 1 }],
      ),
    );
  };
  const plainCount = (itemId: string) => chosen.find((each) => each.key === pickKey(plainPick(itemId)))?.quantity ?? 0;

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

  /**
   * One section's dishes: its own first, then each sub section under its heading. Under the pills the pill names the
   * section, so its own heading is left out and its sub sections take the second level.
   */
  const sectionBody = (section: SnapshotSection, isTabbed: boolean) => {
    const blocks = [
      section as SnapshotSubsection,
      ...section.sections.filter((sub) => sub.itemIds.some((id) => menu.menu.items[id] !== undefined)),
    ];
    return (
      <section className={styles.section} aria-label={section.name}>
        {blocks.map((block, index) => (
          <div key={block.id} className={index === 0 ? styles.block : styles.sub}>
            <SectionHead
              section={block}
              level={index === 0 ? 2 : 3}
              isNamed={!(isTabbed && index === 0)}
              menu={menu}
              now={now}
              when={when}
            />
            <ul className={styles.items} data-layout={block.layout}>
              {block.itemIds
                .map((id) => menu.menu.items[id])
                .filter((item): item is SnapshotItem => item !== undefined)
                .map((item) => {
                  drawn += 1;
                  const isOut = soldOut.has(item.id);
                  const canAdd =
                    onPicksChange !== undefined && !isOut && (item.priceMinor !== undefined || item.sizes.length > 0);
                  return (
                    <li key={item.id} className={styles.cell} data-layout={block.layout}>
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
                                placement={
                                  block.layout === 'grid'
                                    ? 'grid'
                                    : item.photo !== undefined && photoHref !== undefined
                                      ? 'photo'
                                      : 'row'
                                }
                                count={isQuickAdd(item) ? plainCount(item.id) : 0}
                                chosenCount={isQuickAdd(item) ? 0 : itemCount(item.id)}
                                onAdd={() =>
                                  isQuickAdd(item) ? addPick({ ...plainPick(item.id), quantity: 1 }) : open(item.id)
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
  };

  return (
    <div ref={lookRef} className={styles.root} data-menu-list="" data-theme={scheme}>
      <span role="status">
        <VisuallyHidden>{said}</VisuallyHidden>
      </span>
      <div className={styles.look}>
        {/* The page's overlays (the dish's sheet, Your picks) open inside this root, so they wear the menu's look too. */}
        <PopupHost>
          {/* The glass bar: the brand, and nothing else (checklabs'). */}
          <div className={styles.bar} data-sticky="">
            <div className={styles.barTop}>
              {logoHref === undefined ? (
                <span className={styles.mark} aria-hidden="true">
                  {initial}
                </span>
              ) : (
                <img className={styles.logo} src={logoHref} alt={strings.decorative} width={64} height={64} />
              )}
              {/* The menus, when the link holds several: a compact switch at the bar's end (serving now first). */}
              {!isUnavailable && menus.length > 1 && current !== undefined ? (
                <MenuTrigger>
                  <Button
                    size="lg"
                    isRound
                    touchTarget={TOUCH_TARGET}
                    iconRight="chevron-down"
                    label={strings.switchMenu(current.menu.name)}
                  >
                    {current.menu.name}
                  </Button>
                  <Menu
                    label={strings.menus}
                    placement="bottom end"
                    selectionMode="single"
                    selectedKeys={[current.menu.id]}
                    onSelectionChange={(keys) => {
                      const [id] = [...keys];
                      if (id === undefined) return;
                      setMenuId(String(id));
                      setSectionId(undefined);
                    }}
                  >
                    {menus.map(({ menu: each, serving }) => (
                      <MenuItem
                        key={each.id}
                        id={each.id}
                        {...(serving.now
                          ? {}
                          : {
                              description:
                                serving.next === undefined
                                  ? strings.notServing
                                  : strings.servingFrom(when(serving.next)),
                            })}
                      >
                        {each.name}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              ) : null}
            </div>
          </div>

          {coverHref === undefined ? null : (
            <div className={styles.cover}>
              <img className={styles.coverPhoto} src={coverHref} alt={strings.decorative} width={1200} height={400} />
            </div>
          )}
          <header className={styles.head}>
            <div className={styles.titles}>
              <p className={styles.eyebrow}>
                {entering(place.name, 1, 'inline')}
                {table === undefined ? null : (
                  <>
                    <span aria-hidden="true">·</span>
                    <Badge text={table} tone="accent" size="fit" isRound isWhole />
                  </>
                )}
              </p>
              <h1 className={styles.name} id={headingId}>
                {entering(isUnavailable || current === undefined ? business.name : current.menu.name, 1, 'inline')}
              </h1>
              {subtitle === '' ? null : <p className={styles.about}>{entering(subtitle, 2, 'inline')}</p>}
            </div>
            {/* A hidden menu keeps the ways to reach the place: its address, and Call. */}
            {isUnavailable ? (
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
            ) : null}
          </header>

          <main className={styles.body} aria-labelledby={headingId}>
            {isUnavailable ? (
              <div className={styles.unavailable}>
                <span className={styles.unavailableMark} aria-hidden="true">
                  <Icon name="utensils" />
                </span>
                <h2 className={styles.unavailableTitle}>{strings.unavailable}</h2>
                {/* Call is the phone line in the header above, never a second button here. */}
                {reservePath !== undefined ? (
                  <div className={styles.unavailableActions}>
                    <ButtonLink href={reservePath} variant="primary" icon="calendar-check">
                      {strings.reserve}
                    </ButtonLink>
                  </div>
                ) : (
                  <p>{strings.unavailableLater}</p>
                )}
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
            {isUnavailable ? null : sections.length === 0 ? (
              <div className={styles.empty}>
                <p>{strings.noMenu}</p>
              </div>
            ) : shownSection === undefined ? null : (
              <div ref={pillsRef} className={styles.pills}>
                <Tabs
                  label={strings.sections}
                  variant="pills"
                  tabs={sections.map((section) => ({ id: section.id, label: section.name }))}
                  selectedKey={shownSection.id}
                  onSelectionChange={setSectionId}
                >
                  {sections.map((section) => (
                    <TabPanel key={section.id} id={section.id}>
                      <div className={styles.panel}>{sectionBody(section, true)}</div>
                    </TabPanel>
                  ))}
                </Tabs>
              </div>
            )}
            {/* The note stays at the foot only when the business's own words took the line under the name. */}
            {menuNote === undefined || subtitle === menuNote ? null : <p className={styles.note}>{menuNote}</p>}
            {isUnavailable || menuAllergens.length === 0 ? null : (
              <p className={styles.allergenFoot}>
                <span className={styles.allergenLabel}>{strings.allergens}</span>
                <span>{menuAllergens.map((code) => strings.allergen[code]).join(', ')}</span>
                <span className={styles.allergenAsk}>{strings.allergenAsk}</span>
              </p>
            )}
          </main>

          {foot === undefined ? null : <footer className={styles.foot}>{foot}</footer>}

          {onPicksChange === undefined || pickCount === 0 ? null : (
            <div className={styles.picksDock}>
              <button type="button" className={styles.picksBar} onClick={() => setPicksOpen(true)}>
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
        </PopupHost>
      </div>
    </div>
  );
}

/** A section's or sub section's heading, its line and when it serves. */
function SectionHead({
  section,
  level,
  isNamed,
  menu,
  now,
  when,
}: {
  readonly section: SnapshotSubsection;
  readonly level: 2 | 3;
  /** False under the pills, where the pill already shows the section's name: the heading is for screen readers. */
  readonly isNamed: boolean;
  readonly menu: PublicMenu;
  readonly now: Date;
  readonly when: (instant: Date) => string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const serving = servingAt(section.serving, now, menu.place.timeZone);
  const isBare = !isNamed && section.description === undefined && serving.now;
  return (
    <div className={styles.sectionHead} data-hidden={isBare ? '' : undefined}>
      {/* Under the pills the pill shows the section's name, so its heading is there for screen readers only. */}
      <Heading
        className={styles.heading}
        data-level={level}
        data-hidden={isNamed ? undefined : ''}
        id={`h-${section.id}`}
        tabIndex={-1}
      >
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

/** A dish's + : adds one (a dish with no choices), or opens its sheet; once picked, a Stepper takes its place. */
function AddControl({
  item,
  placement,
  count,
  chosenCount = 0,
  onAdd,
  onRemove,
}: {
  readonly item: SnapshotItem;
  /**
   * On a row's photo (a 26px disc in a 2px ring), at a row's end (32px), or on a grid card's photo (32px, the card's);
   * its + is 16px and bold, a stepper's − and + 14px (checklabs').
   */
  readonly placement: 'photo' | 'row' | 'grid';
  readonly count: number;
  /** A dish with choices: how many are in the selection, shown beside its + (which opens the sheet again). */
  readonly chosenCount?: number;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
}) {
  // The + gives way to the stepper on the first add, and comes back on the last remove: focus follows to the control
  // now in that place (the stepper's +, or the + again), so a keyboard never drops to the page's top.
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const refocus = () => focusLater(() => host?.querySelector<HTMLElement>('button:last-of-type'));
  const isPlain = count === 0 && chosenCount === 0;
  return (
    <span ref={setHost} className={styles.add} data-placement={placement} data-stepper={isPlain ? undefined : ''}>
      {chosenCount > 0 ? (
        <Stepper
          size="row"
          label={strings.quantityOf(item.name)}
          isLabelHidden
          value={chosenCount}
          isFewerHidden
          isCountAnnounced={false}
          moreLabel={strings.addAnother(item.name)}
          onChange={onAdd}
        />
      ) : count === 0 ? (
        <Button
          variant={placement === 'grid' ? 'secondary' : 'primary'}
          size={placement === 'photo' ? 'md' : 'lg'}
          icon="plus"
          isRound
          touchTarget={TOUCH_TARGET}
          label={strings.addOne(item.name)}
          onPress={() => {
            onAdd();
            refocus();
          }}
        />
      ) : (
        <Stepper
          size="row"
          label={strings.quantityOf(item.name)}
          isLabelHidden
          value={count}
          isCountAnnounced={false}
          fewerLabel={strings.removeOne(item.name)}
          moreLabel={strings.addAnother(item.name)}
          onChange={(next) => {
            if (next > count) {
              onAdd();
              return;
            }
            onRemove();
            if (count === 1) refocus();
          }}
        />
      )}
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
            {item.featured ? <Badge text={strings.featured} tone="strong" size="chip" isRound isWhole /> : null}
            {isSoldOut ? <Badge text={strings.soldOut} tone="strong" size="chip" dot="red" isRound isWhole /> : null}
          </span>
          {item.description === undefined ? null : <span className={styles.itemAbout}>{item.description}</span>}
          {price === undefined ? null : <span className={styles.price}>{price}</span>}
          {marks.length === 0 ? null : (
            <span className={styles.marks}>
              {marks.map((mark) => (
                <Badge key={mark} text={mark} tone="strong" size="chip" isRound isWhole />
              ))}
            </span>
          )}
        </span>
      </button>
      {add}
    </div>
  );
}
