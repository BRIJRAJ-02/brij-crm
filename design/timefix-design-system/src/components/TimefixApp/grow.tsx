// Grow: Links (everything you share in one place: your page, booking pages, forms, the menu; each with Copy, QR, Open and its numbers),
// the Link page editor (beside the phone; Publish keeps it in the workspace), and Insights, one analytics home with two tabs:
// Pages (what came in through your links, from real bookings and form answers) and Reports (saved CRM charts: new, rename, delete).
import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Copy, Download, ExternalLink, FileText, IdCard, MoreHorizontal, Pencil, Plus, QrCode as QrIcon, Share2, Store, Trash2, UtensilsCrossed } from 'lucide-react';
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
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { STAGES, inr, newId, type AppAction, type AppState, type Report } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** The starter page until someone publishes their own. */
export const STARTER: LinkPageDraft = { profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' };
/** Copies text, and says honestly whether it worked. */
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
/** Whose address the links live under: the business's handle, or the host's own name on a team. */
export const handleFor = (state: AppState, bookings: BookingsState | undefined) => bookings?.business?.handle || state.me.split(' ')[0]?.toLowerCase() || 'me';

/** The link page editor: edit beside the phone; Publish keeps it in the workspace. */
export function LinkPageScreen({ state, dispatch, handle, onBack }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly handle: string; readonly onBack: () => void }) {
  const { toast } = useToast();
  const live = state.linkPage ?? STARTER;
  const [seeing, setSeeing] = useState(false);
  const [qr, setQr] = useState(false);
  const url = `timefix.com/${handle}`;
  const copy = () => { void copyText(`https://${url}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Your link is ${url}`, tone: 'danger' })); };
  if (seeing) {
    return (
      <div className="tf-grow__see">
        <div className="tf-forms__guestbar"><Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setSeeing(false)}>Back to editing</Button><span className="tf-rec__muted">{url}</span></div>
        <LinkPage {...live} booking={demoBooking} />
      </div>
    );
  }
  return (
    <div className="tf-grow">
      <div className="tf-rec__bar">
        <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>Links</Button>
        <span className="tf-grow__url tf-num">{url}</span><Tag size="sm" hue={state.linkPage || state.setupDone.includes('link') ? 'green' : 'gray'}>{state.linkPage || state.setupDone.includes('link') ? 'Live' : 'Not published'}</Tag>
        <span className="tf-rec__spacer" />
        <Button variant="ghost" icon={<Copy {...i14} />} onPress={copy}>Copy link</Button>
        <Button variant="ghost" icon={<QrIcon {...i14} />} onPress={() => setQr(true)}>QR code</Button>
        <Button variant="secondary" icon={<ExternalLink {...i14} />} onPress={() => setSeeing(true)}>See it</Button>
      </div>
      <LinkEditor live={live} booking={demoBooking} onPublish={(page) => new Promise<void>((resolve) => { window.setTimeout(() => { dispatch({ type: 'link/publish', page }); resolve(); }, 500); })} />
      {qr && <QrSheet url={url} name="your link page" onClose={() => setQr(false)} />}
    </div>
  );
}

/** One QR code in a dialog, with Download. */
function QrSheet({ url, name, onClose }: { readonly url: string; readonly name: string; readonly onClose: () => void }) {
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
  const handle = handleFor(state, bookings);
  const business = bookings?.business;
  const now = new Date();
  const upcoming = (pageId?: string) => (bookings?.meetings ?? []).filter((m) => (pageId === undefined || m.pageId === pageId) && m.status !== 'cancelled' && m.start > now).length;
  const rows: ReadonlyArray<{ readonly title: string; readonly rows: ReadonlyArray<ShareRow> }> = [
    { title: 'Your page', rows: business
      ? [{ id: 'home', icon: <Store {...i16} />, name: bookings?.workspace ?? 'Your business page', url: `timefix.com/${handle}`, live: business.published, off: 'Not published', numbers: `${upcoming()} upcoming bookings`, open: () => onBookingPage(undefined, 'profile'), edit: () => onBookings('pages'), editLabel: 'Edit page' }]
      : [{ id: 'link', icon: <IdCard {...i16} />, name: 'Link page', url: `timefix.com/${handle}`, live: state.linkPage !== undefined || state.setupDone.includes('link'), off: 'Not published', numbers: `${(state.linkPage ?? STARTER).blocks.length} links`, open: onLinkPage, edit: onLinkPage, editLabel: 'Edit page' }] },
    { title: business ? (business.kind === 'restaurant' ? 'Tables and bookings' : 'Services') : 'Booking pages', rows: (bookings?.pages ?? []).map((p) => ({ id: p.id, icon: <CalendarDays {...i16} />, name: p.name, url: `timefix.com/${handle}/${p.slug}`, live: p.isOn,
      numbers: `${upcoming(p.id)} upcoming`, open: () => onBookingPage(p.id, 'book'), edit: () => onBookings('pages'), editLabel: 'Edit in Bookings' })) },
    ...(bookings?.menu && appsMenu ? [{ title: 'Menu', rows: [{ id: 'menu', icon: <UtensilsCrossed {...i16} />, name: 'Menu', url: `timefix.com/${handle}/menu`, live: true, numbers: `${bookings.menu.dishes.length} dishes`, open: () => onBookingPage(undefined, 'menu'), edit: () => onBookings('menu'), editLabel: 'Edit menu' }] }] : []),
    { title: 'Forms', rows: state.forms.map((f) => ({ id: f.id, icon: <FileText {...i16} />, name: f.name, url: `timefix.com/f/${f.slug}`, live: f.status === 'live', off: f.status === 'draft' ? 'Draft' : 'Paused', numbers: `${f.responses.filter((r) => !r.spam).length} responses`, open: () => onForm(f.id, true), edit: () => onForm(f.id, false), editLabel: 'Edit form' })) },
  ].filter((g) => g.rows.length > 0);
  const copy = (r: ShareRow) => { void copyText(`https://${r.url}`).then((ok) => toast(ok ? { message: `${r.name} link copied`, tone: 'success' } : { message: `Copy didn’t work. The link is ${r.url}`, tone: 'danger' })); };
  return (
    <div className="tf-links">
      <p className="tf-rec__muted">Everything people can open: copy a link, print its QR code, or open it as they see it.</p>
      {rows.map((g) => (
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
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${r.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={r.name} placement="bottom end" onAction={() => r.edit()}><MenuItem id="edit" icon={<Pencil {...i16} />}>{r.editLabel}</MenuItem></Menu>
                  </MenuTrigger>
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

/** Insights: Pages (from real bookings and form answers) and Reports (saved charts of deals). */
export function InsightsScreen({ state, dispatch, bookings }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly bookings: BookingsState | undefined }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('pages');
  const [kind, setKind] = useState('all');
  const [range, setRange] = useState('30');
  const days = Number(range);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  const before = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days);
  // Real events only: bookings made through pages, and form answers. Each has a date.
  const events = (a: Date, b: Date) => [
    ...(kind === 'all' || kind === 'booking' ? (bookings?.meetings ?? []).filter((m) => m.pageId && m.status !== 'cancelled').map((m) => ({ at: m.start, what: 'booking' as const })) : []),
    ...(kind === 'all' || kind === 'forms' ? state.forms.flatMap((f) => f.responses.filter((r) => !r.spam).map((r) => ({ at: r.at, what: 'form' as const }))) : []),
  ].filter((e) => e.at >= a && e.at < b);
  const cur = events(from, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const prev = events(before, from);
  const delta = (a: number, b: number) => (b === 0 ? { value: a ? 'New' : 'None yet', direction: 'flat' as const } : { value: `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`, direction: a > b ? 'up' as const : a < b ? 'down' as const : 'flat' as const, note: 'vs the period before', isGood: a >= b });
  const buckets = Math.min(days, 30);
  const step = Math.max(1, Math.round(days / buckets));
  const perDay = Array.from({ length: buckets }, (_, i) => { const a = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i * step); const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + step); return { label: a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: cur.filter((e) => e.at >= a && e.at < b).length }; });
  const booked = cur.filter((e) => e.what === 'booking').length; const answered = cur.filter((e) => e.what === 'form').length;
  const byPage = [...(bookings?.pages ?? []).map((p) => ({ id: p.id, label: p.name, value: (bookings?.meetings ?? []).filter((m) => m.pageId === p.id && m.status !== 'cancelled' && m.start >= from).length })),
    ...state.forms.map((f) => ({ id: f.id, label: f.name, value: f.responses.filter((r) => !r.spam && r.at >= from).length }))].filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  const exportCsv = async () => { const csv = ['Date,Bookings and answers', ...perDay.map((d) => `${d.label},${d.value}`)].join('\n'); const o = await saveFile(`insights-${range}d.csv`, new Blob([csv], { type: 'text/csv' })); if (o === 'saved') toast({ message: 'Exported', tone: 'success' }); };

  const reports = state.reports;
  const [report, setReport] = useState(reports[0]?.id ?? '');
  const [making, setMaking] = useState<Report | 'new'>();
  const r = reports.find((x) => x.id === report) ?? reports[0];
  const groups = r?.group === 'stage' ? STAGES.map((s) => ({ key: s, deals: state.deals.filter((d) => d.stage === s) })) : state.members.map((m) => ({ key: m.name, deals: state.deals.filter((d) => d.owner === m.name) }));
  const points = groups.map((g) => ({ id: g.key, label: r?.group === 'owner' ? g.key.split(' ')[0] ?? g.key : g.key, value: r?.measure === 'amount' ? g.deals.reduce((n, d) => n + d.amount, 0) : g.deals.length, valueText: r?.measure === 'amount' ? inr(g.deals.reduce((n, d) => n + d.amount, 0)) : String(g.deals.length) }));
  return (
    <div className="tf-grow tf-grow--wide">
      <Tabs aria-label="Insights" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'pages', label: 'Pages' }, { id: 'reports', label: 'Reports', count: reports.length }]}>
        <TabPanel id="pages" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="What" isLabelHidden className="tf-rec__view" value={kind} onChange={(v) => setKind(v ?? 'all')}
              items={[{ id: 'all', label: 'Everything' }, { id: 'booking', label: 'Booking pages' }, { id: 'forms', label: 'Forms' }]} />
            <Select label="When" isLabelHidden className="tf-you__select" value={range} onChange={(v) => setRange(v ?? '30')}
              items={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }, { id: '365', label: 'Last 12 months' }]} />
            <span className="tf-rec__spacer" />
            <Button variant="ghost" icon={<Download {...i14} />} onPress={() => { void exportCsv(); }}>Export CSV</Button>
            <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => { void copyText(`https://timefix.com/insights/${state.prefs.workspace.slug}-${range}d`).then((ok) => toast(ok ? { message: 'View-only link copied. It shows numbers, never names.', tone: 'success' } : { message: 'Copy didn’t work. Try again.', tone: 'danger' })); }}>Share</Button>
          </div>
          <div className="tf-home__stats">
            <StatCard label="Bookings and answers" value={cur.length} delta={delta(cur.length, prev.length)} />
            <StatCard label="Booked" value={booked} delta={delta(booked, prev.filter((e) => e.what === 'booking').length)} />
            <StatCard label="Form answers" value={answered} delta={delta(answered, prev.filter((e) => e.what === 'form').length)} />
            <StatCard label="Form views" value={state.forms.reduce((n, f) => n + f.views, 0)} delta={{ value: 'all time', direction: 'flat' }} />
          </div>
          <div className="tf-home__grid">
            <ChartCard title={step === 1 ? 'Per day' : `Per ${step} days`}><BarChart label="Bookings and answers over time" points={perDay.map((d, i) => ({ id: String(i), label: d.label, value: d.value }))} emptyText="Nothing came in yet in this period." /></ChartCard>
            <ChartCard title="Which pages and forms">{byPage.length ? <BarList label="By page" items={byPage} /> : <p className="tf-rec__muted">Nothing came in yet in this period.</p>}</ChartCard>
          </div>
        </TabPanel>
        <TabPanel id="reports" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="Report" isLabelHidden className="tf-rec__view" value={r?.id ?? null} onChange={(v) => { if (v === 'new') setMaking('new'); else if (v) setReport(v); }}
              items={[...reports.map((x) => ({ id: x.id, label: x.name })), { id: 'new', label: 'New report…' }]} />
            {r && <MenuTrigger>
              <IconButton label="More for this report"><MoreHorizontal {...i16} /></IconButton>
              <Menu aria-label="Report" placement="bottom end" onAction={(k) => {
                if (k === 'edit') setMaking(r);
                else if (k === 'delete') { const was = r; dispatch({ type: 'report/remove', id: r.id }); setReport(reports.find((x) => x.id !== r.id)?.id ?? ''); toast({ message: `${was.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'report/set', report: was }); setReport(was.id); } } }); }
              }}>
                <MenuItem id="edit" icon={<Pencil {...i16} />}>Rename or change</MenuItem>
                <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete report</MenuItem>
              </Menu>
            </MenuTrigger>}
            <span className="tf-rec__spacer" />
            <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setMaking('new')}>New report</Button>
          </div>
          {!r ? <EmptyState icon={<FileText size={20} strokeWidth={1.75} />} title="No reports yet" description="Chart your deals by stage or owner, and keep it for the team." action={<Button size="sm" variant="primary" onPress={() => setMaking('new')}>New report</Button>} /> : (
            <div className="tf-home__grid">
              <ChartCard title={r.name}><BarChart label={r.name} points={points} /></ChartCard>
              <ChartCard title="Share of the total"><DonutChart label={r.name} segments={points.map((p, n) => ({ id: p.id, label: p.label, value: p.value, valueText: p.valueText, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'gray'] as const)[n % 6] ?? 'gray' }))}
                total={r.measure === 'amount' ? inr(points.reduce((n, p) => n + p.value, 0)) : String(points.reduce((n, p) => n + p.value, 0))} /></ChartCard>
            </div>
          )}
        </TabPanel>
      </Tabs>
      {making && <ReportDialog report={making === 'new' ? undefined : making} onClose={() => setMaking(undefined)} onSave={(x) => { dispatch({ type: 'report/set', report: x }); setReport(x.id); setMaking(undefined); toast({ message: `${x.name} saved`, tone: 'success' }); }} />}
    </div>
  );
}

function ReportDialog({ report, onClose, onSave }: { readonly report?: Report; readonly onClose: () => void; readonly onSave: (r: Report) => void }) {
  const [measure, setMeasure] = useState<'count' | 'amount'>(report?.measure ?? 'amount');
  const [group, setGroup] = useState<'stage' | 'owner'>(report?.group ?? 'stage');
  const [name, setName] = useState(report?.name ?? '');
  const auto = `${measure === 'amount' ? 'Deal value' : 'Deals'} by ${group}`;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={report ? 'Change report' : 'New report'} description="A chart of your deals, saved for the team."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => onSave({ id: report?.id ?? newId('rep'), name: name.trim() || auto, measure, group })}>Save report</Button></>}>
      <div className="tf-rec__form">
        <Select label="Measure" value={measure} onChange={(v) => setMeasure(v === 'count' ? 'count' : 'amount')} items={[{ id: 'amount', label: 'Total deal value' }, { id: 'count', label: 'Number of deals' }]} />
        <Select label="Grouped by" value={group} onChange={(v) => setGroup(v === 'owner' ? 'owner' : 'stage')} items={[{ id: 'stage', label: 'Stage' }, { id: 'owner', label: 'Owner' }]} />
        <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder={auto} />
      </div>
    </Dialog>
  );
}
