// Insights: how bookings are going. The numbers that matter on top, then the trend, the funnel from a page view to a
// meeting that happened, each page and host, when people book, and where they come from. Private to the workspace.
import { useMemo, useState, type CSSProperties } from 'react';
import { CalendarCheck, CalendarX2, Clock, Eye, UserX } from 'lucide-react';
import { StatCard } from '../Card/Card.tsx';
import { BarChart, BarList, DonutChart } from '../Chart/Chart.tsx';
import { Select } from '../Select/Select.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Section, TabToolbar, i16 } from './parts.tsx';
import { TEAM, dayFrom, first, type BookingsState } from './state.ts';

const PERIODS = [{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

/** A steady pseudo-random number from a seed, so the dummy workspace's history looks the same on every visit. */
const noise = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

/** The Insights page. */
export function InsightsTab({ state }: { readonly state: BookingsState }) {
  const [period, setPeriod] = useState('30');
  const [pageId, setPageId] = useState('all');
  const [by, setBy] = useState<'page' | 'host'>('page');
  const days = Number(period);
  const pages = state.pages.filter((p) => pageId === 'all' || p.id === pageId);
  const scale = pages.reduce((s, p) => s + p.stats.bookings, 0) / Math.max(1, state.pages.reduce((s, p) => s + p.stats.bookings, 0));

  const data = useMemo(() => {
    const now = new Date();
    // Bookings per day over the period: the dummy history, shaped by weekday (quiet weekends) and scaled to the pages shown.
    const perDay = Array.from({ length: days }, (_, n) => {
      const d = dayFrom(now, n - days + 1);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      return { d, v: Math.round((weekend ? 0.4 : 2.2 + noise(n + days) * 2.5) * scale * 1.4) };
    });
    const bookings = perDay.reduce((s, x) => s + x.v, 0);
    const prev = Math.round(bookings * (0.82 + noise(days) * 0.2));
    const views = Math.round(bookings * 9.8);
    const picked = Math.round(bookings * 2.1);
    const held = Math.round(bookings * 0.91);
    const cancelled = Math.round(bookings * 0.07);
    const noShows = bookings - held - cancelled > 0 ? bookings - held - cancelled : Math.round(bookings * 0.04);
    return { perDay, bookings, prev, views, picked, held, cancelled, noShows };
  }, [days, scale]);

  const change = (a: number, b: number) => (b === 0 ? '0%' : `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`);
  // Group the trend into at most 15 bars: days for a week or a month, weeks for a quarter.
  const bars = days <= 30
    ? data.perDay.map((x, n) => ({ id: `d${n}`, label: n === 0 || x.d.getDate() === 1 ? x.d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : String(x.d.getDate()), value: x.v, valueText: `${x.v} on ${x.d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` }))
    : Array.from({ length: Math.ceil(days / 7) }, (_, w) => {
      const slice = data.perDay.slice(w * 7, w * 7 + 7);
      return { id: `w${w}`, label: slice[0] ? slice[0].d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '', value: slice.reduce((s, x) => s + x.v, 0) };
    });
  const showRate = data.bookings ? Math.round((data.held / Math.max(1, data.bookings - data.cancelled)) * 100) : 0;
  const lead = Math.round(3 + noise(days + 3) * 4);

  const rows = by === 'page'
    ? pages.map((p, n) => { const b = Math.round(data.bookings * (p.stats.bookings / Math.max(1, pages.reduce((s, x) => s + x.stats.bookings, 0)))); const v = Math.round(b * (7 + noise(n) * 6)); return { id: p.id, name: p.name, sub: `${p.durations.join(' or ')} min`, views: v, bookings: b, conv: v ? Math.round((b / v) * 100) : 0, show: Math.round(p.stats.showRate) }; })
    : TEAM.map((h, n) => { const b = Math.round(data.bookings * (0.15 + noise(n + 11) * 0.25)); return { id: h, name: h, sub: '', views: 0, bookings: b, conv: 0, show: Math.round(85 + noise(n + 7) * 13) }; });
  const maxBookings = Math.max(1, ...rows.map((r) => r.bookings));

  // When people book: weekday by hour, darker where more meetings start.
  const heat = WEEKDAYS.map((_, w) => HOURS.map((h, i) => (w >= 5 ? noise(w * 31 + i) * 0.15 : Math.max(0, Math.sin(((h - 8) / 9) * Math.PI) * (0.55 + noise(w * 13 + i) * 0.45)))));
  const best = (() => { let bw = 0; let bh = 0; let bv = -1; heat.forEach((row, w) => row.forEach((v, i) => { if (v > bv) { bv = v; bw = w; bh = i; } })); const hh = HOURS[bh] ?? 10; return `${WEEKDAYS[bw]} around ${hh > 12 ? `${hh - 12} PM` : hh === 12 ? '12 PM' : `${hh} AM`}`; })();

  const sources = [
    { id: 'link', label: 'Shared link', value: Math.round(data.bookings * 0.38) },
    { id: 'site', label: 'Your website', value: Math.round(data.bookings * 0.27) },
    { id: 'email', label: 'Email signature', value: Math.round(data.bookings * 0.16) },
    { id: 'routing', label: 'Routing form', value: Math.round(data.bookings * 0.12) },
    { id: 'profile', label: 'Profile page', value: Math.round(data.bookings * 0.07) },
  ];
  const funnel = [
    { id: 'views', label: 'Viewed a page', value: data.views },
    { id: 'picked', label: 'Picked a time', value: data.picked },
    { id: 'booked', label: 'Booked', value: data.bookings },
    { id: 'held', label: 'Met', value: data.held },
  ];

  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          <Select label="Period" isLabelHidden className="tf-bkf__inline-select" items={PERIODS} value={period} onChange={(v) => { if (v) setPeriod(v); }} />
          <Select label="Pages" isLabelHidden className="tf-bkf__inline-select" items={[{ id: 'all', label: 'All pages' }, ...state.pages.map((p) => ({ id: p.id, label: p.name }))]} value={pageId} onChange={(v) => setPageId(v ?? 'all')} />
        </>}
        count={<span className="tf-bkf__muted">Only your workspace sees these numbers.</span>} />

      <div className="tf-bkf-insights">
        <div className="tf-bkf-insights__stats">
          <StatCard label="Bookings" icon={<CalendarCheck {...i16} />} value={data.bookings} delta={{ value: change(data.bookings, data.prev), direction: data.bookings >= data.prev ? 'up' : 'down', note: 'vs the period before', isGood: data.bookings >= data.prev }} sparkline={data.perDay.slice(-14).map((x) => x.v)} />
          <StatCard label="Page views" icon={<Eye {...i16} />} value={data.views} delta={{ value: `${Math.round((data.bookings / Math.max(1, data.views)) * 100)}% booked`, direction: 'flat' }} />
          <StatCard label="Showed up" icon={<Clock {...i16} />} value={showRate} format={(n) => `${n}%`} delta={{ value: '+2 pts', direction: 'up', note: 'vs the period before', isGood: true }} />
          <StatCard label="No-shows" icon={<UserX {...i16} />} value={data.noShows} delta={{ value: change(data.noShows, Math.round(data.noShows * 1.5) + 1), direction: 'down', note: 'vs the period before', isGood: true }} />
          <StatCard label="Cancelled" icon={<CalendarX2 {...i16} />} value={data.cancelled} delta={{ value: `${Math.round((data.cancelled / Math.max(1, data.bookings)) * 100)}% of bookings`, direction: 'flat' }} />
        </div>

        <div className="tf-bkf-insights__grid">
          <Section className="tf-bkf-card tf-bkf-insights__wide" title="Bookings over time" description={days > 30 ? 'Each bar is a week.' : 'Each bar is a day. Weekends are quiet.'}>
            <BarChart label="Bookings over time" points={bars} height={200} />
          </Section>
          <Section className="tf-bkf-card" title="From view to meeting" description="Where people drop off on the way.">
            <ol className="tf-bkf-funnel">
              {funnel.map((f, n) => {
                const share = Math.round((f.value / Math.max(1, data.views)) * 100);
                const step = n > 0 ? Math.round((f.value / Math.max(1, funnel[n - 1]?.value ?? 1)) * 100) : 100;
                return (
                  <li key={f.id} className="tf-bkf-funnel__step">
                    <span className="tf-bkf-funnel__head"><span>{f.label}</span><span className="tf-num"><strong>{f.value.toLocaleString('en-GB')}</strong>{n > 0 && <span className="tf-bkf__muted"> · {step}% of the step before</span>}</span></span>
                    <span className="tf-bkf-funnel__bar" style={{ '--tf-bkf-share': Math.max(share, 2) / 100 } as CSSProperties} aria-hidden="true" />
                  </li>
                );
              })}
            </ol>
          </Section>
          <Section className="tf-bkf-card" title="Where guests come from" description="The link or place they booked from.">
            <BarList label="Where guests come from" items={sources} />
          </Section>
          <Section className="tf-bkf-card tf-bkf-insights__wide" title={by === 'page' ? 'Each page' : 'Each host'} description={by === 'page' ? 'Views, bookings, how many booked, and who showed up.' : 'How meetings were shared out, and who showed up.'}
            action={<SegmentedControl aria-label="Group by" size="sm" selectedKey={by} onSelectionChange={(k) => setBy(k === 'host' ? 'host' : 'page')} items={[{ id: 'page', label: 'Pages' }, { id: 'host', label: 'Hosts' }]} />}>
            <div className="tf-bkf-itable" role="table" aria-label={by === 'page' ? 'Each page' : 'Each host'}>
              <div className="tf-bkf-itable__row tf-bkf-itable__row--head" role="row">
                <span role="columnheader">{by === 'page' ? 'Page' : 'Host'}</span>
                {by === 'page' && <span role="columnheader">Views</span>}
                <span role="columnheader">Bookings</span>
                {by === 'page' && <span role="columnheader">Booked</span>}
                <span role="columnheader">Showed up</span>
              </div>
              {[...rows].sort((a, b) => b.bookings - a.bookings).map((r) => (
                <div key={r.id} className="tf-bkf-itable__row" role="row" data-by={by}>
                  <span role="rowheader" className="tf-bkf-itable__name">{by === 'host' && <Avatar name={r.name} size={24} />}<span><strong>{by === 'host' ? first(r.name) : r.name}</strong>{r.sub && <span className="tf-bkf__muted"> · {r.sub}</span>}</span></span>
                  {by === 'page' && <span role="cell" className="tf-num">{r.views.toLocaleString('en-GB')}</span>}
                  <span role="cell" className="tf-bkf-itable__bookings tf-num"><span className="tf-bkf-itable__bar" style={{ '--tf-bkf-share': r.bookings / maxBookings } as CSSProperties} aria-hidden="true" />{r.bookings}</span>
                  {by === 'page' && <span role="cell" className="tf-num">{r.conv}%</span>}
                  <span role="cell" className="tf-num">{r.show}%</span>
                </div>
              ))}
            </div>
          </Section>
          <Section className="tf-bkf-card" title="When people book" description={`Meetings start most often on ${best}.`}>
            <div className="tf-bkf-heat" role="img" aria-label={`Busiest: ${best}. Weekends are quiet.`} style={{ '--tf-bkf-cols': HOURS.length } as CSSProperties}>
              <span />
              {HOURS.map((h) => <span key={h} className="tf-bkf-heat__hour tf-num">{h > 12 ? h - 12 : h}{h >= 12 ? 'p' : 'a'}</span>)}
              {WEEKDAYS.map((w, wi) => (
                <span key={w} className="tf-bkf-heat__row">
                  <span className="tf-bkf-heat__day">{w}</span>
                  {heat[wi]?.map((v, i) => <span key={i} className="tf-bkf-heat__cell" style={{ '--tf-bkf-heat': v.toFixed(2) } as CSSProperties} />)}
                </span>
              ))}
            </div>
          </Section>
          <Section className="tf-bkf-card" title="How meetings ended" description="Of the bookings in this period.">
            <DonutChart label="How meetings ended" total={data.bookings} totalLabel="Booked" segments={[
              { id: 'held', label: 'Met', value: data.held, hue: 'green' },
              { id: 'noshow', label: 'No-show', value: data.noShows, hue: 'orange' },
              { id: 'cancel', label: 'Cancelled', value: data.cancelled, hue: 'red' },
            ]} />
          </Section>
        </div>
      </div>
    </div>
  );
}
