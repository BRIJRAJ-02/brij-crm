// Step 5: the page editor. One scroll of sections with live summaries, the guest's view beside it, Save changes at the foot.
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ArrowRight, CalendarDays, Check, Eye, MessageSquareText, Palette, Play, Settings2, Users } from 'lucide-react';
import { TopBar } from '../AppShell/AppShell.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { DisclosureGroup, DisclosureItem, ShowMore } from '../Disclosure/Disclosure.tsx';
import { Checkbox, RadioGroup, Radio, Switch } from '../Checkbox/Checkbox.tsx';
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
import { Eyebrow, GuestView, Section, OnSwitch, PageMoreMenu, ScaledPreview, ShareMenu, i14, i16, noBook, type ShareHow } from './parts.tsx';
import { uniqueSlug } from './seed.ts';
import {
  HOST, PLACES, PLACE_ORDER, TEAM, afterSummary, dayFrom, hoursFor, isPaused, lookSummary, monthSpread, noHostsFree, parseDay, plural, questionsSummary, whenSummary, whoSummary,
  type BookingPage, type BookingsState, type HostMode, type PlaceKind,
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
export function PageEditor({ page, draft, state, section, onDraft, onBack, onSave, onToggle, onShare, onMore, onGuest, onMeetings, onManageGroups }: PageEditorProps) {
  const [save, setSave] = useState<SaveState>('idle');
  const now = new Date();
  const dirty = JSON.stringify({ ...draft, isOn: page.isOn }) !== JSON.stringify(page);
  const set = (patch: Partial<BookingPage>) => { onDraft({ ...draft, ...patch }); if (save === 'saved') setSave('idle'); };
  const sectionRef = useRef<HTMLDivElement>(null);
  const taken = state.pages.some((p) => p.id !== draft.id && p.slug === draft.slug);
  useEffect(() => {
    if (!section) return undefined;
    const t = window.setTimeout(() => {
      const el = sectionRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
      el?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el?.querySelector<HTMLElement>('input:not([disabled])')?.focus();
    }, 300);
    return () => window.clearTimeout(t);
  }, [section]);
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
        title={<Breadcrumbs size="title" items={[{ id: 'bookings', label: 'Bookings', icon: <CalendarDays {...i16} /> }, { id: 'pages', label: 'Pages' }, { id: 'page', label: page.name }]} onAction={(id) => { if (id !== 'page') onBack(); }} />}
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
              <Section title="Basics" description="What guests see first: the name, the link, how long and where.">
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
                  <TextArea label="Description" aside="Optional" rows={2} value={draft.description} onChange={(description) => set({ description })} placeholder="What the meeting is for, in a line or two" />
                </div>
              </Section>
              <DisclosureGroup variant="plain" allowsMultipleExpanded defaultExpandedKeys={section ? [section] : []}>
                <DisclosureItem id="when" title="When" description={whenSummary(draft, state)} icon={<CalendarDays {...i16} />}>
                  <div className="tf-bkf__stack" data-section="when">
                    <RadioGroup label="Hours" value={draft.hoursFrom} onChange={(v) => set({ hoursFrom: v, customHours: v === 'custom' ? draft.customHours ?? hoursFor(draft, state) : draft.customHours })}>
                      {state.savedHours.map((h) => <Radio key={h.id} value={h.id === state.defaultHoursId ? 'working' : h.id}>{h.id === state.defaultHoursId ? `Your ${h.name.toLowerCase()}` : h.name}</Radio>)}
                      <Radio value="custom">Hours just for this page</Radio>
                    </RadioGroup>
                    {draft.hoursFrom === 'custom' && draft.customHours && <HoursEditor value={draft.customHours} onChange={(h) => set({ customHours: h })} />}
                    <div className="tf-bkf__pair">
                      <Select label="Buffer before" items={BUFFERS} value={String(draft.bufferBefore)} onChange={(v) => set({ bufferBefore: Number(v ?? 0) })} />
                      <Select label="Buffer after" items={BUFFERS} value={String(draft.bufferAfter)} onChange={(v) => set({ bufferAfter: Number(v ?? 0) })} />
                    </div>
                    <div className="tf-bkf__pair">
                      <Select label="Minimum notice" items={NOTICE} value={String(draft.noticeHours)} onChange={(v) => set({ noticeHours: Number(v ?? 0) })} />
                      <Select label="Book up to" items={AHEAD} value={String(draft.daysAhead)} onChange={(v) => set({ daysAhead: Number(v ?? 60) })} />
                    </div>
                    <div className="tf-bkf__pair">
                      <NumberField label="Most a day" description="0 means no limit" value={draft.perDay} minValue={0} maxValue={20} onChange={(n) => set({ perDay: Number.isFinite(n) ? n : 0 })} />
                      <NumberField label="Most a week" description="0 means no limit" value={draft.perWeek} minValue={0} maxValue={60} onChange={(n) => set({ perWeek: Number.isFinite(n) ? n : 0 })} />
                    </div>
                    <div>
                      <span className="tf-bkf__label">Time off that applies</span>
                      {hostOff.length === 0 ? <p className="tf-bkf__muted">None planned. Time off is set under Availability.</p> : (
                        <ul className="tf-bkf__list-plain">{hostOff.map((t) => <li key={t.id} className="tf-bkf__off"><Avatar name={t.member} size={20} />{t.member}<span className="tf-bkf__muted tf-num">{formatDate(parseDay(t.from))}{t.to !== t.from ? ` – ${formatDate(parseDay(t.to))}` : ''} · {t.note || 'Time off'}</span></li>)}</ul>
                      )}
                    </div>
                  </div>
                </DisclosureItem>
                <DisclosureItem id="who" title="Who" description={whoSummary(draft, state, now)} icon={<Users {...i16} />}
                  end={stuck ? <Tag size="sm" hue="orange" icon={<AlertTriangle size={12} strokeWidth={2} />}>No hosts available</Tag> : undefined}>
                  <div className="tf-bkf__stack" data-section="who">
                    {stuck && <Callout tone="warning">Everyone on this page is away or paused, so guests can't book it. Add a host who's free.</Callout>}
                    <RadioGroup label="Who hosts" value={draft.hostMode} onChange={(v) => setMode(v as HostMode)}>
                      <Radio value="one">One person</Radio>
                      <Radio value="collective">Everyone must be free (they all join)</Radio>
                      <Radio value="roundrobin">Round robin (one free host takes it, in turn)</Radio>
                      <Radio value="managed">A copy for each member (each gets their own page)</Radio>
                    </RadioGroup>
                    {draft.hostMode === 'one' ? (
                      <Select label="Host" items={TEAM.map((n) => ({ id: n, label: n === HOST ? `${n} (you)` : n, icon: <Avatar name={n} size={20} /> }))} value={draft.hosts[0] ?? HOST} onChange={(v) => { if (v) set({ hosts: [v] }); }} />
                    ) : (
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
                      <div className="tf-bkf__stack tf-bkf__stack--12">
                        <span className="tf-bkf__label">How it's shared out</span>
                        <SegmentedControl aria-label="How it's shared out" size="sm" selectedKey={draft.shareOut} onSelectionChange={(k) => set({ shareOut: k === 'weighted' ? 'weighted' : k === 'priority' ? 'priority' : 'equal' })}
                          items={[{ id: 'equal', label: 'Equally' }, { id: 'weighted', label: 'Weighted' }, { id: 'priority', label: 'By priority' }]} />
                        {draft.shareOut !== 'equal' && (
                          <div className="tf-bkf__weights">
                            {draft.hosts.map((h) => (
                              <NumberField key={h} label={h} description={draft.shareOut === 'weighted' ? 'Share of meetings' : '1 goes first'} value={draft.weights[h] ?? 1} minValue={1} maxValue={draft.shareOut === 'weighted' ? 10 : draft.hosts.length}
                                onChange={(n) => set({ weights: { ...draft.weights, [h]: Number.isFinite(n) ? n : 1 } })} />
                            ))}
                          </div>
                        )}
                        <div className="tf-bkf__spread">
                          <span className="tf-bkf__label">This month so far</span>
                          {draft.hosts.map((h) => <Meter key={h} label={h} value={spread[h] ?? 0} maxValue={maxSpread} valueLabel={plural(spread[h] ?? 0, 'meeting')} warnAt={2} dangerAt={2} />)}
                        </div>
                        <Button size="sm" variant="secondary" icon={<Settings2 {...i14} />} onPress={onManageGroups}>Manage groups</Button>
                      </div>
                    )}
                    <RadioGroup label="Who can book" value={draft.whoCanBook} onChange={(v) => set({ whoCanBook: v === 'form' ? 'form' : 'anyone', formName: v === 'form' ? draft.formName || 'Support request' : draft.formName })}>
                      <Radio value="anyone">Anyone with the link</Radio>
                      <Radio value="form">Only through a form</Radio>
                    </RadioGroup>
                    {draft.whoCanBook === 'form' && <Select label="Form" items={FORMS} value={draft.formName} onChange={(v) => { if (v) set({ formName: v }); }} description="Guests see times after they send the form." />}
                  </div>
                </DisclosureItem>
                <DisclosureItem id="questions" title="Questions" description={questionsSummary(draft)} icon={<MessageSquareText {...i16} />}>
                  <div className="tf-bkf__stack" data-section="questions">
                    <p className="tf-bkf__muted">Name and email are always asked. Add anything else here.</p>
                    <QuestionBuilder questions={draft.questions} onChange={(questions) => set({ questions })} />
                  </div>
                </DisclosureItem>
                <DisclosureItem id="after" title="After booking" description={afterSummary(draft)} icon={<Check {...i16} />}>
                  <div className="tf-bkf__stack" data-section="after">
                    <RadioGroup label="Confirm" value={draft.confirmFirst ? 'me' : 'auto'} onChange={(v) => set({ confirmFirst: v === 'me' })}>
                      <Radio value="auto">Confirm at once</Radio>
                      <Radio value="me">I confirm each one first (bookings arrive as requests)</Radio>
                    </RadioGroup>
                    <Select label="Add bookings to" items={CALENDARS} value={draft.calendarId} onChange={(v) => { if (v) set({ calendarId: v }); }} />
                    <Switch isSelected={draft.addToPeople} onChange={(addToPeople) => set({ addToPeople })}>Add guests to People, and link the meeting to their company</Switch>
                    <div>
                      <span className="tf-bkf__label">Reminders to the guest</span>
                      <div className="tf-bkf__checks">
                        {[['day', 'A day before'], ['hour', 'An hour before']].map(([id, label]) => (
                          <Checkbox key={id} isSelected={draft.reminders.includes(id ?? '')} onChange={(v) => set({ reminders: v ? [...draft.reminders, id ?? ''] : draft.reminders.filter((r) => r !== id) })}>{label}</Checkbox>
                        ))}
                      </div>
                    </div>
                    <ShowMore showLabel="More options" hideLabel="Fewer options">
                      <div className="tf-bkf__stack">
                        <RadioGroup label="Then show" value={draft.after} onChange={(v) => set({ after: v === 'redirect' ? 'redirect' : 'message' })}>
                          <Radio value="message">A thank-you with the details</Radio>
                          <Radio value="redirect">Another web page</Radio>
                        </RadioGroup>
                        {draft.after === 'redirect' && <TextField label="Web address" value={draft.redirectUrl} onChange={(redirectUrl) => set({ redirectUrl })} placeholder="https://northwind.com/thanks" type="url" />}
                      </div>
                    </ShowMore>
                  </div>
                </DisclosureItem>
                <DisclosureItem id="look" title="Look" description={lookSummary(draft)} icon={<Palette {...i16} />}>
                  <div className="tf-bkf__stack" data-section="look">
                    <GuestLook value={draft.look} onChange={(look) => set({ look })} host={draft.owner} title={draft.name} />
                    <Switch isSelected={draft.showPhoto} onChange={(showPhoto) => set({ showPhoto })}>Show your photo on the page</Switch>
                    <div>
                      <span className="tf-bkf__label">Social links</span>
                      <SocialLinksEditor links={draft.socials} onChange={(socials) => set({ socials })} />
                    </div>
                  </div>
                </DisclosureItem>
              </DisclosureGroup>
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
