// Grow, Wave D1: the link page's share tools, its insights, team pages and claiming a handle; Insights' sessions, sources, where
// people stop, named share links (scope, expiry, revoke asks) and the read-only page someone opens from one. All local state.
import { useRef, useState } from 'react';
import { Copy, Download, Mail, MessageCircle, Plus, QrCode as QrIcon, Trash2, X as XIcon } from 'lucide-react';
import { SocialMark } from '../SocialLinks/SocialLinks.tsx';
import type { Selection } from 'react-aria-components';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog, FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { StatCard } from '../Card/Card.tsx';
import { BarChart, BarList, ChartCard } from '../Chart/Chart.tsx';
import { DataGrid, type GridColumn } from '../DataGrid/DataGrid.tsx';
import { DescriptionList } from '../DescriptionList/DescriptionList.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { BarChart3 } from 'lucide-react';
import type { LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { newId, type AppAction, type AppState, type Visit } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);
const DAY = 86_400_000;

/* ---------- Link page: share, insights, team pages, claim ---------- */

/** The link page's own numbers: views over 30 days against the 30 before, clicks per link, sources. */
export function LinkInsightsDrawer({ state, page, pageKey = 'link', onClose }: { readonly state: AppState; readonly page: LinkPageDraft; readonly pageKey?: string; readonly onClose: () => void }) {
  const now = Date.now();
  const all = (state.visits ?? []).filter((v) => v.page === pageKey);
  const cur = all.filter((v) => v.at.getTime() >= now - 30 * DAY); const prev = all.filter((v) => v.at.getTime() >= now - 60 * DAY && v.at.getTime() < now - 30 * DAY);
  const presses = cur.filter((v) => v.finished).length;
  const perDay = Array.from({ length: 30 }, (_, i) => { const a = now - (30 - i) * DAY; return { id: String(i), label: new Date(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: cur.filter((v) => v.at.getTime() >= a && v.at.getTime() < a + DAY).length }; });
  const links = page.blocks.filter((b) => b.kind === 'link' && !b.archived).map((b) => ({ id: b.id, label: b.kind === 'link' ? b.title || 'Untitled' : '', value: b.kind === 'link' ? b.clicks ?? 0 : 0 })).sort((a, b) => b.value - a.value);
  const sources = [...cur.reduce((m, v) => m.set(v.source, (m.get(v.source) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ id: s, label: s, value: c }));
  const change = prev.length === 0 ? '' : cur.length === prev.length ? ', the same as the 30 days before.' : `, ${cur.length > prev.length ? 'up' : 'down'} from ${prev.length} in the 30 days before.`;
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Link page insights" subtitle={cur.length ? `${cur.length} views in the last 30 days${change}` : 'No views yet in the last 30 days.'} width="lg">
      <div className="tf-fp__sub">
        <div className="tf-home__stats tf-gp__stats"><StatCard label="Views" value={cur.length} delta={{ value: prev.length ? `${cur.length >= prev.length ? '+' : ''}${Math.round(((cur.length - prev.length) / prev.length) * 100)}%` : 'none before', direction: cur.length > prev.length ? 'up' : cur.length < prev.length ? 'down' : 'flat', note: 'vs 30 days before', isGood: cur.length >= prev.length }} />
          <StatCard label="Link presses" value={presses} delta={{ value: `${cur.length ? Math.round((presses / cur.length) * 100) : 0}% of views`, direction: 'flat' }} /></div>
        <ChartCard title="Views per day"><BarChart label="Link page views per day" points={perDay} emptyText="No views yet." /></ChartCard>
        <ChartCard title="Clicks by link">{links.some((l) => l.value) ? <BarList label="Clicks by link" items={links} /> : <p className="tf-rec__muted">No clicks yet.</p>}</ChartCard>
        <ChartCard title="Sources">{sources.length ? <BarList label="Views by source" items={sources} /> : <p className="tf-rec__muted">No views yet.</p>}</ChartCard>
      </div>
    </Drawer>
  );
}

/** Team pages: teammates' link pages you run, invited or live, with Copy, Remove (asks) and Invite. */
export function TeamPagesDialog({ state, dispatch, onClose }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onClose: () => void }) {
  const { toast } = useToast();
  const pages = state.teamPages ?? [];
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [removing, setRemoving] = useState<string>();
  const handle = name.trim().split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const badEmail = email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const taken = pages.some((p) => p.handle === handle || p.email.toLowerCase() === email.trim().toLowerCase());
  const gone = pages.find((p) => p.id === removing);
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title="Team pages" description="Link pages for your teammates, run from here. Each one lives at their own address." actions={<Button variant="primary" slot="close">Done</Button>}>
      <div className="tf-rec__form">
        {pages.length === 0 ? <p className="tf-rec__muted">No team pages yet. Invite a teammate below.</p> : <ul className="tf-set__list" aria-label="Team pages">{pages.map((p) => (
          <li key={p.id}><span className="tf-fp__ending"><strong>{p.name}</strong><span className="tf-rec__muted tf-num">timefix.com/{p.handle} · {p.status === 'live' ? `${p.blocks} blocks` : `invited ${p.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span></span>
            <span className="tf-set__row"><Tag size="sm" hue={p.status === 'live' ? 'green' : 'gray'}>{p.status === 'live' ? 'Live' : 'Invited'}</Tag>
              <IconButton size="sm" label={`Copy ${p.name}'s link`} isDisabled={p.status !== 'live'} onPress={() => { void copyText(`https://timefix.com/${p.handle}`).then((ok) => toast(ok ? { message: 'Link copied.', tone: 'success' } : { message: 'The link didn’t copy.', tone: 'danger' })); }}><Copy {...i14} /></IconButton>
              <IconButton size="sm" label={`Remove ${p.name}'s page`} onPress={() => setRemoving(p.id)}><Trash2 {...i14} /></IconButton></span></li>))}</ul>}
        <div className="tf-bkf__group"><span className="tf-bkf__label">Invite a teammate</span>
          <div className="tf-bkf__pair"><TextField label="Name" value={name} onChange={setName} placeholder="Jo Mendes" /><TextField label="Email" value={email} onChange={setEmail} placeholder="jo@northwind.com" isInvalid={badEmail || (taken && email.trim() !== '')} errorMessage={taken ? 'They have a page already.' : 'That email looks incomplete.'} /></div>
          <span className="tf-set__row"><Button size="sm" variant="secondary" icon={<Plus {...i14} />} isDisabled={!name.trim() || !email.trim() || badEmail || taken} onPress={() => { dispatch({ type: 'team/pages', pages: [...pages, { id: newId('tp'), name: name.trim(), email: email.trim(), handle, status: 'invited', blocks: 0, at: new Date() }] }); toast({ message: `Invited ${name.trim().split(' ')[0]} to timefix.com/${handle}.`, tone: 'success' }); setName(''); setEmail(''); }}>Send invite</Button>
            {handle && <span className="tf-rec__muted tf-num">timefix.com/{handle}</span>}</span>
        </div>
      </div>
      {gone && <Dialog isOpen onOpenChange={(o) => { if (!o) setRemoving(undefined); }} title={`Remove ${gone.name}’s page?`} description={`timefix.com/${gone.handle} stops working at once. ${gone.name.split(' ')[0]} keeps their account.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { dispatch({ type: 'team/pages', pages: pages.filter((p) => p.id !== gone.id) }); setRemoving(undefined); toast({ message: `${gone.name}’s page removed.` }); }}>Remove page</Button></>} />}
    </Dialog>
  );
}

const RESERVED = new Set(['admin', 'help', 'api', 'www', 'app', 'login', 'settings', 'f', 'b', 'insights', 'timefix']);
/** Claim your link: pick the address the page goes live at. */
export function ClaimHandle({ state, dispatch, suggestion }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly suggestion: string }) {
  const { toast } = useToast();
  const [v, setV] = useState(suggestion);
  const clean = v.trim().toLowerCase();
  const bad = !/^[a-z0-9-]{2,30}$/.test(clean); const taken = RESERVED.has(clean) || (state.teamPages ?? []).some((p) => p.handle === clean);
  return (
    <Callout tone="info" action={{ label: 'Claim', onPress: () => { if (bad || taken) return; dispatch({ type: 'link/handle', handle: clean }); toast({ message: `timefix.com/${clean} is yours.`, tone: 'success' }); } }}>
      <span className="tf-gp__claim"><strong>Claim your link</strong><span>Your page goes live at this address.</span>
        <TextField aria-label="Your link" value={v} onChange={(x) => setV(x.toLowerCase().replace(/[^a-z0-9-]/g, ''))} icon={<span className="tf-rec__muted tf-num">timefix.com/</span>} isInvalid={v !== '' && (bad || taken)} errorMessage={taken ? 'That link is taken. Try another.' : 'Use 2 to 30 letters, numbers or hyphens.'} /></span>
    </Callout>
  );
}

/* ---------- Insights ---------- */

/** One visit as Insights shows it: its page's name and kind, how far it got, and who, when a submission can be opened. */
export interface Session extends Visit { readonly name: string; readonly kind: 'form' | 'link' | 'booking'; readonly step: string; readonly person?: string }

/** Every visit to a public page in a period: form and link page visits, and each booking as a finished booking page visit. */
export function sessionsOf(state: AppState, bookings: BookingsState | undefined, from: Date, until: Date): ReadonlyArray<Session> {
  const linkName = 'Link page';
  const v: Session[] = (state.visits ?? []).filter((x) => x.at >= from && x.at < until).flatMap((x): Session[] => {
    if (x.page === 'link') return [{ ...x, name: linkName, kind: 'link', step: x.finished ? 'Link pressed' : 'Viewed' }];
    const f = state.forms.find((y) => `form:${y.id}` === x.page); if (!f) return [];
    const qs = (f.live ?? f.questions).filter((q) => q.kind !== 'hidden');
    const r = x.ref ? f.responses.find((y) => y.id === x.ref) : undefined;
    const nameQ = qs.find((q) => /name/i.test(q.title) && q.kind === 'short');
    return [{ ...x, name: f.name, kind: 'form', step: x.finished ? 'Submitted' : x.reached === 0 ? 'Viewed' : qs[Math.min(x.reached, qs.length) - 1]?.title ?? 'Started', person: r && nameQ ? r.answers[nameQ.id] : undefined }];
  });
  const b: Session[] = (bookings?.meetings ?? []).filter((m) => m.pageId && m.status !== 'cancelled' && m.start >= from && m.start < until).map((m) => ({ id: `vm-${m.id}`, at: m.start, page: `booking:${m.pageId ?? ''}`, source: 'Direct', reached: 3, finished: true, ref: m.id, name: bookings?.pages.find((p) => p.id === m.pageId)?.name ?? 'Booking page', kind: 'booking', step: 'Booked', person: m.invitee.name }));
  return [...v, ...b].sort((a, c) => c.at.getTime() - a.at.getTime());
}

/** Whether a session belongs to what the picker shows: everything, a kind, or one page. */
export const inScope = (s: Session, kind: string) => kind === 'all' || (kind === 'forms' && s.kind === 'form') || (kind === 'booking' && s.kind === 'booking') || (kind === 'link' && s.kind === 'link') || s.page === kind.replace(/^page:/, 'booking:');

/** The figures, chart, sources and where people stop, for the Pages tab and the shared page alike. Never names. */
export function InsightsNumbers({ state, sessions, prev, kind, days, isShared = false }: { readonly state: AppState; readonly sessions: ReadonlyArray<Session>; readonly prev: ReadonlyArray<Session>; readonly kind: string; readonly days: number; /** On the shared page: no prompt to pick a page. */ readonly isShared?: boolean }) {
  const fin = sessions.filter((s) => s.finished); const pfin = prev.filter((s) => s.finished);
  const rate = sessions.length ? Math.round((fin.length / sessions.length) * 100) : 0; const prate = prev.length ? Math.round((pfin.length / prev.length) * 100) : 0;
  const timed = fin.map((s) => s.secs ?? 0).filter((x) => x > 0); const avg = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : undefined;
  const ptimed = pfin.map((s) => s.secs ?? 0).filter((x) => x > 0); const pavg = ptimed.length ? Math.round(ptimed.reduce((a, b) => a + b, 0) / ptimed.length) : undefined;
  const delta = (a: number, b: number) => (b === 0 ? { value: a ? `None the ${days} days before` : 'No visits', direction: 'flat' as const } : { value: `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`, direction: a > b ? 'up' as const : a < b ? 'down' as const : 'flat' as const, note: `on the ${days} days before`, isGood: a >= b });
  const step = days > 31 ? 7 : 1; const start = Date.now() - days * DAY;
  const perDay = Array.from({ length: Math.ceil(days / step) }, (_, i) => { const a = start + i * step * DAY; return { id: String(i), label: new Date(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: sessions.filter((s) => s.at.getTime() >= a && s.at.getTime() < a + step * DAY).length }; });
  const sources = [...sessions.reduce((m, s) => m.set(s.source, (m.get(s.source) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ id: s, label: s, value: c }));
  const t = (x: number) => (x < 60 ? `${x}s` : `${Math.floor(x / 60)}m ${x % 60}s`);
  // Where people stop needs one kind of page: a form's questions, the link page's press, or all forms' start and submit.
  const form = kind.startsWith('form:') ? state.forms.find((f) => `form:${f.id}` === kind) : undefined;
  const funnel = form ? [{ id: 'v', label: 'Viewed', n: sessions.length }, ...(form.live ?? form.questions).filter((q) => q.kind !== 'hidden').map((q, i) => ({ id: q.id, label: q.title || 'A question with no words', n: sessions.filter((s) => s.reached >= i + 1).length })), { id: 'f', label: 'Submitted', n: fin.length }]
    : kind === 'forms' ? [{ id: 'v', label: 'Viewed', n: sessions.length }, { id: 's', label: 'Started', n: sessions.filter((s) => s.reached > 0).length }, { id: 'f', label: 'Submitted', n: fin.length }]
      : kind === 'link' ? [{ id: 'v', label: 'Viewed', n: sessions.length }, { id: 'f', label: 'Link pressed', n: fin.length }] : undefined;
  const worst = funnel ? funnel.slice(1).reduce<{ readonly at: number; readonly lost: number }>((w, s, i) => { const lost = (funnel[i]?.n ?? 0) - s.n; return lost > w.lost ? { at: i + 1, lost } : w; }, { at: -1, lost: 0 }) : { at: -1 };
  return (
    <>
      <div className="tf-home__stats">
        <StatCard label="Visits" value={sessions.length} delta={delta(sessions.length, prev.length)} />
        <StatCard label="Finishes" value={fin.length} delta={delta(fin.length, pfin.length)} />
        <StatCard label="Finish rate" value={rate} format={(x) => `${x}%`} delta={{ value: prev.length ? `${rate - prate >= 0 ? '+' : ''}${rate - prate} points on the period before` : `${fin.length} of ${sessions.length}`, direction: rate > prate ? 'up' : rate < prate ? 'down' : 'flat', isGood: rate >= prate }} />
        <StatCard label="Average time to finish" value={avg} format={t} delta={avg === undefined ? { value: 'No finish timed yet', direction: 'flat' } : pavg === undefined ? { value: `From ${timed.length} timed`, direction: 'flat' } : { value: avg <= pavg ? `${t(pavg - avg)} faster than before` : `${t(avg - pavg)} slower than before`, direction: avg <= pavg ? 'up' : 'down', isGood: avg <= pavg }} />
      </div>
      <div className="tf-home__grid">
        <ChartCard title={step === 1 ? 'Visits by day' : 'Visits by week'}><BarChart label="Visits over time" look="dots" points={perDay} emptyText="No visits in this period." /></ChartCard>
        <ChartCard title="Sources">{sources.length ? <BarList label="Visits by source" items={sources} /> : <p className="tf-rec__muted">No visits in this period.</p>}</ChartCard>
      </div>
      {(funnel || !isShared) && <section className="tf-recp__sec"><h3>Where people stop</h3>
        {!funnel ? <p className="tf-rec__muted">Pick one kind of page to see where people stop.</p> : sessions.length === 0 ? <p className="tf-rec__muted">No visits in this period.</p> : (
          <ul className="tf-forms__drop tf-forms__drop--funnel" aria-label="People reaching each step">
            {funnel.map((s, i) => { const pct = Math.round((Math.min(s.n, sessions.length) / sessions.length) * 100); return (
              <li key={s.id} data-worst={i === worst.at || undefined}><span className="tf-forms__funq"><span className="tf-num tf-rec__muted">{i}</span>{s.label}{i === worst.at && <Tag size="sm" hue="orange">Most leave here</Tag>}</span>
                <span className="tf-forms__bar" aria-hidden><span data-w={Math.round(pct / 10) * 10} /></span><span className="tf-num tf-rec__muted">{s.n} · {pct}%</span></li>); })}
          </ul>)}
      </section>}
    </>
  );
}

/** Sessions: each visit in the period, newest first, filtered by outcome and source, with Show more and a details drawer. */
export function SessionsTable({ sessions }: { readonly sessions: ReadonlyArray<Session> }) {
  const [outcome, setOutcome] = useState('any'); const [source, setSource] = useState('any'); const [shown, setShown] = useState(15);
  const [open, setOpen] = useState<string>(); const [picked, setPicked] = useState<Selection>(new Set());
  const rows = sessions.filter((s) => (outcome === 'any' || (outcome === 'done' ? s.finished : !s.finished)) && (source === 'any' || s.source === source));
  const columns: ReadonlyArray<GridColumn> = [{ id: 'name', name: 'Page', type: 'name', width: 200, isReadOnly: true }, { id: 'when', name: 'When', type: 'text', width: 140, isReadOnly: true }, { id: 'source', name: 'Source', type: 'text', width: 130, isReadOnly: true },
    { id: 'outcome', name: 'Outcome', type: 'status', width: 120, isReadOnly: true, options: [{ id: 'Finished', label: 'Finished', hue: 'green' }, { id: 'Left', label: 'Left', hue: 'gray' }] }, { id: 'step', name: 'Got to', type: 'text', width: 200, isReadOnly: true }, { id: 'person', name: 'Person', type: 'text', width: 150, isReadOnly: true }];
  const s = sessions.find((x) => x.id === open);
  return (
    <section className="tf-recp__sec" aria-label="Sessions"><h3>Sessions</h3>
      <div className="tf-rec__bar">
        <Select label="Outcome" isLabelHidden className="tf-you__select" value={outcome} onChange={(v) => { setOutcome(v ?? 'any'); setShown(15); }} items={[{ id: 'any', label: 'Any outcome' }, { id: 'done', label: 'Finished' }, { id: 'left', label: 'Left part way' }]} />
        <Select label="Source" isLabelHidden className="tf-you__select" value={source} onChange={(v) => { setSource(v ?? 'any'); setShown(15); }} items={[{ id: 'any', label: 'Any source' }, ...[...new Set(sessions.map((x) => x.source))].map((x) => ({ id: x, label: x }))]} />
        <span className="tf-rec__spacer" /><span className="tf-rec__muted">Names show only for submissions and bookings you can open.</span>
      </div>
      {rows.length === 0 ? <p className="tf-rec__muted">No sessions match.</p> : <>
        <DataGrid label="Sessions" columns={columns} selectedKeys={picked} onSelectionChange={setPicked} onRowAction={setOpen}
          rows={rows.slice(0, shown).map((x) => ({ id: x.id, values: { when: x.at.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), name: x.name, source: x.source, outcome: x.finished ? 'Finished' : 'Left', step: x.step, person: x.person ?? '' } }))}
          summary={<span className="tf-rec__muted tf-num">{rows.length > shown ? `${shown} of ${rows.length} shown` : `${rows.length} sessions`}</span>} />
        {rows.length > shown && <span><Button size="sm" variant="secondary" onPress={() => setShown((n) => n + 15)}>Show more</Button></span>}</>}
      {s && <Drawer isOpen onOpenChange={(o) => { if (!o) setOpen(undefined); }} title="Session details" subtitle={s.at.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}>
        <DescriptionList label="Session details" items={[{ id: 'p', label: 'Page', value: s.name, isReadOnly: true }, { id: 'o', label: 'Outcome', value: s.finished ? 'Finished' : 'Left', isReadOnly: true }, { id: 'g', label: 'Got to', value: s.step, isReadOnly: true },
          { id: 's', label: 'Source', value: s.source, isReadOnly: true }, { id: 'm', label: 'Medium', value: s.medium, isReadOnly: true, placeholder: 'None' }, { id: 'c', label: 'Campaign', value: s.campaign, isReadOnly: true, placeholder: 'None' },
          { id: 't', label: 'Time to finish', value: s.secs ? `${s.secs}s` : undefined, isReadOnly: true, placeholder: 'Not timed' }, { id: 'w', label: 'Person', value: s.person, isReadOnly: true, placeholder: 'Not known' }]} />
      </Drawer>}
    </section>
  );
}

/** Named view-only links to Insights: make one (name, pages, expiry), copy it, see the ones shared, revoke (asks). */
export function InsightsShareDialog({ state, dispatch, kinds, onClose, onOpen }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly kinds: ReadonlyArray<{ readonly id: string; readonly label: string }>; readonly onClose: () => void; readonly onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const shares = state.insightsShares ?? [];
  const [name, setName] = useState(''); const [pages, setPages] = useState<ReadonlySet<string>>(new Set(['all'])); const [expiry, setExpiry] = useState('month'); const [days, setDays] = useState('30');
  const [made, setMade] = useState<string>(); const [revoking, setRevoking] = useState<string>(); const [tried, setTried] = useState(false);
  const urlOf = (key: string) => `https://timefix.com/insights/${state.prefs.workspace.slug}?k=${key}`;
  const live = shares.filter((s) => !s.revoked && (!s.expires || s.expires > new Date()));
  const copy = (u: string) => { void copyText(u).then((ok) => toast(ok ? { message: 'Link copied.', tone: 'success' } : { message: 'Couldn’t copy. Select the link and copy it.', tone: 'danger' })); };
  const create = () => {
    setTried(true); if (!name.trim()) return;
    const key = Math.random().toString(36).slice(2, 12);
    const share = { id: newId('sh'), name: name.trim(), key, pages: pages.has('all') || pages.size === 0 ? ['all'] : [...pages], days, made: new Date(), expires: expiry === 'never' ? undefined : new Date(Date.now() + (expiry === 'week' ? 7 : 30) * DAY) };
    dispatch({ type: 'insights/shares', shares: [share, ...shares] }); setMade(share.id); setName(''); setTried(false);
  };
  const just = shares.find((x) => x.id === made);
  const gone = shares.find((x) => x.id === revoking);
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title="Share these numbers" description="Anyone with the link sees the tiles, the chart, where people stop and sources. Never who they are." actions={<Button variant="primary" slot="close">Done</Button>}>
      <div className="tf-rec__form">
        {just && <Callout tone="success" action={{ label: 'Copy link', onPress: () => copy(urlOf(just.key)) }}>{`“${just.name}” is made. Copy it now: it won’t show again.`}</Callout>}
        <div className="tf-bkf__pair">
          <TextField label="Name" value={name} onChange={setName} placeholder="For the client" isInvalid={tried && !name.trim()} errorMessage="Name the link, so you know it later." />
          <Select label="Expires" value={expiry} onChange={(v) => setExpiry(v ?? 'month')} items={[{ id: 'week', label: 'In a week' }, { id: 'month', label: 'In a month' }, { id: 'never', label: 'Never' }]} />
        </div>
        <ChoiceChips label="Pages" selectionMode="multiple" size="sm" selectedKeys={pages} items={[{ id: 'all', label: 'All pages' }, ...kinds.map((k) => ({ id: k.id, label: k.label }))]}
          onSelectionChange={(k) => { const n = new Set(k); if (n.has('all') && !pages.has('all')) setPages(new Set(['all'])); else { n.delete('all'); setPages(n.size ? n : new Set(['all'])); } }} />
        <span className="tf-set__row"><Select label="Period" isLabelHidden className="tf-you__select" value={days} onChange={(v) => setDays(v ?? '30')} items={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }]} />
          <Button variant="secondary" icon={<Plus {...i14} />} onPress={create}>Create link</Button></span>
        <div className="tf-bkf__group"><span className="tf-bkf__label">Links you’ve shared</span>
          {shares.length === 0 ? <p className="tf-rec__muted">No links yet.</p> : <ul className="tf-set__list" aria-label="Links you’ve shared">{shares.map((x) => { const on = live.some((y) => y.id === x.id); return (
            <li key={x.id}><span className="tf-fp__ending"><strong>{x.name}</strong><span className="tf-rec__muted tf-num">{x.pages.includes('all') ? 'All pages' : `${x.pages.length} ${x.pages.length === 1 ? 'page' : 'pages'}`} · made {x.made.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {x.revoked ? 'Revoked' : x.expires ? `${on ? 'Expires' : 'Expired'} ${x.expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Never expires'}</span></span>
              <span className="tf-set__row">{on ? <><Button size="sm" variant="ghost" onPress={() => onOpen(x.id)}>Open</Button><Button size="sm" variant="ghost" icon={<Copy {...i14} />} onPress={() => copy(urlOf(x.key))}>Copy</Button><Button size="sm" variant="ghost" onPress={() => setRevoking(x.id)}>Revoke</Button></> : <Tag size="sm" hue="gray">{x.revoked ? 'Revoked' : 'Expired'}</Tag>}</span></li>); })}</ul>}
        </div>
      </div>
      {gone && <Dialog isOpen onOpenChange={(o) => { if (!o) setRevoking(undefined); }} title={`Revoke “${gone.name}”?`} description="The link stops working at once. Anyone holding it sees nothing."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { dispatch({ type: 'insights/shares', shares: shares.map((y) => (y.id === gone.id ? { ...y, revoked: true } : y)) }); setRevoking(undefined); toast({ message: 'Link revoked. It opens nothing now.' }); }}>Revoke</Button></>} />}
    </Dialog>
  );
}

/** The page someone opens from a shared Insights link: the workspace's name, the numbers for what it covers, read only, never names. */
export function SharedInsights({ state, bookings, shareId, onClose }: { readonly state: AppState; readonly bookings: BookingsState | undefined; readonly shareId?: string; readonly onClose: () => void }) {
  const shares = state.insightsShares ?? [];
  const share = shareId ? shares.find((x) => x.id === shareId) : shares.find((x) => !x.revoked && (!x.expires || x.expires > new Date()));
  const ok = share && !share.revoked && (!share.expires || share.expires > new Date());
  const days = Number(share?.days ?? '30');
  const now = new Date(); const from = new Date(now.getTime() - days * DAY); const before = new Date(from.getTime() - days * DAY);
  const scope = (s: Session) => !share || share.pages.includes('all') || share.pages.some((k) => inScope(s, k));
  const cur = sessionsOf(state, bookings, from, new Date(now.getTime() + DAY)).filter(scope);
  const prev = sessionsOf(state, bookings, before, from).filter(scope);
  const kind = share && !share.pages.includes('all') && share.pages.length === 1 ? share.pages[0] ?? 'all' : 'all';
  return (
    <FullScreenDialog aria-label="Shared Insights" onOpenChange={(o) => { if (!o) onClose(); }} className="tf-gp__shared">
      <div className="tf-pframe__demobar"><span className="tf-pframe__demolabel">Demo · what someone with a shared Insights link sees</span><span className="tf-rec__spacer" /><Button size="sm" variant="secondary" icon={<XIcon {...i14} />} onPress={onClose}>Close demo</Button></div>
      <div className="tf-gp__sharedbody">
        {!ok ? <EmptyState icon={<BarChart3 size={20} strokeWidth={1.75} />} title="This link doesn’t open anything" description="It may have been revoked or have expired. Ask whoever sent it for a new one." /> : (
          <div className="tf-gp__sharedcol">
            <header className="tf-gp__sharedhead"><div><span className="tf-rec__muted">Shared by {state.prefs.workspace.name}</span><h1 className="tf-gp__sharedtitle">{share.name}</h1></div>
              <span className="tf-rec__muted tf-num">Last {days} days · {share.pages.includes('all') ? 'All pages' : `${share.pages.length} ${share.pages.length === 1 ? 'page' : 'pages'}`}</span></header>
            {cur.length === 0 ? <EmptyState icon={<BarChart3 size={20} strokeWidth={1.75} />} title="No visits in this period" description="The numbers show here as soon as people visit." /> : <InsightsNumbers state={state} sessions={cur} prev={prev} kind={kind} days={days} isShared />}
            <a className="tf-hform__foot" href="https://www.timefix.com" target="_blank" rel="noreferrer"><span>Powered by</span><Logo size={16} /></a>
          </div>
        )}
      </div>
    </FullScreenDialog>
  );
}

/** Saves the shown sessions as a CSV. */
export function sessionsCsv(sessions: ReadonlyArray<Session>): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [['When', 'Page', 'Source', 'Medium', 'Campaign', 'Outcome', 'Got to'].map(esc).join(','), ...sessions.map((s) => [s.at.toISOString(), s.name, s.source, s.medium ?? '', s.campaign ?? '', s.finished ? 'Finished' : 'Left', s.step].map(esc).join(','))].join('\n');
}
/** The QR icon, re-exported for the links list's menu. */
export const QrGlyph = QrIcon;
