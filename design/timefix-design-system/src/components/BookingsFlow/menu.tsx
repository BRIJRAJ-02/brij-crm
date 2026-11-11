// A restaurant's Menu: its menus (Lunch, Dinner, Drinks) as sections of dishes, edited as a draft beside a live preview and published
// when ready; Sold out and Hide apply at once. QR codes gives each table a code that opens timefix.com/<handle>/menu with the table set.
import { copyText } from '../../lib/copy.ts';
import { Link } from '../Link/Link.tsx';
import { useRef, useState } from 'react';
import { Copy, Download, Eye, MoreHorizontal, Pencil, Plus, QrCode as QrIcon, UtensilsCrossed, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Menu, MenuItem, MenuSection as MenuGroup, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { QrCode, downloadQr, qrSheet } from '../QrCode/QrCode.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { cx } from '../../lib/cx.ts';
import { ALLERGENS, DIETS, MenuPage, dishPrice, type Diet, type Menu as MenuT, type MenuAddOn, type MenuDish, type MenuSection } from '../MenuPage/MenuPage.tsx';
import { ScaledPreview, TabToolbar, i14, i16 } from './parts.tsx';
import { menuChanges, nextId, plural, tableMenuUrl, type BookingsAction, type BookingsState, type MenuBook, type Table, tableCode } from './state.ts';
import { plate } from './menu-seed.ts';

const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (v: string | null | undefined, d: number) => { if (!v) return d; const [h = '0', m = '0'] = v.split(':'); return Number(h) * 60 + Number(m); };
const SPICE: ReadonlyArray<Diet> = ['spicy-1', 'spicy-2', 'spicy-3'];

/** Props for MenuTab. */
export interface MenuTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  /** See the menu as a guest, from a table's code when given. */
  readonly onGuest: (table?: string) => void;
  /** Tables are kept in Availability. */
  readonly onTables: () => void;
}

/** The Menu tab. */
export function MenuTab({ state, dispatch, onGuest, onTables }: MenuTabProps) {
  const { toast } = useToast();
  const book = state.menu;
  const [view, setView] = useState<'dishes' | 'qr'>('dishes');
  const [menuId, setMenuId] = useState(book?.menus[0]?.id);
  const [dish, setDish] = useState<{ readonly dish?: MenuDish; readonly sectionId?: string }>();
  const [section, setSection] = useState<MenuSection | 'new'>();
  const [settings, setSettings] = useState(false);
  const [addOnsOpen, setAddOnsOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  if (!book) return <EmptyState icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="No menu yet" description="Add your dishes and share one link, or a QR code on every table." />;
  const menu = book.menus.find((m) => m.id === menuId) ?? book.menus[0];
  const changes = menuChanges(state);
  const set = (next: Partial<MenuBook>) => dispatch({ type: 'menu/draft', menu: { ...book, ...next } });
  const setMenu = (m: MenuT) => set({ menus: book.menus.map((x) => (x.id === m.id ? m : x)) });
  const dishById = (id: string) => book.dishes.find((d) => d.id === id);
  const where = (id: string) => book.menus.flatMap((m) => m.sections.filter((s) => s.dishIds.includes(id)).map((s) => `${m.name} › ${s.name}`));
  const soldOut = (d: MenuDish, on: boolean) => {
    dispatch({ type: 'dish/soldout', id: d.id, soldOut: on });
    toast({ message: on ? `${d.name} is sold out. Guests see it greyed.` : `${d.name} is back on`, action: { label: 'Undo', onAction: () => dispatch({ type: 'dish/soldout', id: d.id, soldOut: !on }) } });
  };
  const moveSection = (i: number, by: number) => { if (!menu) return; const s = [...menu.sections]; const [x] = s.splice(i, 1); if (x) s.splice(i + by, 0, x); setMenu({ ...menu, sections: s }); };
  const moveDish = (sec: MenuSection, i: number, by: number) => { if (!menu) return; const ids = [...sec.dishIds]; const [x] = ids.splice(i, 1); if (x) ids.splice(i + by, 0, x); setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, dishIds: ids } : s)) }); };
  const publish = () => { dispatch({ type: 'menu/publish' }); toast({ message: 'Published. Guests see the new menu now.', tone: 'success' }); };

  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          {menu && <Select label="Menu" isLabelHidden className="tf-bkf__whose" value={menu.id} onChange={(v) => { if (v === 'new') setNaming(true); else if (v) setMenuId(v); }}
            items={[...book.menus.map((m) => ({ id: m.id, label: m.isLive ? m.name : `${m.name} · hidden` })), { id: 'new', label: 'New menu…' }]} />}
          <SegmentedControl aria-label="View" size="sm" selectedKey={view} onSelectionChange={(k) => setView(k === 'qr' ? 'qr' : 'dishes')}
            items={[{ id: 'dishes', label: 'Dishes', icon: <UtensilsCrossed {...i14} /> }, { id: 'qr', label: 'QR codes', icon: <QrIcon {...i14} /> }]} />
        </>}
        count={changes.length > 0 ? `Not published: ${changes.join(', ')}` : 'Guests see what’s here'}
        action={<span className="tf-bkf-res__actions">
          <Button variant="secondary" icon={<Eye {...i14} />} onPress={() => onGuest()}>See it</Button>
          <Button variant="primary" isDisabled={changes.length === 0} onPress={publish}>Publish</Button>
          {menu && (
            <MenuTrigger>
              <IconButton label="More for this menu"><MoreHorizontal {...i16} /></IconButton>
              <Menu aria-label="Menu actions" placement="bottom end" onAction={(k) => {
                if (k === 'settings') setSettings(true);
                else if (k === 'addons') setAddOnsOpen(true);
                else if (k === 'show') { dispatch({ type: 'menu/show', id: menu.id, isLive: !menu.isLive }); toast({ message: menu.isLive ? `${menu.name} is hidden from guests` : `${menu.name} is on show`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/show', id: menu.id, isLive: menu.isLive }) } }); }
                else if (k === 'duplicate') { const copy: MenuT = { ...menu, id: nextId('mn'), name: `${menu.name} copy`, isLive: false, sections: menu.sections.map((s) => ({ ...s, id: nextId('sec') })) }; set({ menus: [...book.menus, copy] }); setMenuId(copy.id); toast({ message: `${copy.name} made, hidden until you show it`, tone: 'success' }); }
                else if (k === 'discard') { const before = book; dispatch({ type: 'menu/discard' }); toast({ message: 'Changes discarded', action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); }
                else if (k === 'delete') { const before = book; set({ menus: book.menus.filter((m) => m.id !== menu.id) }); setMenuId(book.menus.find((m) => m.id !== menu.id)?.id); toast({ message: `${menu.name} deleted. Publish to take it off.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); }
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

      {view === 'qr' ? <QrCodes state={state} dispatch={dispatch} onGuest={onGuest} onTables={onTables} /> : menu ? (
        <div className="tf-bkf-menued">
          <div className="tf-bkf-menued__main">
            {!menu.isLive && <Callout tone="warning" action={{ label: 'Show it', onPress: () => dispatch({ type: 'menu/show', id: menu.id, isLive: true }) }}>Guests can’t see {menu.name}.</Callout>}
            <p className="tf-bkf__muted">{menu.serving ? `Served ${hm(menu.serving.start)} to ${hm(menu.serving.end)}` : 'Served all day'}{menu.tax ? ` · prices include ${menu.tax}% tax` : ''}{menu.service ? ` · ${menu.service}% service` : ''} · <Link onPress={() => setSettings(true)} weight="strong">Change</Link></p>
            {menu.sections.length === 0 && <EmptyState size="sm" icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="Start with a section" description="Small plates, Mains, Desserts: then add dishes to each." action={<Button size="sm" variant="primary" onPress={() => setSection('new')}>Add section</Button>} />}
            {menu.sections.map((sec, si) => (
              <section key={sec.id} className="tf-bkf-card tf-bkf-menued__sec" aria-label={sec.name}>
                <div className="tf-bkf-menued__head">
                  <span className="tf-bkf-menued__titles"><h3 className="tf-bkf-menu__h">{sec.name}</h3>{sec.description && <span className="tf-bkf__muted">{sec.description}</span>}</span>
                  <span className="tf-bkf__muted tf-num">{plural(sec.dishIds.length, 'dish', 'dishes')}{sec.layout === 'grid' ? ' · photo grid' : ''}</span>
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${sec.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`${sec.name} actions`} placement="bottom end" onAction={(k) => {
                      if (k === 'edit') setSection(sec);
                      else if (k === 'layout') setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, layout: s.layout === 'grid' ? 'list' : 'grid' } : s)) });
                      else if (k === 'up') moveSection(si, -1);
                      else if (k === 'down') moveSection(si, 1);
                      else if (k === 'delete') { const before = book; setMenu({ ...menu, sections: menu.sections.filter((s) => s.id !== sec.id) }); toast({ message: `${sec.name} deleted. Its dishes stay in your other sections.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); }
                    }}>
                      <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit section</MenuItem>
                      <MenuItem id="layout">{sec.layout === 'grid' ? 'Show as a list' : 'Show as a photo grid'}</MenuItem>
                      {si > 0 && <MenuItem id="up">Move up</MenuItem>}
                      {si < menu.sections.length - 1 && <MenuItem id="down">Move down</MenuItem>}
                      <MenuSeparator />
                      <MenuItem id="delete" icon={<X {...i16} />} isDanger>Delete section</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
                <ul className="tf-bkf-dishes">
                  {sec.dishIds.map((id, di) => {
                    const d = dishById(id);
                    if (!d) return null;
                    const also = where(d.id).length - 1;
                    return (
                      <li key={id} className={cx('tf-bkf-dish', d.soldOut && 'is-out')}>
                        {d.photo ? <img className="tf-bkf-dish__img" src={d.photo} alt="" /> : <span className="tf-bkf-dish__img" aria-hidden />}
                        <button type="button" className="tf-bkf-dish__open" onClick={() => setDish({ dish: d })} aria-label={`Edit ${d.name}`}>
                          <span className="tf-bkf-dish__name">{d.name}</span>
                          <span className="tf-bkf__muted tf-num">{[dishPrice(d), ...d.diet.map((x) => DIETS[x].label), d.popular ? 'Popular' : '', also > 0 ? `also in ${plural(also, 'other section')}` : ''].filter(Boolean).join(' · ')}</span>
                        </button>
                        <Switch aria-label={`${d.name} available`} isSelected={!d.soldOut} onChange={(on) => soldOut(d, !on)}><span className="tf-bkf__onword">{d.soldOut ? 'Sold out' : 'Available'}</span></Switch>
                        <MenuTrigger>
                          <IconButton size="sm" label={`More for ${d.name}`}><MoreHorizontal {...i14} /></IconButton>
                          <Menu aria-label={`${d.name} actions`} placement="bottom end" onAction={(k) => {
                            if (k === 'edit') setDish({ dish: d });
                            else if (k === 'up') moveDish(sec, di, -1);
                            else if (k === 'down') moveDish(sec, di, 1);
                            else if (k === 'out') { const before = book; setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, dishIds: s.dishIds.filter((x) => x !== id) } : s)) }); toast({ message: `${d.name} taken out of ${sec.name}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } }); }
                          }}>
                            <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit dish</MenuItem>
                            {di > 0 && <MenuItem id="up">Move up</MenuItem>}
                            {di < sec.dishIds.length - 1 && <MenuItem id="down">Move down</MenuItem>}
                            <MenuSeparator />
                            <MenuItem id="out" icon={<X {...i16} />}>Take out of {sec.name}</MenuItem>
                          </Menu>
                        </MenuTrigger>
                      </li>
                    );
                  })}
                </ul>
                <MenuTrigger>
                  <Button size="sm" variant="ghost" icon={<Plus {...i14} />}>Add dish</Button>
                  <Menu aria-label={`Add a dish to ${sec.name}`} placement="bottom start" filterPlaceholder="Find a dish you have" onAction={(k) => {
                    const key = String(k);
                    if (key === 'new') setDish({ sectionId: sec.id });
                    else setMenu({ ...menu, sections: menu.sections.map((s) => (s.id === sec.id ? { ...s, dishIds: [...s.dishIds, key] } : s)) });
                  }}>
                    <MenuItem id="new" icon={<Plus {...i16} />}>New dish</MenuItem>
                    <MenuGroup title="Already on your menus">
                      {book.dishes.filter((d) => !sec.dishIds.includes(d.id)).map((d) => <MenuItem key={d.id} id={d.id} description={dishPrice(d)}>{d.name}</MenuItem>)}
                    </MenuGroup>
                  </Menu>
                </MenuTrigger>
              </section>
            ))}
            {menu.sections.length > 0 && <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setSection('new')}>Add section</Button>}
          </div>
          <aside className="tf-bkf-menued__preview" aria-label="What guests see">
            <span className="tf-bkf__eyebrow"><Eye {...i14} aria-hidden /> What guests see</span>
            <div className="tf-bkf-menued__phone">
              <ScaledPreview label="Menu preview" designWidth={390}>
                <MenuPage venue={state.workspace} line={state.business?.area} menus={[{ ...menu, isLive: true }]} dishes={book.dishes} addOns={book.addOns} now={menu.serving?.start ?? 13 * 60} isPreview />
              </ScaledPreview>
            </div>
          </aside>
        </div>
      ) : <EmptyState icon={<UtensilsCrossed size={20} strokeWidth={1.75} />} title="No menus" description="Make one for each time you serve: Lunch, Dinner, Drinks." action={<Button variant="primary" onPress={() => setNaming(true)}>New menu</Button>} />}

      {dish && <DishDrawer book={book} dish={dish.dish} where={dish.dish ? where(dish.dish.id) : []} onClose={() => setDish(undefined)} onSoldOut={soldOut}
        onSave={(d) => {
          const isNew = !book.dishes.some((x) => x.id === d.id);
          const dishes = isNew ? [...book.dishes, d] : book.dishes.map((x) => (x.id === d.id ? d : x));
          const menus = isNew && dish.sectionId && menu ? book.menus.map((m) => (m.id === menu.id ? { ...m, sections: m.sections.map((s) => (s.id === dish.sectionId ? { ...s, dishIds: [...s.dishIds, d.id] } : s)) } : m)) : book.menus;
          set({ dishes, menus }); setDish(undefined);
          toast({ message: isNew ? `${d.name} added. Publish when you’re ready.` : `${d.name} saved. Publish when you’re ready.`, tone: 'success' });
        }}
        onDelete={dish.dish ? () => {
          const gone = dish.dish; if (!gone) return; const before = book;
          set({ dishes: book.dishes.filter((x) => x.id !== gone.id), menus: book.menus.map((m) => ({ ...m, sections: m.sections.map((s) => ({ ...s, dishIds: s.dishIds.filter((x) => x !== gone.id) })) })) });
          setDish(undefined); toast({ message: `${gone.name} deleted from every menu`, action: { label: 'Undo', onAction: () => dispatch({ type: 'menu/draft', menu: before }) } });
        } : undefined}
        onAddOns={() => setAddOnsOpen(true)} />}
      {section && menu && <SectionDialog section={section === 'new' ? undefined : section} onClose={() => setSection(undefined)} onSave={(s) => {
        setMenu({ ...menu, sections: section === 'new' ? [...menu.sections, s] : menu.sections.map((x) => (x.id === s.id ? s : x)) }); setSection(undefined);
      }} />}
      {settings && menu && <MenuSettings menu={menu} onClose={() => setSettings(false)} onSave={(m) => { setMenu(m); setSettings(false); toast({ message: 'Menu settings saved', tone: 'success' }); }} />}
      {addOnsOpen && <AddOnsDialog addOns={book.addOns} dishes={book.dishes} onClose={() => setAddOnsOpen(false)} onSave={(addOns) => { set({ addOns }); setAddOnsOpen(false); toast({ message: 'Add-ons saved', tone: 'success' }); }} />}
      {naming && <NameDialog title="New menu" label="Name" placeholder="Brunch" onClose={() => setNaming(false)} onSave={(name) => {
        const m: MenuT = { id: nextId('mn'), name, isLive: true, sections: [], tax: menu?.tax, service: menu?.service };
        set({ menus: [...book.menus, m] }); setMenuId(m.id); setNaming(false);
      }} />}
    </div>
  );
}

function NameDialog({ title, label, placeholder, onClose, onSave }: { readonly title: string; readonly label: string; readonly placeholder: string; readonly onClose: () => void; readonly onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={title} actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave(name.trim())}>Create</Button></>}>
      <TextField label={label} value={name} onChange={setName} placeholder={placeholder} autoFocus />
    </Dialog>
  );
}

function SectionDialog({ section, onClose, onSave }: { readonly section?: MenuSection; readonly onClose: () => void; readonly onSave: (s: MenuSection) => void }) {
  const [name, setName] = useState(section?.name ?? '');
  const [description, setDescription] = useState(section?.description ?? '');
  const [layout, setLayout] = useState<'list' | 'grid'>(section?.layout ?? 'list');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={section ? 'Edit section' : 'New section'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave({ id: section?.id ?? nextId('sec'), name: name.trim(), description: description.trim() || undefined, layout, dishIds: section?.dishIds ?? [] })}>{section ? 'Save' : 'Add section'}</Button></>}>
      <div className="tf-bkf__stack">
        <TextField label="Name" value={name} onChange={setName} placeholder="Small plates" autoFocus />
        <TextField label="One line under it" aside="Optional" value={description} onChange={setDescription} placeholder="Cooked over olive wood" />
        <div className="tf-bkf__group"><span className="tf-bkf__label">Shown as</span>
          <SegmentedControl aria-label="Shown as" size="sm" selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'grid' ? 'grid' : 'list')} items={[{ id: 'list', label: 'A list' }, { id: 'grid', label: 'A photo grid' }]} />
        </div>
      </div>
    </Dialog>
  );
}

/** One dish: what guests read first, then allergens, add-ons and calories behind a fold. */
function DishDrawer({ book, dish, where, onClose, onSave, onDelete, onAddOns, onSoldOut }: {
  /** Sold out applies at once, like the row's switch; it never waits for Publish. */
  readonly onSoldOut?: (d: MenuDish, out: boolean) => void;
  readonly book: MenuBook; readonly dish?: MenuDish; readonly where: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (d: MenuDish) => void; readonly onDelete?: () => void; readonly onAddOns: () => void;
}) {
  const blank: MenuDish = { id: nextId('dish'), name: '', price: undefined, diet: [], allergens: [], addOnIds: [] };
  const [d, setD] = useState<MenuDish>(dish ?? blank);
  const [pricing, setPricing] = useState<'one' | 'sizes' | 'note'>(d.sizes?.length ? 'sizes' : d.price === undefined && d.priceNote ? 'note' : 'one');
  const patch = (p: Partial<MenuDish>) => setD((x) => ({ ...x, ...p }));
  const contains = d.allergens.filter((a) => !a.may).map((a) => a.name); const may = d.allergens.filter((a) => a.may).map((a) => a.name);
  const sizes = d.sizes ?? [{ name: 'Glass', price: 0 }, { name: 'Bottle', price: 0 }];
  const finished: MenuDish = pricing === 'one' ? { ...d, sizes: undefined, priceNote: undefined } : pricing === 'sizes' ? { ...d, price: undefined, priceNote: undefined, sizes } : { ...d, price: undefined, sizes: undefined };
  const dirty = JSON.stringify(finished) !== JSON.stringify(dish ?? blank);
  const priced = pricing === 'one' ? (d.price ?? 0) > 0 : pricing === 'sizes' ? sizes.every((s) => s.name.trim() && s.price > 0) : Boolean(d.priceNote?.trim());
  // Marks that disagree with what's in the dish.
  const meat = ['Fish', 'Crustaceans', 'Molluscs'].filter((x) => contains.includes(x));
  const clash = d.diet.includes('vegan') && [...meat, ...['Milk', 'Eggs'].filter((x) => contains.includes(x))].length > 0 ? `Marked vegan but contains ${[...meat, ...['Milk', 'Eggs'].filter((x) => contains.includes(x))].join(', ').toLowerCase()}.`
    : d.diet.includes('vegetarian') && meat.length > 0 ? `Marked vegetarian but contains ${meat.join(', ').toLowerCase()}.`
      : d.diet.includes('gluten-free') && contains.includes('Gluten') ? 'Marked gluten free but contains gluten.' : undefined;
  const readPhoto = (files: readonly File[]) => { const f = files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { if (typeof r.result === 'string') patch({ photo: r.result }); }; r.readAsDataURL(f); };
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={dish ? dish.name : 'New dish'} subtitle={where.length ? `On ${where.join(', ')}` : 'Not on a menu yet'} width="lg"
      saveState={dirty ? 'dirty' : 'clean'} saveLabel={dish ? 'Save dish' : 'Add dish'} onSave={() => { if (d.name.trim() && priced) onSave({ ...finished, name: d.name.trim() }); }} onDiscard={onClose}
      footerStart={onDelete && <Button variant="ghost" onPress={onDelete}>Delete dish</Button>}>
      <div className="tf-bkf-cards">
        <section className="tf-bkf-card">
          <div className="tf-bkf__stack">
            <div className="tf-bkf-dishform__top">
              <div className="tf-bkf-dishform__photo">
                {d.photo ? <img src={d.photo} alt="" className="tf-bkf-dishform__img" /> : <FileDrop variant="compact" label="Add a photo" allowsMultiple={false} acceptedFileTypes={['image/png', 'image/jpeg', 'image/webp']} onFiles={readPhoto} />}
                {d.photo && <span className="tf-bkf__row"><Button size="sm" variant="ghost" onPress={() => patch({ photo: undefined })}>Remove</Button>{!dish && <Button size="sm" variant="ghost" onPress={() => patch({ photo: plate('#d9a066', '#6f8b5d') })}>Use a sample</Button>}</span>}
                {!d.photo && <Button size="sm" variant="ghost" onPress={() => patch({ photo: plate('#d9a066', '#6f8b5d') })}>Use a sample photo</Button>}
              </div>
              <div className="tf-bkf__stack">
                <TextField label="Name" value={d.name} onChange={(name) => patch({ name })} autoFocus={!dish} placeholder="Wood-fired octopus" isInvalid={dirty && !d.name.trim()} />
                <TextArea label="Description" aside="Optional" rows={2} value={d.description ?? ''} onChange={(description) => patch({ description: description || undefined })} placeholder="What’s on the plate, in a line" />
              </div>
            </div>
            <div className="tf-bkf__group"><span className="tf-bkf__label">Pricing</span>
              <SegmentedControl aria-label="Pricing" size="sm" selectedKey={pricing} onSelectionChange={(k) => setPricing(k === 'sizes' ? 'sizes' : k === 'note' ? 'note' : 'one')} items={[{ id: 'one', label: 'One price' }, { id: 'sizes', label: 'Sizes' }, { id: 'note', label: 'No price' }]} />
            </div>
            {pricing === 'one' && <NumberField label="Price" value={d.price ?? 0} minValue={0} formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }} onChange={(n) => patch({ price: Number.isFinite(n) ? n : 0 })} />}
            {pricing === 'sizes' && (
              <div className="tf-bkf__stack tf-bkf__stack--8">
                {sizes.map((s, i) => (
                  <div key={i} className="tf-bkf-sizerow">
                    <TextField label={i === 0 ? 'Size' : undefined} aria-label={`Size ${i + 1}`} value={s.name} onChange={(name) => patch({ sizes: sizes.map((x, j) => (j === i ? { ...x, name } : x)) })} placeholder="Glass" />
                    <NumberField label={i === 0 ? 'Price' : undefined} aria-label={`Size ${i + 1} price`} value={s.price} minValue={0} formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }} onChange={(n) => patch({ sizes: sizes.map((x, j) => (j === i ? { ...x, price: Number.isFinite(n) ? n : 0 } : x)) })} />
                    <IconButton size="sm" label={`Remove ${s.name || 'size'}`} isDisabled={sizes.length <= 2} onPress={() => patch({ sizes: sizes.filter((_, j) => j !== i) })}><X {...i14} /></IconButton>
                  </div>
                ))}
                {sizes.length < 8 && <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => patch({ sizes: [...sizes, { name: '', price: 0 }] })}>Add size</Button>}
              </div>
            )}
            {pricing === 'note' && <TextField label="Instead of a price" value={d.priceNote ?? ''} onChange={(priceNote) => patch({ priceNote })} placeholder="Market price" />}
            <ChoiceChips label="Dietary" selectionMode="multiple" size="sm" selectedKeys={[...d.diet]} items={(Object.keys(DIETS) as Diet[]).map((x) => ({ id: x, label: DIETS[x].label }))}
              onSelectionChange={(k) => {
                const next = [...k].map(String) as Diet[];
                // One spice level: the newest wins.
                const newSpice = next.filter((x) => SPICE.includes(x) && !d.diet.includes(x));
                patch({ diet: newSpice.length ? next.filter((x) => !SPICE.includes(x) || newSpice.includes(x)) : next });
              }} />
            <span className="tf-bkf-setting__pair">
              <Switch isSelected={Boolean(d.popular)} onChange={(popular) => patch({ popular })}>Mark as popular</Switch>
              <Switch isSelected={!d.soldOut} onChange={(on) => { patch({ soldOut: !on }); if (dish && onSoldOut) onSoldOut(dish, !on); }}>Available today</Switch>
            </span>
            {clash && <Callout tone="warning">{clash} Check the marks or the allergens.</Callout>}
            <ShowMore showLabel="Allergens, add-ons and calories" hideLabel="Fewer details" defaultExpanded={Boolean(dish && (d.allergens.length || d.addOnIds.length))}>
              <div className="tf-bkf__stack">
                <ChoiceChips label="Contains" selectionMode="multiple" size="sm" selectedKeys={contains} items={ALLERGENS.map((x) => ({ id: x, label: x }))}
                  onSelectionChange={(k) => patch({ allergens: [...[...k].map((x) => ({ name: String(x) })), ...d.allergens.filter((a) => a.may && ![...k].includes(a.name))] })} />
                <ChoiceChips label="May contain traces" selectionMode="multiple" size="sm" selectedKeys={may} items={ALLERGENS.filter((x) => !contains.includes(x)).map((x) => ({ id: x, label: x }))}
                  onSelectionChange={(k) => patch({ allergens: [...d.allergens.filter((a) => !a.may), ...[...k].map((x) => ({ name: String(x), may: true }))] })} />
                <div className="tf-bkf__group">
                  <ChoiceChips label="Add-ons" selectionMode="multiple" size="sm" selectedKeys={[...d.addOnIds]} items={book.addOns.map((a) => ({ id: a.id, label: a.name }))} onSelectionChange={(k) => patch({ addOnIds: [...k].map(String).slice(0, 6) })} />
                  <Link onPress={onAddOns} weight="strong">Edit add-ons</Link>
                </div>
                <NumberField label="Calories" aside="Optional" value={d.calories ?? 0} minValue={0} onChange={(n) => patch({ calories: Number.isFinite(n) && n > 0 ? n : undefined })} unit="kcal" />
              </div>
            </ShowMore>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function MenuSettings({ menu, onClose, onSave }: { readonly menu: MenuT; readonly onClose: () => void; readonly onSave: (m: MenuT) => void }) {
  const [m, setM] = useState(menu);
  const dirty = JSON.stringify(m) !== JSON.stringify(menu);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Menu settings" subtitle={menu.name} saveState={dirty ? 'dirty' : 'clean'} onSave={() => onSave(m)} onDiscard={onClose}>
      <div className="tf-bkf-cards"><section className="tf-bkf-card"><div className="tf-bkf__stack">
        <TextField label="Name" value={m.name} onChange={(name) => setM({ ...m, name })} />
        <Switch isSelected={m.serving !== undefined} onChange={(on) => setM({ ...m, serving: on ? { start: 12 * 60, end: 16 * 60 } : undefined })}>Served at set times</Switch>
        {m.serving && (
          <div className="tf-bkf__pair">
            <TimeSelect label="From" value={hm(m.serving.start)} onChange={(v) => setM({ ...m, serving: { start: mins(v, 720), end: m.serving?.end ?? 960 } })} hourCycle={12} step={30} />
            <TimeSelect label="Until" value={hm(m.serving.end)} onChange={(v) => setM({ ...m, serving: { start: m.serving?.start ?? 720, end: mins(v, 960) } })} hourCycle={12} step={30} />
          </div>
        )}
        <p className="tf-bkf__muted">{m.serving ? 'Outside these times guests still see it, marked with when it’s served.' : 'Shown all day.'}</p>
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

/** A code on every table: scanning opens the menu with the table set, so staff know where the guest sits. */
function QrCodes({ state, dispatch, onGuest, onTables }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly onGuest: (table?: string) => void; readonly onTables: () => void }) {
  const { toast } = useToast();
  const tables = state.tables ?? [];
  const areas = [...new Set(tables.map((t) => t.area))];
  const refs = useRef<Record<string, SVGSVGElement | null>>({});
  const [renew, setRenew] = useState<Table>();
  const live = (state.menuLive?.menus ?? []).some((m) => m.isLive);
  const saved = (o: string) => { if (o === 'saved') toast({ message: 'Saved to your downloads', tone: 'success' }); else if (o === 'failed') toast({ message: 'Couldn’t save the file. Try again.' }); };
  const all = async () => {
    const codes = tables.flatMap((t) => { const svg = refs.current[t.id]; return svg ? [{ svg, label: t.name, line: 'Scan for the menu' }] : []; });
    saved(await saveFile(`${state.business?.handle ?? 'menu'}-table-codes.svg`, new Blob([qrSheet(codes, `${state.workspace} · table codes`)], { type: 'image/svg+xml' })));
  };
  if (tables.length === 0) return <EmptyState icon={<QrIcon size={20} strokeWidth={1.75} />} title="No tables yet" description="Add your tables, then print a code for each." action={<Button variant="primary" onPress={onTables}>Add tables</Button>} />;
  return (
    <div className="tf-bkf__stack">
      {!live && <Callout tone="warning">No menu is on show, so a scan opens an empty page. Show a menu first.</Callout>}
      <div className="tf-bkf__bar">
        <span className="tf-bkf__muted">Guests scan to open the menu with their table set. {plural(tables.length, 'table')}.</span>
        <span className="tf-bkf__spacer" />
        <Button variant="ghost" onPress={onTables}>Edit tables</Button>
        <Button variant="secondary" icon={<Download {...i14} />} onPress={() => { void all(); }}>Download all</Button>
      </div>
      {areas.map((a) => (
        <section key={a} className="tf-bkf-qrarea" aria-label={a}>
          <h3 className="tf-bkf-res-group__h"><span>{a}</span><span className="tf-bkf__muted tf-num">{plural(tables.filter((t) => t.area === a).length, 'table')}</span></h3>
          <ul className="tf-bkf-qrgrid">
            {tables.filter((t) => t.area === a).map((t) => (
              <li key={t.id} className="tf-bkf-qrcard">
                <QrCode value={`https://${tableMenuUrl(state, t)}`} label={`QR code for ${t.name}'s menu`} size="sm" withLogo ground="paper" ref={(el) => { refs.current[t.id] = el; }} />
                <span className="tf-bkf-qrcard__text"><strong>{t.name}</strong><span className="tf-bkf__muted tf-num">{plural(t.seats, 'seat')}</span></span>
                <span className="tf-bkf-res__acts">
                  <IconButton size="sm" label={`Download ${t.name}'s code`} onPress={() => { const svg = refs.current[t.id]; if (svg) void downloadQr(svg, `${t.name}-menu`, 'svg').then(saved); }}><Download {...i14} /></IconButton>
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${t.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`${t.name} code`} placement="bottom end" onAction={(k) => {
                      if (k === 'open') onGuest(t.code ?? t.name);
                      else if (k === 'copy') { void copyText(`https://${tableMenuUrl(state, t)}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: ${`https://${tableMenuUrl(state, t)}`}`, tone: 'danger' })); }
                      else if (k === 'png') { const svg = refs.current[t.id]; if (svg) void downloadQr(svg, `${t.name}-menu`, 'png').then(saved); }
                      else if (k === 'renew') setRenew(t);
                    }}>
                      <MenuItem id="open" icon={<Eye {...i16} />}>Scan it as a guest</MenuItem>
                      <MenuItem id="copy" icon={<Copy {...i16} />} description={tableMenuUrl(state, t)}>Copy link</MenuItem>
                      <MenuItem id="png" icon={<Download {...i16} />}>Download PNG</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="renew" icon={<QrIcon {...i16} />}>New code…</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {renew && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setRenew(undefined); }} title={`New code for ${renew.name}?`} description="The printed code on this table stops working. Print the new one before you put it out."
          actions={<><Button variant="ghost" slot="close">Keep this code</Button><Button variant="danger" onPress={() => {
            dispatch({ type: 'tables/set', tables: tables.map((x) => (x.id === renew.id ? { ...x, code: tableCode(x.name) } : x)) });
            setRenew(undefined); toast({ message: `${renew.name} has a new code. Download it to print.`, tone: 'success' });
          }}>Make a new code</Button></>} />
      )}
    </div>
  );
}
