import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Checkbox, Radio, RadioGroup } from '../Checkbox/Checkbox.tsx';
import { cx } from '../../lib/cx.ts';
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
/** A section of a menu ("Small plates"), drawn as rows or a photo grid. */
export interface MenuSection { readonly id: string; readonly name: string; readonly description?: string; readonly layout: 'list' | 'grid'; readonly dishIds: ReadonlyArray<string> }
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
}

/** What a guest picked: a dish, its size, its add-ons and how many. */
export interface MenuPick { readonly key: string; readonly dishId: string; readonly size?: string; readonly options: ReadonlyArray<string>; readonly qty: number; readonly unit: number }

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const clock = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
/** "₹780", "from ₹650", or the note. */
export function dishPrice(d: MenuDish, money: (n: number) => string = inr): string {
  if (d.sizes && d.sizes.length > 0) { const lo = Math.min(...d.sizes.map((s) => s.price)); return d.sizes.length > 1 ? `from ${money(lo)}` : money(lo); }
  return d.price !== undefined ? money(d.price) : d.priceNote ?? '';
}
/** Whether a menu is being served at this minute of the day. */
export const servingNow = (m: Menu, minute: number) => !m.serving || (m.serving.start <= m.serving.end ? m.serving.start <= minute && minute < m.serving.end : minute >= m.serving.start || minute < m.serving.end);

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
  readonly money?: (n: number) => string;
  /** "Book a table" at the foot, when the place takes bookings. */
  readonly onBookTable?: () => void;
  /** The editor's preview: no selection bar, sheets still open. */
  readonly isPreview?: boolean;
  /** Under everything (Powered by Timefix). */
  readonly foot?: ReactNode;
}

/** A restaurant's public menu at timefix.com/<handle>/menu: a menu switcher, search and dietary filters, sections as pills, dishes with
 *  photos, a sheet for sizes and add-ons, and a selection to show the server. Nothing is ordered or sent from the page. */
export function MenuPage({ venue, line, cover, menus, dishes, addOns, table, now = 12 * 60, money = inr, onBookTable, isPreview = false, foot }: MenuPageProps) {
  const live = menus.filter((m) => m.isLive && m.sections.some((s) => s.dishIds.length > 0));
  const firstServing = live.find((m) => servingNow(m, now)) ?? live[0];
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
  const sections = (menu?.sections ?? []).map((s) => ({ ...s, shown: s.dishIds.map((id) => byId.get(id)).filter((d): d is MenuDish => d !== undefined && fits(d)) })).filter((s) => s.shown.length > 0);
  const count = picks.reduce((n, p) => n + p.qty, 0);
  const subtotal = picks.reduce((n, p) => n + p.qty * p.unit, 0);
  const used = new Set(sections.flatMap((s) => s.shown.flatMap((d) => d.allergens.map((a) => a.name))));

  if (!menu) {
    return (
      <div className="tf-menupage">
        <header className="tf-menupage__brand"><span className="tf-menupage__eyebrow">{venue}</span><h1 className="tf-menupage__title">The menu isn’t up right now</h1></header>
        <p className="tf-menupage__muted">Ask your server, or come back soon.</p>
        {onBookTable && <Button variant="secondary" onPress={onBookTable}>Book a table</Button>}
        {foot}
      </div>
    );
  }
  const serving = servingNow(menu, now);
  const add = (p: MenuPick) => setPicks((all) => { const same = all.find((x) => x.key === p.key); return same ? all.map((x) => (x.key === p.key ? { ...x, qty: Math.min(99, x.qty + p.qty) } : x)) : [...all, p]; });
  const step = (key: string, by: number) => setPicks((all) => all.map((x) => (x.key === key ? { ...x, qty: x.qty + by } : x)).filter((x) => x.qty > 0));
  const tax = menu.tax ?? 0; const service = menu.service ?? 0;

  return (
    <div className={cx('tf-menupage', count > 0 && !isPreview && 'has-bag')}>
      <header className="tf-menupage__top">
        <span className="tf-menupage__eyebrow">{venue}{table && <span className="tf-menupage__table">Table {table}</span>}</span>
        {live.length > 1 && (
          <SegmentedControl aria-label="Menu" size="sm" selectedKey={menu.id} onSelectionChange={(k) => { setMenuId(String(k)); setQuery(''); }}
            items={live.map((m) => ({ id: m.id, label: m.name }))} />
        )}
      </header>
      {cover && <img className="tf-menupage__cover" src={cover} alt="" />}
      <div className="tf-menupage__brand">
        <h1 className="tf-menupage__title">{menu.name}</h1>
        <p className="tf-menupage__muted">{!serving && menu.serving ? `Served from ${clock(menu.serving.start)} · ` : menu.serving ? `Until ${clock(menu.serving.end)} · ` : ''}{line}</p>
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
          {sections.map((s) => <AriaButton key={s.id} className="tf-menupage__pill" onPress={() => sectionRefs.current[s.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{s.name}</AriaButton>)}
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
          <ul className={cx('tf-menupage__dishes', s.layout === 'grid' && 'is-grid')}>
            {s.shown.map((d) => (
              <li key={d.id}>
                <AriaButton className={cx('tf-menupage__dish', d.soldOut && 'is-out')} onPress={() => setOpen(d)} aria-label={`${d.name}, ${dishPrice(d, money)}${d.soldOut ? ', sold out' : ''}`}>
                  {s.layout === 'grid' && d.photo && <img className="tf-menupage__photo" src={d.photo} alt="" />}
                  <span className="tf-menupage__dish-text">
                    <span className="tf-menupage__dish-name">{d.name}{d.popular && !d.soldOut && <span className="tf-menupage__badge">Popular</span>}{d.soldOut && <span className="tf-menupage__badge is-out">Sold out</span>}</span>
                    {d.description && <span className="tf-menupage__desc">{d.description}</span>}
                    <span className="tf-menupage__dish-foot">
                      <span className="tf-menupage__price tf-num">{dishPrice(d, money)}</span>
                      {d.diet.map((x) => <span key={x} className="tf-menupage__diet" title={DIETS[x].label} aria-label={DIETS[x].label}>{DIETS[x].short}</span>)}
                    </span>
                  </span>
                  {s.layout === 'list' && d.photo && <img className="tf-menupage__thumb" src={d.photo} alt="" />}
                </AriaButton>
              </li>
            ))}
          </ul>
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
