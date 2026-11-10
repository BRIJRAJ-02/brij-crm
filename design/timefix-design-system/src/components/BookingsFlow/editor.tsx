// Step 5: the page editor. One scroll of sections with live summaries, the guest's view beside it, Save changes at the foot.
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ArrowRight, CalendarDays, Check, Eye, Link2, MessageSquareText, Palette, Play, Settings2, Users } from 'lucide-react';
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
import { HoursEditor } from '../HoursEditor/HoursEditor.tsx';
import { QuestionBuilder } from '../QuestionList/QuestionList.tsx';
import { GuestLook } from '../GuestLook/GuestLook.tsx';
import { SocialLinksEditor } from '../SocialLinks/SocialLinks.tsx';
import { Meter } from '../Progress/Progress.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button } from '../Button/Button.tsx';
import { NumberRoll, SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { formatDate } from '../../lib/format.ts';
import { Eyebrow, GuestView, Section, SettingRow, OnSwitch, PageMoreMenu, ScaledPreview, ShareMenu, i14, i16, noBook, type ShareHow } from './parts.tsx';
import { uniqueSlug } from './seed.ts';
import {
  HOST, PLACES, PLACE_ORDER, TEAM, afterSummary, dayFrom, first, hoursFor, isPaused, lookSummary, monthSpread, noHostsFree, parseDay, plural, questionsSummary, whenSummary, whoSummary,
  type BookingPage, type BookingsState, type HostMode, type LockedPart, type PlaceKind, type ShareOut,
} from './state.ts';

const LENGTHS = [15, 30, 45, 60, 90];
const BUFFERS = [0, 5, 10, 15, 30].map((n) => ({ id: String(n), label: n ? `${n} min` : 'None' }));
const NOTICE = [{ id: '0', label: 'None' }, { id: '1', label: '1 hour' }, { id: '4', label: '4 hours' }, { id: '24', label: '1 day' }, { id: '48', label: '2 days' }];
const AHEAD = [14, 30, 60, 90].map((n) => ({ id: String(n), label: `${n} days ahead` }));
const CALENDARS = [{ id: 'work', label: 'Work', description: 'Google · priya@northwind.com' }, { id: 'personal', label: 'Personal', description: 'Google · priya@northwind.com' }, { id: 'outlook', label: 'Calendar', description: 'Outlook · needs reconnect', isDisabled: true }];
const FORMS = [{ id: 'Support request', label: 'Support request' }, { id: 'Contact sales', label: 'Contact sales' }, { id: 'Partner enquiry', label: 'Partner enquiry' }];

type SaveState = 'idle' | 'saving' | 'saved';
/** The sections that can be opened from outside (Fix opens Who). */
export type EditorSection = 'when' | 'who' | 'questions' | 'after' | 'look';

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

export function PageEditor({ page, draft, state, section, onDraft, onBack, onSave, onToggle, onShare, onMore, onGuest, onMeetings, onManageGroups }: PageEditorProps) {
  const [save, setSave] = useState<SaveState>('idle');
  const now = new Date();
  const dirty = JSON.stringify({ ...draft, isOn: page.isOn }) !== JSON.stringify(page);
  const set = (patch: Partial<BookingPage>) => { onDraft({ ...draft, ...patch }); if (save === 'saved') setSave('idle'); };
  const sectionRef = useRef<HTMLDivElement>(null);
  const taken = state.pages.some((p) => p.id !== draft.id && p.slug === draft.slug);
  // A link into one part of the page ("Fix hosts") opens on that tab.
  const [tab, setTab] = useState<string>(section ?? 'basics');
  useEffect(() => { if (section) setTab(section); }, [section]);
  const doSave = () => {
    if (!dirty || save === 'saving' || taken) return;
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
          <Button size="sm" variant="ghost" icon={<Play {...i14} />} onPress={onGuest}>See it as a guest</Button>
          <ShareMenu page={page} onShare={onShare} />
          <PageMoreMenu page={page} withEdit={false} onAction={(k) => onMore(page, k)} />
        </>} />
      <div className="tf-bkf__editor">
        <AriaButton className="tf-bkf__stats" onPress={onMeetings} aria-label={`This month: ${page.stats.views} views, ${page.stats.bookings} bookings, ${page.stats.showRate}% showed up. Open this page's meetings.`}>
          <span><strong className="tf-num"><NumberRoll value={page.stats.views} /></strong> views</span>
          <span><strong className="tf-num"><NumberRoll value={page.stats.bookings} /></strong> bookings</span>
          <span><strong className="tf-num"><NumberRoll value={page.stats.showRate} />%</strong> showed up</span>
          <span className="tf-bkf__muted">this month</span>
          <span className="tf-bkf__stats-go">See meetings<ArrowRight {...i14} aria-hidden="true" /></span>
        </AriaButton>
        <div className="tf-bkf__editor-scroll">
          <div className="tf-bkf__editor-grid">
            <div className="tf-bkf__sections" ref={sectionRef}>
              {!page.isOn && <Callout tone="neutral" action={{ label: 'Turn it on', onPress: () => onToggle(true) }}>This page is hidden. Its link tells guests it isn't taking bookings right now.</Callout>}
              <Tabs aria-label="Page settings" className="tf-bkf__edtabs" selectedKey={tab} onSelectionChange={setTab}
                items={[
                  { id: 'basics', label: 'Basics' },
                  { id: 'when', label: 'When', icon: <CalendarDays {...i14} /> },
                  { id: 'who', label: 'Who', icon: stuck ? <AlertTriangle {...i14} /> : <Users {...i14} /> },
                  { id: 'questions', label: 'Questions', icon: <MessageSquareText {...i14} /> },
                  { id: 'after', label: 'After booking', icon: <Check {...i14} /> },
                  { id: 'look', label: 'Look', icon: <Palette {...i14} /> },
                ]}>
              <TabPanel id="basics" className="tf-bkf__edpanel">
              <Section className="tf-bkf-card" title="Basics" description="What guests see first: the name, the link, how long and where.">
                <div className="tf-bkf__stack">
                  <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} isRequired />
                  <TextField label="Link" value={draft.slug} className="tf-bkf__linkinput" icon={<span className="tf-bkf__prefix">timefix.com/priya/</span>}
                    onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} isInvalid={taken} errorMessage="Another page has this link. Try another."
                    suffix={!taken && draft.slug !== page.slug ? <span className="tf-bkf__ok-word"><Check size={14} strokeWidth={2} aria-hidden="true" />Available</span> : undefined}
                    onBlur={() => { if (!draft.slug) set({ slug: uniqueSlug('meeting', state.pages, draft.id) }); }} />
                  <ChoiceChips label="Lengths" size="sm" selectionMode="multiple" selectedKeys={draft.durations.map(String)} items={LENGTHS.map((n) => ({ id: String(n), label: `${n} min` }))}
                    onSelectionChange={(keys) => { const d = [...keys].map(Number).sort((a, b) => a - b); if (d.length) set({ durations: d }); }} />
                  {draft.durations.length > 1 && <p className="tf-bkf__muted tf-bkf__hint">Guests choose the length. {draft.durations[0]} min is picked first.</p>}
                  <ChoiceChips label="Places" size="sm" selectionMode="multiple" selectedKeys={draft.places} items={PLACE_ORDER.map((k) => ({ id: k, label: k === 'in-person' ? 'In person' : PLACES[k].label }))}
                    onSelectionChange={(keys) => { const p = PLACE_ORDER.filter((k) => keys.has(k)); if (p.length) set({ places: p }); }} />
                  {draft.places.includes('in-person') && <TextField label="Address" value={draft.address} onChange={(address) => set({ address })} placeholder="12 Harbour Street, Mumbai" />}
                  {draft.places.includes('phone') && <SegmentedControl aria-label="Who calls" size="sm" selectedKey={draft.phoneWho} onSelectionChange={(k) => set({ phoneWho: k === 'guest' ? 'guest' : 'host' })} items={[{ id: 'host', label: 'You call them' }, { id: 'guest', label: 'They call you' }]} />}
                  <div className="tf-bkf__group">
                    <span className="tf-bkf__label">Guests start in</span>
                    <SegmentedControl aria-label="Guests start in" size="sm" selectedKey={draft.defaultView ?? 'month'} onSelectionChange={(k) => set({ defaultView: k === 'list' ? 'list' : k === 'chat' ? 'chat' : 'month' })}
                      items={[{ id: 'month', label: 'Month' }, { id: 'list', label: 'List' }, { id: 'chat', label: 'Chat' }]} />
                    <span className="tf-bkf__muted">They can switch any time; their last choice is remembered.</span>
                  </div>
                  <TextArea label="Description" aside="Optional" rows={2} value={draft.description} onChange={(description) => set({ description })} placeholder="What the meeting is for, in a line or two" />
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
                    {draft.hoursFrom === 'custom' && draft.customHours && <div className="tf-bkf-setting__more"><HoursEditor value={draft.customHours} onChange={(h) => set({ customHours: h })} /></div>}
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
                    <SettingRow title="Time off" description={hostOff.length === 0 ? 'None planned. Time off is set under Availability.' : 'Guests see no times then.'}>
                      {hostOff.length > 0 ? <span className="tf-bkf__muted tf-num">{hostOff.map((t) => `${first(t.member)} · ${formatDate(parseDay(t.from))}${t.to !== t.from ? ` – ${formatDate(parseDay(t.to))}` : ''}`).join(', ')}</span> : null}
                    </SettingRow>
                  </div>
                </Section></TabPanel>
                <TabPanel id="who" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Who" description={whoSummary(draft, state, now)}
                  action={stuck ? <Tag size="sm" hue="orange" icon={<AlertTriangle size={12} strokeWidth={2} />}>No hosts available</Tag> : undefined}>
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
                              onChange={(v) => set({ hosts: v ? TEAM.filter((n) => n === name || draft.hosts.includes(n)) : draft.hosts.filter((n) => n !== name) })}>
                              <span className="tf-bkf__host"><Avatar name={name} size={20} />{name}{name === HOST && <span className="tf-bkf__muted"> · you</span>}{paused && <span className="tf-bkf__muted"> · paused</span>}{off && <span className="tf-bkf__muted"> · time off soon</span>}</span>
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
                        <div className="tf-bkf-setting__more tf-bkf__spread">
                          <span className="tf-bkf__label">{draft.countDays ? `Last ${draft.countDays} days` : 'This month so far'}</span>
                          {draft.hosts.map((h) => <Meter key={h} label={h} value={spread[h] ?? 0} maxValue={maxSpread} valueLabel={plural(spread[h] ?? 0, 'meeting')} warnAt={2} dangerAt={2} />)}
                          <Button size="sm" variant="secondary" icon={<Settings2 {...i14} />} onPress={onManageGroups}>Manage groups</Button>
                        </div>
                      </div>
                    )}
                    {draft.hostMode === 'managed' && (
                      <div className="tf-bkf-settings tf-bkf-settings--ruled">
                        <SettingRow title="Locked for members" description="Members can't change these on their copy. Saving here updates every copy.">
                          <ChoiceChips label="Locked for members" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={draft.locked ?? ['length', 'questions']}
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
                                  {stale.length > 0 ? <Tag size="sm" hue="orange">Behind on {stale.map((x) => LOCKABLE.find((l) => l.id === x)?.label.toLowerCase()).join(', ')}</Tag>
                                    : changed.length > 0 ? <Tag size="sm" hue="gray">Changed {changed.map((x) => LOCKABLE.find((l) => l.id === x)?.label.toLowerCase()).join(', ')}</Tag>
                                    : <Tag size="sm" hue="green">In sync</Tag>}
                                  {stale.length > 0 && <Button size="sm" variant="ghost" onPress={() => set({ drift: { ...(draft.drift ?? {}), [h]: changed } })}>Update copy</Button>}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    )}
                    <div className="tf-bkf-settings tf-bkf-settings--ruled">
                    <SettingRow title="Who can book" description={draft.whoCanBook === 'form' ? 'Guests see times after they send the form.' : 'Anyone with the link picks a time.'}>
                      <SegmentedControl aria-label="Who can book" size="sm" selectedKey={draft.whoCanBook} onSelectionChange={(v) => set({ whoCanBook: v === 'form' ? 'form' : 'anyone', formName: v === 'form' ? draft.formName || 'Support request' : draft.formName })}
                        items={[{ id: 'anyone', label: 'Anyone' }, { id: 'form', label: 'Through a form' }]} />
                    </SettingRow>
                    <SettingRow title="Who can edit" description="Admins always can. Others you pick here can change this page too.">
                      <ChoiceChips label="Who can edit" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={draft.editors ?? []}
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
                    <QuestionBuilder questions={draft.questions} onChange={(questions) => set({ questions })} title="Also asked" kinds={['short', 'long', 'phone', 'choice', 'multi', 'dropdown']} />
                  </div>
                </Section></TabPanel>
                <TabPanel id="after" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="After booking" description={afterSummary(draft)}>
                  <div className="tf-bkf-settings" data-section="after">
                    <SettingRow title="Confirming" description="Requests wait for you in Meetings, under Needs your OK.">
                      <SegmentedControl aria-label="Confirming" size="sm" selectedKey={draft.confirmFirst ? 'me' : 'auto'} onSelectionChange={(v) => set({ confirmFirst: v === 'me' })}
                        items={[{ id: 'auto', label: 'At once' }, { id: 'me', label: 'I confirm first' }]} />
                    </SettingRow>
                    <SettingRow title="Calendar" description="Where new bookings are added.">
                      <Select label="Add bookings to" isLabelHidden className="tf-bkf__inline-select" items={CALENDARS} value={draft.calendarId} onChange={(v) => { if (v) set({ calendarId: v }); }} />
                    </SettingRow>
                    <SettingRow title="Add to People" description="Guests become people, linked to their company.">
                      <Switch aria-label="Add guests to People" isSelected={draft.addToPeople} onChange={(addToPeople) => set({ addToPeople })} />
                    </SettingRow>
                    <SettingRow title="Reminders" description="Emails to the guest before the meeting.">
                      <ChoiceChips label="Reminders" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={draft.reminders}
                        items={[{ id: 'day', label: 'A day before' }, { id: 'hour', label: 'An hour before' }]} onSelectionChange={(k) => set({ reminders: [...k] })} />
                    </SettingRow>
                    <SettingRow title="Emails to the guest" description="Each one goes from your address, with the meeting details.">
                      <ChoiceChips label="Emails to the guest" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={draft.emails ?? ALL_EMAILS}
                        items={[{ id: 'confirm', label: 'Confirmation' }, { id: 'change', label: 'Changes' }, { id: 'cancel', label: 'Cancellations' }, { id: 'after', label: 'Thank-you after' }]}
                        onSelectionChange={(k) => set({ emails: [...(draft.emails ?? ALL_EMAILS).filter((e) => e.startsWith('host-')), ...k] })} />
                    </SettingRow>
                    <SettingRow title="Emails to you" description="Your hosts get the same.">
                      <ChoiceChips label="Emails to you" isLabelHidden selectionMode="multiple" size="sm" selectedKeys={(draft.emails ?? ALL_EMAILS).filter((e) => e.startsWith('host-'))}
                        items={[{ id: 'host-booked', label: 'New bookings' }, { id: 'host-cancel', label: 'Cancellations' }]}
                        onSelectionChange={(k) => set({ emails: [...(draft.emails ?? ALL_EMAILS).filter((e) => !e.startsWith('host-')), ...k] })} />
                    </SettingRow>
                    <SettingRow title="After they book" description={draft.after === 'redirect' ? 'They go to your web page.' : 'They see a thank-you with the details.'}>
                      <SegmentedControl aria-label="After they book" size="sm" selectedKey={draft.after} onSelectionChange={(v) => set({ after: v === 'redirect' ? 'redirect' : 'message' })}
                        items={[{ id: 'message', label: 'Thank-you' }, { id: 'redirect', label: 'Web page' }]} />
                    </SettingRow>
                    {draft.after === 'redirect' && <TextField label="Web address" value={draft.redirectUrl} onChange={(redirectUrl) => set({ redirectUrl })} placeholder="https://northwind.com/thanks" type="url" />}
                  </div>
                </Section></TabPanel>
                <TabPanel id="look" className="tf-bkf__edpanel"><Section className="tf-bkf-card" title="Look" description={lookSummary(draft)}>
                  <div className="tf-bkf__stack" data-section="look">
                    <GuestLook value={draft.look} onChange={(look) => set({ look })} host={draft.owner} title={draft.name} />
                    <Switch isSelected={draft.showPhoto} onChange={(showPhoto) => set({ showPhoto })}>Show your photo on the page</Switch>
                    <div>
                      <span className="tf-bkf__label">Social links</span>
                      <SocialLinksEditor links={draft.socials} onChange={(socials) => set({ socials })} />
                    </div>
                  </div>
                </Section></TabPanel>
              </Tabs>
            </div>
            <aside className="tf-bkf__editor-preview" aria-label="Preview">
              <Eyebrow><Eye {...i14} aria-hidden="true" /> What guests see</Eyebrow>
              <div className="tf-bkf-sheet__preview">
                <div className="tf-bkf__soft" key={`${draft.durations[0]}-${draft.places[0] as PlaceKind}-${draft.hoursFrom}`}>
                  <ScaledPreview label="Booking page preview" designWidth={400}>
                    <GuestView page={draft} state={state} onBook={noBook} />
                  </ScaledPreview>
                </div>
              </div>
            </aside>
          </div>
        </div>
        <footer className="tf-bkf__savefoot">
          <span className="tf-bkf__savenote" aria-live="polite"><TextSwap swapKey={dirty ? 'dirty' : 'clean'}>{dirty ? 'Unsaved changes' : 'Changes save to the live page'}</TextSwap></span>
          {dirty && save !== 'saving' && <Button variant="ghost" onPress={() => onDraft(page)}>Discard</Button>}
          <Button variant="primary" isDisabled={!dirty || taken} isPending={save === 'saving'} onPress={doSave} aria-keyshortcuts="Meta+S">
            <TextSwap swapKey={save === 'saved' && !dirty ? 'saved' : 'save'}>{save === 'saved' && !dirty ? <span className="tf-bkf__saved"><SuccessCheck size={16} />Saved</span> : 'Save changes'}</TextSwap>
          </Button>
        </footer>
      </div>
    </>
  );
}
