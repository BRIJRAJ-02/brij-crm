// Grow: the Link page (its editor beside the phone, Live, Copy, See it, QR) and Insights, one analytics home with two tabs:
// Pages (forms, booking pages, the link page: visits, finishes, sources; CSV and a read-only share link) and Reports (saved CRM charts and New report).
import { useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, ExternalLink, Plus, QrCode as QrIcon, Share2 } from 'lucide-react';
import { LinkEditor, type LinkPageDraft } from '../LinkEditor/LinkEditor.tsx';
import { LinkPage } from '../LinkPage/LinkPage.tsx';
import { demoBlocks, demoBooking, demoProfile, demoSocials } from '../LinkPage/LinkPage.demo.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { BarChart, BarList, ChartCard, DonutChart } from '../Chart/Chart.tsx';
import { StatCard } from '../Card/Card.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Select } from '../Select/Select.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { TextField } from '../Field/Field.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { STAGES, inr, newId, type AppState } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** The link page: edit beside the phone; Publish makes it live at timefix.com/<handle>. */
export function LinkPageScreen() {
  const { toast } = useToast();
  const [live, setLive] = useState<LinkPageDraft>({ profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' });
  const [seeing, setSeeing] = useState(false);
  const [qr, setQr] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const url = 'timefix.com/priya';
  const copy = () => { void navigator.clipboard?.writeText(`https://${url}`).catch(() => undefined); toast({ message: 'Link copied', tone: 'success' }); };
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
        <span className="tf-grow__url tf-num">{url}</span><Tag size="sm" hue="green">Live</Tag>
        <span className="tf-rec__spacer" />
        <Button variant="ghost" icon={<Copy {...i14} />} onPress={copy}>Copy link</Button>
        <Button variant="ghost" icon={<QrIcon {...i14} />} onPress={() => setQr(true)}>QR code</Button>
        <Button variant="secondary" icon={<ExternalLink {...i14} />} onPress={() => setSeeing(true)}>See it</Button>
      </div>
      <LinkEditor live={live} booking={demoBooking} onPublish={(page) => new Promise<void>((resolve) => { window.setTimeout(() => { setLive(page); resolve(); }, 700); })} />
      {qr && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setQr(false); }} title="Your link page's QR code" description="For your card, your desk or a slide."
          actions={<><Button variant="ghost" slot="close">Done</Button><Button variant="secondary" icon={<Download {...i14} />} onPress={() => { if (svg.current) void downloadQr(svg.current, 'priya-link-page', 'png').then((o) => { if (o === 'saved') toast({ message: 'Saved', tone: 'success' }); }); }}>Download PNG</Button></>}>
          <div className="tf-grow__qr"><QrCode value={`https://${url}`} label="QR code for your link page" withLogo ref={svg} /><span className="tf-num">{url}</span></div>
        </Dialog>
      )}
    </div>
  );
}

const series = (seed: number, n: number) => Array.from({ length: n }, (_, i) => Math.round(40 + 30 * Math.sin((i + seed) / 3) + ((i * 7 + seed * 13) % 17)));

/** Insights: Pages and Reports. */
export function InsightsScreen({ state }: { readonly state: AppState }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('pages');
  const [kind, setKind] = useState('all');
  const [range, setRange] = useState('30');
  const days = Number(range);
  const visits = series(kind.length, Math.min(days, 30));
  const total = visits.reduce((n, v) => n + v, 0) * (days > 30 ? days / 30 : 1);
  const finishes = Math.round(total * (kind === 'link' ? 0.41 : kind === 'forms' ? 0.27 : 0.33));
  const [reports, setReports] = useState<ReadonlyArray<{ readonly id: string; readonly name: string; readonly measure: 'count' | 'amount'; readonly group: 'stage' | 'owner' }>>([
    { id: 'r-stage', name: 'Pipeline by stage', measure: 'amount', group: 'stage' }, { id: 'r-owner', name: 'Deals by owner', measure: 'count', group: 'owner' },
  ]);
  const [report, setReport] = useState(reports[0]?.id ?? '');
  const [making, setMaking] = useState(false);
  const exportCsv = async () => { const csv = ['Day,Visits', ...visits.map((v, i) => `${i + 1},${v}`)].join('\n'); const o = await saveFile(`insights-${range}d.csv`, new Blob([csv], { type: 'text/csv' })); if (o === 'saved') toast({ message: 'Exported', tone: 'success' }); };
  const r = reports.find((x) => x.id === report) ?? reports[0];
  const groups = r?.group === 'stage' ? STAGES.map((s) => ({ key: s, deals: state.deals.filter((d) => d.stage === s) })) : state.members.map((m) => ({ key: m.name, deals: state.deals.filter((d) => d.owner === m.name) }));
  const points = groups.map((g) => ({ id: g.key, label: r?.group === 'owner' ? g.key.split(' ')[0] ?? g.key : g.key, value: r?.measure === 'amount' ? g.deals.reduce((n, d) => n + d.amount, 0) : g.deals.length, valueText: r?.measure === 'amount' ? inr(g.deals.reduce((n, d) => n + d.amount, 0)) : String(g.deals.length) }));
  return (
    <div className="tf-grow tf-grow--wide">
      <Tabs aria-label="Insights" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'pages', label: 'Pages' }, { id: 'reports', label: 'Reports', count: reports.length }]}>
        <TabPanel id="pages" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="What" isLabelHidden className="tf-rec__view" value={kind} onChange={(v) => setKind(v ?? 'all')}
              items={[{ id: 'all', label: 'Everything' }, { id: 'booking', label: 'Booking pages' }, { id: 'forms', label: 'Forms' }, { id: 'link', label: 'Link page' }]} />
            <Select label="When" isLabelHidden className="tf-you__select" value={range} onChange={(v) => setRange(v ?? '30')}
              items={[{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }, { id: '365', label: 'Last 12 months' }]} />
            <span className="tf-rec__spacer" />
            <Button variant="ghost" icon={<Download {...i14} />} onPress={() => { void exportCsv(); }}>Export CSV</Button>
            <Button variant="ghost" icon={<Share2 {...i14} />} onPress={() => { void navigator.clipboard?.writeText('https://timefix.com/public/insights#t=north').catch(() => undefined); toast({ message: 'View-only link copied. It shows numbers, never names.', tone: 'success' }); }}>Share</Button>
          </div>
          <div className="tf-home__stats">
            <StatCard label="Visits" value={Math.round(total)} delta={{ value: '+12%', direction: 'up', note: 'vs the period before', isGood: true }} sparkline={visits.slice(-12)} />
            <StatCard label="Finished" value={finishes} delta={{ value: '+4%', direction: 'up', isGood: true }} />
            <StatCard label="Finish rate" value={Math.round((finishes / Math.max(1, total)) * 100)} format={(n) => `${n}%`} delta={{ value: '−1 pt', direction: 'down', isGood: false }} />
            <StatCard label="Booked" value={Math.round(finishes * 0.6)} />
          </div>
          <div className="tf-home__grid">
            <ChartCard title={`Visits, last ${days > 30 ? '30' : days} days`}><BarChart label="Visits per day" points={visits.map((v, i) => ({ id: String(i), label: String(i + 1), value: v }))} /></ChartCard>
            <ChartCard title="Where they came from"><BarList label="Sources" items={[{ id: 'direct', label: 'Direct', value: 412 }, { id: 'linkedin', label: 'LinkedIn', value: 288 }, { id: 'google', label: 'Google', value: 190 }, { id: 'email', label: 'Email signature', value: 121 }, { id: 'site', label: 'northwind.com', value: 96 }]} /></ChartCard>
          </div>
        </TabPanel>
        <TabPanel id="reports" className="tf-forms__panel">
          <div className="tf-rec__bar">
            <Select label="Report" isLabelHidden className="tf-rec__view" value={r?.id ?? null} onChange={(v) => { if (v === 'new') setMaking(true); else if (v) setReport(v); }}
              items={[...reports.map((x) => ({ id: x.id, label: x.name })), { id: 'new', label: 'New report…' }]} />
            <span className="tf-rec__spacer" />
            <Button variant="secondary" icon={<Plus {...i14} />} onPress={() => setMaking(true)}>New report</Button>
          </div>
          {r && (
            <div className="tf-home__grid">
              <ChartCard title={r.name}><BarChart label={r.name} points={points} /></ChartCard>
              <ChartCard title="Share of the total"><DonutChart label={r.name} segments={points.map((p, n) => ({ id: p.id, label: p.label, value: p.value, valueText: p.valueText, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'gray'] as const)[n % 6] ?? 'gray' }))}
                total={r.measure === 'amount' ? inr(points.reduce((n, p) => n + p.value, 0)) : String(points.reduce((n, p) => n + p.value, 0))} /></ChartCard>
            </div>
          )}
        </TabPanel>
      </Tabs>
      {making && <NewReport onClose={() => setMaking(false)} onSave={(x) => { setReports([...reports, x]); setReport(x.id); setMaking(false); toast({ message: `${x.name} saved`, tone: 'success' }); }} />}
    </div>
  );
}

function NewReport({ onClose, onSave }: { readonly onClose: () => void; readonly onSave: (r: { readonly id: string; readonly name: string; readonly measure: 'count' | 'amount'; readonly group: 'stage' | 'owner' }) => void }) {
  const [measure, setMeasure] = useState<'count' | 'amount'>('amount');
  const [group, setGroup] = useState<'stage' | 'owner'>('stage');
  const [name, setName] = useState('');
  const auto = `${measure === 'amount' ? 'Deal value' : 'Deals'} by ${group}`;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New report" description="A chart of your deals, saved for the team."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => onSave({ id: newId('rep'), name: name.trim() || auto, measure, group })}>Save report</Button></>}>
      <div className="tf-rec__form">
        <Select label="Measure" value={measure} onChange={(v) => setMeasure(v === 'count' ? 'count' : 'amount')} items={[{ id: 'amount', label: 'Total deal value' }, { id: 'count', label: 'Number of deals' }]} />
        <Select label="Grouped by" value={group} onChange={(v) => setGroup(v === 'owner' ? 'owner' : 'stage')} items={[{ id: 'stage', label: 'Stage' }, { id: 'owner', label: 'Owner' }]} />
        <TextField label="Name" aside="Optional" value={name} onChange={setName} placeholder={auto} />
      </div>
    </Dialog>
  );
}
