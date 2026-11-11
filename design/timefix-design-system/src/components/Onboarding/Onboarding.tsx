import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarCheck, CalendarDays, Check, Copy, Scissors, Users, UtensilsCrossed, Video, X } from 'lucide-react';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Spinner, TextSwap } from '../Motion/Motion.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { HOURS_DAYS, type HoursDay } from '../HoursEditor/HoursEditor.tsx';
import { formatClock, formatClockRange } from '../WeekCalendar/WeekCalendar.tsx';
import { AuthLayout, AuthFooterLink, AuthHeading, AuthPages } from '../AuthLayout/AuthLayout.tsx';
import { InviteRows, type Invite } from '../InviteRows/InviteRows.tsx';
import './Onboarding.css';

/** First run's hours, kept simple: the same range on the chosen days. Breaks and per-day hours live in Settings. */
export interface SimpleHours {
  readonly days: ReadonlyArray<HoursDay>;
  /** Minutes from midnight. */
  readonly start: number;
  readonly end: number;
}

/** What a workspace books: meetings with people, appointments with staff, or tables. */
export type BusinessKind = 'team' | 'salon' | 'restaurant';

/** What first run collects. */
export interface OnboardingValues {
  readonly kind: BusinessKind;
  readonly workspace: string;
  readonly slug: string;
  readonly hours: SimpleHours;
  readonly invites: ReadonlyArray<Invite>;
  /** The first booking page: its name and length (a service for a salon; a sitting for a restaurant). */
  readonly meeting: { readonly name: string; readonly length: number };
  /** A restaurant's biggest party booked online. */
  readonly party?: number;
  /** The calendar connected on the way, if any. */
  readonly calendar?: 'google' | 'outlook';
}

/** Which part of the preview the current step is changing. */
export type PreviewFocus = 'kind' | 'workspace' | 'link' | 'meeting' | 'hours' | 'calendar' | 'team';

const DAY_SHORT: Readonly<Record<HoursDay, string>> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DAY_CHIPS = HOURS_DAYS.map((d) => ({ id: d, label: DAY_SHORT[d] }));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** What a typed link keeps: lower case letters, numbers and dashes, a space becoming a dash. */
function cleanSlug(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-/, '').slice(0, 40);
}

/** A booking link's last part from any text: lower case, words joined by dashes, nothing else. */
export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** A name to show for an address until the person types theirs: maya.rao@x.com reads "Maya Rao". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ') || email;
}

/** "Mon – Fri, 9:00 AM – 5:00 PM", or the chosen days listed when they are not a run. */
export function summarizeSimpleHours(h: SimpleHours): string {
  if (h.days.length === 0) return 'No days chosen';
  const idx = HOURS_DAYS.map((d, i) => (h.days.includes(d) ? i : -1)).filter((i) => i >= 0);
  const run = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? 0) + 1);
  const first = HOURS_DAYS[idx[0] ?? 0] ?? 'mon';
  const last = HOURS_DAYS[idx[idx.length - 1] ?? 0] ?? 'mon';
  const days = idx.length === 1 ? DAY_SHORT[first] : run && idx.length > 2 ? `${DAY_SHORT[first]} – ${DAY_SHORT[last]}` : idx.map((i) => DAY_SHORT[HOURS_DAYS[i] ?? 'mon']).join(', ');
  return `${days}, ${formatClockRange(h.start, h.end)}`;
}

/** Props for WorkspacePreview. */
export interface WorkspacePreviewProps {
  readonly workspace: string;
  readonly slug: string;
  /** The person setting up: the host on the booking page. */
  readonly owner: string;
  readonly hours: SimpleHours;
  readonly invites?: ReadonlyArray<Invite>;
  /** The first booking page's name and length (default "Intro call", 30 min). */
  readonly meeting?: { readonly name: string; readonly length: number };
  /** Rings the part the current step changes. */
  readonly focus?: PreviewFocus;
  /** What the page books: a meeting with the owner, a service, or a table. */
  readonly kind?: BusinessKind;
  /** A restaurant's biggest party online. */
  readonly party?: number;
}

/** A live sketch of the workspace being set up: its booking page at its link, the open days and first times, and the team. Updates as the person types. Decorative. */
export function WorkspacePreview({ workspace, slug, owner, hours, invites = [], meeting = { name: 'Intro call', length: 30 }, focus, kind = 'team', party = 6 }: WorkspacePreviewProps) {
  const name = workspace.trim() || 'Your workspace';
  const slots: number[] = [];
  for (let t = hours.start; t + meeting.length <= hours.end && slots.length < 4; t += 30) slots.push(t);
  const summary = summarizeSimpleHours(hours);
  return (
    <div className="tf-wsprev" data-focus={focus} data-kind={kind}>
      <div className="tf-wsprev__window">
        <div className="tf-wsprev__bar">
          <span className="tf-wsprev__url" data-part="link">timefix.com/<span className="tf-wsprev__slug">{slug || 'your-link'}</span></span>
        </div>
        <div className="tf-wsprev__page">
          <div className="tf-wsprev__host">
            <span className="tf-wsprev__brand" data-part="workspace"><Avatar name={name} shape="square" size={28} /><span className="tf-wsprev__name">{name}</span></span>
            {kind !== 'restaurant' && <span className="tf-wsprev__who"><Avatar name={owner} size={36} /><span className="tf-wsprev__owner">{kind === 'salon' ? `With ${owner.split(' ')[0] ?? owner}` : owner}</span></span>}
            <span className="tf-wsprev__event" data-part="meeting">{kind === 'restaurant' ? 'Book a table' : meeting.name.trim() || (kind === 'salon' ? 'Haircut' : 'Intro call')}</span>
            <span className="tf-wsprev__meta">{kind === 'team' ? <><Video size={14} strokeWidth={1.75} aria-hidden="true" />{meeting.length} min · Google Meet</> : kind === 'salon' ? <><Scissors size={14} strokeWidth={1.75} aria-hidden="true" />{meeting.length} min · At the studio</> : <><Users size={14} strokeWidth={1.75} aria-hidden="true" />Up to {party} people · {meeting.length} min</>}</span>
          </div>
          <div className="tf-wsprev__times" data-part="hours">
            <div className="tf-wsprev__days">
              {HOURS_DAYS.map((d) => <span key={d} className={cx('tf-wsprev__day', hours.days.includes(d) && 'tf-wsprev__day--on')}>{DAY_SHORT[d].slice(0, 2)}</span>)}
            </div>
            <span className="tf-wsprev__summary tf-num"><TextSwap swapKey={summary}>{summary}</TextSwap></span>
            <div className="tf-wsprev__slots">
              {hours.days.length > 0 && slots.map((t, i) => <span key={`${t}`} className={cx('tf-wsprev__slot tf-num', i === 1 && 'tf-wsprev__slot--picked')}>{formatClock(t)}</span>)}
            </div>
          </div>
        </div>
      </div>
      <div className="tf-wsprev__team" data-part="team">
        <span className="tf-wsprev__team-title">{kind === 'salon' ? 'Staff' : 'Team'}</span>
        <span className="tf-wsprev__avatars">
          <Avatar name={owner} size={28} />
          {invites.slice(0, 6).map((v) => <span key={v.email} className="tf-wsprev__pop"><Avatar name={nameFromEmail(v.email)} size={28} /></span>)}
        </span>
        <span className="tf-wsprev__team-note tf-num">{invites.length === 0 ? 'Just you for now' : `${invites.length} invited`}</span>
      </div>
    </div>
  );
}

/** Props for Onboarding. */
export interface OnboardingProps {
  /** The signed in address, said at the foot beside Sign out. */
  readonly account: string;
  /** The person's name: the host on the preview. */
  readonly owner: string;
  /** Whether a link is free. Resolve `true` for free. */
  readonly checkSlug: (slug: string) => Promise<boolean>;
  /** Called on the last step. Return a promise to spin Finish. */
  readonly onFinish: (values: OnboardingValues) => void | Promise<void>;
  /** Runs after the person confirms Sign out in a dialog. */
  readonly onSignOut: () => void;
  readonly defaultValues?: Partial<OnboardingValues>;
}

type StepId = 'kind' | 'workspace' | 'link' | 'meeting' | 'hours' | 'calendar' | 'team';
const KINDS: ReadonlyArray<{ readonly id: BusinessKind; readonly title: string; readonly line: string; readonly icon: ReactNode }> = [
  { id: 'team', title: 'Meetings', line: 'Calls and demos with you or your team', icon: <CalendarDays size={20} strokeWidth={1.75} /> },
  { id: 'salon', title: 'Appointments', line: 'Services with staff: a salon, clinic or studio', icon: <Scissors size={20} strokeWidth={1.75} /> },
  { id: 'restaurant', title: 'Tables', line: 'Reservations for a restaurant or café', icon: <UtensilsCrossed size={20} strokeWidth={1.75} /> },
];
/** The steps for each kind: a restaurant has no calendar to connect. */
function stepsFor(kind: BusinessKind): ReadonlyArray<{ readonly id: StepId; readonly label: string }> {
  return [
    { id: 'kind', label: 'What you book' }, { id: 'workspace', label: 'Name' }, { id: 'link', label: 'Link' },
    { id: 'meeting', label: kind === 'team' ? 'First meeting' : kind === 'salon' ? 'First service' : 'Tables' },
    { id: 'hours', label: 'Hours' }, ...(kind === 'restaurant' ? [] : [{ id: 'calendar' as const, label: 'Calendar' }]),
    { id: 'team', label: kind === 'salon' ? 'Staff' : 'Team' },
  ];
}

type SlugState = 'idle' | 'checking' | 'free' | 'taken';

/** First run, full screen: what you book, then a few short steps on the left and a live preview on the right that changes as you type. One question, no questionnaire. */
export function Onboarding({ account, owner, checkSlug, onFinish, onSignOut, defaultValues }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<BusinessKind>(defaultValues?.kind ?? 'team');
  const [party, setParty] = useState(defaultValues?.party ?? 6);
  const STEPS = stepsFor(kind);
  const chooseKind = (k: BusinessKind) => {
    setKind(k);
    // Each kind starts from its own first page; anything typed for the old kind's page is replaced only if it was still the starter.
    const starter = ['Intro call', 'Haircut', 'Table'];
    setMeeting((m) => (starter.includes(m.name) ? { name: k === 'team' ? 'Intro call' : k === 'salon' ? 'Haircut' : 'Table', length: k === 'restaurant' ? 90 : k === 'salon' ? 45 : 30 } : m));
  };
  const [workspace, setWorkspace] = useState(defaultValues?.workspace ?? '');
  const [slug, setSlug] = useState(defaultValues?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(defaultValues?.slug !== undefined);
  const [slugState, setSlugState] = useState<SlugState>('idle');
  const [hours, setHours] = useState<SimpleHours>(defaultValues?.hours ?? { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: 9 * 60, end: 17 * 60 });
  const [invites, setInvites] = useState<ReadonlyArray<Invite>>([]);
  const [meeting, setMeeting] = useState(defaultValues?.meeting ?? { name: 'Intro call', length: 30 });
  const [calendar, setCalendar] = useState<'google' | 'outlook' | undefined>(defaultValues?.calendar);
  const [connecting, setConnecting] = useState<'google' | 'outlook'>();
  const [live, setLive] = useState(false);
  const connect = (c: 'google' | 'outlook') => { setConnecting(c); window.setTimeout(() => { setConnecting(undefined); setCalendar(c); }, 900); };
  const [finishing, setFinishing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const check = useRef(checkSlug);
  check.current = checkSlug;

  const link = slugEdited ? slug : slugify(workspace);

  // The link is checked 350ms after typing stops; an older answer never overwrites a newer one.
  useEffect(() => {
    if (link === '') { setSlugState('idle'); return; }
    setSlugState('checking');
    let live = true;
    const t = window.setTimeout(() => { void check.current(link).then((free) => { if (live) setSlugState(free ? 'free' : 'taken'); }); }, 350);
    return () => { live = false; window.clearTimeout(t); };
  }, [link]);

  const hoursBad = hours.end <= hours.start;
    const okFor: Readonly<Record<StepId, boolean>> = { kind: true, workspace: workspace.trim() !== '', link: slugState === 'free', meeting: kind === 'restaurant' || meeting.name.trim() !== '', hours: hours.days.length > 0 && !hoursBad, calendar: connecting === undefined, team: true };
  const can = okFor[STEPS[step]?.id ?? 'kind'];
  const last = step === STEPS.length - 1;
  const finish = async () => {
    setFinishing(true);
    // The end shows "You're live" with the link; Go to dashboard then hands everything over.
    await new Promise<void>((r) => { window.setTimeout(r, 700); });
    setFinishing(false); setLive(true);
  };
  const values = (): OnboardingValues => ({ kind, workspace: workspace.trim(), slug: link, hours, invites, meeting: { name: kind === 'restaurant' ? 'Table' : meeting.name.trim(), length: meeting.length }, calendar, ...(kind === 'restaurant' ? { party } : {}) });
  const next = () => { if (!can) return; if (last) void finish(); else setStep(step + 1); };
  const nextLabel = !last ? 'Continue' : invites.length > 0 ? `Send ${invites.length} invite${invites.length === 1 ? '' : 's'} and finish` : 'Finish setup';
  const focus = STEPS[step]?.id;

  const liveLink = `timefix.com/${link}/${kind === 'restaurant' ? 'table' : slugify(meeting.name) || 'intro-call'}`;
  const pageName = kind === 'restaurant' ? 'Book a table' : meeting.name.trim() || 'Intro call';
  return (
    <>
      <AuthLayout account={account} footer={<AuthFooterLink onPress={() => setSigningOut(true)}>Sign out</AuthFooterLink>}
        preview={<WorkspacePreview workspace={workspace} slug={link} owner={owner} hours={hours} invites={invites} meeting={meeting} kind={kind} party={party} focus={live ? undefined : focus} />}>
        {live ? (
          <div className="tf-onb tf-onb--live">
            <AuthHeading title="You’re live" description={kind === 'restaurant' ? 'Guests can book a table now. Share the link anywhere.' : 'People can book you now. Share the link anywhere.'} />
            <div className="tf-onb__live">
              <span className="tf-onb__live-icon" aria-hidden="true"><CalendarCheck size={18} strokeWidth={1.75} /></span>
              <span className="tf-onb__live-text"><strong>{pageName}</strong><span className="tf-num">{liveLink}</span></span>
              <Button size="sm" variant="secondary" icon={<Copy size={14} strokeWidth={1.75} />} onPress={() => { void navigator.clipboard?.writeText(`https://${liveLink}`).catch(() => undefined); }}>Copy link</Button>
              <Button size="sm" variant="ghost" icon={<ArrowUpRight size={14} strokeWidth={1.75} />} onPress={() => window.open(`https://${liveLink}`, '_blank', 'noopener')}>Open</Button>
            </div>
            <Button variant="primary" className="tf-onb__next" isPending={finishing} onPress={() => { setFinishing(true); void Promise.resolve(onFinish(values())).finally(() => setFinishing(false)); }}>Go to dashboard</Button>
          </div>
        ) : (
        <div className="tf-onb">
          {/* Where you are: one segment per step, filled up to here; a done step is a way back. */}
          <div className="tf-onb__progress">
            <span className="tf-onb__count tf-num" aria-hidden="true">Step {step + 1} of {STEPS.length}</span>
            <ol className="tf-onb__bar" aria-label="Setup steps">
              {STEPS.map((x, i) => (
                <li key={x.id} className="tf-onb__seg-item">
                  <button type="button" className="tf-onb__seg" data-state={i < step ? 'done' : i === step ? 'current' : 'todo'} disabled={i > step} onClick={() => setStep(i)}
                    aria-current={i === step ? 'step' : undefined} aria-label={`${x.label}${i < step ? ', done' : i === step ? ', current step' : ''}`} />
                </li>
              ))}
            </ol>
          </div>
          <form className="tf-onb__form" noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
            <AuthPages index={step} aria-label={STEPS[step]?.label}>
              {STEPS.map((x) => {
                switch (x.id) {
                  case 'kind': return (
                    <div key="kind" className="tf-onb__page">
                      <AuthHeading title="What do people book with you?" description="It sets up the right pages. You can add the others later." />
                      <div className="tf-onb__kinds" role="radiogroup" aria-label="What people book">
                        {KINDS.map((k) => (
                          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className="tf-onb__kind" onClick={() => chooseKind(k.id)}
                            onKeyDown={(e) => { const at = KINDS.findIndex((y) => y.id === kind); const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); const to = KINDS[(at + d + KINDS.length) % KINDS.length]; if (to) { chooseKind(to.id); (e.currentTarget.parentElement?.children[KINDS.indexOf(to)] as HTMLElement | undefined)?.focus(); } }}
                            tabIndex={kind === k.id ? 0 : -1}>
                            <span className="tf-onb__kind-icon" aria-hidden="true">{k.icon}</span>
                            <span className="tf-onb__kind-text"><strong>{k.title}</strong><span>{k.line}</span></span>
                            <span className="tf-onb__kind-tick" aria-hidden="true"><Check size={14} strokeWidth={2} /></span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                  case 'workspace': return (
                    <div key="workspace" className="tf-onb__page">
                      <AuthHeading title={kind === 'team' ? 'Name your workspace' : 'Name your business'} description={kind === 'team' ? 'Usually your company or team. Guests see it when they book.' : 'Guests see it when they book.'} />
                      <TextField label={kind === 'team' ? 'Workspace name' : 'Business name'} size="lg" placeholder={kind === 'team' ? 'Northwind' : kind === 'salon' ? 'Lumen Studio' : 'Café Verde'} value={workspace} onChange={setWorkspace} />
                    </div>
                  );
                  case 'link': return (
                    <div key="link" className="tf-onb__page">
                      <AuthHeading title="Pick your booking link" description="Share it anywhere; people book from it." />
                      <TextField label="Booking link" size="lg" value={link} onChange={(v) => { setSlugEdited(true); setSlug(cleanSlug(v)); }}
                        icon={<span className="tf-onb__prefix">timefix.com/</span>}
                        suffix={<SlugStatus state={slugState} />}
                        isInvalid={slugState === 'taken'} errorMessage={`timefix.com/${link} is taken. Try ${link}-team.`}
                        description={slugState === 'free' ? `People book you at timefix.com/${link}` : 'Letters, numbers and dashes.'} />
                    </div>
                  );
                  case 'meeting': return kind === 'restaurant' ? (
                    <div key="meeting" className="tf-onb__page">
                      <AuthHeading title="Table bookings" description="Add areas and tables afterwards in Settings." />
                      <div className="tf-onb__group">
                        <span className="tf-onb__label">Biggest party online</span>
                        <SegmentedControl aria-label="Biggest party online" isFullWidth selectedKey={String(party)} onSelectionChange={(k) => setParty(Number(k))}
                          items={[4, 6, 8, 12].map((n) => ({ id: String(n), label: `${n} people` }))} />
                      </div>
                      <div className="tf-onb__group">
                        <span className="tf-onb__label">A sitting lasts</span>
                        <SegmentedControl aria-label="A sitting lasts" isFullWidth selectedKey={String(meeting.length)} onSelectionChange={(k) => setMeeting({ ...meeting, length: Number(k) })}
                          items={[60, 90, 120].map((n) => ({ id: String(n), label: n === 60 ? '1 hr' : n === 90 ? '1 hr 30' : '2 hr' }))} />
                      </div>
                    </div>
                  ) : (
                    <div key="meeting" className="tf-onb__page">
                      <AuthHeading title={kind === 'salon' ? 'Your first service' : 'Your first booking page'} description="It opens straight away; change it afterwards." />
                      <TextField label={kind === 'salon' ? 'Service' : 'Meeting name'} size="lg" placeholder={kind === 'salon' ? 'Haircut' : 'Intro call'} value={meeting.name} onChange={(name) => setMeeting({ ...meeting, name })} />
                      <div className="tf-onb__group">
                        <span className="tf-onb__label">Length</span>
                        <SegmentedControl aria-label="Length" isFullWidth selectedKey={String(meeting.length)} onSelectionChange={(k) => setMeeting({ ...meeting, length: Number(k) })}
                          items={(kind === 'salon' ? [30, 45, 60, 90] : [15, 30, 45, 60]).map((n) => ({ id: String(n), label: `${n} min` }))} />
                      </div>
                    </div>
                  );
                  case 'hours': return (
                    <div key="hours" className="tf-onb__page">
                      <AuthHeading title={kind === 'team' ? 'When can people book you?' : 'When are you open?'} description="Breaks and different hours per day come later, in Settings." />
                      <ChoiceChips label="Days" selectionMode="multiple" items={DAY_CHIPS} selectedKeys={hours.days}
                        onSelectionChange={(k) => setHours({ ...hours, days: HOURS_DAYS.filter((d) => k.has(d)) })} />
                      <div className="tf-onb__group" role="group" aria-labelledby="tf-onb-hours">
                        <span className="tf-onb__label" id="tf-onb-hours">Hours</span>
                        <div className="tf-onb__range">
                          <TimeSelect label="From" isLabelHidden hourCycle={12} value={toHHMM(hours.start)} onChange={(v) => { if (v) setHours({ ...hours, start: fromHHMM(v) }); }} />
                          <span className="tf-onb__to" aria-hidden="true">to</span>
                          <TimeSelect label="To" isLabelHidden hourCycle={12} value={toHHMM(hours.end)} isInvalid={hoursBad} onChange={(v) => { if (v) setHours({ ...hours, end: fromHHMM(v) }); }} />
                        </div>
                        {hoursBad && <span className="tf-onb__error" role="alert">Pick an end after the start.</span>}
                      </div>
                    </div>
                  );
                  case 'calendar': return (
                    <div key="calendar" className="tf-onb__page">
                      <AuthHeading title="Connect your calendar" description="So people only book when you’re free." />
                      {calendar ? (
                        <Callout tone="success">Your {calendar === 'google' ? 'Google' : 'Outlook'} calendar is connected. Busy times there are kept free.</Callout>
                      ) : (
                        <div className="tf-onb__connect">
                          <Button size="lg" variant="secondary" isPending={connecting === 'google'} isDisabled={connecting !== undefined} onPress={() => connect('google')}>Connect Google Calendar</Button>
                          <Button size="lg" variant="secondary" isPending={connecting === 'outlook'} isDisabled={connecting !== undefined} onPress={() => connect('outlook')}>Connect Outlook</Button>
                        </div>
                      )}
                    </div>
                  );
                  case 'team': return (
                    <div key="team" className="tf-onb__page">
                      <AuthHeading title={kind === 'salon' ? 'Add your staff' : 'Invite your team'} description="They get an email to join. You can skip this and add people any time." />
                      <InviteRows showSend={false} onChange={setInvites} />
                    </div>
                  );
                  default: return null;
                }
              })}
            </AuthPages>
            <div className="tf-onb__actions">
              {step > 0 && <Button variant="ghost" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onPress={() => setStep(step - 1)} isDisabled={finishing}>Back</Button>}
              {last && invites.length === 0 && <Button variant="ghost" className="tf-onb__skip" onPress={() => { void finish(); }} isDisabled={finishing}>Skip for now</Button>}
              {focus === 'calendar' && !calendar && <Button variant="ghost" className="tf-onb__skip" onPress={() => setStep(step + 1)} isDisabled={connecting !== undefined}>Skip for now</Button>}
              <Button type="submit" variant="primary" className="tf-onb__next" isDisabled={!can} isPending={finishing}>{nextLabel}</Button>
            </div>
          </form>
        </div>
        )}
      </AuthLayout>
      <ConfirmDialog isOpen={signingOut} onOpenChange={setSigningOut} tone="primary" title="Sign out of Timefix?"
        consequence="What you've set up so far is saved. Sign in again to finish." confirmLabel="Sign out" onConfirm={onSignOut} />
    </>
  );
}

function SlugStatus({ state }: { readonly state: SlugState }) {
  if (state === 'checking') return <Spinner size={16} label="Checking the link" />;
  if (state === 'free') return <span className="tf-onb__free"><Check size={14} strokeWidth={2} aria-hidden="true" />Free</span>;
  if (state === 'taken') return <span className="tf-onb__taken"><X size={14} strokeWidth={2} aria-hidden="true" />Taken</span>;
  return null;
}

