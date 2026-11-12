// A restaurant's Menu (spec 0065 H1): its menus (Lunch, Dinner, Drinks) as sections, sub sections and items, edited as a draft beside a live
// preview read at a chosen day and time, reviewed and published when ready; Sold out and Hide apply at once. Structure orders sections and
// items by drag (lib/drag.ts); Items lists every item with its Available switch; Design sets the guest look; QR codes lives in menu-qr.tsx.
import { copyText } from '../../lib/copy.ts';
import { Link } from '../Link/Link.tsx';
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Check, Copy, Eye, ListTree, MoreHorizontal, Palette, Pencil, Plus, QrCode as QrIcon, Rows3, Share2, TriangleAlert, UtensilsCrossed, X, Clock, ListChecks, Send } from 'lucide-react';
import { PublishBar, SaveBar } from '../FloatingBar/FloatingBar.tsx';
import { ShareSheet } from '../ShareSheet/ShareSheet.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { EmptyState, NoResults } from '../EmptyState/EmptyState.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { HoursEditor, HoursSummary, type WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { AccentPicker } from '../ColorPicker/ColorPicker.tsx';
import { TileGrid } from '../Card/Card.tsx';
import { Checklist } from '../Checklist/Checklist.tsx';
import { PhotoCrop, cropToDataUrl } from '../PhotoCrop/PhotoCrop.tsx';
import { QrCode } from '../QrCode/QrCode.tsx';
import { Menu, MenuItem, MenuSection as MenuGroup, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { DragArea, DragGroup, DragList, useDragGroup } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { cx } from '../../lib/cx.ts';
import { ALLERGENS, DIETS, MENU_FONTS, MENU_LOOKS, MenuPage, fontItems, dishPrice, menuLookChecks, type Diet, type Menu as MenuT, type MenuAddOn, type MenuDish, type MenuLook, type MenuSection } from '../MenuPage/MenuPage.tsx';
import { ScaledPreview, TabToolbar, i14, i16 } from './parts.tsx';
import { menuChanges, nextId, plural, type BookingsAction, type BookingsState, type MenuBook } from './state.ts';
import { bizOf, currentBiz } from './biz.ts';
import { plate } from './menu-seed.ts';
import { QrCodes } from './menu-qr.tsx';

const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v: string | null | undefined, d: number) => { if (!v) return d; const [h = '0', m = '0'] = v.split(':'); return Number(h) * 60 + Number(m); };
const SPICE: ReadonlyArray<Diet> = ['spicy-1', 'spicy-2', 'spicy-3'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_LOOK: MenuLook = { preset: 'classic', ...(MENU_LOOKS[0]?.look ?? { ground: '#FFFFFF', text: '#111111', accent: '#111111', font: 'sans', corners: 'soft' }) };
/** Where a group of items sits: a section, or a sub section ("sec/sub"). */
const gid = (sec: string, sub?: string) => (sub ? `${sec}/${sub}` : sec);
const lc = (s: string) => s.toLowerCase();
/** A menu with its book: every id an item sits under. */
const placesOf = (m: MenuT, id: string) => m.sections.flatMap((s) => [...(s.dishIds.includes(id) ? [s.name] : []), ...(s.subs ?? []).filter((x) => x.dishIds.includes(id)).map((x) => `${s.name} · ${x.name}`)]);

/** Props for MenuTab. */
export interface MenuTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  /** See the menu as a guest, from a table's code when given. */
  readonly onGuest: (table?: string) => void;
  /** Tables are kept in Availability. */
  readonly onTables: () => void;
}

type View = 'structure' | 'items' | 'qr' | 'design';

/** The Menu tab. */
export function MenuTab({ state, dispatch, onGuest, onTables }: MenuTabProps) {
  const { toast } = useToast();
  const book = state.menu;
  const [view, setView] = useState<View>('structure');
  const [menuId, setMenuId] = useState(book?.menus[0]?.id);
  const [dish, setDish] = useState<{ readonly dish?: MenuDish; readonly group?: string }>();
  const [section, setSection] = useState<MenuSection | 'new'>();
  const [sub, setSub] = useState<{ readonly sec: MenuSection; readonly id?: string }>();
  const [settings, setSettings] = useState(false);
  const [addOnsOpen, setAddOnsOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [query, setQuery] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [at, setAt] = useState(() => ({ day: new Date().getDay(), minute: 13 * 60 }));
  const [draftLook, setDraftLook] = useState<MenuLook>();
  if (!book) return <EmptyState icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="No menu yet" description="Add your items and share one link, or a QR code on every table." />;
  const menu = book.menus.find((m) => m.id === menuId) ?? book.menus[0];
  const changes = menuChanges(state);
  const z = bizOf(state); const biz = currentBiz(z);
  const look = book.look ?? DEFAULT_LOOK;
  const set = (next: Partial<MenuBook>) => dispatch({ type: 'menu/draft', menu: { ...book, ...next } });
  const setMenu = (m: MenuT) => set({ menus: book.menus.map((x) => (x.id === m.id ? m : x)) });
  const dishById = (id: string) => book.dishes.find((d) => d.id === id);
  const where = (id: string) => book.menus.flatMap((m) => placesOf(m, id).map((p) => `${m.name} › ${p}`));
  const soldOut = (d: MenuDish, on: boolean) => {
    dispatch({ type: 'dish/soldout', id: d.id, soldOut: on });
    toast({ message: on ? `${d.name} is sold out. Guests see it greyed.` : `${d.name} is back on`, action: { label: 'Undo', onAction: () => dispatch({ type: 'dish/soldout', id: d.id, soldOut: !on }) } });
  };
  const undoable = (message: string) => { const before = book; toast({ message, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); };
  const menuUrl = `timefix.com/${state.business?.handle ?? 'menu'}/menu`;
  const q = lc(query.trim());
  const hitDish = (d: MenuDish) => !q || lc(d.name).includes(q) || lc(d.description ?? '').includes(q);
  const firstPublish = !state.menuLive;
  const steps = [
    { id: 'hours', title: 'Set your opening hours', description: biz.places[0]?.name ?? '', icon: <Clock {...i16} />, actionLabel: 'Open hours', isDone: biz.places.every((p) => Object.values(p.hours).some((x) => x.on)) },
    { id: 'menu', title: 'Make your first menu', description: 'Lunch, Dinner or Drinks', icon: <ListTree {...i16} />, actionLabel: 'New menu', isDone: book.menus.length > 0 },
    { id: 'items', title: 'Add your first items', description: 'With prices and photos', icon: <UtensilsCrossed {...i16} />, actionLabel: 'Add item', isDone: book.dishes.length > 0 },
    { id: 'publish', title: 'Publish it', description: menuUrl, icon: <Send {...i16} />, actionLabel: 'Review', isDone: !firstPublish },
  ];
  const hidden = (z.hidden ?? []).includes('setup:menu');
  const preview = (l: MenuLook, m: MenuT | undefined) => (
    <aside className="tf-bkf-menued__preview" aria-label="What guests see">
      <div className="tf-bkf-menued__at">
        <span className="tf-bkf__eyebrow"><Eye {...i14} aria-hidden /> Preview at</span>
        <Select label="Day" isLabelHidden value={String(at.day)} onChange={(v) => v && setAt({ ...at, day: Number(v) })} items={DAY_NAMES.map((n, i) => ({ id: String(i), label: i === new Date().getDay() ? `${n} (today)` : n }))} />
        <TimeSelect label="Time" isLabelHidden value={hm(at.minute)} onChange={(v) => setAt({ ...at, minute: mins(v, 780) })} hourCycle={12} step={30} />
      </div>
      <div className="tf-bkf-menued__phone">
        <ScaledPreview label="Menu preview" designWidth={390}>
          <MenuPage venue={state.workspace} line={state.business?.area} menus={m ? [{ ...m, isLive: true }] : []} dishes={book.dishes} addOns={book.addOns} now={at.minute} day={at.day} look={l} isPreview />
        </ScaledPreview>
      </div>
    </aside>
  );

  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          {menu && view !== 'design' && <Select label="Menu" isLabelHidden className="tf-bkf__whose" value={menu.id} onChange={(v) => { if (v === 'new') setNaming(true); else if (v) setMenuId(v); }}
            items={[...book.menus.map((m) => ({ id: m.id, label: m.isLive ? m.name : `${m.name} · hidden` })), { id: 'new', label: 'New menu…' }]} />}
          <SegmentedControl aria-label="View" size="sm" selectedKey={view} onSelectionChange={(k) => { const v = String(k) as View; if (v === 'design') setDraftLook(look); setView(v); }}
            items={[{ id: 'structure', label: 'Structure', icon: <ListTree {...i14} /> }, { id: 'items', label: 'Items', icon: <Rows3 {...i14} /> }, { id: 'design', label: 'Design', icon: <Palette {...i14} /> }, { id: 'qr', label: 'QR codes', icon: <QrIcon {...i14} /> }]} />
          {(view === 'structure' || view === 'items') && <SearchField label="Search the menu" size="sm" placeholder={view === 'items' ? 'Search items' : 'Search sections and items'} value={query} onChange={setQuery} />}
        </>}
        count={view === 'items' ? `${book.dishes.filter((d) => !d.soldOut).length} of ${plural(book.dishes.length, 'item')} available` : `${plural(book.dishes.length, 'item')} · ${book.menus.filter((m) => m.isLive).length} live`}
        action={<span className="tf-bkf-res__actions">
          <Button variant="ghost" icon={<Eye {...i14} />} onPress={() => onGuest()}>See it as a guest</Button>
          <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => setSharing(true)}>Share</Button>
          {menu && (
            <MenuTrigger>
              <IconButton label="More for this menu"><MoreHorizontal {...i16} /></IconButton>
              <Menu aria-label="Menu actions" placement="bottom end" onAction={(k) => {
                if (k === 'settings') setSettings(true);
                else if (k === 'addons') setAddOnsOpen(true);
                else if (k === 'show') { dispatch({ type: 'menu/show', id: menu.id, isLive: !menu.isLive }); toast({ message: menu.isLive ? `${menu.name} is hidden from guests` : `${menu.name} is on show`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/show', id: menu.id, isLive: menu.isLive }) } }); }
                else if (k === 'duplicate') { const copy: MenuT = { ...menu, id: nextId('mn'), name: `${menu.name} copy`, isLive: false, sections: menu.sections.map((s) => ({ ...s, id: nextId('sec'), subs: s.subs?.map((x) => ({ ...x, id: nextId('sub') })) })) }; set({ menus: [...book.menus, copy] }); setMenuId(copy.id); toast({ message: `${copy.name} made, hidden until you show it`, tone: 'success' }); }
                else if (k === 'discard') { const before = book; dispatch({ type: 'menu/discard' }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); }
                else if (k === 'delete') { set({ menus: book.menus.filter((m) => m.id !== menu.id) }); setMenuId(book.menus.find((m) => m.id !== menu.id)?.id); undoable(`${menu.name} deleted. Publish to take it off.`); }
              }}>
                <MenuItem id="settings" icon={<Pencil {...i16} />}>Menu settings</MenuItem>
                <MenuItem id="addons" icon={<Plus {...i16} />}>Add-ons</MenuItem>
                <MenuItem id="show" icon={<Eye {...i16} />}>{menu.isLive ? 'Hide from guests' : 'Show to guests'}</MenuItem>
                <MenuItem id="duplicate" icon={<Copy {...i16} />}>Duplicate menu</MenuItem>
                {changes.length > 0 && <MenuItem id="discard" icon={<X {...i16} />}>Discard changes</MenuItem>}
                <MenuSeparator />
                <MenuItem id="delete" icon={<X {...i16} />} isDanger>Delete menu</MenuItem>
              </Menu>
            </MenuTrigger>
          )}
        </span>} />

      {!hidden && steps.some((x) => !x.isDone) && view !== 'design' && (
        <Checklist title="Set up your menu" steps={steps} defaultExpanded onHide={() => dispatch({ type: 'biz/set', biz: { ...z, hidden: [...(z.hidden ?? []), 'setup:menu'] } })}
          onAction={(id) => { if (id === 'menu') setNaming(true); else if (id === 'items') setDish({ group: menu?.sections[0]?.id }); else if (id === 'publish') setReviewing(true); else onTables(); }} />
      )}

      {view === 'qr' ? <QrCodes state={state} dispatch={dispatch} onGuest={onGuest} onTables={onTables} />
        : view === 'design' ? (
          <div className="tf-bkf-menued">
            <DesignPanel value={draftLook ?? look} onChange={setDraftLook} />
            {preview(draftLook ?? look, menu)}
            <SaveBar status={draftLook && JSON.stringify(draftLook) !== JSON.stringify(look) ? 'unsaved' : 'hidden'} note="Design goes live at once"
              onDiscard={() => setDraftLook(look)}
              onSave={() => { if (!draftLook) return; const was = book; const next = { ...book, look: draftLook }; dispatch({ type: 'menu/draft', menu: next }); if (state.menuLive) dispatch({ type: 'menu/look', look: draftLook }); toast({ message: 'Design saved. Guests see it now.', tone: 'success', action: { label: 'Undo', onAction: () => { dispatch({ type: 'menu/draft', menu: was }); dispatch({ type: 'menu/look', look: was.look }); setDraftLook(was.look ?? DEFAULT_LOOK); } } }); }} />
          </div>
        )
        : view === 'items' ? (
          <ItemsTable onClear={() => setQuery('')} book={book} q={q} onOpen={(d) => setDish({ dish: d })} onSoldOut={soldOut} onNew={() => setDish({})}
            onDelete={(d) => { set({ dishes: book.dishes.filter((x) => x.id !== d.id), menus: book.menus.map((m) => ({ ...m, sections: m.sections.map((s) => ({ ...s, dishIds: s.dishIds.filter((x) => x !== d.id), subs: s.subs?.map((y) => ({ ...y, dishIds: y.dishIds.filter((x) => x !== d.id) })) })) })) }); undoable(`${d.name} deleted from every menu`); }} />
        )
        : menu ? (
          <div className="tf-bkf-menued">
            <div className="tf-bkf-menued__main">
              {!menu.isLive && <Callout tone="warning" action={{ label: 'Show it', onPress: () => dispatch({ type: 'menu/show', id: menu.id, isLive: true }) }}>Guests can’t see {menu.name}.</Callout>}
              <p className="tf-bkf__muted">{menu.days ? `Served ${servingLine(menu.days)}` : menu.serving ? `Served ${hm(menu.serving.start)} to ${hm(menu.serving.end)}` : 'Served all day'}{menu.placeIds ? ` · at ${menu.placeIds.map((id) => biz.places.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'no place'}` : ''}{menu.tax ? ` · prices include ${menu.tax}% tax` : ''}{menu.service ? ` · ${menu.service}% service` : ''} · <Link onPress={() => setSettings(true)} weight="strong">Change</Link></p>
              {menu.sections.length === 0 && <EmptyState size="sm" icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="Set up your menu" description="Small plates, Mains, Desserts: then add items to each." action={<Button size="sm" variant="primary" onPress={() => setSection('new')}>Add section</Button>} />}
              <Structure onClear={() => setQuery('')} menu={menu} book={book} q={q} hitDish={hitDish} setMenu={setMenu} dishById={dishById} where={where} soldOut={soldOut} undoable={undoable}
                onEditSection={setSection} onSub={(sec, id) => setSub({ sec, id })} onDish={(d, group) => setDish({ dish: d, group })} />
              {menu.sections.length > 0 && !q && <button type="button" className="tf-bkf-menued__addsec" onClick={() => setSection('new')}><Plus {...i14} /> Add section</button>}
            </div>
            {preview(look, menu)}
          </div>
        ) : <EmptyState icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="No menus" description="Make one for each time you serve: Lunch, Dinner, Drinks." action={<Button variant="primary" onPress={() => setNaming(true)}>New menu</Button>} />}

      {dish && <DishDrawer key={dish.dish?.id ?? `new-${dish.group ?? ''}`} book={book} dish={dish.dish} currency={biz.currency} where={dish.dish ? where(dish.dish.id) : []} onClose={() => setDish(undefined)} onSoldOut={soldOut}
        onSave={(d, again) => {
          const isNew = !book.dishes.some((x) => x.id === d.id);
          const dishes = isNew ? [...book.dishes, d] : book.dishes.map((x) => (x.id === d.id ? d : x));
          const [secId, subId] = (dish.group ?? '').split('/');
          const menus = isNew && secId && menu ? book.menus.map((m) => (m.id === menu.id ? { ...m, sections: m.sections.map((s) => (s.id !== secId ? s : subId ? { ...s, subs: s.subs?.map((x) => (x.id === subId ? { ...x, dishIds: [...x.dishIds, d.id] } : x)) } : { ...s, dishIds: [...s.dishIds, d.id] })) } : m)) : book.menus;
          set({ dishes, menus });
          toast({ message: isNew ? `${d.name} added. Publish when you’re ready.` : `${d.name} saved. Publish when you’re ready.`, tone: 'success' });
          if (again) setDish({ group: dish.group }); else setDish(undefined);
        }}
        onDelete={dish.dish ? () => {
          const gone = dish.dish; if (!gone) return;
          set({ dishes: book.dishes.filter((x) => x.id !== gone.id), menus: book.menus.map((m) => ({ ...m, sections: m.sections.map((s) => ({ ...s, dishIds: s.dishIds.filter((x) => x !== gone.id), subs: s.subs?.map((y) => ({ ...y, dishIds: y.dishIds.filter((x) => x !== gone.id) })) })) })) });
          setDish(undefined); undoable(`${gone.name} deleted from every menu`);
        } : undefined}
        onAddOns={() => setAddOnsOpen(true)} />}
      {section && menu && <SectionDialog section={section === 'new' ? undefined : section} hours={menu.days ?? biz.places[0]?.hours} onClose={() => setSection(undefined)} onSave={(s) => {
        setMenu({ ...menu, sections: section === 'new' ? [...menu.sections, s] : menu.sections.map((x) => (x.id === s.id ? s : x)) }); setSection(undefined);
      }} />}
      {sub && menu && <NameDialog title={sub.id ? 'Rename sub section' : `New sub section in ${sub.sec.name}`} label="Name" placeholder="From the grill" initial={sub.sec.subs?.find((x) => x.id === sub.id)?.name} onClose={() => setSub(undefined)} onSave={(name) => {
        setMenu({ ...menu, sections: menu.sections.map((s) => (s.id !== sub.sec.id ? s : { ...s, subs: sub.id ? s.subs?.map((x) => (x.id === sub.id ? { ...x, name } : x)) : [...(s.subs ?? []), { id: nextId('sub'), name, dishIds: [] }] })) }); setSub(undefined);
      }} />}
      {settings && menu && <MenuSettings menu={menu} places={biz.places} hours={biz.places[0]?.hours} onClose={() => setSettings(false)} onSave={(m) => { setMenu(m); setSettings(false); toast({ message: 'Menu settings saved', tone: 'success' }); }} />}
      {addOnsOpen && <AddOnsDialog addOns={book.addOns} dishes={book.dishes} onClose={() => setAddOnsOpen(false)} onSave={(addOns) => { set({ addOns }); setAddOnsOpen(false); toast({ message: 'Add-ons saved', tone: 'success' }); }} />}
      {naming && <NameDialog title="New menu" label="Name" placeholder="Brunch" onClose={() => setNaming(false)} onSave={(name) => {
        const m: MenuT = { id: nextId('mn'), name, isLive: true, sections: [{ id: nextId('sec'), name: 'Mains', layout: 'list', dishIds: [] }], tax: menu?.tax, service: menu?.service };
        set({ menus: [...book.menus, m] }); setMenuId(m.id); setNaming(false); toast({ message: `${name} made with a first section`, tone: 'success' });
      }} />}
      {reviewing && <PublishReview state={state} book={book} menuUrl={menuUrl} firstPublish={firstPublish} onClose={() => setReviewing(false)}
        onFix={(fix) => { setReviewing(false); if (fix.kind === 'menu') { setMenuId(fix.id); setView('structure'); } else if (fix.kind === 'item') { const d = dishById(fix.id); if (d) setDish({ dish: d }); } else if (fix.kind === 'settings') { setMenuId(fix.id); setSettings(true); } else onTables(); }}
        onPublish={() => dispatch({ type: 'menu/publish' })} />}
      <ShareSheet isOpen={sharing} onOpenChange={setSharing} title="Share your menu" url={menuUrl} name="Menu" invite="Our menu:" description="For your site and socials. Each table has its own code under QR codes." onSite={() => { setSharing(false); void copyText(`<iframe src="https://${menuUrl}?embed=1" style="width:100%;min-height:720px;border:0" title="Menu"></iframe>`).then((ok) => toast(ok ? { message: 'Embed code copied. Paste it into your site’s HTML.', tone: 'success' } : { message: 'Copy didn’t work. Try again.', tone: 'danger' })); }} />
      {view !== 'design' && <PublishBar status={changes.length > 0 || firstPublish ? 'draft' : 'live'} changes={changes.length} message={firstPublish ? 'Not published yet' : undefined} onPublish={() => setReviewing(true)}
        onDiscard={firstPublish ? undefined : () => { const was = book; dispatch({ type: 'menu/discard' }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: was }) } }); }} />}
    </div>
  );
}

/** "Mon–Fri 12–4 PM, Sat–Sun 11 AM–4 PM", short. */
function servingLine(w: WeekHours): string {
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const on = keys.filter((k) => w[k].on);
  if (on.length === 0) return 'on no day';
  const c = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  const first = w[on[0] ?? 'mon'].ranges[0];
  const same = on.every((k) => JSON.stringify(w[k].ranges.map((r) => [r.start, r.end])) === JSON.stringify(w[on[0] ?? 'mon'].ranges.map((r) => [r.start, r.end])));
  return `${on.length === 7 ? 'every day' : on.map((k) => k[0]?.toUpperCase() + k.slice(1, 3)).join(', ')}${same && first ? ` ${c(first.start)}–${c(first.end)}` : ', hours vary'}`;
}

/** The menu's sections as cards (drag by the grip to order them), each with its items and sub sections; items drag between them. */
function Structure({ onClear, menu, book, q, hitDish, setMenu, dishById, where, soldOut, undoable, onEditSection, onSub, onDish }: {
  readonly onClear: () => void; readonly menu: MenuT; readonly book: MenuBook; readonly q: string; readonly hitDish: (d: MenuDish) => boolean; readonly setMenu: (m: MenuT) => void; readonly dishById: (id: string) => MenuDish | undefined;
  readonly where: (id: string) => ReadonlyArray<string>; readonly soldOut: (d: MenuDish, on: boolean) => void; readonly undoable: (message: string) => void;
  readonly onEditSection: (s: MenuSection) => void; readonly onSub: (sec: MenuSection, id?: string) => void; readonly onDish: (d: MenuDish | undefined, group: string) => void;
}) {
  // While searching: a section whose name matches shows whole; else only its matching items. Moving is off until the search is cleared.
  const shownIds = (sec: MenuSection, ids: ReadonlyArray<string>) => (!q || lc(sec.name).includes(q) ? ids : ids.filter((id) => { const d = dishById(id); return d ? hitDish(d) : false; }));
  const visible = menu.sections.filter((s) => !q || lc(s.name).includes(q) || [...s.dishIds, ...(s.subs ?? []).flatMap((x) => x.dishIds)].some((id) => { const d = dishById(id); return d ? hitDish(d) : false; }));
  if (q && visible.length === 0) return <NoResults query={q} noun="items" onClearFilters={onClear} />;
  const groups = Object.fromEntries(menu.sections.flatMap((s) => [[gid(s.id), s.dishIds], ...(s.subs ?? []).map((x) => [gid(s.id, x.id), x.dishIds] as const)]));
  const groupName = (g: string) => { const [a, b] = g.split('/'); const s = menu.sections.find((x) => x.id === a); return b ? `${s?.name} · ${s?.subs?.find((x) => x.id === b)?.name}` : s?.name ?? ''; };
  const moveItems = (next: Readonly<Record<string, ReadonlyArray<string>>>) => setMenu({ ...menu, sections: menu.sections.map((s) => ({ ...s, dishIds: next[gid(s.id)] ?? s.dishIds, subs: s.subs?.map((x) => ({ ...x, dishIds: next[gid(s.id, x.id)] ?? x.dishIds })) })) });
  const sectionMenu = (sec: MenuSection, si: number) => (
    <MenuTrigger>
      <IconButton size="sm" label={`More for ${sec.name}`}><MoreHorizontal {...i14} /></IconButton>
      <Menu aria-label={`${sec.name} actions`} placement="bottom end" onAction={(k) => {
        const move = (by: number) => { const s = [...menu.sections]; const [x] = s.splice(si, 1); if (x) s.splice(si + by, 0, x); setMenu({ ...menu, sections: s }); };
        if (k === 'edit') onEditSection(sec);
        else if (k === 'layout') setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, layout: s.layout === 'grid' ? 'list' : 'grid' } : s)) });
        else if (k === 'sub') onSub(sec);
        else if (k === 'up') move(-1); else if (k === 'down') move(1);
        else if (k === 'delete') { setMenu({ ...menu, sections: menu.sections.filter((s) => s.id !== sec.id) }); undoable(`${sec.name} deleted. Its items stay in your other sections.`); }
      }}>
        <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit section</MenuItem>
        <MenuItem id="layout">{sec.layout === 'grid' ? 'Show as a list' : 'Show as a photo grid'}</MenuItem>
        <MenuItem id="sub" icon={<Plus {...i16} />}>Add sub section</MenuItem>
        {si > 0 && <MenuItem id="up">Move up</MenuItem>}
        {si < menu.sections.length - 1 && <MenuItem id="down">Move down</MenuItem>}
        <MenuSeparator />
        <MenuItem id="delete" icon={<X {...i16} />} isDanger>Delete section</MenuItem>
      </Menu>
    </MenuTrigger>
  );
  const itemsOf = (sec: MenuSection, g: string, ids: ReadonlyArray<string>) => (
    <ItemGroup key={g} id={g} ids={shownIds(sec, ids)} label={groupName(g)} dishById={dishById} where={where} soldOut={soldOut} disabled={Boolean(q)}
      onOpen={(d) => onDish(d, g)} onNew={() => onDish(undefined, g)} book={book}
      onAdd={(id) => moveItems({ ...groups, [g]: [...ids, id] })}
      onMove={(d, by) => { const list = [...ids]; const i = list.indexOf(d.id); list.splice(i, 1); list.splice(i + by, 0, d.id); moveItems({ ...groups, [g]: list }); }}
      onOut={(d) => { moveItems({ ...groups, [g]: ids.filter((x) => x !== d.id) }); undoable(`${d.name} taken out of ${groupName(g)}`); }} />
  );
  return (
    <DragArea groups={{ [SECS]: visible.map((x) => x.id), ...groups }} groupName={(g) => (g === SECS ? 'the sections' : groupName(g))} kindOf={(g) => (g === SECS ? 'section' : 'item')}
      textOf={(id) => menu.sections.find((x) => x.id === id)?.name ?? dishById(id)?.name ?? 'item'}
      onChange={(next) => {
        const order = next[SECS] ?? [];
        const sections = [...order.map((id) => menu.sections.find((x) => x.id === id)).filter((x): x is MenuSection => Boolean(x)), ...menu.sections.filter((x) => !order.includes(x.id))];
        setMenu({ ...menu, sections: sections.map((x) => ({ ...x, dishIds: next[gid(x.id)] ?? x.dishIds, subs: x.subs?.map((y) => ({ ...y, dishIds: next[gid(x.id, y.id)] ?? y.dishIds })) })) });
      }}
      overlay={(id) => {
        const sec = menu.sections.find((x) => x.id === id);
        if (sec) return <div className="tf-bkf-card tf-bkf-menued__sec tf-bkf-menued__sec--lifted"><div className="tf-bkf-menued__head"><DragHandle label="" reveal="always" isLifted /><span className="tf-bkf-menued__titles"><h3 className="tf-bkf-menu__h">{sec.name}</h3></span><span className="tf-bkf__muted tf-num">{plural(sec.dishIds.length, 'item')}</span></div>
          <ul className="tf-bkf-dishes">{sec.dishIds.map(dishById).filter((x): x is MenuDish => Boolean(x)).map((x) => <li key={x.id} className="tf-bkf-dish tf-bkf-dish--drag"><span /><DishFace d={x} /><span className="tf-bkf-dish__open"><span className="tf-bkf-dish__name">{x.name}</span><span className="tf-bkf__muted tf-num">{dishPrice(x)}</span></span></li>)}</ul></div>;
        const d = dishById(id); return d ? <div className="tf-bkf-dish tf-bkf-dish--drag"><DragHandle label="" reveal="always" isLifted /><DishFace d={d} /><span className="tf-bkf-dish__open"><span className="tf-bkf-dish__name">{d.name}</span><span className="tf-bkf__muted tf-num">{dishPrice(d)}</span></span></div> : null;
      }}>
        {() => (
          <SectionList label={`${menu.name}, sections in order`}>
            {visible.map((sec) => { const si = menu.sections.indexOf(sec); return (
              <DragItem key={sec.id} id={sec.id} group={SECS} isDisabled={Boolean(q)} className="tf-bkf-card tf-bkf-menued__sec" aria-label={sec.name}>
                {(d) => <>
                  <div className="tf-bkf-menued__head">
                    {!q && <DragHandle label={`Move ${sec.name}`} isLifted={d.isDragging} drag={d.grip} />}
                    <span className="tf-bkf-menued__titles"><h3 className="tf-bkf-menu__h">{sec.name}</h3>{sec.description && <span className="tf-bkf__muted">{sec.description}</span>}</span>
                    <span className="tf-bkf__muted tf-num">{[(sec.subs ?? []).length ? plural((sec.subs ?? []).length, 'sub section') : '', plural(sec.dishIds.length + (sec.subs ?? []).reduce((n, x) => n + x.dishIds.length, 0), 'item'), sec.layout === 'grid' ? 'photo grid' : '', sec.days ? 'own times' : ''].filter(Boolean).join(' · ')}</span>
                    {sectionMenu(sec, si)}
                  </div>
                  {itemsOf(sec, gid(sec.id), sec.dishIds)}
                  {(sec.subs ?? []).map((x) => (
                    <div key={x.id} className="tf-bkf-menued__sub">
                      <div className="tf-bkf-menued__subhead"><span className="tf-bkf__label">{x.name}</span><span className="tf-bkf__spacer" />
                        <MenuTrigger>
                          <IconButton size="sm" label={`More for ${x.name}`}><MoreHorizontal {...i14} /></IconButton>
                          <Menu aria-label={`${x.name} actions`} placement="bottom end" onAction={(k) => {
                            if (k === 'rename') onSub(sec, x.id);
                            else if (k === 'delete') { setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, dishIds: [...s.dishIds, ...x.dishIds], subs: s.subs?.filter((y) => y.id !== x.id) } : s)) }); undoable(`${x.name} deleted. Its items moved up into ${sec.name}.`); }
                          }}>
                            <MenuItem id="rename" icon={<Pencil {...i16} />}>Rename</MenuItem>
                            <MenuItem id="delete" icon={<X {...i16} />} isDanger>Delete sub section</MenuItem>
                          </Menu>
                        </MenuTrigger></div>
                      {itemsOf(sec, gid(sec.id, x.id), x.dishIds)}
                    </div>
                  ))}
                </>}
              </DragItem>
            ); })}
          </SectionList>
        )}
    </DragArea>
  );
}

const SECS = 'sections';
/** The sections' own list: a group of the area, so sections land only among sections. */
function SectionList({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const drop = useDragGroup(SECS);
  return <DragGroup id={SECS}><ul ref={drop.ref} className="tf-bkf-menued__secs" aria-label={label}>{children}</ul></DragGroup>;
}

function DishFace({ d }: { readonly d: MenuDish }) {
  return d.photo ? <img className="tf-bkf-dish__img" src={d.photo} alt="" /> : <span className="tf-bkf-dish__img tf-bkf-dish__img--none" aria-hidden><UtensilsCrossed {...i14} /></span>;
}

/** One section's (or sub section's) items: drag by the grip, a quick Available switch, ⋯, and Add item at the foot. */
function ItemGroup({ id, ids, label, book, dishById, where, soldOut, disabled, onOpen, onNew, onAdd, onMove, onOut }: {
  readonly id: string; readonly ids: ReadonlyArray<string>; readonly label: string; readonly book: MenuBook; readonly dishById: (id: string) => MenuDish | undefined; readonly where: (id: string) => ReadonlyArray<string>;
  readonly soldOut: (d: MenuDish, on: boolean) => void; readonly disabled: boolean; readonly onOpen: (d: MenuDish) => void; readonly onNew: () => void; readonly onAdd: (id: string) => void;
  readonly onMove: (d: MenuDish, by: number) => void; readonly onOut: (d: MenuDish) => void;
}) {
  const drop = useDragGroup(id);
  return (
    <DragGroup id={id}>
      <ul ref={drop.ref} className="tf-bkf-dishes" aria-label={`${label} items`} data-over={drop.isOver || undefined}>
        {ids.map((did, di) => { const d = dishById(did); if (!d) return null; const also = where(d.id).length - 1; return (
          <DragItem key={did} id={did} group={id} isDisabled={disabled} className={cx('tf-bkf-dish tf-bkf-dish--drag', d.soldOut && 'is-out')}>
            {(r) => <>
              {disabled ? <span /> : <DragHandle label={`Move ${d.name}`} isLifted={r.isDragging} drag={r.grip} />}
              <DishFace d={d} />
              <button type="button" className="tf-bkf-dish__open" onClick={() => onOpen(d)} aria-label={`Edit ${d.name}`}>
                <span className="tf-bkf-dish__name">{d.name}{d.soldOut && <span className="tf-bkf-dish__out"> · Sold out</span>}</span>
                <span className="tf-bkf__muted tf-num">{[dishPrice(d) || 'No price', ...d.diet.map((x) => DIETS[x].label), d.sizes?.length ? plural(d.sizes.length, 'size') : '', also > 0 ? `also in ${plural(also, 'other section')}` : ''].filter(Boolean).join(' · ')}</span>
              </button>
              <Switch aria-label={`${d.name} available`} isSelected={!d.soldOut} onChange={(on) => soldOut(d, !on)}><span className="tf-bkf__onword">{d.soldOut ? 'Sold out' : 'Available'}</span></Switch>
              <MenuTrigger>
                <IconButton size="sm" label={`More for ${d.name}`}><MoreHorizontal {...i14} /></IconButton>
                <Menu aria-label={`${d.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'edit') onOpen(d); else if (k === 'up') onMove(d, -1); else if (k === 'down') onMove(d, 1); else if (k === 'out') onOut(d); }}>
                  <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit item</MenuItem>
                  {di > 0 && <MenuItem id="up">Move up</MenuItem>}
                  {di < ids.length - 1 && <MenuItem id="down">Move down</MenuItem>}
                  <MenuSeparator />
                  <MenuItem id="out" icon={<X {...i16} />}>Take out of {label}</MenuItem>
                </Menu>
              </MenuTrigger>
            </>}
          </DragItem>
        ); })}
        {!disabled && <li className="tf-bkf-dishes__add">
          <MenuTrigger>
            <Button size="sm" variant="ghost" icon={<Plus {...i14} />}>Add item</Button>
            <Menu aria-label={`Add an item to ${label}`} placement="bottom start" filterPlaceholder="Find an item you have" onAction={(k) => { const key = String(k); if (key === 'new') onNew(); else onAdd(key); }}>
              <MenuItem id="new" icon={<Plus {...i16} />}>New item</MenuItem>
              <MenuGroup title="Already on your menus">
                {book.dishes.filter((d) => !ids.includes(d.id)).map((d) => <MenuItem key={d.id} id={d.id} description={dishPrice(d)}>{d.name}</MenuItem>)}
              </MenuGroup>
            </Menu>
          </MenuTrigger>
        </li>}
      </ul>
    </DragGroup>
  );
}

/** Every item, in the order the menus read: photo and name, where it sits, price, the Available switch and ⋯. */
function ItemsTable({ onClear, book, q, onOpen, onSoldOut, onNew, onDelete }: { readonly onClear: () => void; readonly book: MenuBook; readonly q: string; readonly onOpen: (d: MenuDish) => void; readonly onSoldOut: (d: MenuDish, on: boolean) => void; readonly onNew: () => void; readonly onDelete: (d: MenuDish) => void }) {
  const order = [...new Set([...book.menus.flatMap((m) => m.sections.flatMap((s) => [...s.dishIds, ...(s.subs ?? []).flatMap((x) => x.dishIds)])), ...book.dishes.map((d) => d.id)])];
  const rows = order.map((id) => book.dishes.find((d) => d.id === id)).filter((d): d is MenuDish => Boolean(d) && (!q || lc(d?.name ?? '').includes(q) || lc(d?.description ?? '').includes(q)));
  const whereOf = (id: string) => book.menus.flatMap((m) => placesOf(m, id));
  return (
    <section className="tf-bkf-card" aria-label="All items">
      <div className="tf-bkf-menued__head"><span className="tf-bkf-menued__titles"><h3 className="tf-bkf-menu__h">All items</h3><span className="tf-bkf__muted tf-num">{book.dishes.filter((d) => !d.soldOut).length} available. Items are shared by every menu they sit on.</span></span>
        <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={onNew}>New item</Button></div>
      {rows.length === 0 ? <NoResults query={q} noun="items" onClearFilters={onClear} /> : (
        <table className="tf-bkf-items">
          <thead><tr><th scope="col">Item</th><th scope="col">Section</th><th scope="col">Price</th><th scope="col">Available</th><th scope="col"><span className="tf-bkf-items__sr">Actions</span></th></tr></thead>
          <tbody>{rows.map((d) => { const w = whereOf(d.id); return (
            <tr key={d.id} className={cx(d.soldOut && 'is-out')}>
              <td><button type="button" className="tf-bkf-items__open" onClick={() => onOpen(d)}><DishFace d={d} /><span className="tf-bkf-dish__name">{d.name}</span></button></td>
              <td className="tf-bkf__muted">{w[0] ?? 'On no menu'}{w.length > 1 ? ` +${w.length - 1}` : ''}</td>
              <td className={cx('tf-num', !dishPrice(d) && 'tf-bkf-items__noprice')}>{d.sizes?.length ? `${dishPrice(d)}` : dishPrice(d) || 'No price'}</td>
              <td><Switch aria-label={`${d.name} available`} isSelected={!d.soldOut} onChange={(on) => onSoldOut(d, !on)} /></td>
              <td><MenuTrigger>
                <IconButton size="sm" label={`More for ${d.name}`}><MoreHorizontal {...i14} /></IconButton>
                <Menu aria-label={`${d.name} actions`} placement="bottom end" onAction={(k) => { if (k === 'edit') onOpen(d); else if (k === 'delete') onDelete(d); }}>
                  <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit</MenuItem>
                  <MenuSeparator />
                  <MenuItem id="delete" icon={<X {...i16} />} isDanger>Delete</MenuItem>
                </Menu>
              </MenuTrigger></td>
            </tr>
          ); })}</tbody>
        </table>
      )}
    </section>
  );
}

/** The guest look: a preset, its three colours with an AA check, the face, the corners and a cover. Saved live, no Publish. */
function DesignPanel({ value, onChange }: { readonly value: MenuLook; readonly onChange: (l: MenuLook) => void }) {
  const [cropping, setCropping] = useState(false);
  const checks = menuLookChecks(value);
  const failing = checks.filter((c) => c.ratio < c.need);
  const tweak = (patch: Partial<MenuLook>) => onChange({ ...value, ...patch, preset: 'custom' });
  return (
    <div className="tf-bkf-menued__main">
      <section className="tf-bkf-card"><div className="tf-bkf__stack">
        <span className="tf-bkf__eyebrow">How your menu, reservation page and business page look to guests</span>
        <TileGrid label="Preset" value={value.preset} columns={3}
          items={[...MENU_LOOKS.map((l) => ({ id: l.id, title: l.title, description: l.description, icon: <LookChip ground={l.look.ground} text={l.look.text} accent={l.look.accent} /> })), { id: 'custom', title: 'Custom', description: 'Your own colours', icon: <LookChip ground={value.ground} text={value.text} accent={value.accent} /> }]}
          onChange={(id) => { const l = MENU_LOOKS.find((x) => x.id === id); if (l) onChange({ preset: l.id, ...l.look, cover: value.cover }); }} />
        {failing.length > 0 && <Callout tone="warning">{failing.map((c) => c.label).join(' and ')} {failing.length === 1 ? 'is' : 'are'} hard to read. Guests need {failing[0]?.need}:1; pick a {failing[0]?.id === 'text' ? 'darker text or lighter background' : 'stronger colour'}.</Callout>}
        <div className="tf-bkf-look__colours">
          <AccentPicker label="Background" use="ground" value={value.ground} onChange={(ground) => tweak({ ground })} swatches={[{ hex: '#FFFFFF', name: 'White' }, { hex: '#FBF6EE', name: 'Cream' }, { hex: '#F2F5EE', name: 'Sage' }, { hex: '#16130F', name: 'Night' }]} />
          <AccentPicker label="Text" use="plain" value={value.text} onChange={(text) => tweak({ text })} swatches={[{ hex: '#111111', name: 'Ink' }, { hex: '#2B2118', name: 'Espresso' }, { hex: '#1C2A1F', name: 'Forest' }, { hex: '#F4EEE4', name: 'Paper' }]} />
          <AccentPicker label="Buttons and chips" value={value.accent} onChange={(accent) => tweak({ accent })} />
        </div>
        <ul className="tf-bkf-look__checks" aria-label="Contrast checks">
          {checks.map((c) => <li key={c.id} data-ok={c.ratio >= c.need || undefined}>{c.ratio >= c.need ? <Check {...i14} aria-hidden /> : <TriangleAlert {...i14} aria-hidden />}<span>{c.label}</span><span className="tf-num">{c.ratio.toFixed(1)}:1 · {c.ratio >= c.need ? 'AA' : `needs ${c.need}:1`}</span></li>)}
        </ul>
        <div className="tf-bkf__pair">
          <Select label="Headings" value={value.heading ?? value.font} onChange={(k) => { const f = MENU_FONTS.find((x) => x.id === k); if (f) tweak({ heading: f.id }); }} items={fontItems()} searchable={false} />
          <Select label="Everything else" value={value.font} onChange={(k) => { const f = MENU_FONTS.find((x) => x.id === k); if (f) tweak({ font: f.id }); }} items={fontItems()} searchable={false} />
        </div>
        <div className="tf-bkf__pair">
          <div className="tf-bkf__group"><span className="tf-bkf__label">Corners</span><SegmentedControl aria-label="Corners" size="sm" selectedKey={value.corners} onSelectionChange={(k) => tweak({ corners: k === 'sharp' ? 'sharp' : k === 'round' ? 'round' : 'soft' })} items={[{ id: 'sharp', label: 'Sharp' }, { id: 'soft', label: 'Soft' }, { id: 'round', label: 'Round' }]} /></div>
        </div>
        <div className="tf-bkf__group"><span className="tf-bkf__label">Cover</span>
          {value.cover && <img className="tf-bkf-look__cover" src={value.cover} alt="The menu’s cover photo" />}
          <span className="tf-bkf__row"><Button size="sm" variant="secondary" onPress={() => setCropping(true)}>{value.cover ? 'Change cover' : 'Add a cover photo'}</Button>{value.cover && <Button size="sm" variant="ghost" onPress={() => onChange({ ...value, cover: undefined })}>Remove</Button>}</span></div>
      </div></section>
      {cropping && <PhotoCrop isOpen onOpenChange={setCropping} shape="wide" title="Cover photo" onSave={async (src, crop) => { const cover = await cropToDataUrl(src, crop, 1200); onChange({ ...value, cover }); setCropping(false); }} />}
    </div>
  );
}

function LookChip({ ground, text, accent }: { readonly ground: string; readonly text: string; readonly accent: string }) {
  return <svg className="tf-bkf-look__chip" viewBox="0 0 40 28" aria-hidden="true"><rect width="40" height="28" rx="6" fill={ground} stroke={text} strokeOpacity=".15" /><rect x="7" y="8" width="16" height="3" rx="1.5" fill={text} /><rect x="7" y="15" width="10" height="3" rx="1.5" fill={text} fillOpacity=".5" /><rect x="25" y="16" width="9" height="6" rx="3" fill={accent} /></svg>;
}

/** Review and publish: each check with Fix; with all passed, what goes live; then the live link with Copy and its QR code. */
function PublishReview({ state, book, menuUrl, firstPublish, onClose, onFix, onPublish }: {
  readonly state: BookingsState; readonly book: MenuBook; readonly menuUrl: string; readonly firstPublish: boolean; readonly onClose: () => void;
  readonly onFix: (f: { readonly kind: 'menu' | 'item' | 'settings' | 'hours'; readonly id: string }) => void; readonly onPublish: () => void;
}) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const biz = currentBiz(bizOf(state));
  const live = book.menus.filter((m) => m.isLive);
  const onMenus = new Set(book.menus.flatMap((m) => m.sections.flatMap((s) => [...s.dishIds, ...(s.subs ?? []).flatMap((x) => x.dishIds)])));
  const empty = live.find((m) => m.sections.every((s) => s.dishIds.length === 0 && (s.subs ?? []).every((x) => x.dishIds.length === 0)));
  const unpriced = book.dishes.find((d) => onMenus.has(d.id) && !dishPrice(d));
  const nowhere = live.find((m) => m.placeIds !== undefined && m.placeIds.length === 0);
  const checks = [
    { id: 'hours', ok: biz.places.every((p) => Object.values(p.hours).some((x) => x.on)), text: 'Opening hours are set', bad: 'Set your opening hours first', fix: { kind: 'hours' as const, id: '' } },
    { id: 'items', ok: !empty && onMenus.size > 0, text: 'Every menu on show has items', bad: `${empty?.name ?? 'A menu'} has no items yet`, fix: { kind: 'menu' as const, id: empty?.id ?? '' } },
    { id: 'priced', ok: !unpriced, text: 'Every item has a price', bad: `${unpriced?.name ?? 'An item'} has no price`, fix: { kind: 'item' as const, id: unpriced?.id ?? '' } },
    { id: 'served', ok: !nowhere, text: 'Every menu on show is served somewhere', bad: `${nowhere?.name ?? 'A menu'} isn’t served at any place`, fix: { kind: 'settings' as const, id: nowhere?.id ?? '' } },
  ];
  const blocked = checks.some((c) => !c.ok);
  const changes = menuChanges(state);
  const count = live.reduce((n, m) => n + new Set(m.sections.flatMap((s) => [...s.dishIds, ...(s.subs ?? []).flatMap((x) => x.dishIds)])).size, 0);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={done ? 'Your menu is live' : 'Review and publish'} description={done ? 'Guests see it now. Put the link anywhere, or print the code.' : firstPublish ? 'A quick check before guests see it.' : `${plural(changes.length, 'change')} since the last publish.`}
      actions={done ? <Button variant="primary" slot="close">Done</Button> : <><Button variant="ghost" slot="close">Not yet</Button><Button variant="primary" isDisabled={blocked} onPress={() => { onPublish(); setDone(true); }}>{firstPublish ? 'Publish & go live' : 'Publish'}</Button></>}>
      {done ? (
        <div className="tf-bkf-review__live">
          <QrCode value={`https://${menuUrl}`} label="QR code for your menu" size="sm" withLogo ground="paper" />
          <div className="tf-bkf__stack tf-bkf__stack--8"><strong className="tf-num">{menuUrl}</strong>
            <Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={() => { void copyText(`https://${menuUrl}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Your link is ${menuUrl}`, tone: 'danger' })); }}>Copy link</Button></div>
        </div>
      ) : (
        <div className="tf-bkf__stack tf-bkf__stack--12">
          <ul className="tf-bkf-review" aria-label="Checks">
            {checks.map((c) => <li key={c.id} data-ok={c.ok || undefined}>{c.ok ? <Check {...i16} aria-hidden /> : <TriangleAlert {...i16} aria-hidden />}<span>{c.ok ? c.text : c.bad}</span>{!c.ok && <Button size="sm" variant="secondary" onPress={() => onFix(c.fix)}>Fix</Button>}</li>)}
          </ul>
          {!blocked && <p className="tf-bkf__muted">Guests will see {plural(count, 'item')} on {live.map((m) => m.name).join(', ') || 'no menu'}.</p>}
        </div>
      )}
    </Dialog>
  );
}

function NameDialog({ title, label, placeholder, initial = '', onClose, onSave }: { readonly title: string; readonly label: string; readonly placeholder: string; readonly initial?: string; readonly onClose: () => void; readonly onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={title} actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave(name.trim())}>{initial ? 'Save' : 'Create'}</Button></>}>
      <TextField label={label} value={name} onChange={setName} placeholder={placeholder} autoFocus />
    </Dialog>
  );
}


function SectionDialog({ section, hours, onClose, onSave }: { readonly section?: MenuSection; readonly hours?: WeekHours; readonly onClose: () => void; readonly onSave: (s: MenuSection) => void }) {
  const [name, setName] = useState(section?.name ?? '');
  const [description, setDescription] = useState(section?.description ?? '');
  const [layout, setLayout] = useState<'list' | 'grid'>(section?.layout ?? 'list');
  const [days, setDays] = useState<WeekHours | undefined>(section?.days);
  return (
    <Dialog isOpen size={days ? 'wide' : undefined} onOpenChange={(o) => { if (!o) onClose(); }} title={section ? 'Edit section' : 'New section'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave({ id: section?.id ?? nextId('sec'), name: name.trim(), description: description.trim() || undefined, layout, dishIds: section?.dishIds ?? [], subs: section?.subs, days })}>{section ? 'Save' : 'Add section'}</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={name} onChange={setName} placeholder="Small plates" autoFocus />
        <TextField label="One line under it" aside="Optional" value={description} onChange={setDescription} placeholder="Cooked over olive wood" />
        <div className="tf-bkf__group"><span className="tf-bkf__label">Shown as</span>
          <SegmentedControl aria-label="Shown as" size="sm" selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'grid' ? 'grid' : 'list')} items={[{ id: 'list', label: 'A list' }, { id: 'grid', label: 'A photo grid' }]} />
        </div>
        <Switch isSelected={days !== undefined} onChange={(on) => setDays(on ? hours : undefined)}>Its own serving times</Switch>
        {days && <><p className="tf-bkf__muted">Inside the menu’s own times: a brunch section on weekends, a late bar list.</p><HoursEditor value={days} onChange={setDays} /></>}
      </div>
    </Dialog>
  );
}

/** One item, in the order a person fills it: name, description, price, photo; then what's in it; Add another and ⌘↵ for a run of items. */
function DishDrawer({ book, dish, currency, where, onClose, onSave, onDelete, onAddOns, onSoldOut }: {
  /** Sold out applies at once, like the row's switch; it never waits for Publish. */
  readonly onSoldOut?: (d: MenuDish, out: boolean) => void;
  readonly book: MenuBook; readonly dish?: MenuDish; readonly currency: string; readonly where: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (d: MenuDish, again: boolean) => void; readonly onDelete?: () => void; readonly onAddOns: () => void;
}) {
  const [blank] = useState<MenuDish>(() => ({ id: nextId('dish'), name: '', price: undefined, diet: [], allergens: [], addOnIds: [] }));
  const [d, setD] = useState<MenuDish>(dish ?? blank);
  const [pricing, setPricing] = useState<'one' | 'sizes' | 'note'>(d.sizes?.length ? 'sizes' : d.price === undefined && d.priceNote ? 'note' : 'one');
  const [tried, setTried] = useState(false);
  const [cropping, setCropping] = useState<string | 'new'>();
  const patch = (p: Partial<MenuDish>) => setD((x) => ({ ...x, ...p }));
  const contains = d.allergens.filter((a) => !a.may).map((a) => a.name); const may = d.allergens.filter((a) => a.may).map((a) => a.name);
  const sizes = d.sizes ?? [{ name: 'Glass', price: 0 }, { name: 'Bottle', price: 0 }];
  const finished: MenuDish = pricing === 'one' ? { ...d, sizes: undefined, priceNote: undefined } : pricing === 'sizes' ? { ...d, price: undefined, priceNote: undefined, sizes } : { ...d, price: undefined, sizes: undefined };
  const dirty = JSON.stringify(finished) !== JSON.stringify(dish ?? blank);
  const priced = pricing === 'one' ? (d.price ?? 0) > 0 : pricing === 'sizes' ? sizes.every((s) => s.name.trim() && s.price > 0) : Boolean(d.priceNote?.trim());
  const meat = ['Fish', 'Crustaceans', 'Molluscs'].filter((x) => contains.includes(x));
  const clash = d.diet.includes('vegan') && [...meat, ...['Milk', 'Eggs'].filter((x) => contains.includes(x))].length > 0 ? `Marked vegan but contains ${[...meat, ...['Milk', 'Eggs'].filter((x) => contains.includes(x))].join(', ').toLowerCase()}.`
    : d.diet.includes('vegetarian') && meat.length > 0 ? `Marked vegetarian but contains ${meat.join(', ').toLowerCase()}.`
      : d.diet.includes('gluten-free') && contains.includes('Gluten') ? 'Marked gluten free but contains gluten.' : undefined;
  const save = (again: boolean) => { setTried(true); if (d.name.trim() && priced) onSave({ ...finished, name: d.name.trim() }, again); };
  const keys = (e: ReactKeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(false); } };
  const money = { style: 'currency' as const, currency, maximumFractionDigits: 0 };
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={dish ? dish.name : d.name.trim() || 'New item'} subtitle={where.length ? `On ${where.join(', ')}` : 'Not on a menu yet'} width="lg"
      saveState={dirty ? 'dirty' : 'clean'} saveLabel={dish ? 'Save item' : 'Add item'} onSave={() => save(false)} onDiscard={onClose}
      footerStart={onDelete ? <Button variant="ghost" onPress={onDelete}>Delete item</Button> : <Button variant="ghost" icon={<Plus {...i14} />} isDisabled={!dirty} onPress={() => save(true)}>Add another</Button>}>
      <div className="tf-bkf-cards" onKeyDown={keys}>
        <section className="tf-bkf-card">
          <div className="tf-bkf__stack">
            <TextField label="Name" value={d.name} onChange={(name) => patch({ name })} autoFocus={!dish} placeholder="Wood-fired octopus" isInvalid={tried && !d.name.trim()} errorMessage="Give the item a name." />
            <TextArea label="Description" aside="Optional" rows={2} value={d.description ?? ''} onChange={(description) => patch({ description: description || undefined })} placeholder="What’s on the plate, in a line" />
            <div className="tf-bkf__group"><span className="tf-bkf__label">Pricing</span>
              <SegmentedControl aria-label="Pricing" size="sm" selectedKey={pricing} onSelectionChange={(k) => setPricing(k === 'sizes' ? 'sizes' : k === 'note' ? 'note' : 'one')} items={[{ id: 'one', label: 'One price' }, { id: 'sizes', label: 'Sizes' }, { id: 'note', label: 'Other' }]} />
            </div>
            {pricing === 'one' && <NumberField label="Price" value={d.price ?? 0} minValue={0} formatOptions={money} onChange={(n) => patch({ price: Number.isFinite(n) ? n : 0 })} isInvalid={tried && !priced} errorMessage="Add a price, or pick Other." />}
            {pricing === 'sizes' && (
              <div className="tf-bkf__stack tf-bkf__stack--8">
                {sizes.map((s, i) => (
                  <div key={i} className="tf-bkf-sizerow">
                    <TextField label={i === 0 ? 'Size' : undefined} aria-label={`Size ${i + 1}`} value={s.name} onChange={(name) => patch({ sizes: sizes.map((x, j) => (j === i ? { ...x, name } : x)) })} placeholder="Glass" />
                    <NumberField label={i === 0 ? 'Price' : undefined} aria-label={`Size ${i + 1} price`} value={s.price} minValue={0} formatOptions={money} onChange={(n) => patch({ sizes: sizes.map((x, j) => (j === i ? { ...x, price: Number.isFinite(n) ? n : 0 } : x)) })} />
                    <IconButton size="sm" label={`Remove ${s.name || 'size'}`} isDisabled={sizes.length <= 2} onPress={() => patch({ sizes: sizes.filter((_, j) => j !== i) })}><X {...i14} /></IconButton>
                  </div>
                ))}
                {sizes.length < 8 && <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => patch({ sizes: [...sizes, { name: '', price: 0 }] })}>Add size</Button>}
                {tried && !priced && <p className="tf-bkf-dishform__error" role="alert">Every size needs a name and a price.</p>}
              </div>
            )}
            {pricing === 'note' && <TextField label="Instead of a price" value={d.priceNote ?? ''} onChange={(priceNote) => patch({ priceNote })} placeholder="Market price" isInvalid={tried && !priced} errorMessage="Say what guests read instead." />}
            <div className="tf-bkf__group"><span className="tf-bkf__label">Photo</span>
              <div className="tf-bkf-dishform__photo">
                {d.photo ? <img src={d.photo} alt="" className="tf-bkf-dishform__img" /> : null}
                <span className="tf-bkf__row">
                  <Button size="sm" variant="secondary" onPress={() => setCropping(d.photo ? d.photo : 'new')}>{d.photo ? 'Change or adjust' : 'Add a photo'}</Button>
                  {d.photo && <Button size="sm" variant="ghost" onPress={() => patch({ photo: undefined })}>Remove</Button>}
                  {!d.photo && <Button size="sm" variant="ghost" onPress={() => patch({ photo: plate('#d9a066', '#6f8b5d') })}>Use a sample photo</Button>}
                </span>
              </div>
            </div>
          </div>
        </section>
        <section className="tf-bkf-card">
          <div className="tf-bkf__stack">
            <ChoiceChips label="Dietary" selectionMode="multiple" size="sm" selectedKeys={[...d.diet]} items={(Object.keys(DIETS) as Diet[]).map((x) => ({ id: x, label: DIETS[x].label }))}
              onSelectionChange={(k) => {
                const next = [...k].map(String) as Diet[];
                const newSpice = next.filter((x) => SPICE.includes(x) && !d.diet.includes(x));
                patch({ diet: newSpice.length ? next.filter((x) => !SPICE.includes(x) || newSpice.includes(x)) : next });
              }} />
            {clash && <Callout tone="warning">{clash} Check the marks or the allergens.</Callout>}
            <span className="tf-bkf-setting__pair">
              <Switch isSelected={Boolean(d.popular)} onChange={(popular) => patch({ popular })}>Popular</Switch>
              <Switch isSelected={!d.soldOut} onChange={(on) => { patch({ soldOut: !on }); if (dish && onSoldOut) onSoldOut(dish, !on); }}>Available</Switch>
            </span>
            {dish && d.soldOut !== dish.soldOut && <p className="tf-bkf__muted">Guests see the change at once.</p>}
            <ShowMore showLabel="Allergens, add-ons and calories" hideLabel="Fewer details" defaultExpanded={Boolean(dish && (d.allergens.length || d.addOnIds.length))}>
              <div className="tf-bkf__stack">
                <ChoiceChips label="Contains allergens" selectionMode="multiple" size="sm" selectedKeys={contains} items={ALLERGENS.map((x) => ({ id: x, label: x }))}
                  onSelectionChange={(k) => patch({ allergens: [...[...k].map((x) => ({ name: String(x) })), ...d.allergens.filter((a) => a.may && ![...k].includes(a.name))] })} />
                <ChoiceChips label="May contain" selectionMode="multiple" size="sm" selectedKeys={may} items={ALLERGENS.filter((x) => !contains.includes(x)).map((x) => ({ id: x, label: x }))}
                  onSelectionChange={(k) => patch({ allergens: [...d.allergens.filter((a) => !a.may), ...[...k].map((x) => ({ name: String(x), may: true }))] })} />
                <div className="tf-bkf__group">
                  <ChoiceChips label="Add-ons" selectionMode="multiple" size="sm" selectedKeys={[...d.addOnIds]} items={book.addOns.map((a) => ({ id: a.id, label: a.name }))} onSelectionChange={(k) => patch({ addOnIds: [...k].map(String).slice(0, 6) })} />
                  <Link onPress={onAddOns} weight="strong">Edit add-ons</Link>
                </div>
                <NumberField label="Calories" aside="Optional" value={d.calories ?? 0} minValue={0} onChange={(n) => patch({ calories: Number.isFinite(n) && n > 0 ? n : undefined })} unit="kcal" />
              </div>
            </ShowMore>
            <p className="tf-bkf__muted">⌘↵ saves from anywhere in the sheet.</p>
          </div>
        </section>
      </div>
      {cropping && <PhotoCrop isOpen onOpenChange={(o) => { if (!o) setCropping(undefined); }} shape="square" src={cropping === 'new' ? undefined : cropping} title="Item photo"
        onSave={async (src, crop) => { patch({ photo: await cropToDataUrl(src, crop, 480) }); setCropping(undefined); }} />}
    </Drawer>
  );
}

/** A menu's name, serving times per day, the places it's served, tax and service, and the foot line. */
function MenuSettings({ menu, places, hours, onClose, onSave }: { readonly menu: MenuT; readonly places: ReadonlyArray<{ readonly id: string; readonly name: string }>; readonly hours?: WeekHours; readonly onClose: () => void; readonly onSave: (m: MenuT) => void }) {
  const [m, setM] = useState(menu);
  const dirty = JSON.stringify(m) !== JSON.stringify(menu);
  const placeIds = m.placeIds ?? places.map((p) => p.id);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Menu settings" subtitle={menu.name} width="lg" saveState={dirty ? 'dirty' : 'clean'} onSave={() => onSave(m)} onDiscard={onClose}>
      <div className="tf-bkf-cards"><section className="tf-bkf-card"><div className="tf-bkf__stack">
        <TextField label="Name" value={m.name} onChange={(name) => setM({ ...m, name })} />
        <fieldset className="tf-bkf-menued__places"><legend className="tf-bkf__label">Served at</legend>
          {places.map((p) => <Checkbox key={p.id} isSelected={placeIds.includes(p.id)} onChange={(on) => setM({ ...m, placeIds: on ? [...placeIds, p.id] : placeIds.filter((x) => x !== p.id) })}>{p.name}</Checkbox>)}
          {placeIds.length === 0 && <span className="tf-bkf-dishform__error">Pick a place, or guests won’t find this menu.</span>}
        </fieldset>
        <Switch isSelected={m.days !== undefined || m.serving !== undefined} onChange={(on) => setM({ ...m, days: on ? hours : undefined, serving: undefined })}>Served at set times</Switch>
        {m.days && <><HoursSummary value={m.days} /><HoursEditor value={m.days} onChange={(days) => setM({ ...m, days })} /></>}
        {!m.days && m.serving && <p className="tf-bkf__muted">Served {hm(m.serving.start)} to {hm(m.serving.end)} every day. <Link onPress={() => hours && setM({ ...m, days: hours, serving: undefined })} weight="strong">Set it per day</Link></p>}
        <p className="tf-bkf__muted">{m.days || m.serving ? 'Outside these times guests still see it, marked with when it’s served.' : 'Shown all day, every day.'}</p>
        <div className="tf-bkf__pair">
          <NumberField label="Tax in your prices" value={m.tax ?? 0} minValue={0} maxValue={40} unit="%" onChange={(n) => setM({ ...m, tax: Number.isFinite(n) ? n : 0 })} />
          <NumberField label="Service added" value={m.service ?? 0} minValue={0} maxValue={30} unit="%" onChange={(n) => setM({ ...m, service: Number.isFinite(n) ? n : 0 })} />
        </div>
        <TextField label="A line at the foot" aside="Optional" value={m.note ?? ''} onChange={(note) => setM({ ...m, note: note || undefined })} placeholder="Our kitchen uses nuts and sesame." />
      </div></section></div>
    </Drawer>
  );
}

/** Add-on groups: shared by every dish that offers them. */
function AddOnsDialog({ addOns, dishes, onClose, onSave }: { readonly addOns: ReadonlyArray<MenuAddOn>; readonly dishes: ReadonlyArray<MenuDish>; readonly onClose: () => void; readonly onSave: (a: ReadonlyArray<MenuAddOn>) => void }) {
  const [list, setList] = useState(addOns);
  const set = (g: MenuAddOn) => setList((l) => l.map((x) => (x.id === g.id ? g : x)));
  const rule = (g: MenuAddOn) => (g.max === 1 ? (g.min > 0 ? 'one-req' : 'one') : 'many');
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title="Add-ons" description="Sides, extras and choices. One set can be on many dishes."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => onSave(list.filter((g) => g.name.trim() && g.options.length))}>Save</Button></>}>
      <div className="tf-bkf__stack">
        {list.map((g) => (
          <section key={g.id} className="tf-bkf-addon">
            <div className="tf-bkf-sizerow">
              <TextField aria-label="Add-on set name" value={g.name} onChange={(name) => set({ ...g, name })} placeholder="Sides" />
              <Select label="Rule" isLabelHidden value={rule(g)} onChange={(v) => set({ ...g, ...(v === 'one-req' ? { min: 1, max: 1 } : v === 'one' ? { min: 0, max: 1 } : { min: 0, max: Math.max(2, g.options.length) }) })}
                items={[{ id: 'one-req', label: 'Choose one (required)' }, { id: 'one', label: 'Choose one (optional)' }, { id: 'many', label: 'Choose any' }]} />
              <IconButton size="sm" label={`Remove ${g.name}`} onPress={() => setList((l) => l.filter((x) => x.id !== g.id))}><X {...i14} /></IconButton>
            </div>
            <span className="tf-bkf__muted">{plural(dishes.filter((d) => d.addOnIds.includes(g.id)).length, 'dish', 'dishes')} offer it</span>
            {g.options.map((o, i) => (
              <div key={i} className="tf-bkf-sizerow tf-bkf-addon__opt">
                <TextField aria-label="Option" value={o.name} onChange={(name) => set({ ...g, options: g.options.map((x, j) => (j === i ? { ...x, name } : x)) })} placeholder="Fries" />
                <NumberField aria-label="Price change" value={o.price} formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0, signDisplay: 'exceptZero' }} onChange={(n) => set({ ...g, options: g.options.map((x, j) => (j === i ? { ...x, price: Number.isFinite(n) ? n : 0 } : x)) })} />
                <IconButton size="sm" label={`Remove ${o.name || 'option'}`} onPress={() => set({ ...g, options: g.options.filter((_, j) => j !== i) })}><X {...i14} /></IconButton>
              </div>
            ))}
            {g.options.length < 20 && <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => set({ ...g, options: [...g.options, { name: '', price: 0 }] })}>Add option</Button>}
          </section>
        ))}
        <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setList((l) => [...l, { id: nextId('ao'), name: '', min: 0, max: 1, options: [{ name: '', price: 0 }] }])}>New add-on set</Button>
      </div>
    </Dialog>
  );
}

