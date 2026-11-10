// Booking pages for a business: its own page first (timefix.com/<handle>), then what it books, laid out like Fresha's service menu:
// categories on the left, a card a service on the right with its colour, length, price and link.
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Copy, ExternalLink, Pencil, Plus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { HoursEditor } from '../HoursEditor/HoursEditor.tsx';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { cx } from '../../lib/cx.ts';
import { OnSwitch, PageMoreMenu, ShareMenu, TabToolbar, i14, type ShareHow } from './parts.tsx';
import { homeUrl, lengthsText, pageSub, pageUrl, plural, priceText, type BookingPage, type BookingsAction, type BookingsState, type BusinessProfile } from './state.ts';

/** Props for BusinessPages. */
export interface BusinessPagesProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  readonly fresh: string | undefined;
  readonly onOpen: (id: string) => void;
  readonly onToggle: (id: string, on: boolean) => void;
  readonly onShare: (p: BookingPage, how: ShareHow) => void;
  readonly onMore: (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => void;
  readonly onCreate: () => void;
  readonly onSeePage: () => void;
}

/** The business's Booking pages tab. */
export function BusinessPages({ state, dispatch, fresh, onOpen, onToggle, onShare, onMore, onCreate, onSeePage }: BusinessPagesProps) {
  const { toast } = useToast();
  const b = state.business;
  const [cat, setCat] = useState('all');
  const [editing, setEditing] = useState(false);
  if (!b) return null;
  const cats = state.categories ?? [];
  const services = state.pages.filter((p) => p.kind !== 'table');
  const tablePages = state.pages.filter((p) => p.kind === 'table');
  const shown = cat === 'all' ? services : services.filter((p) => p.categoryId === cat);
  const url = homeUrl(state);
  const copy = (text: string) => { void navigator.clipboard?.writeText(`https://${text}`).catch(() => undefined); toast({ message: 'Link copied', tone: 'success' }); };
  const card = (p: BookingPage) => (
    <li key={p.id} className={cx('tf-bkf-svc', p.id === fresh && 'is-new', !p.isOn && 'is-hidden')} data-hue={p.accent}>
      <AriaButton className="tf-bkf-svc__open" onPress={() => onOpen(p.id)} aria-label={`Edit ${p.name}`}>
        <span className="tf-bkf-svc__name">{p.name}</span>
        <span className="tf-bkf-svc__sub tf-num">{p.kind === 'table' ? pageSub(p) : lengthsText(p)}</span>
      </AriaButton>
      {p.kind === 'service' && <span className="tf-bkf-svc__price tf-num">{priceText(p)}</span>}
      <span className="tf-bkf-svc__who">{p.kind !== 'table' && <AvatarGroup names={p.hosts} size={20} max={3} />}</span>
      <OnSwitch page={p} onChange={(on) => onToggle(p.id, on)} />
      <ShareMenu page={p} onShare={onShare} />
      <PageMoreMenu page={p} onAction={(k) => { if (k !== 'versions') onMore(p, k); }} />
    </li>
  );
  return (
    <div className="tf-bkf__tab">
      <section className="tf-bkf-yourpage" aria-label="Your page">
        {b.photos[0] && <img src={b.photos[0]} alt="" className="tf-bkf-yourpage__img" />}
        <div className="tf-bkf-yourpage__text">
          <span className="tf-bkf-yourpage__eyebrow">Your page<Tag size="sm" hue={b.published ? 'green' : 'gray'}>{b.published ? 'Live' : 'Not live'}</Tag></span>
          <strong className="tf-bkf-yourpage__name">{state.workspace}</strong>
          <span className="tf-bkf__muted">{b.kindLabel} · {b.area} · {plural(state.pages.filter((p) => p.isOn).length, b.kind === 'restaurant' ? 'way to book' : 'service')} online</span>
          <span className="tf-bkf-yourpage__url tf-num">{url}</span>
        </div>
        <div className="tf-bkf-yourpage__actions">
          <Button variant="secondary" icon={<Copy {...i14} />} onPress={() => copy(url)}>Copy link</Button>
          <Button variant="secondary" icon={<ExternalLink {...i14} />} onPress={onSeePage}>See it</Button>
          <Button variant="ghost" icon={<Pencil {...i14} />} onPress={() => setEditing(true)}>Edit page</Button>
        </div>
      </section>

      {tablePages.length > 0 && (
        <section className="tf-bkf-card" aria-label="Table booking">
          <ul className="tf-bkf-svcs">{tablePages.map(card)}</ul>
        </section>
      )}

      {services.length > 0 && (
        <>
          <TabToolbar count={`${plural(services.length, 'service')} · ${services.filter((p) => p.isOn).length} online`} action={<Button variant="primary" icon={<Plus {...i14} />} onPress={onCreate}>New service</Button>} />
          <div className="tf-bkf-menu">
            {cats.length > 0 && (
              <nav className="tf-bkf-menu__cats" aria-label="Categories">
                <span className="tf-bkf-menu__title">Categories</span>
                {[{ id: 'all', name: 'All services' }, ...cats].map((c) => (
                  <AriaButton key={c.id} className="tf-bkf-menu__cat" aria-current={cat === c.id ? 'true' : undefined} onPress={() => setCat(c.id)}>
                    <span>{c.name}</span><span className="tf-bkf__muted tf-num">{c.id === 'all' ? services.length : services.filter((p) => p.categoryId === c.id).length}</span>
                  </AriaButton>
                ))}
              </nav>
            )}
            <div className="tf-bkf-menu__list">
              {(cat === 'all' ? cats : cats.filter((c) => c.id === cat)).map((c) => {
                const rows = shown.filter((p) => p.categoryId === c.id);
                if (rows.length === 0) return null;
                return (
                  <section key={c.id} className="tf-bkf-menu__group" aria-label={c.name}>
                    <h3 className="tf-bkf-menu__h">{c.name}</h3>
                    <ul className="tf-bkf-svcs">{rows.map(card)}</ul>
                  </section>
                );
              })}
              {shown.filter((p) => !p.categoryId).length > 0 && <ul className="tf-bkf-svcs">{shown.filter((p) => !p.categoryId).map(card)}</ul>}
            </div>
          </div>
        </>
      )}
      {editing && <EditPageDrawer state={state} business={b} onClose={() => setEditing(false)} onSave={(next, hours) => {
        dispatch({ type: 'business/set', business: next });
        if (hours) dispatch({ type: 'hours/set', id: state.defaultHoursId, hours });
        setEditing(false); toast({ message: 'Page saved', tone: 'success' });
      }} />}
      <p className="tf-bkf__muted tf-bkf-menu__foot">Each one has its own link too, like <span className="tf-num">{pageUrl(services[0]?.slug ?? tablePages[0]?.slug ?? 'book', b.handle)}</span>, that goes straight to booking it.</p>
    </div>
  );
}

/** Edit the business page: name, what it is, where, about, opening hours. */
function EditPageDrawer({ state, business, onClose, onSave }: { readonly state: BookingsState; readonly business: BusinessProfile; readonly onClose: () => void; readonly onSave: (b: BusinessProfile, hours?: BookingsState['savedHours'][number]['hours']) => void }) {
  const [b, setB] = useState(business);
  const week = state.savedHours.find((h) => h.id === state.defaultHoursId)?.hours;
  const [hours, setHours] = useState(week);
  const dirty = JSON.stringify(b) !== JSON.stringify(business) || JSON.stringify(hours) !== JSON.stringify(week);
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Your page" subtitle={homeUrl({ ...state, business: b })} width="lg" saveState={dirty ? 'dirty' : 'idle'} onSave={() => onSave(b, hours)} onDiscard={onClose}>
      <div className="tf-bkf-cards">
        <section className="tf-bkf-card">
          <div className="tf-bkf__stack">
            <div className="tf-bkf__pair">
              <TextField label="What you are" value={b.kindLabel} onChange={(kindLabel) => setB({ ...b, kindLabel })} />
              <TextField label="Link" value={b.handle} icon={<span className="tf-bkf__prefix">timefix.com/</span>} onChange={(v) => setB({ ...b, handle: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </div>
            <TextField label="Address" value={b.address} onChange={(address) => setB({ ...b, address })} />
            <div className="tf-bkf__pair">
              <TextField label="Area" value={b.area} onChange={(area) => setB({ ...b, area })} />
              <TextField label="Phone" type="tel" value={b.phone} onChange={(phone) => setB({ ...b, phone })} />
            </div>
            <TextArea label="About" rows={3} value={b.about} onChange={(about) => setB({ ...b, about })} />
          </div>
        </section>
        {hours && <section className="tf-bkf-card" aria-label="Opening hours"><h3 className="tf-bkf-menu__h">Opening hours</h3><HoursEditor value={hours} onChange={setHours} /></section>}
      </div>
    </Drawer>
  );
}
