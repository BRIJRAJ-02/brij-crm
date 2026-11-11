// Grow: Links (everything you share in one place: your page, booking pages, forms, the menu; each with Copy, QR, Open and its numbers),
// the Link page editor (beside the phone; Publish keeps it in the workspace), and Insights, one analytics home with two tabs:
// Pages (what came in through your links, from real bookings and form answers) and Reports (saved CRM charts: new, rename, delete).
import { useRef, useState, type ReactNode } from 'react';
import { NoResults } from '../EmptyState/EmptyState.tsx';
import { Link } from '../Link/Link.tsx';
import { DialogTrigger } from 'react-aria-components';
import { Popover } from '../Popover/Popover.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { ArrowLeft, CalendarDays, Copy, Download, ExternalLink, FileText, IdCard, Pencil, Plus, QrCode as QrIcon, Share2, Store, Trash2, UtensilsCrossed } from 'lucide-react';
import { LinkEditor, type LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import { LinkPage } from '../LinkPage/LinkPage.tsx';
import { demoBlocks, demoBooking, demoProfile, demoSocials } from '../LinkPage/LinkPage.demo.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { BarChart, BarList, ChartCard, DonutChart } from '../Chart/Chart.tsx';
import { StatCard } from '../Card/Card.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Select } from '../Select/Select.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { TextField } from '../Field/Field.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { lengthOf, placeLabel } from '../BookingsFlow/state.ts';
import { dayFrom, inr, newId, ymdOf, type AppAction, type AppState, type ObjectId, type Report } from './data.ts';
import { isOpenDeal, kindOf, oddsOf, ownFields, stagesOf, viewRows, wordsOf } from './model.tsx';
import { Stat } from '../Chart/Chart.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** The starter page until someone publishes their own. */
export const STARTER: LinkPageDraft = { profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' };
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
/** Whose address the links live under: the business's handle, or the host's own name on a team. */
export const handleFor = (state: AppState, bookings: BookingsState | undefined) => bookings?.business?.handle || state.me.split(' ')[0]?.toLowerCase() || 'me';

/** The link page editor: edit beside the phone; Publish keeps it in the workspace. Unpublished work is kept in the app, so See it and leaving never lose it. */
export function LinkPageScreen({ state, dispatch, handle, onBack, bookings, isEmbedded = false }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly handle: string; readonly onBack: () => void; readonly bookings?: BookingsState; /** Inside a partner's frame: no way back into the rest of Timefix. */ readonly isEmbedded?: boolean }) {
  const { toast } = useToast();
  const live = state.linkPage ?? STARTER;
  const published = (state.linkPage !== undefined || state.setupDone.includes('link')) && !state.linkOffline;
  const [offlineAsk, setOfflineAsk] = useState(false);
  const [seeing, setSeeing] = useState(false);
  const [qr, setQr] = useState(false);
  const url = `timefix.com/${handle}`;
  const copy = () => { void copyText(`https://${url}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Your link is ${url}`, tone: 'danger' })); };
  /** A visitor joins the list: they're filed in People (matched by email), tagged with the signup's heading. */
  const signup = (email: string, heading: string) => {
    const match = state.people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (match) dispatch({ type: 'records/fields', object: 'people', changes: [{ id: match.id, patch: { tags: [...new Set([...match.tags, heading])] } }] });
    else dispatch({ type: 'person/set', person: { id: newId('p'), name: email.split('@')[0] ?? email, email, title: '', owner: state.me, tags: [heading], created: new Date() } });
    toast({ message: `${email} joined “${heading}” and is in People`, tone: 'success' });
  };
  return (
    <>
      {seeing && (
        <div className="tf-grow__see">
          <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setSeeing(false)}>Back to editing</Button><span className="tf-rec__muted">{url}</span>
            {state.linkDraft && <Tag size="sm" hue="orange">This is the live page; your changes aren’t published yet</Tag>}</div>
          <LinkPage {...live} booking={demoBooking} onSignup={signup} />
        </div>
      )}
      <div className="tf-grow" hidden={seeing}>
        <div className="tf-rec__bar">
          {!isEmbedded && <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>Links</Button>}
          <span className="tf-grow__url tf-num">{url}</span><Tag size="sm" hue={published ? 'green' : 'gray'}>{published ? 'Live' : state.linkOffline ? 'Offline' : 'Not published'}</Tag>
          <span className="tf-rec__spacer" />
          <Button variant="ghost" icon={<Copy {...i14} />} isDisabled={!published} onPress={copy}>Copy link</Button>
          <Button variant="ghost" icon={<QrIcon {...i14} />} isDisabled={!published} onPress={() => setQr(true)}>QR code</Button>
          <Button variant="secondary" icon={<ExternalLink {...i14} />} isDisabled={!published} onPress={() => setSeeing(true)}>See it</Button>
          {state.linkPage && (state.linkOffline
            ? <Button variant="ghost" onPress={() => { dispatch({ type: 'link/offline', offline: false }); toast({ message: 'Your page is back online', tone: 'success' }); }}>Put back online</Button>
            : <Button variant="ghost" onPress={() => setOfflineAsk(true)}>Take offline</Button>)}
          {offlineAsk && <Dialog isOpen onOpenChange={(o) => { if (!o) setOfflineAsk(false); }} title="Take your page offline?" description={`Visitors to ${url} see that it’s not available. Nothing is deleted, and you can put it back any time.`}
            actions={<><Button variant="ghost" slot="close">Keep it live</Button><Button variant="danger" onPress={() => { setOfflineAsk(false); dispatch({ type: 'link/offline', offline: true }); toast({ message: 'Your page is offline', action: { label: 'Undo', onAction: () => dispatch({ type: 'link/offline', offline: false }) } }); }}>Take offline</Button></>} />}
        </div>
        <LinkEditor live={live} booking={demoBooking} initialDraft={state.linkDraft} neverPublished={!published}
          forms={state.forms.map((f) => ({ slug: f.slug, name: f.name, live: f.status === 'live' }))}
          bookingPages={(bookings?.pages ?? []).filter((p) => p.kind !== 'table' && p.isOn).map((p) => { const where = p.places?.[0] ?? 'video'; return { slug: p.slug, name: p.name, minutes: lengthOf(p), location: { kind: where === 'phone' ? 'phone' as const : where === 'in-person' ? 'place' as const : 'video' as const, label: placeLabel(p, where) } }; })}
          onDraftChange={(d) => { if (JSON.stringify(d) !== JSON.stringify(state.linkDraft)) dispatch({ type: 'link/draft', page: d }); }}
          onPublish={(page) => new Promise<void>((resolve) => { window.setTimeout(() => { dispatch({ type: 'link/publish', page }); resolve(); }, 500); })} />
        {qr && <QrSheet url={url} name="your link page" onClose={() => setQr(false)} />}
      </div>
    </>
  );
}

/** One QR code in a dialog, with Download. */
/** A QR code for any public address, with download. */
export function QrSheet({ url, name, onClose }: { readonly url: string; readonly name: string; readonly onClose: () => void }) {
  const { toast } = useToast();
  const svg = useRef<SVGSVGElement>(null);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`QR code for ${name}`} description="For a card, a table, a poster or a slide."
      actions={<><Button variant="ghost" slot="close">Done</Button><Button variant="secondary" icon={<Download {...i14} />} onPress={() => { if (svg.current) void downloadQr(svg.current, url.replace(/[^a-z0-9]+/gi, '-'), 'png').then((o) => { if (o === 'saved') toast({ message: 'Saved', tone: 'success' }); }); }}>Download PNG</Button></>}>
      <div className="tf-grow__qr"><QrCode value={`https://${url}`} label={`QR code for ${name}`} withLogo ref={svg} /><span className="tf-num">{url}</span></div>
    </Dialog>
  );
}

/** One thing you share. */
interface ShareRow { readonly id: string; readonly icon: ReactNode; readonly name: string; readonly url: string; readonly live: boolean; readonly off?: string; readonly numbers: string; readonly open: () => void; readonly edit: () => void; readonly editLabel: string }

/** Links: everything you share, in one place. */
export function LinksScreen({ state, bookings, appsMenu, onLinkPage, onBookingPage, onBookings, onForm }: {
  readonly state: AppState; readonly bookings: BookingsState | undefined; readonly appsMenu: boolean;
  readonly onLinkPage: () => void; readonly onBookingPage: (pageId: string | undefined, scenario: 'book' | 'profile' | 'menu') => void; readonly onBookings: (tab: string) => void;
  readonly onForm: (id: string, visit: boolean) => void;
}) {
  const { toast } = useToast();
  const [qr, setQr] = useState<ShareRow>();
  const [query, setQuery] = useState('');
  const handle = handleFor(state, bookings);
  const business = bookings?.business;
  const now = new Date();
  const upcoming = (pageId?: string) => (bookings?.meetings ?? []).filter((m) => (pageId === undefined || m.pageId === pageId) && m.status !== 'cancelled' && m.start > now).length;
  const rows: ReadonlyArray<{ readonly title: string; readonly rows: ReadonlyArray<ShareRow> }> = [
    { title: 'Your page', rows: business
      ? [{ id: 'home', icon: <Store {...i16} />, name: bookings?.workspace ?? 'Your business page', url: `timefix.com/${handle}`, live: business.published, off: 'Not published', numbers: `${upcoming()} upcoming bookings`, open: () => onBookingPage(undefined, 'profile'), edit: () => onBookings('pages'), editLabel: 'Edit page' }]
      : [{ id: 'link', icon: <IdCard {...i16} />, name: 'Link page', url: `timefix.com/${handle}`, live: !state.linkOffline && state.linkPage !== undefined || state.setupDone.includes('link'), off: 'Not published', numbers: (() => { const blocks = (state.linkPage ?? STARTER).blocks; const n = blocks.filter((b) => b.kind === 'link' && !b.hidden && b.href.trim()).length; const clicks = blocks.reduce((t, b) => t + (b.kind === 'link' ? b.clicks ?? 0 : 0), 0); return `${n} links${clicks ? ` · ${clicks >= 1000 ? `${(clicks / 1000).toFixed(1)}K` : clicks} clicks` : ''}`; })(), open: onLinkPage, edit: onLinkPage, editLabel: 'Edit page' }] },
    { title: business ? (business.kind === 'restaurant' ? 'Tables and bookings' : 'Services') : 'Booking pages', rows: (bookings?.pages ?? []).map((p) => ({ id: p.id, icon: <CalendarDays {...i16} />, name: p.name, url: `timefix.com/${handle}/${p.slug}`, live: p.isOn,
      numbers: `${upcoming(p.id)} upcoming`, open: () => onBookingPage(p.id, 'book'), edit: () => onBookings('pages'), editLabel: 'Edit in Bookings' })) },
    ...(bookings?.menu && appsMenu ? [{ title: 'Menu', rows: [{ id: 'menu', icon: <UtensilsCrossed {...i16} />, name: 'Menu', url: `timefix.com/${handle}/menu`, live: true, numbers: `${bookings.menu.dishes.length} dishes`, open: () => onBookingPage(undefined, 'menu'), edit: () => onBookings('menu'), editLabel: 'Edit menu' }] }] : []),
    { title: 'Forms', rows: state.forms.map((f) => ({ id: f.id, icon: <FileText {...i16} />, name: f.name, url: `timefix.com/f/${f.slug}`, live: f.status === 'live', off: f.status === 'draft' ? 'Draft' : 'Paused', numbers: `${f.responses.filter((r) => !r.spam).length} responses`, open: () => onForm(f.id, true), edit: () => onForm(f.id, false), editLabel: 'Edit form' })) },
  ].filter((g) => g.rows.length > 0);
  const q = query.trim().toLowerCase();
  const total = rows.reduce((n, g) => n + g.rows.length, 0);
  const live = rows.reduce((n, g) => n + g.rows.filter((r) => r.live).length, 0);
  const shown = q ? rows.map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.name} ${r.url}`.toLowerCase().includes(q)) })).filter((g) => g.rows.length > 0) : rows;
  const copy = (r: ShareRow) => { void copyText(`https://${r.url}`).then((ok) => toast(ok ? { message: `${r.name} link copied`, tone: 'success' } : { message: `Copy didn’t work. The link is ${r.url}`, tone: 'danger' })); };
  return (
    <div className="tf-links">
      <div className="tf-you__bar">
        <SearchField label="Search links" placeholder="Search links" size="sm" value={query} onChange={setQuery} className="tf-rec__search" />
        <span className="tf-rec__muted tf-num">{total} links · {live} live</span>
      </div>
      {shown.length === 0 && <NoResults size="sm" query={query} noun="links" onClearFilters={() => setQuery('')} />}
      {shown.map((g) => (
        <section key={g.title} className="tf-links__group" aria-label={g.title}>
          <h2 className="tf-links__h">{g.title}</h2>
          <ul className="tf-links__list">
            {g.rows.map((r) => (
              <li key={r.id} className="tf-links__row">
                <span className="tf-links__icon" aria-hidden>{r.icon}</span>
                <span className="tf-links__what"><strong>{r.name}</strong><span className="tf-rec__muted tf-num">{r.url}</span></span>
                <span className="tf-links__nums tf-rec__muted tf-num">{r.numbers}</span>
                <Tag size="sm" hue={r.live ? 'green' : 'gray'}>{r.live ? 'Live' : r.off ?? 'Off'}</Tag>
                <span className="tf-links__acts">
                  <Button size="sm" variant="ghost" icon={<Copy {...i14} />} isDisabled={!r.live} onPress={() => copy(r)}>Copy</Button>
                  <IconButton size="sm" label={`QR code for ${r.name}`} isDisabled={!r.live} onPress={() => setQr(r)}><QrIcon {...i14} /></IconButton>
                  <IconButton size="sm" label={`Open ${r.name}`} onPress={r.open}><ExternalLink {...i14} /></IconButton>
                  <IconButton size="sm" label={`${r.editLabel}: ${r.name}`} onPress={r.edit}><Pencil {...i14} /></IconButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {qr && <QrSheet url={qr.url} name={qr.name} onClose={() => setQr(undefined)} />}
    </div>
  );
}

/** The points of one report, from the workspace's records: any object, filtered by a saved view and an owner, grouped by any field (dates by month or week), counted or summed or averaged. */
export function reportPoints(state: AppState, r: Report): ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: number; readonly valueText: string }> {
  const object = r.object ?? 'deals';
  const view = r.viewId ? (state.views[object] ?? []).find((v) => v.id === r.viewId) : undefined;
  const rows = viewRows(state, object, view).filter((x) => !r.owner || x.values.owner === r.owner);
  const fields = ownFields(state, object);
  const groupId = r.group === 'tag' ? 'tags' : r.group;
  const gf = fields.find((f) => f.id === groupId);
  const measureId = r.measure === 'amount' ? 'amount' : r.field;
  const mf = fields.find((f) => f.id === measureId);
  const isDate = gf ? kindOf(gf.type) === 'date' : false;
  const bucket = (v: unknown): ReadonlyArray<string> => {
    const s0 = v === undefined || v === '' ? '' : String(v);
    if (!s0) return [`No ${gf?.name.toLowerCase() ?? 'value'}`];
    if (isDate) { const d = dayFrom(s0); if (!d) return [s0]; if (r.dateBy === 'week') { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [ymdOf(m)]; } return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`]; }
    if (gf?.type === 'multiSelect') return s0.split(/,\s*/).filter(Boolean);
    return [s0];
  };
  const groups = new Map<string, Array<typeof rows[number]>>();
  if (gf?.options && !isDate) gf.options.filter((o) => o.id !== '').forEach((o) => groups.set(o.id, []));
  if (groupId === 'owner') state.members.forEach((m) => groups.set(m.name, []));
  rows.forEach((x) => bucket(x.values[groupId]).forEach((k) => groups.set(k, [...(groups.get(k) ?? []), x])));
  const keys = isDate ? [...groups.keys()].sort() : [...groups.keys()];
  const money = mf?.money === true;
  return keys.map((k) => {
    const xs = groups.get(k) ?? [];
    const nums = xs.map((x) => Number(x.values[measureId ?? ''] ?? 0)).filter((n) => !Number.isNaN(n));
    const value = r.measure === 'count' || !measureId ? xs.length : r.measure === 'avg' ? (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0) : nums.reduce((a, b) => a + b, 0);
    const label = isDate ? (r.dateBy === 'week' ? `${dayFrom(k)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) ?? k}` : `${dayFrom(`${k}-01`)?.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) ?? k}`)
      : groupId === 'owner' ? k.split(' ')[0] ?? k : gf?.options?.find((o) => o.id === k)?.label ?? k;
    return { id: k, label, value, valueText: r.measure === 'count' || !measureId ? String(value) : money ? inr(value) : value.toLocaleString('en-IN') };
  });
}

/** Insights: Pages (from real bookings and form answers) and Reports (saved charts: one tab each, new, change, delete). */
/** Share Insights by a view-only link: its own key, an expiry, Copy, and Stop sharing (the link dies at once; Undo brings it back). Numbers only, never names. */
function ShareInsights({ state, dispatch, query }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly query: string }) {
  const { toast } = useToast();
  const link = state.insightsLink;
  const live = link && (!link.expires || link.expires > new Date()) ? link : undefined;
  const url = live ? `https://timefix.com/insights/${state.prefs.workspace.slug}?k=${live.key}&${query}` : '';
  const copy = (u: string) => { void copyText(u).then((ok) => toast(ok ? { message: 'View-only link copied', tone: 'success' } : { message: `Copy didn’t work. The link is ${u}`, tone: 'danger' })); };
  const make = (days: number) => dispatch({ type: 'insights/link', link: { key: Math.random().toString(36).slice(2, 10), made: new Date(), expires: days ? new Date(Date.now() + days * 86_400_000) : undefined } });
  return (
    <DialogTrigger>
      <Button variant="ghost" icon={<Share2 {...i14} />}>{live ? 'Shared' : 'Share'}</Button>
      <Popover label="Share Insights" placement="bottom end" offset={6}>
        <div className="tf-grow__share">
          <span className="tf-grow__share-title">Share a view-only link</span>
          <span className="tf-rec__muted">Anyone with it sees these numbers and charts, never names or answers.</span>
          {live ? <>
            <div className="tf-grow__share-link"><span className="tf-num">{url.replace('https://', '')}</span><Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={() => copy(url)}>Copy</Button></div>
            <span className="tf-rec__muted tf-num">{live.expires ? `Stops working ${live.expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Works until you stop sharing'}</span>
            <Button size="sm" variant="ghost" onPress={() => { const was = link; dispatch({ type: 'insights/link', link: undefined }); toast({ message: 'The link stopped working', action: { label: 'Undo', onAction: () => dispatch({ type: 'insights/link', link: was }) } }); }}>Stop sharing</Button>
          </> : <>
            <span className="tf-bkf__row">
              <Button size="sm" variant="primary" onPress={() => { make(30); }}>Share for 30 days</Button>
              <Button size="sm" variant="ghost" onPress={() => { make(0); }}>No end date</Button>
            </span>
          </>}
        </div>
      </Popover>
    </DialogTrigger>
  );
}

export function InsightsScreen({ state, dispatch, bookings, startTab, startReport }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly bookings: BookingsState | undefined; readonly startTab?: 'pages' | 'reports'; readonly startReport?: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>(startTab ?? 'pages');
  const [kind, setKind] = useState('all');
  const [range, setRange] = useState('30');
  const [from0, setFrom0] = useState<string>();
  const [to0, setTo0] = useState<string>();
  const now = new Date();
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const firstEver = [...(bookings?.meetings ?? []).map((m) => m.start), ...state.forms.flatMap((f) => f.responses.map((r) => r.at))].reduce((a, b) => (b < a ? b : a), now);
  const from = range === 'all' ? dayStart(firstEver) : range === 'custom' && from0 ? dayFrom(from0, 0) ?? dayStart(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(range === 'custom' ? 30 : range) + 1);
  const until = range === 'custom' && to0 ? new Date((dayFrom(to0, 0) ?? now).getTime() + 86_400_000) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const days = Math.max(1, Math.round((until.getTime() - from.getTime()) / 86_400_000));
  const before = new Date(from.getTime() - days * 86_400_000);
  // One page or form, or a whole kind. Everything counted comes from real bookings and answers.
  const pageId = kind.startsWith('page:') ? kind.slice(5) : undefined; const formId = kind.startsWith('form:') ? kind.slice(5) : undefined;
  const events = (a: Date, b: Date) => [
    ...(kind === 'all' || kind === 'booking' || pageId ? (bookings?.meetings ?? []).filter((m) => m.pageId && (!pageId || m.pageId === pageId) && m.status !== 'cancelled').map((m) => ({ at: m.start, what: 'booking' as const })) : []),
    ...(kind === 'all' || kind === 'forms' || formId ? state.forms.filter((f) => !formId || f.id === formId).flatMap((f) => f.responses.filter((r) => !r.spam).map((r) => ({ at: r.at, what: 'form' as const }))) : []),
  ].filter((e) => e.at >= a && e.at < b);
  const cur = events(from, until);
  const prev = events(before, from);
  const delta = (a: number, b: number) => (range === 'all' ? { value: 'all time', direction: 'flat' as const } : b === 0 ? { value: a ? 'up from 0' : 'none yet', direction: 'flat' as const } : { value: `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`, direction: a > b ? 'up' as const : a < b ? 'down' as const : 'flat' as const, note: 'vs the period before', isGood: a >= b });
  const buckets = Math.min(days, 30);
  const step = Math.max(1, Math.round(days / buckets));
  const perDay = Array.from({ length: Math.ceil(days / step) }, (_, i) => { const a = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i * step); const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + step); return { label: a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: cur.filter((e) => e.at >= a && e.at < b).length }; });
  const booked = cur.filter((e) => e.what === 'booking').length; const answered = cur.filter((e) => e.what === 'form').length;
  const byPage = [...(bookings?.pages ?? []).filter((p) => !pageId || p.id === pageId).filter(() => !formId && kind !== 'forms').map((p) => ({ id: p.id, label: p.name, value: (bookings?.meetings ?? []).filter((m) => m.pageId === p.id && m.status !== 'cancelled' && m.start >= from && m.start < until).length })),
    ...state.forms.filter((f) => !formId || f.id === formId).filter(() => !pageId && kind !== 'booking').map((f) => ({ id: f.id, label: f.name, value: f.responses.filter((r) => !r.spam && r.at >= from && r.at < until).length }))].filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  const formsShown = state.forms.filter((f) => (formId ? f.id === formId : kind === 'all' || kind === 'forms'));
  const funnel = formsShown.length ? [{ id: 'views', label: 'Opened', value: formsShown.reduce((n, f) => n + f.views, 0) }, { id: 'sent', label: 'Sent', value: formsShown.reduce((n, f) => n + f.responses.filter((r) => !r.spam).length, 0) }, { id: 'filed', label: 'Filed in People', value: formsShown.reduce((n, f) => n + f.responses.filter((r) => !r.spam && r.personId).length, 0) }] : [];
  const exportCsv = async () => { const csv = ['Date,Bookings and answers', ...perDay.map((d) => `${d.label},${d.value}`)].join('\n'); const o = await saveFile(`insights-${range}.csv`, new Blob([csv], { type: 'text/csv' })); if (o === 'saved') toast({ message: 'Exported', tone: 'success' }); };

  const reports = state.reports;
  const [report, setReport] = useState(startReport ?? reports[0]?.id ?? '');
  const [making, setMaking] = useState<Report | 'new'>();
  const r = reports.find((x) => x.id === report) ?? reports[0];
  const points = r ? reportPoints(state, r) : [];
  return (
    <div className="tf-grow tf-grow--wide">
      <Tabs aria-label="Insights" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'pages', label: 'Pages' }, { id: 'reports', label: 'Reports', count: reports.length }, { id: 'forecast', label: 'Forecast' }]}>
        <TabPanel id="pages" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="What" isLabelHidden className="tf-rec__view" value={kind} onChange={(v) => setKind(v ?? 'all')}
              items={[{ id: 'all', label: 'Everything' }, { id: 'booking', label: 'All booking pages' }, { id: 'forms', label: 'All forms' },
                ...(bookings?.pages ?? []).map((p) => ({ id: `page:${p.id}`, label: p.name, description: 'Booking page' })), ...state.forms.map((f) => ({ id: `form:${f.id}`, label: f.name, description: 'Form' }))]} />
            <Select label="When" isLabelHidden className="tf-you__select" value={range} onChange={(v) => setRange(v ?? '30')}
              items={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }, { id: '365', label: 'Last 12 months' }, { id: 'all', label: 'All time' }, { id: 'custom', label: 'Pick dates…' }]} />
            {range === 'custom' && <>
              <TextField label="From" isRequired type="date" value={from0 ?? ''} onChange={(v) => setFrom0(v || undefined)} />
              <TextField label="To" type="date" value={to0 ?? ''} onChange={(v) => setTo0(v || undefined)} />
            </>}
            <span className="tf-rec__spacer" />
            <Button variant="ghost" icon={<Download {...i14} />} onPress={() => { void exportCsv(); }}>Export CSV</Button>
            <ShareInsights state={state} dispatch={dispatch} query={new URLSearchParams({ tab, show: kind, ...(range === 'custom' ? { from: ymdOf(from), to: ymdOf(new Date(until.getTime() - 86_400_000)) } : { days: range }) }).toString()} />
          </div>
          <div className="tf-home__stats">
            <StatCard label="Bookings and answers" value={cur.length} delta={delta(cur.length, prev.length)} />
            <StatCard label="Meetings in this period" value={booked} delta={delta(booked, prev.filter((e) => e.what === 'booking').length)} />
            <StatCard label="Form answers" value={answered} delta={delta(answered, prev.filter((e) => e.what === 'form').length)} />
            <StatCard label="Form views, all time" value={formsShown.reduce((n, f) => n + f.views, 0)} delta={{ value: `${formsShown.reduce((n, f) => n + f.views, 0) ? Math.round((formsShown.reduce((n, f) => n + f.responses.filter((r) => !r.spam).length, 0) / formsShown.reduce((n, f) => n + f.views, 0)) * 100) : 0}% answered`, direction: 'flat' }} />
          </div>
          <div className="tf-home__grid">
            <ChartCard title={step === 1 ? 'Per day' : `Per ${step} days`}><BarChart label="Bookings and answers over time" look="dots" points={perDay.map((d, i) => ({ id: String(i), label: d.label, value: d.value }))} emptyText="Nothing came in yet in this period." /></ChartCard>
            <ChartCard title={funnel.length && (formId || kind === 'forms') ? 'Where people stop (all time)' : 'Which pages and forms'}>
              {funnel.length && (formId || kind === 'forms') ? <BarList label="From opening to filed" items={funnel} /> : byPage.length ? <BarList label="By page" items={byPage} /> : <p className="tf-rec__muted">Nothing came in yet in this period.</p>}
            </ChartCard>
          </div>
          <p className="tf-rec__muted">Counts bookings, form answers and form opens. Page visits and where people came from appear here once your pages have visitors.</p>
        </TabPanel>
        <TabPanel id="reports" className="tf-forms__panel">
          {reports.length === 0 ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No reports yet" description="Chart your deals, people or companies, and keep it for the team." action={<Button size="sm" variant="primary" onPress={() => setMaking('new')}>New report</Button>} /> : (
            <>
              <div className="tf-rec__bar">
                <Select label="Report" isLabelHidden className="tf-rec__view" value={r?.id ?? null} onChange={(v) => { if (v) setReport(v); }} items={reports.map((x) => ({ id: x.id, label: x.name, description: `${wordsOf(state, x.object ?? 'deals').Many} by ${ownFields(state, x.object ?? 'deals').find((f) => f.id === (x.group === 'tag' ? 'tags' : x.group))?.name.toLowerCase() ?? x.group}${x.owner ? `, ${x.owner}'s` : ''}` }))} />
                <span className="tf-rec__spacer" />
                {r && <Button size="sm" variant="ghost" icon={<Pencil {...i14} />} onPress={() => setMaking(r)}>Change</Button>}
                {r && <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { const was = r; const at = reports.findIndex((y) => y.id === r.id); dispatch({ type: 'report/remove', id: r.id }); setReport(reports.find((y) => y.id !== r.id)?.id ?? ''); toast({ message: `${was.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'report/set', report: was }); void at; setReport(was.id); } } }); }}>Delete</Button>}
                <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setMaking('new')}>New report</Button>
              </div>
              {r && (() => {
                const totalNum = r.measure === 'avg' ? Math.round(points.reduce((n, p) => n + p.value, 0) / Math.max(1, points.filter((p) => p.value).length)) : points.reduce((n, p) => n + p.value, 0);
                const money = r.measure !== 'count' && (ownFields(state, r.object ?? 'deals').find((f) => f.id === (r.measure === 'amount' ? 'amount' : r.field))?.money ?? false);
                const totalText = money ? inr(totalNum) : totalNum.toLocaleString('en-IN');
                if (points.every((p) => p.value === 0)) return <p className="tf-rec__muted">Nothing to count yet.</p>;
                if (r.chart === 'number') return <div className="tf-home__stats tf-grow__one"><Stat label={r.name} value={totalText} delta={`${points.filter((p) => p.value).length} groups · ${r.measure === 'avg' ? 'average' : 'total'}`} /></div>;
                return (
                  <div className="tf-home__grid">
                    <ChartCard title={r.name}><BarChart label={r.name} points={points} look={r.chart === 'line' ? 'line' : 'bars'} /></ChartCard>
                    <ChartCard title="Share of the total"><DonutChart label={r.name} segments={points.filter((p) => p.value > 0).map((p, n) => ({ id: p.id, label: p.label, value: p.value, valueText: p.valueText, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'gray'] as const)[n % 6] ?? 'gray' }))}
                      total={totalText} totalLabel={r.measure === 'avg' ? 'Average' : 'Total'} /></ChartCard>
                  </div>
                );
              })()}
            </>
          )}
        </TabPanel>
        <TabPanel id="forecast" className="tf-forms__panel"><Forecast state={state} dispatch={dispatch} /></TabPanel>
      </Tabs>
      {making && <ReportDialog state={state} report={making === 'new' ? undefined : making} members={state.members.map((m) => m.name)} onClose={() => setMaking(undefined)} onSave={(x) => { dispatch({ type: 'report/set', report: x }); setReport(x.id); setMaking(undefined); toast({ message: `${x.name} saved`, tone: 'success' }); }} />}
    </div>
  );
}

/** A chart of any object's records: count, total or average of a number field, grouped by any field (dates by month or week), from a saved view, as bars, a line or one number. */
function ReportDialog({ state, report, members, onClose, onSave }: { readonly state: AppState; readonly report?: Report; readonly members: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (r: Report) => void }) {
  const [object, setObject] = useState<ObjectId>(report?.object ?? 'deals');
  const [measure, setMeasure] = useState<'count' | 'sum' | 'avg'>(report?.measure === 'amount' ? 'sum' : report?.measure ?? 'sum');
  const fields = ownFields(state, object);
  const numbers = fields.filter((f) => kindOf(f.type) === 'number');
  const [field, setField] = useState(report?.measure === 'amount' ? 'amount' : report?.field ?? numbers[0]?.id ?? '');
  const groupable = fields.filter((f) => ['select', 'status', 'multiSelect', 'actor', 'date', 'timestamp', 'checkbox'].includes(f.type) || f.id === 'company' || f.id === 'city');
  const [group, setGroup] = useState<string>(report?.group === 'tag' ? 'tags' : report?.group ?? groupable[0]?.id ?? 'owner');
  const [dateBy, setDateBy] = useState<'month' | 'week'>(report?.dateBy ?? 'month');
  const [owner, setOwner] = useState<string>(report?.owner ?? 'all');
  const [viewId, setViewId] = useState<string>(report?.viewId ?? 'all');
  const [chart, setChart] = useState<'bar' | 'line' | 'number'>(report?.chart ?? 'bar');
  const [name, setName] = useState(report?.name ?? '');
  const gf = fields.find((f) => f.id === group);
  const isDate = gf ? kindOf(gf.type) === 'date' : false;
  const useMeasure = numbers.length > 0 ? measure : 'count';
  const w = wordsOf(state, object);
  const auto = `${useMeasure === 'count' ? w.Many : `${useMeasure === 'avg' ? 'Average' : 'Total'} ${numbers.find((f) => f.id === field)?.name.replace(/ \(₹\)$/, '').toLowerCase() ?? ''}`} by ${gf?.name.toLowerCase() ?? group}${isDate ? ` (${dateBy})` : ''}`;
  const objects = state.objects.filter((o) => !o.archived);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={report ? 'Change report' : 'New report'} description="A chart of your records, saved for the team."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!gf} onPress={() => onSave({ id: report?.id ?? newId('rep'), name: name.trim() || auto, object, measure: useMeasure, field: useMeasure === 'count' ? undefined : field, group, dateBy: isDate ? dateBy : undefined, owner: owner === 'all' ? undefined : owner, viewId: viewId === 'all' ? undefined : viewId, chart })}>Save report</Button></>}>
      <div className="tf-rec__form">
        <div className="tf-bkf__pair">
          <Select label="Records" value={object} onChange={(v) => { const o = v ?? 'deals'; setObject(o); const f = ownFields(state, o); setGroup(f.find((x) => ['status', 'select', 'actor'].includes(x.type))?.id ?? 'owner'); setField(f.find((x) => kindOf(x.type) === 'number')?.id ?? ''); setViewId('all'); }} items={objects.map((o) => ({ id: o.id, label: o.many }))} />
          <Select label="From view" value={viewId} onChange={(v) => setViewId(v ?? 'all')} items={[{ id: 'all', label: `All ${w.many}` }, ...(state.views[object] ?? []).map((v) => ({ id: v.id, label: v.name }))]} />
        </div>
        <div className="tf-bkf__pair">
          <Select label="Measure" value={useMeasure} onChange={(v) => setMeasure(v === 'count' ? 'count' : v === 'avg' ? 'avg' : 'sum')} items={[{ id: 'count', label: `Number of ${w.many}` }, ...(numbers.length ? [{ id: 'sum', label: 'Total of a number' }, { id: 'avg', label: 'Average of a number' }] : [])]} />
          {useMeasure !== 'count' && <Select label="Of" value={field || null} onChange={(v) => setField(v ?? '')} items={numbers.map((f) => ({ id: f.id, label: f.name }))} />}
        </div>
        <div className="tf-bkf__pair">
          <Select label="Grouped by" value={group} onChange={(v) => { if (v) setGroup(v); }} items={groupable.map((f) => ({ id: f.id, label: f.name }))} />
          {isDate && <Select label="Per" value={dateBy} onChange={(v) => setDateBy(v === 'week' ? 'week' : 'month')} items={[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }]} />}
        </div>
        <div className="tf-bkf__pair">
          <Select label="Owned by" value={owner} onChange={(v) => setOwner(v ?? 'all')} items={[{ id: 'all', label: 'Everyone' }, ...members.map((m) => ({ id: m, label: m }))]} />
          <Select label="Show as" value={chart} onChange={(v) => setChart(v === 'line' ? 'line' : v === 'number' ? 'number' : 'bar')} items={[{ id: 'bar', label: 'Bars' }, { id: 'line', label: 'A line' }, { id: 'number', label: 'One number' }]} />
        </div>
        <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder={auto} />
      </div>
    </Dialog>
  );
}

/** Forecast: open pipeline, won, and the weighted forecast; each stage's win chance can be changed, and the forecast follows. */
function Forecast({ state, dispatch }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void }) {
  const { toast } = useToast();
  const stages = stagesOf(state);
  const open = state.deals.filter((d) => isOpenDeal(state, d));
  const wonIds = new Set(stages.filter((s) => s.outcome === 'won').map((s) => s.id));
  const won = state.deals.filter((d) => wonIds.has(d.stage));
  const pipeline = open.reduce((n, d) => n + d.amount, 0);
  const weighted = open.reduce((n, d) => n + Math.round((d.amount * oddsOf(state, d.stage)) / 100), 0);
  const byMonth = new Map<string, number>();
  open.forEach((d) => { const k = `${d.close.getFullYear()}-${String(d.close.getMonth() + 1).padStart(2, '0')}`; byMonth.set(k, (byMonth.get(k) ?? 0) + Math.round((d.amount * oddsOf(state, d.stage)) / 100)); });
  const months = [...byMonth.keys()].sort().map((k) => ({ id: k, label: dayFrom(`${k}-01`)?.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) ?? k, value: byMonth.get(k) ?? 0, valueText: inr(byMonth.get(k) ?? 0) }));
  return (
    <>
      <div className="tf-home__stats">
        <StatCard label="Open pipeline" value={pipeline} delta={{ value: `${open.length} open ${open.length === 1 ? 'deal' : 'deals'}`, direction: 'flat' }} format={inr} />
        <StatCard label="Won" value={won.reduce((n, d) => n + d.amount, 0)} delta={{ value: `${won.length} won`, direction: 'flat' }} format={inr} />
        <StatCard label="Weighted forecast" value={weighted} delta={{ value: pipeline ? `${Math.round((weighted / pipeline) * 100)}% of open` : '—', direction: 'flat' }} format={inr} />
      </div>
      <div className="tf-home__grid">
        <ChartCard title="Expected by close month"><BarChart label="Weighted amount by close month" points={months} emptyText="No open deals." /></ChartCard>
        <ChartCard title="Win chance by stage">
          <ul className="tf-set__list tf-forecast">
            {stages.filter((s) => !s.outcome).map((s) => {
              const ds = open.filter((d) => d.stage === s.id); const amt = ds.reduce((n, d) => n + d.amount, 0);
              return (
                <li key={s.id}>
                  <span><strong>{s.label}</strong> <span className="tf-rec__muted tf-num">{ds.length} · {inr(amt)} · {inr(Math.round((amt * oddsOf(state, s.id)) / 100))} weighted</span></span>
                  <TextField aria-label={`${s.label} win chance`} className="tf-forecast__pct" value={String(oddsOf(state, s.id))} suffix={<span className="tf-rec__muted">%</span>} inputMode="numeric"
                    onChange={(v) => { const n = Math.max(0, Math.min(100, Number(v.replace(/[^\d]/g, '')) || 0)); const was = state.prefs.winChance; dispatch({ type: 'prefs/update', fn: (p) => ({ winChance: { ...(p.winChance ?? {}), [s.id]: n } }) }); void was; }}
                    onBlur={() => toast({ message: `${s.label}: ${oddsOf(state, s.id)}% likely`, tone: 'success' })} />
                </li>
              );
            })}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}
