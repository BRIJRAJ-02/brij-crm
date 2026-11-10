// Grow: Links (everything you share in one place: your page, booking pages, forms, the menu; each with Copy, QR, Open and its numbers),
// the Link page editor (beside the phone; Publish keeps it in the workspace), and Insights, one analytics home with two tabs:
// Pages (what came in through your links, from real bookings and form answers) and Reports (saved CRM charts: new, rename, delete).
import { useRef, useState, type ReactNode } from 'react';
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
import { STAGES, dayFrom, inr, newId, ymdOf, type AppAction, type AppState, type Report } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** The starter page until someone publishes their own. */
export const STARTER: LinkPageDraft = { profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' };
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
/** Whose address the links live under: the business's handle, or the host's own name on a team. */
export const handleFor = (state: AppState, bookings: BookingsState | undefined) => bookings?.business?.handle || state.me.split(' ')[0]?.toLowerCase() || 'me';

/** The link page editor: edit beside the phone; Publish keeps it in the workspace. Unpublished work is kept in the app, so See it and leaving never lose it. */
export function LinkPageScreen({ state, dispatch, handle, onBack }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly handle: string; readonly onBack: () => void }) {
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
          <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>Links</Button>
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
      : [{ id: 'link', icon: <IdCard {...i16} />, name: 'Link page', url: `timefix.com/${handle}`, live: !state.linkOffline && state.linkPage !== undefined || state.setupDone.includes('link'), off: 'Not published', numbers: `${(state.linkPage ?? STARTER).blocks.filter((b) => b.kind === 'link' && !b.hidden && b.href.trim()).length} links`, open: onLinkPage, edit: onLinkPage, editLabel: 'Edit page' }] },
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
      {shown.length === 0 && <p className="tf-rec__muted">No links match. <button type="button" className="tf-rec__link" onClick={() => setQuery('')}>Clear search</button></p>}
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

/** The bars of one report, from the workspace's records. */
export function reportPoints(state: AppState, r: Report): ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: number; readonly valueText: string }> {
  const object = r.object ?? 'deals';
  const mine = <T extends { readonly owner: string }>(xs: ReadonlyArray<T>) => (r.owner ? xs.filter((x) => x.owner === r.owner) : xs);
  const amount = (ds: ReadonlyArray<{ readonly amount: number }>) => ds.reduce((n, d) => n + d.amount, 0);
  const keyOf = (rec: Readonly<Record<string, unknown>>): ReadonlyArray<string> => {
    if (r.group === 'owner') return [String(rec.owner ?? 'No owner')];
    if (r.group === 'stage') return [String(rec.stage ?? '')];
    if (r.group === 'industry') return [String(rec.industry || 'No industry')];
    if (r.group === 'city') return [String(rec.city || 'No city')];
    if (r.group === 'company') return [state.companies.find((c) => c.id === rec.companyId)?.name ?? 'No company'];
    if (r.group === 'tag') { const t = rec.tags as ReadonlyArray<string> | undefined; return t && t.length ? t : ['No tags']; }
    return [''];
  };
  const rows = (object === 'deals' ? mine(state.deals) : object === 'people' ? mine(state.people) : mine(state.companies)) as unknown as ReadonlyArray<Readonly<Record<string, unknown>> & { readonly amount?: number }>;
  const groups = new Map<string, Array<Readonly<Record<string, unknown>> & { readonly amount?: number }>>();
  if (object === 'deals' && r.group === 'stage') STAGES.forEach((st) => groups.set(st, []));
  rows.forEach((x) => keyOf(x).forEach((k) => groups.set(k, [...(groups.get(k) ?? []), x])));
  return [...groups].map(([k, xs]) => {
    const value = r.measure === 'amount' && object === 'deals' ? amount(xs as ReadonlyArray<{ readonly amount: number }>) : xs.length;
    return { id: k, label: r.group === 'owner' ? k.split(' ')[0] ?? k : k, value, valueText: r.measure === 'amount' && object === 'deals' ? inr(value) : String(value) };
  });
}

/** Insights: Pages (from real bookings and form answers) and Reports (saved charts: one tab each, new, change, delete). */
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
      <Tabs aria-label="Insights" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'pages', label: 'Pages' }, { id: 'reports', label: 'Reports', count: reports.length }]}>
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
            <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => { void copyText(`https://timefix.com/insights/${state.prefs.workspace.slug}?${new URLSearchParams({ tab, show: kind, ...(range === 'custom' ? { from: ymdOf(from), to: ymdOf(new Date(until.getTime() - 86_400_000)) } : { days: range }) }).toString()}`).then((ok) => toast(ok ? { message: 'View-only link copied, with these filters. It shows numbers, never names.', tone: 'success' } : { message: 'Copy didn’t work. Try again.', tone: 'danger' })); }}>Share</Button>
          </div>
          <div className="tf-home__stats">
            <StatCard label="Bookings and answers" value={cur.length} delta={delta(cur.length, prev.length)} />
            <StatCard label="Meetings in this period" value={booked} delta={delta(booked, prev.filter((e) => e.what === 'booking').length)} />
            <StatCard label="Form answers" value={answered} delta={delta(answered, prev.filter((e) => e.what === 'form').length)} />
            <StatCard label="Form views" value={formsShown.reduce((n, f) => n + f.views, 0)} delta={{ value: 'all time', direction: 'flat' }} />
          </div>
          <div className="tf-home__grid">
            <ChartCard title={step === 1 ? 'Per day' : `Per ${step} days`}><BarChart label="Bookings and answers over time" points={perDay.map((d, i) => ({ id: String(i), label: d.label, value: d.value }))} emptyText="Nothing came in yet in this period." /></ChartCard>
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
                <Select label="Report" isLabelHidden className="tf-rec__view" value={r?.id ?? null} onChange={(v) => { if (v) setReport(v); }} items={reports.map((x) => ({ id: x.id, label: x.name, description: `${(x.object ?? 'deals') === 'deals' ? (x.measure === 'amount' ? 'Deal value' : 'Deals') : x.object === 'people' ? 'People' : 'Companies'} by ${x.group}${x.owner ? `, ${x.owner}'s` : ''}` }))} />
                <span className="tf-rec__spacer" />
                {r && <Button size="sm" variant="ghost" icon={<Pencil {...i14} />} onPress={() => setMaking(r)}>Change</Button>}
                {r && <Button size="sm" variant="ghost" icon={<Trash2 {...i14} />} onPress={() => { const was = r; const at = reports.findIndex((y) => y.id === r.id); dispatch({ type: 'report/remove', id: r.id }); setReport(reports.find((y) => y.id !== r.id)?.id ?? ''); toast({ message: `${was.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'report/set', report: was }); void at; setReport(was.id); } } }); }}>Delete</Button>}
                <Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setMaking('new')}>New report</Button>
              </div>
              {r && (points.every((p) => p.value === 0) ? <p className="tf-rec__muted">Nothing to count yet.</p> : (
                <div className="tf-home__grid">
                  <ChartCard title={r.name}><BarChart label={r.name} points={points} /></ChartCard>
                  <ChartCard title="Share of the total"><DonutChart label={r.name} segments={points.filter((p) => p.value > 0).map((p, n) => ({ id: p.id, label: p.label, value: p.value, valueText: p.valueText, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'gray'] as const)[n % 6] ?? 'gray' }))}
                    total={r.measure === 'amount' && (r.object ?? 'deals') === 'deals' ? inr(points.reduce((n, p) => n + p.value, 0)) : String(points.reduce((n, p) => n + p.value, 0))} /></ChartCard>
                </div>
              ))}
            </>
          )}
        </TabPanel>
      </Tabs>
      {making && <ReportDialog report={making === 'new' ? undefined : making} members={state.members.map((m) => m.name)} onClose={() => setMaking(undefined)} onSave={(x) => { dispatch({ type: 'report/set', report: x }); setReport(x.id); setMaking(undefined); toast({ message: `${x.name} saved`, tone: 'success' }); }} />}
    </div>
  );
}

const GROUPS: Readonly<Record<'deals' | 'people' | 'companies', ReadonlyArray<{ readonly id: Report['group']; readonly label: string }>>> = {
  deals: [{ id: 'stage', label: 'Stage' }, { id: 'owner', label: 'Owner' }, { id: 'company', label: 'Company' }],
  people: [{ id: 'owner', label: 'Owner' }, { id: 'company', label: 'Company' }, { id: 'tag', label: 'Tag' }],
  companies: [{ id: 'industry', label: 'Industry' }, { id: 'owner', label: 'Owner' }, { id: 'city', label: 'City' }],
};

function ReportDialog({ report, members, onClose, onSave }: { readonly report?: Report; readonly members: ReadonlyArray<string>; readonly onClose: () => void; readonly onSave: (r: Report) => void }) {
  const [object, setObject] = useState<'deals' | 'people' | 'companies'>(report?.object ?? 'deals');
  const [measure, setMeasure] = useState<'count' | 'amount'>(report?.measure ?? 'amount');
  const [group, setGroup] = useState<Report['group']>(report?.group ?? 'stage');
  const [owner, setOwner] = useState<string>(report?.owner ?? 'all');
  const [name, setName] = useState(report?.name ?? '');
  const amount = object === 'deals' && measure === 'amount';
  const auto = `${amount ? 'Deal value' : object === 'deals' ? 'Deals' : object === 'people' ? 'People' : 'Companies'} by ${GROUPS[object].find((g) => g.id === group)?.label.toLowerCase() ?? group}`;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={report ? 'Change report' : 'New report'} description="A chart of your records, saved for the team."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => onSave({ id: report?.id ?? newId('rep'), name: name.trim() || auto, object, measure: object === 'deals' ? measure : 'count', group, owner: owner === 'all' ? undefined : owner })}>Save report</Button></>}>
      <div className="tf-rec__form">
        <Select label="Count" value={object} onChange={(v) => { const o = (v ?? 'deals') as 'deals' | 'people' | 'companies'; setObject(o); setGroup(GROUPS[o][0]?.id ?? 'owner'); }} items={[{ id: 'deals', label: 'Deals' }, { id: 'people', label: 'People' }, { id: 'companies', label: 'Companies' }]} />
        {object === 'deals' && <Select label="Measure" value={measure} onChange={(v) => setMeasure(v === 'count' ? 'count' : 'amount')} items={[{ id: 'amount', label: 'Total deal value' }, { id: 'count', label: 'Number of deals' }]} />}
        <Select label="Grouped by" value={group} onChange={(v) => { if (v) setGroup(v as Report['group']); }} items={GROUPS[object]} />
        <Select label="Owned by" value={owner} onChange={(v) => setOwner(v ?? 'all')} items={[{ id: 'all', label: 'Everyone' }, ...members.map((m) => ({ id: m, label: m }))]} />
        <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder={auto} />
      </div>
    </Dialog>
  );
}
