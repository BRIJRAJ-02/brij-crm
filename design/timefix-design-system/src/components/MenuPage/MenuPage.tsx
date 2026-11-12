import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { contrastBetween, contrastOnWhiteText } from '../ColorPicker/ColorPicker.tsx';
import { Button as AriaButton } from 'react-aria-components';
import { BellRing, Check, Minus, Plus, Receipt, ShoppingBag, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Checkbox, Radio, RadioGroup } from '../Checkbox/Checkbox.tsx';
import { cx } from '../../lib/cx.ts';
import { fontFace, type MenuFont } from '../../lib/fonts.ts';
import { LookContext } from '../../lib/look.ts';
import './MenuPage.css';

/** A dietary mark. One spice level at most. */
export type Diet = 'vegan' | 'vegetarian' | 'gluten-free' | 'dairy-free' | 'nuts' | 'halal' | 'spicy-1' | 'spicy-2' | 'spicy-3';
/** Each mark as guests read it: the word, a short form for the pill, and whether it can be filtered on. */
export const DIETS: Readonly<Record<Diet, { readonly label: string; readonly short: string; readonly filter: boolean }>> = {
  vegan: { label: 'Vegan', short: 'VG', filter: true }, vegetarian: { label: 'Vegetarian', short: 'V', filter: true }, 'gluten-free': { label: 'Gluten free', short: 'GF', filter: true },
  'dairy-free': { label: 'Dairy free', short: 'DF', filter: false }, nuts: { label: 'Contains nuts', short: 'N', filter: false }, halal: { label: 'Halal', short: 'H', filter: false },
  'spicy-1': { label: 'Mild', short: '🌶', filter: false }, 'spicy-2': { label: 'Medium hot', short: '🌶🌶', filter: false }, 'spicy-3': { label: 'Hot', short: '🌶🌶🌶', filter: false },
};
/** The fourteen allergens a menu has to name (EU and FSSAI lists). */
export const ALLERGENS = ['Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Peanuts', 'Soy', 'Milk', 'Tree nuts', 'Celery', 'Mustard', 'Sesame', 'Sulphites', 'Lupin', 'Molluscs'] as const;

/** One dish (or drink). Shared: the same dish can sit in several sections and menus. */
export interface MenuDish {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** One price, in whole currency units; or `sizes`; or neither with a `priceNote` ("Market price"). */
  readonly price?: number;
  readonly sizes?: ReadonlyArray<{ readonly name: string; readonly price: number }>;
  readonly priceNote?: string;
  readonly photo?: string;
  readonly diet: ReadonlyArray<Diet>;
  /** `may` is "may contain" (traces). */
  readonly allergens: ReadonlyArray<{ readonly name: string; readonly may?: boolean }>;
  readonly addOnIds: ReadonlyArray<string>;
  readonly calories?: number;
  readonly popular?: boolean;
  readonly soldOut?: boolean;
}
/** A set of add-ons a dish offers: pick `min` to `max` (max 1 is "choose one"; min 1 or more is required). */
export interface MenuAddOn { readonly id: string; readonly name: string; readonly min: number; readonly max: number; readonly options: ReadonlyArray<{ readonly name: string; readonly price: number }> }
/** A sub section inside a section ("Small plates › From the grill"). */
export interface MenuSub { readonly id: string; readonly name: string; readonly dishIds: ReadonlyArray<string> }
/** A section of a menu ("Small plates"), drawn as rows or a photo grid, with optional sub sections and its own serving times. */
export interface MenuSection { readonly id: string; readonly name: string; readonly description?: string; readonly layout: 'list' | 'grid'; readonly dishIds: ReadonlyArray<string>;
  readonly subs?: ReadonlyArray<MenuSub>;
  /** Served on these days and hours, inside the menu's own (a brunch section on weekends). Unset follows the menu. */
  readonly days?: WeekHours }
/** A menu ("Dinner", "Drinks"): its sections, when it's served, and how prices are added up. */
export interface Menu {
  readonly id: string;
  readonly name: string;
  /** Served every day between these minutes; unset is all day. */
  readonly serving?: { readonly start: number; readonly end: number };
  readonly sections: ReadonlyArray<MenuSection>;
  /** Tax included in prices and service added to the bill, in percent. */
  readonly tax?: number;
  readonly service?: number;
  /** A line at the foot ("Please tell us about any allergies"). */
  readonly note?: string;
  /** Hidden menus aren't shown to guests. */
  readonly isLive: boolean;
  /** Served on these days and hours; beats `serving`. Unset is every day at `serving`, or all day. */
  readonly days?: WeekHours;
  /** The places it is served at (ids of the business's places); unset is every place. */
  readonly placeIds?: ReadonlyArray<string>;
}

export { MENU_FONTS, fontFace, fontItems, type MenuFont } from '../../lib/fonts.ts';

/** How a business's guest menu looks: a preset, its three colours, its faces, corners and a cover. */
export interface MenuLook {
  readonly preset: 'classic' | 'bistro' | 'garden' | 'night' | 'custom';
  /** "#RRGGBB": the page, the words, the buttons and chosen chips. */
  readonly ground: string; readonly text: string; readonly accent: string;
  /** The face of everything else (body, buttons, prices). */
  readonly font: MenuFont;
  /** The headings' face (the name, sections); left out, the same as `font`. */
  readonly heading?: MenuFont;
  readonly corners: 'sharp' | 'soft' | 'round';
  readonly cover?: string;
}
/** The presets a menu can start from. */
export const MENU_LOOKS: ReadonlyArray<{ readonly id: Exclude<MenuLook['preset'], 'custom'>; readonly title: string; readonly description: string; readonly look: Omit<MenuLook, 'preset' | 'cover'> }> = [
  { id: 'classic', title: 'Classic', description: 'White, black, quiet', look: { ground: '#FFFFFF', text: '#111111', accent: '#111111', font: 'sans', corners: 'soft' } },
  { id: 'bistro', title: 'Bistro', description: 'Cream and terracotta', look: { ground: '#FBF6EE', text: '#2B2118', accent: '#B4441F', font: 'sans', corners: 'round' } },
  { id: 'garden', title: 'Garden', description: 'Sage and deep green', look: { ground: '#F2F5EE', text: '#1C2A1F', accent: '#2F6B3F', font: 'sans', corners: 'soft' } },
  { id: 'night', title: 'Night', description: 'Dark, warm gold', look: { ground: '#16130F', text: '#F4EEE4', accent: '#E3B25B', font: 'mono', corners: 'sharp' } },
];
/** The contrast checks a look has to pass: words on the ground 4.5:1, buttons on the ground 3:1, words on buttons 4.5:1. */
export function menuLookChecks(l: Pick<MenuLook, 'ground' | 'text' | 'accent'>): ReadonlyArray<{ readonly id: string; readonly label: string; readonly ratio: number; readonly need: number }> {
  const onAccent = contrastOnWhiteText(l.accent) >= 4.5 ? '#FFFFFF' : '#111111';
  return [
    { id: 'text', label: 'Words on the background', ratio: contrastBetween(l.text, l.ground), need: 4.5 },
    { id: 'accent', label: 'Buttons on the background', ratio: contrastBetween(l.accent, l.ground), need: 3 },
    { id: 'on', label: 'Words on buttons', ratio: contrastBetween(onAccent, l.accent), need: 4.5 },
  ];
}
/** The look as a theme and token overrides, spread on the page's root; everything inside follows through the tokens. */
export function menuLookProps(l: MenuLook): { readonly 'data-theme': 'light' | 'dark'; readonly style: CSSProperties } {
  const dark = contrastBetween('#000000', l.ground) < contrastBetween('#FFFFFF', l.ground);
  const on = contrastOnWhiteText(l.accent) >= 4.5 ? '#FFFFFF' : '#111111';
  const r = l.corners === 'sharp' ? 'var(--radius-xs)' : l.corners === 'round' ? 'var(--radius-xl)' : undefined;
  return {
    'data-theme': dark ? 'dark' : 'light',
    style: {
      '--surface': l.ground, '--surface-raised': l.ground, '--text': l.text, '--text-secondary': `color-mix(in srgb, ${l.text} 72%, ${l.ground})`, '--text-tertiary': `color-mix(in srgb, ${l.text} 55%, ${l.ground})`,
      '--surface-subtle': `color-mix(in srgb, ${l.text} 6%, ${l.ground})`, '--surface-hover': `color-mix(in srgb, ${l.text} 9%, ${l.ground})`, '--border': `color-mix(in srgb, ${l.text} 16%, ${l.ground})`, '--border-subtle': `color-mix(in srgb, ${l.text} 10%, ${l.ground})`,
      '--primary': l.accent, '--on-primary': on, '--primary-hover': `color-mix(in srgb, ${l.accent} 88%, black)`, '--accent': l.accent, '--on-accent': on,
      '--font-sans': l.font === 'sans' ? undefined : fontFace(l.font), '--tf-face-display': fontFace(l.heading ?? l.font), '--radius-lg': r, '--radius-md': r, background: 'var(--surface)', color: 'var(--text)',
    } as CSSProperties,
  };
}
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** Whether a week of hours is open on this day (0 is Sunday) at this minute. */
export const openIn = (w: WeekHours, day: number, minute: number) => { const d = w[DAY_KEYS[day] ?? 'mon']; return Boolean(d?.on && d.ranges.some((r) => r.start <= minute && minute < r.end)); };
/** The next opening on that day after this minute, if any. */
const nextOpen = (w: WeekHours, day: number, minute: number) => { const d = w[DAY_KEYS[day] ?? 'mon']; return d?.on ? d.ranges.map((r) => r.start).filter((x) => x > minute).sort((a, b) => a - b)[0] : undefined; };

/** What a guest picked: a dish, its size, its add-ons and how many. */
export interface MenuPick { readonly key: string; readonly dishId: string; readonly size?: string; readonly options: ReadonlyArray<string>; readonly qty: number; readonly unit: number }

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const clock = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
/** "₹780", "from ₹650", or the note. */
export function dishPrice(d: MenuDish, money: (n: number) => string = inr): string {
  if (d.sizes && d.sizes.length > 0) { const lo = Math.min(...d.sizes.map((s) => s.price)); return d.sizes.length > 1 ? `from ${money(lo)}` : money(lo); }
  return d.price !== undefined ? money(d.price) : d.priceNote ?? '';
}
/** Whether a menu is being served at this minute of the day (and, with `days`, on this day; 0 is Sunday). */
export const servingNow = (m: Menu, minute: number, day = new Date().getDay()) => (m.days ? openIn(m.days, day, minute) : !m.serving || (m.serving.start <= m.serving.end ? m.serving.start <= minute && minute < m.serving.end : minute >= m.serving.start || minute < m.serving.end));

/** Props for MenuPage. */
export interface MenuPageProps {
  /** The place and what it is ("Olive Kitchen", "Colaba"). */
  readonly venue: string;
  readonly line?: string;
  readonly cover?: string;
  readonly menus: ReadonlyArray<Menu>;
  readonly dishes: ReadonlyArray<MenuDish>;
  readonly addOns: ReadonlyArray<MenuAddOn>;
  /** From a table's QR code: shown beside the name, so staff know where the guest sits. */
  readonly table?: string;
  /** Minutes into the day at the place, for "Served from 7 PM". */
  readonly now?: number;
  /** The day at the place (0 is Sunday), for menus and sections served on some days. */
  readonly day?: number;
  /** How the page looks (MenuLook); left out, the app's own tokens. */
  readonly look?: MenuLook;
  readonly money?: (n: number) => string;
  /** "Book a table" at the foot, when the place takes bookings. */
  readonly onBookTable?: () => void;
  /** The editor's preview: no selection bar, sheets still open. */
  readonly isPreview?: boolean;
  /** Under everything (Powered by Timefix). */
  readonly foot?: ReactNode;
  /** From a table's QR: "Call a waiter" and "Ask for the bill" under the menu's name; each says it's on its way once sent. */
  readonly onRequest?: (kind: 'waiter' | 'bill') => void;
  /** What this table has asked for and staff haven't done yet. */
  readonly requested?: ReadonlyArray<'waiter' | 'bill'>;
}

/** A restaurant's public menu at timefix.com/<handle>/menu: a menu switcher, search and dietary filters, sections as pills, dishes with
 *  photos, a sheet for sizes and add-ons, and a selection to show the server. Nothing is ordered or sent from the page. */
export function MenuPage(props: MenuPageProps) {
  // Its sheets and pickers open in the menu's own look.
  return <LookContext.Provider value={props.look ? menuLookProps(props.look) : undefined}><MenuPageBody {...props} /></LookContext.Provider>;
}

function MenuPageBody({ venue, line, cover, menus, dishes, addOns, table, now = 12 * 60, day = new Date().getDay(), look, money = inr, onBookTable, isPreview = false, foot, onRequest, requested = [] }: MenuPageProps) {
  const themed = look ? menuLookProps(look) : undefined;
  const coverSrc = cover ?? look?.cover;
  const live = menus.filter((m) => m.isLive && m.sections.some((s) => s.dishIds.length > 0 || (s.subs ?? []).some((x) => x.dishIds.length > 0)));
  const firstServing = live.find((m) => servingNow(m, now, day)) ?? live[0];
  const [menuId, setMenuId] = useState(firstServing?.id);
  const menu = live.find((m) => m.id === menuId) ?? firstServing;
  const [query, setQuery] = useState('');
  const [diets, setDiets] = useState<ReadonlySet<Diet>>(new Set());
  const [open, setOpen] = useState<MenuDish>();
  const [picks, setPicks] = useState<ReadonlyArray<MenuPick>>([]);
  const [bag, setBag] = useState(false);
  const [cleared, setCleared] = useState<ReadonlyArray<MenuPick>>();
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const byId = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);
  const q = query.trim().toLowerCase();
  const fits = (d: MenuDish) => (!q || d.name.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)) && [...diets].every((x) => d.diet.includes(x) || (x === 'vegetarian' && d.diet.includes('vegan')));
  const pick = (ids: ReadonlyArray<string>) => ids.map((id) => byId.get(id)).filter((d): d is MenuDish => d !== undefined && fits(d));
  const sections = (menu?.sections ?? []).map((s) => ({ ...s, shown: pick(s.dishIds), subsShown: (s.subs ?? []).map((x) => ({ ...x, shown: pick(x.dishIds) })).filter((x) => x.shown.length > 0) })).filter((s) => s.shown.length > 0 || s.subsShown.length > 0);
  const count = picks.reduce((n, p) => n + p.qty, 0);
  const subtotal = picks.reduce((n, p) => n + p.qty * p.unit, 0);
  const used = new Set(sections.flatMap((s) => [...s.shown, ...s.subsShown.flatMap((x) => x.shown)].flatMap((d) => d.allergens.map((a) => a.name))));

  if (!menu) {
    return (
      <div className="tf-menupage" {...themed}>
        <header className="tf-menupage__brand"><span className="tf-menupage__eyebrow">{venue}</span><h1 className="tf-menupage__title">The menu isn’t up right now</h1></header>
        <p className="tf-menupage__muted">Ask your server, or come back soon.</p>
        {onBookTable && <Button variant="secondary" onPress={onBookTable}>Book a table</Button>}
        {foot}
      </div>
    );
  }
  const serving = servingNow(menu, now, day);
  const from = menu.days ? nextOpen(menu.days, day, now) : menu.serving?.start;
  const add = (p: MenuPick) => setPicks((all) => { const same = all.find((x) => x.key === p.key); return same ? all.map((x) => (x.key === p.key ? { ...x, qty: Math.min(99, x.qty + p.qty) } : x)) : [...all, p]; });
  const step = (key: string, by: number) => setPicks((all) => all.map((x) => (x.key === key ? { ...x, qty: x.qty + by } : x)).filter((x) => x.qty > 0));
  const tax = menu.tax ?? 0; const service = menu.service ?? 0;
  const dishList = (list: ReadonlyArray<MenuDish>, layout: 'list' | 'grid') => list.length === 0 ? null : (
          <ul className={cx('tf-menupage__dishes', layout === 'grid' && 'is-grid')}>
            {list.map((d) => (
              <li key={d.id}>
                <AriaButton className={cx('tf-menupage__dish', d.soldOut && 'is-out')} onPress={() => setOpen(d)} aria-label={`${d.name}, ${dishPrice(d, money)}${d.soldOut ? ', sold out' : ''}`}>
                  {layout === 'grid' && d.photo && <img className="tf-menupage__photo" src={d.photo} alt="" />}
                  <span className="tf-menupage__dish-text">
                    <span className="tf-menupage__dish-name">{d.name}{d.popular && !d.soldOut && <span className="tf-menupage__badge">Popular</span>}{d.soldOut && <span className="tf-menupage__badge is-out">Sold out</span>}</span>
                    {d.description && <span className="tf-menupage__desc">{d.description}</span>}
                    <span className="tf-menupage__dish-foot">
                      <span className="tf-menupage__price tf-num">{dishPrice(d, money)}</span>
                      {d.diet.map((x) => <span key={x} className="tf-menupage__diet" title={DIETS[x].label} aria-label={DIETS[x].label}>{DIETS[x].short}</span>)}
                    </span>
                  </span>
                  {layout === 'list' && d.photo && <img className="tf-menupage__thumb" src={d.photo} alt="" />}
                </AriaButton>
              </li>
            ))}
          </ul>
  );

  return (
    <div className={cx('tf-menupage', count > 0 && !isPreview && 'has-bag')} {...themed}>
      <header className="tf-menupage__top">
        <span className="tf-menupage__eyebrow">{venue}{table && <span className="tf-menupage__table">Table {table}</span>}</span>
        {live.length > 1 && (
          <SegmentedControl aria-label="Menu" size="sm" selectedKey={menu.id} onSelectionChange={(k) => { setMenuId(String(k)); setQuery(''); }}
            items={live.map((m) => ({ id: m.id, label: m.name }))} />
        )}
      </header>
      {table && onRequest && (
        <div className="tf-menupage__ask" role="group" aria-label={`Table ${table}`}>
          {(['waiter', 'bill'] as const).map((k) => {
            const sent = requested.includes(k);
            return <Button key={k} variant={sent ? 'secondary' : k === 'bill' ? 'primary' : 'secondary'} isDisabled={sent} icon={sent ? <Check size={16} strokeWidth={2} /> : k === 'waiter' ? <BellRing size={16} strokeWidth={1.75} /> : <Receipt size={16} strokeWidth={1.75} />}
              onPress={() => onRequest(k)}>{sent ? (k === 'waiter' ? 'Someone’s coming' : 'Bill on its way') : k === 'waiter' ? 'Call a waiter' : 'Ask for the bill'}</Button>;
          })}
        </div>
      )}
      {coverSrc && <img className="tf-menupage__cover" src={coverSrc} alt="" />}
      <div className="tf-menupage__brand">
        <h1 className="tf-menupage__title">{menu.name}</h1>
        <p className="tf-menupage__muted">{!serving ? (from !== undefined ? `Served from ${clock(from)} · ` : 'Not served today · ') : menu.serving && !menu.days ? `Until ${clock(menu.serving.end)} · ` : ''}{line}</p>
      </div>
      <div className="tf-menupage__tools">
        <SearchField label="Search the menu" placeholder="Search dishes" size="sm" value={query} onChange={setQuery} />
        <div className="tf-menupage__filters" role="group" aria-label="Dietary">
          {(Object.keys(DIETS) as Diet[]).filter((d) => DIETS[d].filter).map((d) => (
            <AriaButton key={d} className="tf-menupage__filter" aria-pressed={diets.has(d)} onPress={() => setDiets((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}>{DIETS[d].label}</AriaButton>
          ))}
        </div>
      </div>
      {sections.length > 1 && (
        <nav className="tf-menupage__pills" aria-label="Sections">
          {sections.map((s) => <AriaButton key={s.id} className="tf-menupage__pill" onPress={() => sectionRefs.current[s.id]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>{s.name}</AriaButton>)}
        </nav>
      )}
      {sections.length === 0 ? (
        <div className="tf-menupage__none">
          <p>Nothing matches{q ? ` “${query}”` : ''}{diets.size ? ` for ${[...diets].map((d) => DIETS[d].label.toLowerCase()).join(' and ')}` : ''}.</p>
          <Button size="sm" variant="secondary" onPress={() => { setQuery(''); setDiets(new Set()); }}>Show everything</Button>
        </div>
      ) : sections.map((s) => (
        <section key={s.id} className="tf-menupage__section" aria-labelledby={`tf-menupage-${s.id}`} ref={(el) => { sectionRefs.current[s.id] = el; }}>
          <h2 id={`tf-menupage-${s.id}`} className="tf-menupage__h2">{s.name}</h2>
          {s.description && <p className="tf-menupage__muted">{s.description}</p>}
          {s.days && !openIn(s.days, day, now) && <p className="tf-menupage__muted">{nextOpen(s.days, day, now) !== undefined ? `Served from ${clock(nextOpen(s.days, day, now) ?? 0)}` : 'Not served today'}</p>}
          {dishList(s.shown, s.layout)}
          {s.subsShown.map((x) => (
            <div key={x.id} className="tf-menupage__sub">
              <h3 className="tf-menupage__h3">{x.name}</h3>
              {dishList(x.shown, s.layout)}
            </div>
          ))}
        </section>
      ))}
      <footer className="tf-menupage__foot">
        {used.size > 0 && <p className="tf-menupage__muted">Allergies? Tap a dish to see what’s in it, and tell your server before you order. {menu.note ?? ''}</p>}
        {(tax > 0 || service > 0) && <p className="tf-menupage__muted">{tax > 0 ? `Prices include ${tax}% tax.` : ''}{service > 0 ? ` ${service}% service is added to the bill.` : ''}</p>}
        {onBookTable && <Button variant="secondary" onPress={onBookTable}>Book a table</Button>}
        {foot}
      </footer>
      {count > 0 && !isPreview && (
        <div className="tf-menupage__bagbar">
          <AriaButton className="tf-menupage__bagbtn" onPress={() => setBag(true)}>
            <span className="tf-menupage__bagcount tf-num">{count}</span><span>Your selection</span><span className="tf-num">{money(subtotal)}</span>
          </AriaButton>
        </div>
      )}
      {open && <DishSheet dish={open} addOns={addOns} money={money} onClose={() => setOpen(undefined)} onAdd={isPreview ? undefined : (p) => { add(p); setOpen(undefined); }} />}
      {bag && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setBag(false); }} title="Your selection" description="Show this to your server. Nothing is sent from this page."
          actions={<><Button variant="ghost" icon={<Trash2 size={14} strokeWidth={1.75} />} onPress={() => { setCleared(picks); setPicks([]); setBag(false); }}>Clear all</Button><Button variant="primary" slot="close">Done</Button></>}>
          <ul className="tf-menupage__picks">
            {picks.map((p) => {
              const d = byId.get(p.dishId);
              return (
                <li key={p.key} className="tf-menupage__pickrow">
                  <span className="tf-menupage__dish-text"><span className="tf-menupage__dish-name">{d?.name}</span>{(p.size || p.options.length > 0) && <span className="tf-menupage__desc">{[p.size, ...p.options].filter(Boolean).join(', ')}</span>}</span>
                  <span className="tf-menupage__stepper">
                    <IconButton size="sm" label={`One less ${d?.name ?? ''}`} onPress={() => step(p.key, -1)}><Minus size={14} strokeWidth={2} /></IconButton>
                    <span className="tf-num" aria-live="polite">{p.qty}</span>
                    <IconButton size="sm" label={`One more ${d?.name ?? ''}`} onPress={() => step(p.key, 1)}><Plus size={14} strokeWidth={2} /></IconButton>
                  </span>
                  <span className="tf-menupage__price tf-num">{money(p.qty * p.unit)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="tf-menupage__sum tf-num">
            <div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
            {tax > 0 && <div className="tf-menupage__muted"><dt>Includes {tax}% tax</dt><dd>{money(Math.round(subtotal - subtotal / (1 + tax / 100)))}</dd></div>}
            {service > 0 && <div><dt>Service {service}%</dt><dd>{money(Math.round(subtotal * service / 100))}</dd></div>}
            <div className="is-total"><dt>Total</dt><dd>{money(Math.round(subtotal * (1 + service / 100)))}</dd></div>
          </dl>
        </Dialog>
      )}
      {cleared && picks.length === 0 && !bag && (
        <div className="tf-menupage__bagbar" role="status">
          <span className="tf-menupage__cleared">Selection cleared<Button size="sm" variant="ghost" onPress={() => { setPicks(cleared); setCleared(undefined); }}>Undo</Button><IconButton size="sm" label="Dismiss" onPress={() => setCleared(undefined)}><X size={14} strokeWidth={2} /></IconButton></span>
        </div>
      )}
    </div>
  );
}

/** One dish, opened: photo, what's in it, sizes and add-ons with their rules, how many, and add to the selection. */
function DishSheet({ dish: d, addOns, money, onClose, onAdd }: { readonly dish: MenuDish; readonly addOns: ReadonlyArray<MenuAddOn>; readonly money: (n: number) => string; readonly onClose: () => void; readonly onAdd?: (p: MenuPick) => void }) {
  const groups = d.addOnIds.map((id) => addOns.find((a) => a.id === id)).filter((a): a is MenuAddOn => a !== undefined);
  const [size, setSize] = useState(d.sizes?.[0]?.name);
  const [chosen, setChosen] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [qty, setQty] = useState(1);
  const base = d.sizes?.find((s) => s.name === size)?.price ?? d.price ?? 0;
  const extra = groups.reduce((n, g) => n + (chosen[g.id] ?? []).reduce((m, o) => m + (g.options.find((x) => x.name === o)?.price ?? 0), 0), 0);
  const missing = groups.filter((g) => (chosen[g.id] ?? []).length < g.min);
  const unit = base + extra;
  const toggle = (g: MenuAddOn, name: string, on: boolean) => setChosen((c) => {
    const cur = c[g.id] ?? [];
    const next = g.max === 1 ? [name] : on ? (cur.length < g.max ? [...cur, name] : cur) : cur.filter((x) => x !== name);
    return { ...c, [g.id]: next };
  });
  const contains = d.allergens.filter((a) => !a.may); const may = d.allergens.filter((a) => a.may);
  const signed = (n: number) => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={d.name} showClose
      description={[dishPrice(d, money), d.calories ? `${d.calories} kcal` : ''].filter(Boolean).join(' · ')}
      actions={d.soldOut ? <Button variant="secondary" slot="close">Sold out today</Button> : onAdd ? (
        <>
          <span className="tf-menupage__stepper">
            <IconButton size="sm" label="One less" isDisabled={qty <= 1} onPress={() => setQty(qty - 1)}><Minus size={14} strokeWidth={2} /></IconButton>
            <span className="tf-num" aria-live="polite">{qty}</span>
            <IconButton size="sm" label="One more" isDisabled={qty >= 99} onPress={() => setQty(qty + 1)}><Plus size={14} strokeWidth={2} /></IconButton>
          </span>
          <Button variant="primary" icon={<ShoppingBag size={14} strokeWidth={1.75} />} isDisabled={missing.length > 0}
            onPress={() => { const options = groups.flatMap((g) => chosen[g.id] ?? []); onAdd({ key: [d.id, size, ...options].join('|'), dishId: d.id, size, options, qty, unit }); }}>
            {missing.length > 0 ? `Choose ${missing[0]?.name.toLowerCase()}` : `Add · ${money(unit * qty)}`}
          </Button>
        </>
      ) : <Button variant="secondary" slot="close">Close</Button>}>
      <div className="tf-menupage__sheet">
        {d.photo && <img className="tf-menupage__sheet-photo" src={d.photo} alt="" />}
        {d.description && <p className="tf-menupage__sheet-desc">{d.description}</p>}
        {d.diet.length > 0 && <p className="tf-menupage__marks">{d.diet.map((x) => <span key={x} className="tf-menupage__mark">{DIETS[x].label}</span>)}</p>}
        {d.sizes && d.sizes.length > 1 && (
          <RadioGroup label="Size" value={size ?? null} onChange={setSize}>
            {d.sizes.map((s) => <Radio key={s.name} value={s.name}><span className="tf-menupage__opt"><span>{s.name}</span><span className="tf-num">{money(s.price)}</span></span></Radio>)}
          </RadioGroup>
        )}
        {groups.map((g) => (
          <div key={g.id} className="tf-menupage__group" role="group" aria-label={g.name}>
            <span className="tf-menupage__group-h">{g.name}<span className="tf-menupage__muted">{g.min > 0 ? 'Required' : 'Optional'}{g.max > 1 ? ` · up to ${g.max}` : g.max === 1 ? ' · choose one' : ''}</span></span>
            {g.max === 1 ? (
              <RadioGroup aria-label={g.name} value={chosen[g.id]?.[0] ?? null} onChange={(v) => toggle(g, v, true)}>
                {g.options.map((o) => <Radio key={o.name} value={o.name}><span className="tf-menupage__opt"><span>{o.name}</span><span className="tf-num">{signed(o.price)}</span></span></Radio>)}
              </RadioGroup>
            ) : g.options.map((o) => (
              <Checkbox key={o.name} isSelected={(chosen[g.id] ?? []).includes(o.name)} isDisabled={!(chosen[g.id] ?? []).includes(o.name) && (chosen[g.id] ?? []).length >= g.max} onChange={(on) => toggle(g, o.name, on)}>
                <span className="tf-menupage__opt"><span>{o.name}</span><span className="tf-num">{signed(o.price)}</span></span>
              </Checkbox>
            ))}
          </div>
        ))}
        {(contains.length > 0 || may.length > 0) && (
          <div className="tf-menupage__allergens">
            {contains.length > 0 && <p><strong>Contains</strong> {contains.map((a) => a.name.toLowerCase()).join(', ')}</p>}
            {may.length > 0 && <p className="tf-menupage__muted">May contain traces of {may.map((a) => a.name.toLowerCase()).join(', ')}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
