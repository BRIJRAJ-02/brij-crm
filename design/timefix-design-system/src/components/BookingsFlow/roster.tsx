// Roster: the team's week as a grid of shifts. A shift can change for one date or every week; weeks copy forward;
// several people's usual hours set at once; each day's totals at the foot; search and a team filter.
import { useState } from 'react';
import { Button as AriaButton, DialogTrigger, type Key } from 'react-aria-components';
import { ChevronLeft, ChevronRight, Copy, MoreHorizontal, RotateCcw, Settings2, Users } from 'lucide-react';
import { HoursEditor, summarizeHours, HOURS_DAYS, type DayHours, type WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { Select } from '../Select/Select.tsx';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import { LimitsSection, TimeOffSection } from './availability.tsx';
import { weekdays } from './seed.ts';
import {
  HOST, TEAM, dayFrom, first, hoursOn, isOff, isoDay, memberHours, mondayOf, nextId, overrideKey, plural,
  type BookedMeeting, type BookingsAction, type BookingsState,
} from './state.ts';

/** Props for RosterTab. */
export interface RosterTabProps {
  readonly state: BookingsState;
  readonly dispatch: (a: BookingsAction) => void;
  readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number;
  /** Opens the round robin groups dialog. */
  readonly onManageGroups: () => void;
}

/** "9 AM", "9:30 AM": the short clock a shift chip uses. */
const short = (m: number) => formatClock(m).replace(':00', '');
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const dayMinutes = (d: DayHours) => (d.on ? d.ranges.reduce((t, r) => t + r.end - r.start, 0) : 0);
const weekMinutes = (w: WeekHours) => HOURS_DAYS.reduce((s, d) => s + dayMinutes(w[d]), 0);
const shiftText = (d: DayHours) => (d.on && d.ranges.length ? d.ranges.map((r) => `${short(r.start)}–${short(r.end)}`).join(', ') : 'Off');
const keyOf = (d: Date) => HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon';
const SKILL_TEAMS = ['Sales', 'Support', 'Onboarding', 'Partnerships'];

/** Writes one person's usual week: your own hours are your default saved hours, so Availability and Roster edit the same thing. */
function useSetHours(state: BookingsState, dispatch: (a: BookingsAction) => void) {
  return (name: string, hours: WeekHours) => (name === HOST ? dispatch({ type: 'hours/set', id: state.defaultHoursId, hours }) : dispatch({ type: 'member/hours', name, hours }));
}

/** The Roster page (team workspaces only). */
export function RosterTab({ state, dispatch, onReassignMany, onManageGroups }: RosterTabProps) {
  const { toast } = useToast();
  const [week, setWeek] = useState(0);
  const [person, setPerson] = useState<string>();
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [usualOpen, setUsualOpen] = useState(false);
  const setHours = useSetHours(state, dispatch);
  const now = new Date();
  const monday = dayFrom(mondayOf(now), week * 7);
  const days = Array.from({ length: 7 }, (_, n) => dayFrom(monday, n));
  const last = days[days.length - 1] ?? monday;
  const people = TEAM.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()) && (team === 'all' || (state.routing.skills[n] ?? []).includes(team)));

  /** Copies this week's shifts, as worked, onto next week as date-only changes; Undo puts next week back. */
  const copyWeek = (names: ReadonlyArray<string>) => {
    const before = state.overrides ?? {};
    const patch: Record<string, DayHours | null> = {};
    // Only real differences become date-only changes: a day that matches the usual week next week needs nothing.
    const same = (a: DayHours, b: DayHours) => a.on === b.on && (!a.on || JSON.stringify(a.ranges.map((r) => [r.start, r.end])) === JSON.stringify(b.ranges.map((r) => [r.start, r.end])));
    names.forEach((n) => days.forEach((d) => {
      const target = dayFrom(d, 7);
      const now0 = hoursOn(state, n, d).hours;
      patch[overrideKey(n, target)] = same(now0, memberHours(state, n)[keyOf(target)]) ? null : now0;
    }));
    dispatch({ type: 'overrides/merge', patch });
    const undo: Record<string, DayHours | null> = {};
    Object.keys(patch).forEach((k) => { undo[k] = before[k] ?? null; });
    toast({ message: `${names.length === 1 ? `${first(names[0] ?? '')}’s week` : 'This week'} copied to ${formatDay(dayFrom(monday, 7))} – ${formatDay(dayFrom(last, 7))}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'overrides/merge', patch: undo }) } });
  };

  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<>
          <span className="tf-bkf__weeknav">
            <IconButton size="sm" label="Previous week" onPress={() => setWeek((w) => w - 1)}><ChevronLeft {...i16} /></IconButton>
            <span className="tf-num" aria-live="polite">{formatDay(monday)} – {formatDay(last)}</span>
            <IconButton size="sm" label="Next week" onPress={() => setWeek((w) => w + 1)}><ChevronRight {...i16} /></IconButton>
            {week !== 0 && <Button size="sm" variant="ghost" onPress={() => setWeek(0)}>This week</Button>}
          </span>
          <SearchField label="Find a person" placeholder="Find a person" size="sm" value={query} onChange={setQuery} className="tf-bkf-roster__search" />
          <Select label="Team" isLabelHidden className="tf-bkf__inline-select" value={team} onChange={(v) => setTeam(v ?? 'all')}
            items={[{ id: 'all', label: 'All teams' }, ...SKILL_TEAMS.map((t) => ({ id: t, label: t }))]} />
        </>}
        action={<>
          <MenuTrigger>
            <IconButton label="More roster actions"><MoreHorizontal {...i16} /></IconButton>
            <Menu aria-label="Roster actions" placement="bottom end" onAction={(k: Key) => { if (k === 'groups') onManageGroups(); }}>
              <MenuItem id="groups" icon={<Users {...i16} />}>Round robin groups</MenuItem>
            </Menu>
          </MenuTrigger>
          <Button variant="secondary" icon={<Copy {...i14} />} onPress={() => copyWeek(people)} isDisabled={people.length === 0}>Copy week</Button>
          <Button variant="primary" onPress={() => setUsualOpen(true)}>Set usual hours</Button>
        </>} />
      <div className="tf-bkf-roster" role="table" aria-label="Roster">
        <div className="tf-bkf-roster__row tf-bkf-roster__row--head" role="row">
          <span role="columnheader" className="tf-bkf-roster__corner">{plural(people.length, 'person', 'people')}</span>
          {days.map((d) => (
            <span key={isoDay(d)} role="columnheader" className={cx('tf-bkf-roster__day', d.toDateString() === now.toDateString() && 'is-today')}>
              <span>{formatDay(d).split(' ')[0]}</span><span className="tf-num">{d.getDate()}</span>
            </span>
          ))}
        </div>
        {people.length === 0 && <p className="tf-bkf__muted tf-bkf-roster__empty">No one matches. Clear the search or pick All teams.</p>}
        {people.map((name) => {
          const hours = memberHours(state, name);
          return (
            <div key={name} className="tf-bkf-roster__row" role="row">
              <span role="rowheader" className="tf-bkf-roster__whocell">
                <AriaButton className="tf-bkf-roster__who" onPress={() => setPerson(name)} aria-label={`Set up ${name}`}>
                  <Avatar name={name} size={28} />
                  <span className="tf-bkf-roster__whotext">
                    <span className="tf-bkf-roster__name">{name === HOST ? `${first(name)} (you)` : first(name)}</span>
                    <span className="tf-bkf-roster__total tf-num">{Math.round(days.reduce((s, d) => s + (isOff(state, name, d) ? 0 : dayMinutes(hoursOn(state, name, d).hours)), 0) / 60)} h this week</span>
                  </span>
                </AriaButton>
                <MenuTrigger>
                  <IconButton size="sm" label={`More for ${name}`}><MoreHorizontal {...i16} /></IconButton>
                  <Menu aria-label={`${name} actions`} placement="bottom start" onAction={(k: Key) => { if (k === 'copy') copyWeek([name]); else if (k === 'setup') setPerson(name); }}>
                    <MenuItem id="copy" icon={<Copy {...i16} />}>Copy this week to next</MenuItem>
                    <MenuItem id="setup" icon={<Settings2 {...i16} />}>Usual hours and time off</MenuItem>
                  </Menu>
                </MenuTrigger>
              </span>
              {days.map((d) => {
                const on = hoursOn(state, name, d);
                return <ShiftCell key={isoDay(d)} name={name} day={d} hours={on.hours} usual={hours[keyOf(d)]} isOverride={on.isOverride} off={isOff(state, name, d)?.note}
                  count={state.meetings.filter((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === d.toDateString()).length}
                  onDate={(next) => dispatch({ type: 'overrides/merge', patch: { [overrideKey(name, d)]: next } })}
                  onEvery={(next) => { setHours(name, { ...hours, [keyOf(d)]: next }); dispatch({ type: 'overrides/merge', patch: { [overrideKey(name, d)]: null } }); }} />;
              })}
            </div>
          );
        })}
        <div className="tf-bkf-roster__row tf-bkf-roster__row--foot" role="row">
          <span role="rowheader" className="tf-bkf-roster__corner">Working</span>
          {days.map((d) => {
            const working = people.filter((n) => !isOff(state, n, d) && hoursOn(state, n, d).hours.on);
            const ranges = working.flatMap((n) => hoursOn(state, n, d).hours.ranges);
            const from = Math.min(...ranges.map((r) => r.start));
            const to = Math.max(...ranges.map((r) => r.end));
            return (
              <span key={isoDay(d)} role="cell" className="tf-bkf-roster__foot">
                <span className="tf-num">{working.length ? plural(working.length, 'person', 'people') : 'No one'}</span>
                {working.length > 0 && <span className="tf-bkf__muted tf-num">{short(from)}–{short(to)}</span>}
              </span>
            );
          })}
        </div>
      </div>
      <p className="tf-bkf__muted tf-bkf-roster__hint">
        <span className="tf-bkf-roster__legend"><span className="tf-bkf-shift tf-bkf-shift--on tf-bkf-shift--key" aria-hidden="true" />Usual</span>
        <span className="tf-bkf-roster__legend"><span className="tf-bkf-shift tf-bkf-shift--on tf-bkf-shift--date tf-bkf-shift--key" aria-hidden="true" />This date only</span>
        Click a shift to change it. Click a name for their usual week and time off.
      </p>
      {person && <PersonDrawer name={person} state={state} dispatch={dispatch} onReassignMany={onReassignMany} onClose={() => setPerson(undefined)} />}
      <UsualHoursDialog isOpen={usualOpen} onClose={() => setUsualOpen(false)}
        onApply={(names, h) => {
          const before = names.map((n) => [n, memberHours(state, n)] as const);
          names.forEach((n) => setHours(n, h));
          setUsualOpen(false);
          toast({ message: `Usual hours set for ${names.length === 1 ? first(names[0] ?? '') : plural(names.length, 'person', 'people')}`, action: { label: 'Undo', onAction: () => before.forEach(([n, w]) => setHours(n, w)) } });
        }} />
    </div>
  );
}

/** One person's day: a shift chip (or Off / time off) that opens a small editor for this date or every week. */
function ShiftCell({ name, day, hours, usual, isOverride, off, count, onDate, onEvery }: {
  readonly name: string; readonly day: Date; readonly hours: DayHours; readonly usual: DayHours; readonly isOverride: boolean; readonly off: string | undefined; readonly count: number;
  readonly onDate: (h: DayHours | null) => void; readonly onEvery: (h: DayHours) => void;
}) {
  const [scope, setScope] = useState<'date' | 'every'>('date');
  const weekday = formatLongDay(day).split(' ')[0] ?? '';
  const label = off !== undefined ? (off || 'Time off') : shiftText(hours);
  const kind = off !== undefined ? 'away' : hours.on ? 'on' : 'off';
  const apply = (next: DayHours) => (scope === 'date' ? onDate(next) : onEvery(next));
  const first0 = hours.ranges[0];
  return (
    <span role="cell" className="tf-bkf-roster__cell">
      <DialogTrigger onOpenChange={(o) => { if (o) setScope('date'); }}>
        <AriaButton className={cx('tf-bkf-shift', `tf-bkf-shift--${kind}`, isOverride && 'tf-bkf-shift--date')}
          aria-label={`${name}, ${formatLongDay(day)}: ${label}${isOverride ? ', this date only' : ''}${count ? `, ${plural(count, 'meeting')}` : ''}. Change`}>
          <span className="tf-bkf-shift__time tf-num">{label}</span>
          {count > 0 && <span className="tf-bkf-shift__count tf-num">{plural(count, 'meeting')}</span>}
        </AriaButton>
        <Popover label={`${first(name)}, ${formatLongDay(day)}`} placement="bottom start" offset={6}>
          <div className="tf-bkf-shiftedit">
            <span className="tf-bkf-shiftedit__title">{first(name)} · {formatLongDay(day)}</span>
            {off !== undefined && <span className="tf-bkf__muted">On time off{off ? `: ${off}` : ''}. Guests can’t book then.</span>}
            <SegmentedControl aria-label="Change" size="sm" isFullWidth selectedKey={scope} onSelectionChange={(k) => setScope(k === 'every' ? 'every' : 'date')}
              items={[{ id: 'date', label: 'This date only' }, { id: 'every', label: `Every ${weekday}` }]} />
            <Switch isSelected={hours.on} onChange={(on) => apply({ on, ranges: on && hours.ranges.length === 0 ? [{ id: nextId('r'), start: 9 * 60, end: 17 * 60 }] : hours.ranges })}>Works this day</Switch>
            {hours.on && first0 && (
              <div className="tf-bkf__pair">
                <TimeSelect label="From" hourCycle={12} value={toHHMM(first0.start)} onChange={(v) => { if (v) apply({ ...hours, ranges: [{ ...first0, start: fromHHMM(v) }, ...hours.ranges.slice(1)] }); }} />
                <TimeSelect label="To" hourCycle={12} value={toHHMM(first0.end)} onChange={(v) => { if (v) apply({ ...hours, ranges: [{ ...first0, end: fromHHMM(v) }, ...hours.ranges.slice(1)] }); }} />
              </div>
            )}
            {isOverride && (
              <div className="tf-bkf-shiftedit__usual">
                <span className="tf-bkf__muted tf-num">Usual: {shiftText(usual)}</span>
                <Button size="sm" variant="ghost" icon={<RotateCcw {...i14} />} onPress={() => onDate(null)}>Back to usual</Button>
              </div>
            )}
          </div>
        </Popover>
      </DialogTrigger>
    </span>
  );
}

/** Set usual hours for several people at once: who, then the week. */
function UsualHoursDialog({ isOpen, onClose, onApply }: { readonly isOpen: boolean; readonly onClose: () => void; readonly onApply: (names: ReadonlyArray<string>, hours: WeekHours) => void }) {
  const [who, setWho] = useState<ReadonlyArray<string>>([]);
  const [hours, setHoursDraft] = useState<WeekHours>(() => weekdays(9, 17, 'u'));
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); else { setWho([]); setHoursDraft(weekdays(9, 17, 'u')); } }} size="wide" title="Set usual hours"
      description="Their week from now on. Date-only changes stay as they are."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={who.length === 0} onPress={() => onApply(who, hours)}>{who.length > 1 ? `Set for ${who.length} people` : 'Set hours'}</Button></>}>
      <div className="tf-bkf__stack">
        <ChoiceChips label="Who" selectionMode="multiple" items={TEAM.map((n) => ({ id: n, label: n === HOST ? `${first(n)} (you)` : first(n) }))} selectedKeys={who} onSelectionChange={(k) => setWho([...k])}
          end={<Button size="sm" variant="ghost" onPress={() => setWho(who.length === TEAM.length ? [] : [...TEAM])}>{who.length === TEAM.length ? 'Clear' : 'Everyone'}</Button>} />
        <HoursEditor value={hours} onChange={setHoursDraft} />
        <p className="tf-bkf__muted">{summarizeHours(hours)}, India time</p>
      </div>
    </Dialog>
  );
}

/** One person's setup: weekly hours, time off, and which round robins they take meetings for. */
function PersonDrawer({ name, state, dispatch, onReassignMany, onClose }: { readonly name: string; readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number; readonly onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  const setHours = useSetHours(state, dispatch);
  const hours = memberHours(state, name);
  const groups = state.groups.filter((g) => g.members.some((m) => m.name === name));
  const setPaused = (gid: string, paused: boolean) => dispatch({ type: 'groups/set', groups: state.groups.map((g) => (g.id === gid ? { ...g, members: g.members.map((m) => (m.name === name ? { ...m, paused } : m)) } : g)) });
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={name} subtitle={`${summarizeHours(hours)}, India time · ${Math.round(weekMinutes(hours) / 60)} h a week`} leading={<Avatar name={name} size={32} />} width="lg">
      <div className="tf-bkf-cards">
        <Section title="Usual week" description="When guests can book them, every week." className="tf-bkf-card">
          <HoursEditor value={hours} onChange={(h) => setHours(name, h)} />
        </Section>
        <div className="tf-bkf-card"><LimitsSection state={state} dispatch={dispatch} name={name} /></div>
        <div className="tf-bkf-card"><TimeOffSection state={state} dispatch={dispatch} onReassignMany={onReassignMany} adding={adding} onAddingChange={setAdding} only={name} /></div>
        <Section title="Round robin" description="Paused people are skipped for new meetings." className="tf-bkf-card">
          {groups.length === 0 ? <p className="tf-bkf__muted">Not in any round robin.</p> : (
            <ul className="tf-bkf__list-plain">
              {groups.map((g) => {
                const me = g.members.find((m) => m.name === name);
                return (
                  <li key={g.id} className="tf-bkf-skill">
                    <span>{g.name}</span>
                    <Switch isSelected={!me?.paused} onChange={(on) => setPaused(g.id, !on)}>Taking meetings</Switch>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </Drawer>
  );
}
