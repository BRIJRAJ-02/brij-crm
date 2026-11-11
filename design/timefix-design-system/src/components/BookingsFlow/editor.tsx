// Step 5: the page editor. One scroll of sections with live summaries, the guest's view beside it, Save changes at the foot.
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ArrowRight, BarChart3, CalendarCheck, CalendarDays, Check, Eye, Link2, MessageSquareText, Palette, Play, Plus, RotateCcw, Settings2, Users } from 'lucide-react';
import { PublishBar } from '../FloatingBar/FloatingBar.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { TopBar } from '../AppShell/AppShell.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { HoursEditor, HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { QuestionBuilder } from '../QuestionList/QuestionList.tsx';
import { GuestLook } from '../GuestLook/GuestLook.tsx';
import { SocialLinksEditor } from '../SocialLinks/SocialLinks.tsx';
import { Meter } from '../Progress/Progress.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button } from '../Button/Button.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import { formatDate, formatDay } from '../../lib/format.ts';
import { DaysOffEditor, Eyebrow, GuestView, Section, SettingRow, OnSwitch, PageMoreMenu, ScaledPreview, ShareMenu, i14, i16, noBook, type ShareHow } from './parts.tsx';
import { Link as TextLink } from '../Link/Link.tsx';
import { MeetingList } from '../MeetingList/MeetingList.tsx';
import { InsightsTab } from './insights.tsx';
import { declinesIn } from './meetings.tsx';
import { uniqueSlug } from './seed.ts';
import { TablePreview } from './guest-venue.tsx';
import {
  HOST, HOST_ZONE, PLACES, PLACE_ALL, TEAM, ZONES, afterSummary, handleOf, openDaysAhead, pageChanges, dayFrom, first, hoursFor, isPaused, lookSummary, monthSpread, noHostsFree, parseDay, plural, questionsSummary, whenSummary, whoSummary, shiftName, REMINDERS,
  type BookingPage, type BookingsState, type HostMode, type LockedPart, type PlaceKind, type ShareOut, type ShiftRule,
} from './state.ts';

const LENGTHS = [15, 30, 45, 60, 90];
/** Record fields a booking question's answer can fill. */
const SAVE_TARGETS = [{ id: 'person.title', label: 'Person › Job title' }, { id: 'person.phone', label: 'Person › Phone' }, { id: 'company.industry', label: 'Company › Industry' }, { id: 'company.employees', label: 'Company › Employees' }, { id: 'company.domain', label: 'Company › Website' }, { id: 'deal.value', label: 'Deal › Value' }];
const BUFFERS = [0, 5, 10, 15, 30].map((n) => ({ id: String(n), label: n ? `${n} min` : 'None' }));
const NOTICE = [{ id: '0', label: 'None' }, { id: '1', label: '1 hour' }, { id: '4', label: '4 hours' }, { id: '24', label: '1 day' }, { id: '48', label: '2 days' }, { id: '72', label: '3 days' }, { id: '168', label: '1 week' }, { id: '336', label: '2 weeks' }];
const AHEAD = [7, 14, 30, 60, 90, 180, 365].map((n) => ({ id: String(n), label: n === 365 ? 'A year ahead' : `${n} days ahead` }));
/** Where new bookings can go: each connected account's calendars; one that needs reconnecting can't take them. */
const calendarsOf = (state: BookingsState) => state.calendars.flatMap((c) => c.provider === 'Google' ? [{ id: 'work', label: 'Work', description: `Google · ${c.email}`, isDisabled: c.status !== 'connected' }, { id: 'personal', label: 'Personal', description: `Google · ${c.email}`, isDisabled: c.status !== 'connected' }] : [{ id: c.id, label: 'Calendar', description: `${c.provider} · ${c.status === 'connected' ? c.email : 'needs reconnect'}`, isDisabled: c.status !== 'connected' }]);
const STEPS = [{ id: '0', label: 'Every 15 or 30 min' }, { id: '15', label: 'Every 15 min' }, { id: '30', label: 'Every 30 min' }, { id: '60', label: 'On the hour' }];
const CUTOFFS = [{ id: '0', label: 'Up to the start' }, { id: '1', label: 'Until 1 hour before' }, { id: '4', label: 'Until 4 hours before' }, { id: '24', label: 'Until a day before' }, { id: '48', label: 'Until 2 days before' }];
const FILE_TO = [{ id: 'people', label: 'People' }, { id: 'companies', label: 'Companies' }, { id: 'deals', label: 'Deals' }, { id: 'none', label: 'Don’t file' }];
const FORMS = [{ id: 'Support request', label: 'Support request' }, { id: 'Contact sales', label: 'Contact sales' }, { id: 'Partner enquiry', label: 'Partner enquiry' }];

type SaveState = 'idle' | 'saving' | 'saved';
/** The sections that can be opened from outside (Fix opens Who). */
export type EditorSection = 'when' | 'who' | 'questions' | 'after' | 'look' | 'insights' | 'bookings';

/** Props for PageEditor. */
export interface PageEditorProps {
  readonly page: BookingPage;
  readonly draft: BookingPage;
  readonly state: BookingsState;
  readonly section?: EditorSection;
  readonly onDraft: (d: BookingPage) => void;
  readonly onBack: () => void;
  readonly onSave: (d: BookingPage) => Promise<void>;
  readonly onToggle: (on: boolean) => void;
  readonly onShare: (p: BookingPage, how: ShareHow) => void;
  readonly onMore: (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => void;
  readonly onGuest: () => void;
  readonly onMeetings: () => void;
  readonly onManageGroups: () => void;
  /** Keeps the changes as a draft without publishing. */
  readonly onKeepDraft: (d: BookingPage) => void;
  /** Opens one of this page's meetings (its Bookings tab). */
  readonly onOpenMeeting?: (id: string) => void;
}

/** The page editor. */
const ALL_EMAILS: ReadonlyArray<string> = ['confirm', 'change', 'cancel', 'after', 'host-booked', 'host-cancel'];
const SHARE_HELP: Readonly<Record<ShareOut, string>> = {
  equal: 'The free host with the fewest meetings takes it.',
  even: 'Everyone takes a turn; whoever is ahead waits.',
  weighted: 'Some hosts take a bigger share.',
  priority: 'The first free host in your order takes it.',
};
const LOCKABLE: ReadonlyArray<{ readonly id: LockedPart; readonly label: string }> = [
  { id: 'length', label: 'Length' }, { id: 'where', label: 'Where' }, { id: 'questions', label: 'Questions' }, { id: 'look', label: 'Look' },
];

export function PageEditor({ page, draft, state, section, onDraft, onBack, onSave, onToggle, onShare, onMore, onGuest, onMeetings, onManageGroups, onKeepDraft, onOpenMeeting }: PageEditorProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customMin, setCustomMin] = useState(40);
  const [bookingsRange, setBookingsRange] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const kept = state.drafts?.[page.id] !== undefined;
  const [save, setSave] = useState<SaveState>('idle');
  const now = new Date();
  // Only real changes count: a setting touched and put back is not a change.
  const dirty = pageChanges(page, { ...draft, isOn: page.isOn }).length > 0;
  const nameless = !draft.name.trim();
  const set = (patch: Partial<BookingPage>) => { onDraft({ ...draft, ...patch }); if (save === 'saved') setSave('idle'); };
  const sectionRef = useRef<HTMLDivElement>(null);
  const taken = state.pages.some((p) => p.id !== draft.id && p.slug === draft.slug);
  // A link into one part of the page ("Fix hosts") opens on that tab.
  const [tab, setTab] = useState<string>(section ?? 'basics');
  useEffect(() => { if (section) setTab(section); }, [section]);
  const doSave = () => {
    if (!dirty || save === 'saving' || taken || nameless) return;
    setSave('saving');
    void onSave({ ...draft, isOn: page.isOn }).then(() => { setSave('saved'); window.setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 1800); });
  };
  useEffect(() => {
    if (!dirty) return undefined;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const stuck = noHostsFree(state, draft, now);
  const noTimes = page.isOn && !stuck && openDaysAhead(draft, state, now) === 0;
  const spread = monthSpread(state, draft, now);
  const maxSpread = Math.max(1, ...Object.values(spread));
  const hostOff = state.timeOff.filter((t) => draft.hosts.includes(t.member) && parseDay(t.to) >= dayFrom(now, 0));
  const setMode = (hostMode: HostMode) => set({ hostMode, hosts: hostMode === 'one' ? [draft.hosts[0] ?? HOST] : draft.hosts.length > 1 ? draft.hosts : TEAM.slice(0, 3) });

  return (
    <>
      <TopBar
        title={<Breadcrumbs size="title" items={[{ id: 'pages', label: 'Booking pages', icon: <Link2 {...i16} /> }, { id: 'page', label: page.name }]} onAction={(id) => { if (id !== 'page') onBack(); }} />}
        actions={<>
          <OnSwitch page={page} onChange={onToggle} />
          <Button variant="ghost" icon={<Play {...i14} />} onPress={onGuest}>See it as a guest</Button>
          <ShareMenu page={page} onShare={onShare} handle={handleOf(state)} />
          <PageMoreMenu page={page} withEdit={false} withVersions onAction={(k) => { if (k === 'versions') setVersionsOpen(true); else onMore(page, k); }} />
        </>} />
      <div className="tf-bkf__editor">
        <AriaButton className="tf-bkf__stats" onPress={onMeetings} aria-label={`This month: ${page.stats.views} views, ${page.stats.bookings} bookings, ${page.stats.showRate}% showed up. Open Meetings.`}>
          <span><strong className="tf-num"><NumberRoll value={page.stats.views} /></strong> views</span>
          <span><strong className="tf-num"><NumberRoll value={page.stats.bookings} /></strong> bookings</span>
          <span><strong className="tf-num"><NumberRoll value={page.stats.showRate} />%</strong> showed up</span>
          <span className="tf-bkf__muted">this month</span>
          <span className="tf-bkf__stats-go">{draft.kind === 'table' ? 'See reservations' : 'See meetings'}<ArrowRight {...i14} aria-hidden="true" /></span>
        </AriaButton>
        <div className="tf-bkf__editor-scroll">
          <div className="tf-bkf__editor-grid" data-wide={tab === 'bookings' || tab === 'insights' || undefined}>
            <div className="tf-bkf__sections" ref={sectionRef}>
              {!page.isOn && <Callout tone="neutral" action={{ label: 'Turn it on', onPress: () => onToggle(true) }}>This page is hidden. Its link tells guests it isn't taking bookings right now.</Callout>}
              {noTimes && <Callout tone="warning" action={{ label: 'Check When', onPress: () => setTab('when') }}>Guests can’t book this page: there are no open times in the next two months.</Callout>}
              <Tabs aria-label="Page settings" className="tf-bkf__edtabs" selectedKey={tab} onSelectionChange={setTab}
                items={[
                  { id: 'basics', label: 'Basics' },
                  { id: 'when', label: 'When', icon: <CalendarDays {...i14} /> },
                  { id: 'who', label: 'Who', icon: stuck ? <AlertTriangle {...i14} /> : <Users {...i14} /> },
                  { id: 'questions', label: 'Questions', icon: <MessageSquareText {...i14} /> },
                  { id: 'after', label: 'After booking', icon: <Check {...i14} /> },
                  { id: 'look', label: 'Look', icon: <Palette {...i14} /> },
                  ...(draft.linkKind ? [] : [{ id: 'bookings', label: 'Bookings', icon: <CalendarCheck {...i14} /> }, { id: 'insights', label: 'Insights', icon: <BarChart3 {...i14} /> }]),
                ]}>
              <TabPanel id="basics" className="tf-bkf__edpanel">
              <Section className="tf-bkf-card" title="Basics" description="What guests see first: the name, the link, how long and where.">
                <div className="tf-bkf__stack">
                  <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} isRequired isInvalid={nameless} errorMessage="Give the page a name." />
                  <TextField label="Link" value={draft.slug} className="tf-bkf__linkinput" icon={<span className="tf-bkf__prefix">timefix.com/{state.business?.handle ?? 'priya'}/</span>}
                    onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} isInvalid={taken} errorMessage="Another page has this link. Try another."
                    suffix={!taken && draft.slug !== page.slug ? <span className="tf-bkf__ok-word"><Check size={14} strokeWidth={2} aria-hidden="true" />Available</span> : undefined}
                    onBlur={() => { if (!draft.slug) set({ slug: uniqueSlug('meeting', state.pages, draft.id) }); }} />
                  {draft.kind === 'service' && (
                    <div className="tf-bkf__pair">
                      {(draft.durations.length < 2 || draft.priceType === 'free') && <NumberField label="Price" value={draft.priceType === 'free' ? 0 : draft.price ?? 0} minValue={0} step={50} showSteppers={false} isDisabled={draft.priceType === 'free'}
                        formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }} onChange={(n) => set({ price: Number.isFinite(n) ? n : 0 })} />}
                      <Select label="Price shows as" value={draft.priceType ?? 'fixed'} onChange={(v) => set({ priceType: (v ?? 'fixed') as 'fixed' })}
                        items={[{ id: 'fixed', label: 'Fixed price' }, { id: 'from', label: '“From” price' }, { id: 'free', label: 'Free' }]} />
                    </div>
                  )}
                  {draft.kind === 'service' && (state.categories ?? []).length > 0 && (
                    <Select label="Category" value={draft.categoryId ?? null} onChange={(v) => { if (v) set({ categoryId: v }); }} items={(state.categories ?? []).map((c) => ({ id: c.id, label: c.name }))} />
                  )}
                  {draft.kind === 'table' && (
                    <div className="tf-bkf__pair">
                      <NumberField label="Smallest party" value={draft.party?.min ?? 1} minValue={1} maxValue={draft.party?.max ?? 8} onChange={(n) => set({ party: { min: Number.isFinite(n) ? n : 1, max: draft.party?.max ?? 8 } })} />
                      <NumberField label="Largest party online" value={draft.party?.max ?? 8} minValue={draft.party?.min ?? 1} maxValue={20} onChange={(n) => set({ party: { min: draft.party?.min ?? 1, max: Number.isFinite(n) ? n : 8 } })} />
                    </div>
                  )}
                  <ChoiceChips label={draft.kind === 'table' ? 'Time at the table' : 'Lengths'} selectionMode="multiple" selectedKeys={[...draft.durations.map(String), ...(customOpen ? ['custom'] : [])]}
                    items={[...[...new Set([...LENGTHS, ...draft.durations])].sort((a, b) => a - b).map((n) => ({ id: String(n), label: `${n} min`, isDisabled: !draft.durations.includes(n) && draft.durations.length >= 4 })), ...(draft.kind === 'table' ? [] : [{ id: 'custom', label: 'Custom' }])]}
                    onSelectionChange={(keys) => { setCustomOpen(keys.has('custom')); const d = [...keys].filter((k) => k !== 'custom').map(Number).sort((a, b) => a - b); if (d.length) set({ durations: d }); }} />
                  {customOpen && (
                    <div className="tf-bkf-custommin">
                      <NumberField label="Minutes" description="5 to 480, in steps of 5." value={customMin} minValue={5} maxValue={480} step={5} onChange={(n) => { if (Number.isFinite(n)) setCustomMin(n); }}
                        isInvalid={customMin < 5 || customMin > 480 || customMin % 5 !== 0} errorMessage="Type 5 to 480 minutes, in steps of 5." />
                      <Button variant="secondary" icon={<Plus {...i14} />} isDisabled={customMin < 5 || customMin > 480 || customMin % 5 !== 0 || draft.durations.includes(customMin) || draft.durations.length >= 4}
                        onPress={() => { set({ durations: [...draft.durations, customMin].sort((a, b) => a - b) }); setCustomOpen(false); }}>Add {customMin} min</Button>
                    </div>
                  )}
                  {draft.durations.length > 1 && <p className="tf-bkf__muted tf-bkf__hint">Guests choose the length. {draft.durations[0]} min is picked first.</p>}
                  {draft.kind === 'service' && draft.durations.length > 1 && draft.priceType !== 'free' && (
                    <div className="tf-bkf__group"><span className="tf-bkf__label">Price by length</span>
                      <ul className="tf-bkf__turns">{draft.durations.map((d) => (
                        <li key={d}><span>{d} min</span><NumberField aria-label={`Price for ${d} minutes`} value={draft.prices?.[String(d)] ?? draft.price ?? 0} minValue={0} step={50} showSteppers={false}
                          formatOptions={{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }} onChange={(n) => set({ prices: { ...(draft.prices ?? {}), [String(d)]: Number.isFinite(n) ? n : 0 } })} /></li>))}</ul>
                    </div>
                  )}
                  {draft.kind === undefined || draft.kind === 'meeting' ? <ChoiceChips label="Places" selectionMode="multiple" selectedKeys={draft.places} items={PLACE_ALL.map((k) => ({ id: k, label: k === 'in-person' ? 'In person' : PLACES[k].label }))}
                    onSelectionChange={(keys) => { const p = PLACE_ALL.filter((k) => keys.has(k)); if (p.length) set({ places: p }); }} /> : null}
                  {draft.places.includes('custom') && <TextField label="Somewhere else" value={draft.customPlace ?? ''} onChange={(customPlace) => set({ customPlace })} placeholder="The café on Park Street" description="Guests see these words as the place." />}
                  {(draft.places.includes('meet') || draft.places.includes('zoom')) && (draft.kind === undefined || draft.kind === 'meeting') && (() => {
                    const canMake = state.calendars.some((c) => c.status === 'connected');
                    const how = draft.videoLink ?? (canMake ? 'calendar' : 'send');
                    return <div className="tf-bkf__stack tf-bkf__stack--8">
                      <Select label="Video link" value={how} onChange={(v) => { if (v) set({ videoLink: v as BookingPage['videoLink'] }); }} description={how === 'send' ? 'You send it before the meeting, by hand. The meeting shows No link yet until you do.' : how === 'own' ? 'Guests get it in their confirmation, never on the page.' : 'Each booking gets its own link.'}
                        items={[{ id: 'calendar', label: draft.places.includes('zoom') && !draft.places.includes('meet') ? 'Made by Zoom' : 'Made by your calendar', isDisabled: !canMake }, { id: 'own', label: 'Paste your own link' }, { id: 'send', label: 'I’ll send a link' }]} />
                      {how === 'own' && <TextField label="Meeting link" type="url" value={draft.ownLink ?? ''} onChange={(ownLink) => set({ ownLink })} placeholder="https://zoom.us/j/…"
                        isInvalid={(draft.ownLink ?? '') !== '' && !/^https:\/\/\S+\.\S+/.test(draft.ownLink ?? '')} errorMessage="Give the meeting link, starting https://." />}
                    </div>;
                  })()}
                  {(draft.kind === undefined || draft.kind === 'meeting') && draft.places.includes('in-person') && <TextField label="Address" value={draft.address} onChange={(address) => set({ address })} placeholder="12 Harbour Street, Mumbai" />}
                  {draft.places.includes('phone') && <SegmentedControl aria-label="Who calls" selectedKey={draft.phoneWho} onSelectionChange={(k) => set({ phoneWho: k === 'guest' ? 'guest' : 'host' })} items={[{ id: 'host', label: 'You call them' }, { id: 'guest', label: 'They call you' }]} />}
                  {draft.kind !== 'table' && <div className="tf-bkf__group">
                    <span className="tf-bkf__label">Guests start in</span>
                    <SegmentedControl aria-label="Guests start in" selectedKey={draft.defaultView ?? 'month'} onSelectionChange={(k) => set({ defaultView: k === 'list' ? 'list' : k === 'chat' ? 'chat' : 'month' })}
                      items={[{ id: 'month', label: 'Month' }, { id: 'list', label: 'List' }, { id: 'chat', label: 'Chat' }]} />
                    <span className="tf-bkf__muted">They can switch any time; their last choice is remembered.</span>
                  </div>}
                  <TextArea label="Description" aside="Optional" rows={2} value={draft.description} onChange={(description) => set({ description })} placeholder={draft.kind === 'table' ? 'What guests should know, like a dress code or a set menu on Sundays' : draft.kind === 'service' ? 'What’s included, in a line or two' : 'What the meeting is for, in a line or two'} />
                  <ShowMore showLabel="More options" hideLabel="Fewer options">
                    {draft.kind === 'table' && (
                      <div className="tf-bkf__stack">
                        <div className="tf-bkf__pair">
                          <Select label="Most guests starting at once" description="Paces the kitchen: times fill once this many guests start together." value={String(draft.pacing ?? 0)} onChange={(v) => set({ pacing: Number(v ?? 0) })}
                            items={[{ id: '0', label: 'No limit' }, ...[8, 12, 16, 20, 24, 30].map((n) => ({ id: String(n), label: `${n} guests` }))]} />
                          <Select label="Late tables held for" description="Then the table can go to someone else." value={String(draft.holdLate ?? 15)} onChange={(v) => set({ holdLate: Number(v ?? 15) })}
                            items={[10, 15, 20, 30].map((n) => ({ id: String(n), label: `${n} min` }))} />
                        </div>
                        {/* Each shift's own pacing and last seating (Resy and OpenTable shifts), off until asked for. */}
                        {(() => {
                          const names = [...new Set(HOURS_DAYS.flatMap((d) => { const h = (state.savedHours.find((x) => x.id === state.defaultHoursId) ?? state.savedHours[0])?.hours[d]; return h?.on ? h.ranges.map((r) => shiftName(h.ranges.length, r.start)) : []; }))]
                            .sort((a, b) => ['Lunch', 'Service', 'Dinner'].indexOf(a) - ['Lunch', 'Service', 'Dinner'].indexOf(b));
                          if (names.length === 0) return null;
                          const rule = (n: string) => draft.shifts?.[n] ?? {};
                          const put = (n: string, x: Partial<ShiftRule>) => set({ shifts: { ...draft.shifts, [n]: { ...rule(n), ...x } } });
                          return <>
                            <Switch isSelected={draft.shifts !== undefined} onChange={(on) => set({ shifts: on ? Object.fromEntries(names.map((n) => [n, {}])) : undefined })}>{names.length > 1 ? `Own rules for ${names.join(' and ').toLowerCase()}` : 'Last seating and pacing for the service'}</Switch>
                            {draft.shifts && <ul className="tf-bkf__turns tf-bkf__turns--shifts"><li className="tf-bkf__turns-head" aria-hidden="true"><span>Shift</span><span>Most starting at once</span><span>Last seating</span></li>{names.map((n) => (
                              <li key={n}><span>{n}</span>
                                <Select label={`${n}: most guests starting at once`} isLabelHidden className="tf-bkf__inline-select" value={String(rule(n).pacing ?? 'page')} onChange={(v) => put(n, { pacing: v && v !== 'page' ? Number(v) : undefined })}
                                  items={[{ id: 'page', label: draft.pacing ? `${draft.pacing} at once` : 'No limit' }, ...[6, 8, 10, 12, 16, 20, 24, 30].filter((x) => x !== draft.pacing).map((x) => ({ id: String(x), label: `${x} at once` }))]} />
                                <Select label={`${n}: last seating`} isLabelHidden className="tf-bkf__inline-select" value={String(rule(n).lastSeating ?? 'fit')} onChange={(v) => put(n, { lastSeating: v && v !== 'fit' ? Number(v) : undefined })}
                                  items={[{ id: 'fit', label: 'While a table fits' }, ...[30, 45, 60, 90, 120].map((x) => ({ id: String(x), label: `${x} min before close` }))]} />
                              </li>))}</ul>}
                          </>;
                        })()}
                        {/* How long each party keeps its table, by size (OpenTable's turn times). */}
                        <Switch isSelected={draft.turns !== undefined} onChange={(on) => set({ turns: on ? [{ upTo: 2, minutes: 75 }, { upTo: 4, minutes: 90 }, { upTo: 6, minutes: 120 }, { upTo: 99, minutes: 150 }] : undefined, bigTurn: undefined })}>Turn time by party size</Switch>
                        {draft.turns && <ul className="tf-bkf__turns">{draft.turns.map((t, n) => (
                          <li key={t.upTo}><span>{t.upTo >= 99 ? `${(draft.turns?.[n - 1]?.upTo ?? 0) + 1} or more` : `${n === 0 ? 1 : (draft.turns?.[n - 1]?.upTo ?? 0) + 1}–${t.upTo} guests`}</span>
                            <Select label={`Table time for ${t.upTo >= 99 ? 'larger parties' : `up to ${t.upTo}`}`} isLabelHidden className="tf-bkf__inline-select" value={String(t.minutes)} onChange={(v) => set({ turns: (draft.turns ?? []).map((x, m) => (m === n ? { ...x, minutes: Number(v ?? x.minutes) } : x)) })}
                              items={[60, 75, 90, 105, 120, 150, 180].map((m) => ({ id: String(m), label: m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} ${m === 60 ? 'hour' : 'hours'}` }))} /></li>))}</ul>}
                        {new Set((state.tables ?? []).map((t) => t.area)).size > 1 && <Switch isSelected={draft.pickArea ?? false} onChange={(pickArea) => set({ pickArea })}>Guests can ask for an area ({[...new Set((state.tables ?? []).map((t) => t.area))].join(', ')})</Switch>}
                      </div>
                    )}
                    <div className="tf-bkf__group">
                    <span className="tf-bkf__label">Who can find it</span>
                    <SegmentedControl aria-label="Who can find it" selectedKey={draft.visibility ?? 'public'} onSelectionChange={(k) => set({ visibility: k === 'link' ? 'link' : 'public' })}
                      items={[{ id: 'public', label: 'On your profile' }, { id: 'link', label: 'Only with the link' }]} />
                    <span className="tf-bkf__muted">{(draft.visibility ?? 'public') === 'link' ? 'It’s left off timefix.com/priya. Only people you send the link to can book.' : 'It’s listed on timefix.com/priya with your other pages.'}</span>
                    {draft.visibility === 'link' && <Switch isSelected={draft.inHeldTime ?? false} onChange={(inHeldTime) => set({ inHeldTime })}>Book inside time you’ve held, and skip minimum notice</Switch>}
                    <Switch isSelected={draft.inviteOnly ?? false} onChange={(inviteOnly) => set({ inviteOnly })}>Book only through these links</Switch>
                    {draft.inviteOnly && <span className="tf-bkf__muted">The page’s own address says it books by invitation. <TextLink onPress={() => onShare(page, 'once')} weight="strong">One-time links</TextLink></span>}
                  </div>
                  {(draft.visibility ?? 'public') === 'public' && draft.kind !== 'table' && (() => {
                    const listed = state.pages.filter((x) => x.isOn && (x.visibility ?? 'public') === 'public' && !x.linkKind && x.onLinkPage !== false);
                    const count = Math.max(1, listed.length);
                    return <div className="tf-bkf__group">
                      <span className="tf-bkf__label">Profile</span>
                      <Switch isSelected={draft.onLinkPage ?? true} onChange={(onLinkPage) => set({ onLinkPage })}>On your link page</Switch>
                      {(draft.onLinkPage ?? true) && <Select label="Position" value={String(draft.linkOrder ?? Math.max(1, listed.findIndex((x) => x.id === draft.id) + 1))} onChange={(v) => set({ linkOrder: Number(v ?? 1) })}
                        items={Array.from({ length: count }, (_, n) => ({ id: String(n + 1), label: n === 0 ? 'First' : n === count - 1 ? `Last (${n + 1})` : String(n + 1) }))} description="Public pages join your link page. Move, hide or archive them there." />}
                    </div>;
                  })()}
                  </ShowMore>
                </div>
              </Section>
              </TabPanel>
                <TabPanel id="when" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="When" description={whenSummary(draft, state)}>
                  <div className="tf-bkf-settings" data-section="when">
                    <SettingRow title="Hours" description="Which weekly hours guests can book.">
                      <Select label="Hours" isLabelHidden className="tf-bkf__inline-select" value={draft.hoursFrom}
                        onChange={(v) => { if (v) set({ hoursFrom: v, customHours: v === 'custom' ? draft.customHours ?? hoursFor(draft, state) : draft.customHours }); }}
                        items={[...state.savedHours.map((h) => ({ id: h.id === state.defaultHoursId ? 'working' : h.id, label: h.id === state.defaultHoursId ? `Your ${h.name.toLowerCase()}` : h.name })), { id: 'custom', label: 'Just for this page' }]} />
                    </SettingRow>
                    {draft.hoursFrom === 'custom' && draft.customHours && <div className="tf-bkf-setting__more tf-bkf__stack"><HoursEditor value={draft.customHours} onChange={(h) => set({ customHours: h })} /><DaysOffEditor value={draft.daysOff ?? []} onChange={(daysOff) => set({ daysOff })} /></div>}
                    <SettingRow title="Time zone" description="These hours follow this zone.">
                      <Select label="Time zone" isLabelHidden className="tf-bkf__inline-select" value={draft.zone ?? HOST_ZONE} onChange={(v) => { if (v) set({ zone: v === HOST_ZONE ? undefined : v }); }} items={ZONES.map((z) => ({ id: z.id, label: z.label, description: z.id === HOST_ZONE ? 'Your time zone' : undefined }))} />
                    </SettingRow>
                    <SettingRow title="Gap around meetings" description="Free time kept before and after each one.">
                      <span className="tf-bkf-setting__pair">
                        <Select label="Before" isLabelHidden className="tf-bkf__inline-select" items={BUFFERS.map((x) => ({ ...x, label: x.id === '0' ? 'None before' : `${x.label} before` }))} value={String(draft.bufferBefore)} onChange={(v) => set({ bufferBefore: Number(v ?? 0) })} />
                        <Select label="After" isLabelHidden className="tf-bkf__inline-select" items={BUFFERS.map((x) => ({ ...x, label: x.id === '0' ? 'None after' : `${x.label} after` }))} value={String(draft.bufferAfter)} onChange={(v) => set({ bufferAfter: Number(v ?? 0) })} />
                      </span>
                    </SettingRow>
                    <SettingRow title="Minimum notice" description="How soon before a meeting guests can book.">
                      <Select label="Minimum notice" isLabelHidden className="tf-bkf__inline-select" items={NOTICE} value={String(draft.noticeHours)} onChange={(v) => set({ noticeHours: Number(v ?? 0) })} />
                    </SettingRow>
                    <SettingRow title="How far ahead" description="The latest day guests can pick.">
                      <Select label="Book up to" isLabelHidden className="tf-bkf__inline-select" items={AHEAD} value={String(draft.daysAhead)} onChange={(v) => set({ daysAhead: Number(v ?? 60) })} />
                    </SettingRow>
                    <SettingRow title="Most a day" description="Meetings from this page in one day.">
                      <span className="tf-bkf-setting__pair">
                        <Switch aria-label="Limit meetings a day" isSelected={draft.perDay > 0} onChange={(on) => set({ perDay: on ? 4 : 0 })} />
                        {draft.perDay > 0 && <NumberField aria-label="Most a day" value={draft.perDay} minValue={1} maxValue={20} onChange={(n) => { if (Number.isFinite(n) && n > 0) set({ perDay: n }); }} />}
                      </span>
                    </SettingRow>
                    <SettingRow title="Most a week" description="Meetings from this page in one week.">
                      <span className="tf-bkf-setting__pair">
                        <Switch aria-label="Limit meetings a week" isSelected={draft.perWeek > 0} onChange={(on) => set({ perWeek: on ? 10 : 0 })} />
                        {draft.perWeek > 0 && <NumberField aria-label="Most a week" value={draft.perWeek} minValue={1} maxValue={60} onChange={(n) => { if (Number.isFinite(n) && n > 0) set({ perWeek: n }); }} />}
                      </span>
                    </SettingRow>
                    <ShowMore showLabel="More options" hideLabel="Fewer options">
                      <div className="tf-bkf-settings">
                        <SettingRow title="Start times" description="How often a time can start.">
                      <Select label="Start times" isLabelHidden className="tf-bkf__inline-select" items={STEPS} value={String(draft.slotStep ?? 0)} onChange={(v) => set({ slotStep: Number(v ?? 0) })} />
                    </SettingRow>
                        {state.calendars.length > 0 && <SettingRow title="Checks for conflicts in" description="Busy time in these calendars is never offered.">
                          <ChoiceChips label="Checks for conflicts in" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={(draft.conflictIn ?? state.calendars.filter((c) => c.checkConflicts).map((c) => c.id)).filter((id) => state.calendars.some((c) => c.id === id && c.status === 'connected'))}
                            items={state.calendars.map((c) => ({ id: c.id, label: c.status === 'connected' ? `${c.provider} · ${c.email.split('@')[0]}` : `${c.provider} · needs reconnect`, isDisabled: c.status !== 'connected' }))}
                            onSelectionChange={(k) => set({ conflictIn: [...k].map(String) })} />
                        </SettingRow>}
                      </div>
                    </ShowMore>
                    <SettingRow title="Time off" description={hostOff.length === 0 ? 'None planned. Time off is set under Availability.' : 'Guests see no times then.'}>
                      {hostOff.length > 0 ? <span className="tf-bkf__muted tf-num">{hostOff.map((t) => `${first(t.member)} · ${formatDate(parseDay(t.from))}${t.to !== t.from ? ` – ${formatDate(parseDay(t.to))}` : ''}`).join(', ')}</span> : null}
                    </SettingRow>
                  </div>
                </Section></TabPanel>
                <TabPanel id="who" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Who" description={whoSummary(draft, state, now)}
                  action={stuck ? <Tag hue="orange" icon={<AlertTriangle size={12} strokeWidth={2} />}>No hosts available</Tag> : undefined}>
                  <div className="tf-bkf__stack" data-section="who">
                    {stuck && <Callout tone="warning">Everyone on this page is away or paused, so guests can't book it. Add a host who's free.</Callout>}
                    <div className="tf-bkf-settings">
                    <SettingRow title="Who hosts" description={draft.hostMode === 'one' ? 'One person takes every meeting.' : draft.hostMode === 'collective' ? 'Everyone must be free; they all join.' : draft.hostMode === 'roundrobin' ? 'One free host takes it, in turn.' : 'Each member gets their own copy of this page.'}>
                      <Select label="Who hosts" isLabelHidden className="tf-bkf__inline-select" value={draft.hostMode} onChange={(v) => { if (v) setMode(v as HostMode); }}
                        items={[{ id: 'one', label: 'One person' }, { id: 'collective', label: 'Everyone together' }, { id: 'roundrobin', label: 'Round robin' }, { id: 'managed', label: 'A copy each' }]} />
                    </SettingRow>
                    {draft.hostMode === 'one' && (
                      <SettingRow title="Host" description="Their hours and calendars decide the times.">
                        <Select label="Host" isLabelHidden className="tf-bkf__inline-select" items={TEAM.map((n) => ({ id: n, label: n === HOST ? `${n} (you)` : n, icon: <Avatar name={n} size={20} /> }))} value={draft.hosts[0] ?? HOST} onChange={(v) => { if (v) set({ hosts: [v] }); }} />
                      </SettingRow>
                    )}
                    </div>
                    {draft.hostMode === 'one' ? null : (
                      <div className="tf-bkf__checks" role="group" aria-label="Hosts">
                        {TEAM.map((name) => {
                          const on = draft.hosts.includes(name);
                          const paused = isPaused(state, draft, name);
                          const off = state.timeOff.some((t) => t.member === name && parseDay(t.to) >= dayFrom(now, 0));
                          return (
                            <Checkbox key={name} isSelected={on} isDisabled={on && draft.hosts.length === 1}
                              onChange={(v) => set({ hosts: v ? TEAM.filter((n) => n === name || draft.hosts.includes(n)) : draft.hosts.filter((n) => n !== name), alwaysWith: v && draft.alwaysWith?.includes(name) ? draft.alwaysWith.filter((n) => n !== name).length ? draft.alwaysWith.filter((n) => n !== name) : undefined : draft.alwaysWith })}>
                              <span className="tf-bkf__host"><Avatar name={name} size={20} />{name}{name === HOST && <span className="tf-bkf__muted"> · you</span>}{paused && <span className="tf-bkf__muted"> · paused</span>}{off && <span className="tf-bkf__muted"> · time off soon</span>}{(state.memberCalendars?.[name] === 'reconnect') && <span className="tf-bkf__muted"> · calendar needs reconnecting</span>}{draft.hostMode === 'roundrobin' && draft.alwaysWith?.includes(name) && <span className="tf-bkf__muted"> · joins every meeting</span>}</span>
                            </Checkbox>
                          );
                        })}
                      </div>
                    )}
                    {draft.hostMode === 'roundrobin' && (
                      <div className="tf-bkf-settings tf-bkf-settings--ruled">
                        <SettingRow title="How it's shared out" description={SHARE_HELP[draft.shareOut]}>
                          <Select label="How it's shared out" isLabelHidden className="tf-bkf__inline-select" value={draft.shareOut} onChange={(k) => { if (k) set({ shareOut: k as ShareOut }); }}
                            items={[{ id: 'equal', label: 'Fewest first' }, { id: 'even', label: 'Strict turns' }, { id: 'weighted', label: 'Weighted' }, { id: 'priority', label: 'By priority' }]} />
                        </SettingRow>
                        {draft.shareOut === 'even' && (
                          <SettingRow title="Waits when ahead by" description="Someone this many meetings ahead sits out until the rest catch up.">
                            <NumberField aria-label="Waits when ahead by" value={draft.evenGap ?? 1} minValue={1} maxValue={5} onChange={(n) => { if (Number.isFinite(n) && n > 0) set({ evenGap: n }); }} />
                          </SettingRow>
                        )}
                        {(draft.shareOut === 'weighted' || draft.shareOut === 'priority') && (
                          <div className="tf-bkf-setting__more tf-bkf__weights">
                            {draft.hosts.map((h) => (
                              <NumberField key={h} label={h} description={draft.shareOut === 'weighted' ? 'Share of meetings' : '1 goes first'} value={draft.weights[h] ?? 1} minValue={1} maxValue={draft.shareOut === 'weighted' ? 10 : draft.hosts.length}
                                onChange={(n) => set({ weights: { ...draft.weights, [h]: Number.isFinite(n) ? n : 1 } })} />
                            ))}
                          </div>
                        )}
                        <SettingRow title="Count meetings from" description="Who is ahead is judged over this window.">
                          <Select label="Count meetings from" isLabelHidden className="tf-bkf__inline-select" value={String(draft.countDays ?? 0)} onChange={(k) => set({ countDays: Number(k ?? 0) })}
                            items={[{ id: '0', label: 'This month' }, { id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }]} />
                        </SettingRow>
                        <SettingRow title="Most a day, each" description="Someone at their cap sits the day out. Empty is no cap.">
                          <span className="tf-bkf-caps">
                            {draft.hosts.map((h) => (
                              <NumberField key={h} label={first(h)} showSteppers={false} value={(draft.caps?.[h] ?? 0) || Number.NaN} minValue={1} maxValue={20} placeholder="No cap"
                                onChange={(n) => set({ caps: { ...(draft.caps ?? {}), [h]: Number.isFinite(n) ? n : 0 } })} />
                            ))}
                          </span>
                        </SettingRow>
                        <ShowMore showLabel="More options" hideLabel="Fewer options" defaultExpanded={Boolean(draft.alwaysWith?.length)}>
                          {/* A fixed teammate on every meeting while the hosts rotate (Chili Piper's and Calendly's "always include"). */}
                          {TEAM.some((n) => !draft.hosts.includes(n)) && <div className="tf-bkf__group tf-bkf-always">
                            <ChoiceChips label="Always joins" size="sm" selectionMode="multiple" selectedKeys={[...(draft.alwaysWith ?? [])]}
                              onSelectionChange={(k) => set({ alwaysWith: k.size ? TEAM.filter((n) => k.has(n)) : undefined })}
                              items={TEAM.filter((n) => !draft.hosts.includes(n)).map((n) => ({ id: n, label: n === HOST ? `${first(n)} (you)` : first(n) }))} />
                          {draft.alwaysWith?.length ? <p className="tf-bkf__muted">{draft.alwaysWith.map(first).join(' and ')} {draft.alwaysWith.length === 1 ? 'joins' : 'join'} every meeting, so times show only when {draft.alwaysWith.length === 1 ? 'they are' : 'they’re all'} free too.</p> : null}
                          </div>}
                          <div className="tf-bkf-settings">
                        <SettingRow title="When a meeting moves" description={(draft.rrReschedule ?? 'same') === 'same' ? 'The same host keeps it if they’re free at the new time.' : 'The rotation picks again, as for a new booking.'}>
                          <Select label="When a meeting moves" isLabelHidden className="tf-bkf__inline-select" value={draft.rrReschedule ?? 'same'} onChange={(k) => set({ rrReschedule: k === 'rotate' ? 'rotate' : 'same' })}
                            items={[{ id: 'same', label: 'Keep the same host' }, { id: 'rotate', label: 'Ask the rotation again' }]} />
                        </SettingRow>
                          </div>
                        </ShowMore>
                        <div className="tf-bkf-setting__more tf-bkf__spread">
                          <span className="tf-bkf__label">{draft.countDays ? `Last ${draft.countDays} days` : 'This month so far'}</span>
                          {draft.hosts.map((h) => <Meter key={h} label={h} value={spread[h] ?? 0} maxValue={maxSpread} valueLabel={plural(spread[h] ?? 0, 'meeting')} warnAt={2} dangerAt={2} />)}
                          <Button variant="secondary" icon={<Settings2 {...i14} />} onPress={onManageGroups}>Manage groups</Button>
                        </div>
                      </div>
                    )}
                    {draft.hostMode === 'managed' && (
                      <div className="tf-bkf-settings tf-bkf-settings--ruled">
                        <SettingRow title="Locked for members" description="Members can't change these on their copy. Saving here updates every copy.">
                          <ChoiceChips label="Locked for members" isLabelHidden selectionMode="multiple" selectedKeys={draft.locked ?? ['length', 'questions']}
                            items={LOCKABLE} onSelectionChange={(k) => set({ locked: [...k] as LockedPart[] })} />
                        </SettingRow>
                        <div className="tf-bkf-setting__more">
                          <ul className="tf-bkf__list-plain tf-bkf-copies">
                            {draft.hosts.map((h) => {
                              const changed = (draft.drift?.[h] ?? []).filter((x) => !(draft.locked ?? ['length', 'questions']).includes(x));
                              const stale = (draft.drift?.[h] ?? []).filter((x) => (draft.locked ?? ['length', 'questions']).includes(x));
                              return (
                                <li key={h} className="tf-bkf-copies__row">
                                  <Avatar name={h} size={24} />
                                  <span className="tf-bkf-copies__text"><strong>{first(h)}’s copy</strong><span className="tf-bkf__muted tf-num">timefix.com/{first(h).toLowerCase()}/{draft.slug}</span></span>
                                  {stale.length > 0 ? <Tag hue="orange">Behind on {stale.map((x) => LOCKABLE.find((l) => l.id === x)?.label.toLowerCase()).join(', ')}</Tag>
                                    : changed.length > 0 ? <Tag hue="gray">Changed {changed.map((x) => LOCKABLE.find((l) => l.id === x)?.label.toLowerCase()).join(', ')}</Tag>
                                    : <Tag hue="green">In sync</Tag>}
                                  {stale.length > 0 && <Button variant="ghost" onPress={() => set({ drift: { ...(draft.drift ?? {}), [h]: changed } })}>Update copy</Button>}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    )}
                    <div className="tf-bkf-settings tf-bkf-settings--ruled">
                    <SettingRow title="Who can book" description={draft.whoCanBook === 'form' ? 'Guests see times after they send the form.' : 'Anyone with the link picks a time.'}>
                      <SegmentedControl aria-label="Who can book" selectedKey={draft.whoCanBook} onSelectionChange={(v) => set({ whoCanBook: v === 'form' ? 'form' : 'anyone', formName: v === 'form' ? draft.formName || 'Support request' : draft.formName })}
                        items={[{ id: 'anyone', label: 'Anyone' }, { id: 'form', label: 'Through a form' }]} />
                    </SettingRow>
                    <SettingRow title="Who can edit" description="Admins always can. Others you pick here can change this page too.">
                      <ChoiceChips label="Who can edit" isLabelHidden selectionMode="multiple" selectedKeys={draft.editors ?? []}
                        items={TEAM.filter((n) => n !== draft.owner).map((n) => ({ id: n, label: first(n) }))} onSelectionChange={(k) => set({ editors: [...k] })} />
                    </SettingRow>
                    {draft.whoCanBook === 'form' && (
                      <SettingRow title="Form" description="The form guests fill in first.">
                        <Select label="Form" isLabelHidden className="tf-bkf__inline-select" items={FORMS} value={draft.formName} onChange={(v) => { if (v) set({ formName: v }); }} />
                      </SettingRow>
                    )}
                    </div>
                  </div>
                </Section></TabPanel>
                <TabPanel id="questions" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Questions for the guest" description="Name and email are always asked. Add anything else you need before the call.">
                  <div className="tf-bkf__stack" data-section="questions">
                    <QuestionBuilder questions={draft.questions} onChange={(questions) => set({ questions })} title="Also asked" kinds={['short', 'long', 'phone', 'choice', 'multi', 'dropdown']} saveTargets={SAVE_TARGETS} />
                  </div>
                </Section></TabPanel>
                <TabPanel id="after" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="After booking" description={afterSummary(draft)}>
                  <div className="tf-bkf-settings" data-section="after">
                    <SettingRow title="Confirming" description={draft.confirmFirst ? 'Requests wait in Meetings, under Needs your OK. Unanswered requests decline after a day.' : 'Requests wait for you in Meetings, under Needs your OK.'}>
                      <SegmentedControl aria-label="Confirming" selectedKey={draft.confirmFirst ? 'me' : 'auto'} onSelectionChange={(v) => set({ confirmFirst: v === 'me' })}
                        items={[{ id: 'auto', label: 'At once' }, { id: 'me', label: 'I confirm first' }]} />
                    </SettingRow>
                    <SettingRow title="Calendar" description="Where new bookings are added.">
                      <Select label="Add bookings to" isLabelHidden className="tf-bkf__inline-select" items={calendarsOf(state).length ? calendarsOf(state) : [{ id: 'work', label: 'Work', description: 'Connect a calendar first' }]} value={draft.calendarId} onChange={(v) => { if (v) set({ calendarId: v }); }} />
                    </SettingRow>
                    <SettingRow title="Add to People" description="Guests become people, linked to their company.">
                      <Switch aria-label="Add guests to People" isSelected={(draft.fileTo ?? (draft.addToPeople ? 'people' : 'none')) !== 'none'} onChange={(on) => set({ addToPeople: on, fileTo: on ? (draft.fileTo && draft.fileTo !== 'none' ? draft.fileTo : 'people') : 'none' })} />
                    </SettingRow>
                    <SettingRow title="Reminders" description={draft.remindByText ? 'An email and a text to the guest before they come.' : `Emails to the guest before the ${draft.kind === 'table' ? 'booking' : draft.kind === 'service' ? 'appointment' : 'meeting'}.`}>
                      <ChoiceChips label="Reminders" isLabelHidden selectionMode="multiple" selectedKeys={draft.reminders}
                        items={REMINDERS.map((r) => ({ id: r.id, label: r.label }))} onSelectionChange={(k) => set({ reminders: REMINDERS.filter((r) => k.has(r.id)).map((r) => r.id) })} />
                    </SettingRow>
                    {(draft.kind === 'service' || draft.kind === 'table') && draft.reminders.length > 0 && (
                      <SettingRow title="Also by text" description="To the mobile they give when they book.">
                        <Switch aria-label="Also send reminders by text" isSelected={draft.remindByText ?? false} onChange={(remindByText) => set({ remindByText })} />
                      </SettingRow>
                    )}
                    {draft.reminders.length > 0 && <p className="tf-bkf-remind__sample"><span className="tf-bkf__muted">{draft.remindByText ? 'The text reads' : 'The email says'}</span>“{(() => {
                      const when = draft.reminders.includes('day') ? 'tomorrow at 10:30 AM' : draft.reminders.includes('week') ? 'next Tuesday at 10:30 AM' : 'today at 10:30 AM';
                      const who = draft.kind === 'table' ? `your table for 2 at ${state.workspace}` : draft.kind === 'service' ? `${draft.name} with ${first(draft.hosts[0] ?? draft.owner)} at ${state.workspace}` : `${draft.name} with ${first(draft.owner)}`;
                      return `See you ${when}: ${who}. Need to change it? Use the link in your booking email.`;
                    })()}”</p>}
                    <SettingRow title="Emails to the guest" description="Each one goes from your address, with the meeting details.">
                      <ChoiceChips label="Emails to the guest" isLabelHidden selectionMode="multiple" selectedKeys={draft.emails ?? ALL_EMAILS}
                        items={[{ id: 'confirm', label: 'Confirmation' }, { id: 'change', label: 'Changes' }, { id: 'cancel', label: 'Cancellations' }, { id: 'after', label: 'Thank-you after' }]}
                        onSelectionChange={(k) => set({ emails: [...(draft.emails ?? ALL_EMAILS).filter((e) => e.startsWith('host-')), ...k] })} />
                    </SettingRow>
                    <SettingRow title="Emails to you" description="Your hosts get the same.">
                      <ChoiceChips label="Emails to you" isLabelHidden selectionMode="multiple" selectedKeys={(draft.emails ?? ALL_EMAILS).filter((e) => e.startsWith('host-'))}
                        items={[{ id: 'host-booked', label: 'New bookings' }, { id: 'host-cancel', label: 'Cancellations' }]}
                        onSelectionChange={(k) => set({ emails: [...(draft.emails ?? ALL_EMAILS).filter((e) => !e.startsWith('host-')), ...k] })} />
                    </SettingRow>
                    <SettingRow title="After they book" description={draft.after === 'redirect' ? 'They go to your web page.' : 'They see a thank-you with the details.'}>
                      <SegmentedControl aria-label="After they book" selectedKey={draft.after} onSelectionChange={(v) => set({ after: v === 'redirect' ? 'redirect' : 'message' })}
                        items={[{ id: 'message', label: 'Thank-you' }, { id: 'redirect', label: 'Web page' }]} />
                    </SettingRow>
 <ShowMore showLabel="More options" hideLabel="Fewer options">
                      <div className="tf-bkf-settings">
                    <SettingRow title="File answers to" description={(draft.fileTo ?? (draft.addToPeople ? 'people' : 'none')) === 'deals' ? 'Matched by email to the person’s open deal; a new deal if there is none.' : (draft.fileTo ?? (draft.addToPeople ? 'people' : 'none')) === 'none' ? 'Answers stay on the meeting only.' : 'Matched by email; a new record if there is no match.'}>
                      <Select label="File answers to" isLabelHidden className="tf-bkf__inline-select" items={FILE_TO} value={draft.fileTo ?? (draft.addToPeople ? 'people' : 'none')}
                        onChange={(v) => { if (v) set({ fileTo: v as 'people', addToPeople: v !== 'none' }); }} />
                    </SettingRow>
                    <SettingRow title="Guests can cancel" description="After this, the link in their invite shows your message instead.">
                      <Select label="Guests can cancel" isLabelHidden className="tf-bkf__inline-select" items={CUTOFFS} value={String(draft.cancelCutoff ?? 0)} onChange={(v) => set({ cancelCutoff: Number(v ?? 0) })} />
                    </SettingRow>
                    <SettingRow title="Guests can move it" description="The same, for picking a new time.">
                      <Select label="Guests can move it" isLabelHidden className="tf-bkf__inline-select" items={CUTOFFS} value={String(draft.moveCutoff ?? 0)} onChange={(v) => set({ moveCutoff: Number(v ?? 0) })} />
                    </SettingRow>
                    {((draft.cancelCutoff ?? 0) > 0 || (draft.moveCutoff ?? 0) > 0) && (
                      <div className="tf-bkf-setting__more"><TextArea label="When it’s too late" rows={2} value={draft.tooLateMessage ?? ''} onChange={(tooLateMessage) => set({ tooLateMessage })} placeholder="It’s too close to the meeting to change it here. Reply to your invite instead." /></div>
                    )}
                      </div>
                    </ShowMore>
                    {draft.after === 'redirect' && <div className="tf-bkf__stack tf-bkf__stack--8">
                      <TextField label="Web address" value={draft.redirectUrl} onChange={(redirectUrl) => set({ redirectUrl })} placeholder="https://northwind.com/thanks" type="url" />
                      <Switch isSelected={draft.redirectDetails ?? false} onChange={(redirectDetails) => set({ redirectDetails })}>Add the booking’s details to the address</Switch>
                      <span className="tf-bkf__muted">{draft.redirectDetails ? <span className="tf-num">{(draft.redirectUrl || 'https://northwind.com/thanks')}?name=Liam+Ortiz&email=liam%40acme.com&start=…&zone=Asia%2FKolkata&page={draft.slug}</span> : 'Name, email, start, time zone and page.'}</span>
                    </div>}
                  </div>
                </Section></TabPanel>
                <TabPanel id="look" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Look" description={lookSummary(draft)}>
                  <div className="tf-bkf__stack" data-section="look">
                    <GuestLook value={draft.look} onChange={(look) => set({ look })} host={draft.owner} title={draft.name} isPreviewHidden />
                    <Switch isSelected={draft.showPhoto} onChange={(showPhoto) => set({ showPhoto })}>Show your photo on the page</Switch>
                    <div>
                      <span className="tf-bkf__label">Social links</span>
                      <SocialLinksEditor links={draft.socials} onChange={(socials) => set({ socials })} />
                    </div>
                  </div>
                </Section></TabPanel>
              <TabPanel id="bookings" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Bookings" description={`Booked through ${page.name}.`} action={<Button size="sm" variant="ghost" iconEnd={<ArrowRight {...i14} />} onPress={onMeetings}>Open in Bookings</Button>}>
                <div className="tf-bkf__stack">
                  <SegmentedControl aria-label="Which bookings" size="sm" selectedKey={bookingsRange} onSelectionChange={(k) => setBookingsRange(k === 'past' ? 'past' : k === 'cancelled' ? 'cancelled' : 'upcoming')}
                    items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'cancelled', label: 'Cancelled' }]} />
                  {(() => {
                    const mine = state.meetings.filter((m) => m.pageId === page.id);
                    const list = bookingsRange === 'cancelled' ? mine.filter((m) => m.status === 'cancelled') : bookingsRange === 'past' ? mine.filter((m) => m.status !== 'cancelled' && m.end <= now).reverse() : mine.filter((m) => m.status !== 'cancelled' && m.end > now);
                    if (list.length === 0) return <p className="tf-bkf__muted">{bookingsRange === 'upcoming' ? 'No upcoming bookings' : bookingsRange === 'past' ? 'No past bookings' : 'Nothing has been called off'}</p>;
                    return <MeetingList isFullWidth now={now} meetings={list.filter((m) => m.status !== 'pending').map((m) => ({ ...m, host: draft.hosts.length > 1 ? first(m.host) : undefined }))} requests={bookingsRange === 'upcoming' ? list.filter((m) => m.status === 'pending').map((m) => ({ ...m, note: declinesIn(m, now) })) : []} onOpen={(m) => onOpenMeeting?.(m.id)} />;
                  })()}
                </div>
              </Section></TabPanel>
              <TabPanel id="insights" className="tf-bkf__edpanel"><div className="tf-bkf-card tf-bkf-edinsights"><InsightsTab state={state} pageId={page.id} /></div></TabPanel>
              </Tabs>
            </div>
            <aside className="tf-bkf__editor-preview" aria-label="Preview">
              <Eyebrow><Eye {...i14} aria-hidden="true" /> What guests see</Eyebrow>
              <div className="tf-bkf-sheet__preview">
                <div className="tf-bkf__soft" key={`${draft.durations[0]}-${draft.places[0] as PlaceKind}-${draft.hoursFrom}`}>
                  <ScaledPreview label="Booking page preview" designWidth={400}>
                    {draft.kind === 'table' ? <TablePreview state={{ ...state, pages: state.pages.map((x) => (x.id === draft.id ? draft : x)) }} table={draft} /> : <GuestView page={draft} state={state} onBook={noBook} />}
                  </ScaledPreview>
                </div>
              </div>
            </aside>
          </div>
        </div>
        {/* The one publish bar every editor shares: it rises when guests would see something new, and leaves once they do. */}
        <PublishBar status={save === 'saving' ? 'publishing' : save === 'saved' && !dirty ? 'published' : dirty || kept ? 'draft' : 'live'} changes={1}
          message={dirty ? 'Unpublished changes' : 'A draft is kept'} isPublishDisabled={!dirty || taken || nameless} onPublish={doSave}
          onDiscard={() => { onDraft(page); onKeepDraft(page); }} />
      </div>
      <Drawer isOpen={versionsOpen} onOpenChange={setVersionsOpen} title="Versions" subtitle="Each time you publish, the page before is kept here.">
        <ol className="tf-bkf-versions" aria-label="Versions">
          <li className="tf-bkf-versions__row">
            <span className="tf-bkf-versions__dot is-live" aria-hidden="true" />
            <span className="tf-bkf-versions__text"><strong>Live now</strong><span className="tf-bkf__muted">What guests see</span></span>
          </li>
          {(page.versions ?? []).map((v) => (
            <li key={v.id} className="tf-bkf-versions__row">
              <span className="tf-bkf-versions__dot" aria-hidden="true" />
              <span className="tf-bkf-versions__text">
                <strong className="tf-num">{formatDay(v.at)}</strong>
                <span className="tf-bkf__muted">{first(v.by)} changed {v.changes.join(', ').toLowerCase() || 'nothing visible'}</span>
              </span>
              <Button variant="ghost" icon={<RotateCcw {...i14} />} onPress={() => { onDraft({ ...v.page, versions: page.versions, isOn: page.isOn }); setVersionsOpen(false); }}>Restore</Button>
            </li>
          ))}
          {(page.versions ?? []).length === 0 && <li className="tf-bkf__muted">No earlier versions yet. Publish a change and the version before it appears here.</li>}
        </ol>
        <p className="tf-bkf__muted">Restoring opens that version as a draft. Nothing changes for guests until you publish.</p>
      </Drawer>
    </>
  );
}
