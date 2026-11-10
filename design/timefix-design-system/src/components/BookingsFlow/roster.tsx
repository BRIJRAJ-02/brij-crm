// Roster: the team's week as a grid of shifts. Click a shift to change that day; click a person to set up their week, time off and round robins.
import { useState, type CSSProperties } from 'react';
import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { HoursEditor, summarizeHours, HOURS_DAYS, type DayHours, type WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import { TimeOffSection } from './availability.tsx';
import {
  HOST, TEAM, dayFrom, first, isOff, isoDay, memberHours, mondayOf, nextId, plural,
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
const weekMinutes = (w: WeekHours) => HOURS_DAYS.reduce((s, d) => s + (w[d].on ? w[d].ranges.reduce((t, r) => t + r.end - r.start, 0) : 0), 0);

/** Writes one person's week: your own hours are your default saved hours, so Availability and Roster edit the same thing. */
function useSetHours(state: BookingsState, dispatch: (a: BookingsAction) => void) {
  return (name: string, hours: WeekHours) => (name === HOST ? dispatch({ type: 'hours/set', id: state.defaultHoursId, hours }) : dispatch({ type: 'member/hours', name, hours }));
}

/** The Roster page (team workspaces only). */
export function RosterTab({ state, dispatch, onReassignMany, onManageGroups }: RosterTabProps) {
  const [week, setWeek] = useState(0);
  const [person, setPerson] = useState<string>();
  const setHours = useSetHours(state, dispatch);
  const now = new Date();
  const monday = dayFrom(mondayOf(now), week * 7);
  const days = Array.from({ length: 7 }, (_, n) => dayFrom(monday, n));
  const last = days[days.length - 1] ?? monday;
  return (
    <div className="tf-bkf__tab">
      <TabToolbar
        start={<span className="tf-bkf__weeknav">
          <IconButton size="sm" label="Previous week" onPress={() => setWeek((w) => w - 1)}><ChevronLeft {...i16} /></IconButton>
          <span className="tf-num" aria-live="polite">{formatDay(monday)} – {formatDay(last)}</span>
          <IconButton size="sm" label="Next week" onPress={() => setWeek((w) => w + 1)}><ChevronRight {...i16} /></IconButton>
          {week !== 0 && <Button size="sm" variant="ghost" onPress={() => setWeek(0)}>This week</Button>}
        </span>}
        action={<Button variant="secondary" icon={<Users {...i14} />} onPress={onManageGroups}>Round robin groups</Button>} />
      <div className="tf-bkf-roster" role="table" aria-label="Roster">
        <div className="tf-bkf-roster__row tf-bkf-roster__row--head" role="row">
          <span role="columnheader" className="tf-bkf-roster__corner">Team</span>
          {days.map((d) => (
            <span key={isoDay(d)} role="columnheader" className={cx('tf-bkf-roster__day', d.toDateString() === now.toDateString() && 'is-today')}>
              <span>{formatDay(d).split(' ')[0]}</span><span className="tf-num">{d.getDate()}</span>
            </span>
          ))}
        </div>
        {TEAM.map((name) => {
          const hours = memberHours(state, name);
          return (
            <div key={name} className="tf-bkf-roster__row" role="row">
              <span role="rowheader" className="tf-bkf-roster__whocell">
                <AriaButton className="tf-bkf-roster__who" onPress={() => setPerson(name)} aria-label={`Set up ${name}`}>
                  <Avatar name={name} size={28} />
                  <span className="tf-bkf-roster__whotext">
                    <span className="tf-bkf-roster__name">{name === HOST ? `${first(name)} (you)` : first(name)}</span>
                    <span className="tf-bkf-roster__total tf-num">{Math.round(weekMinutes(hours) / 60)} h a week</span>
                  </span>
                </AriaButton>
              </span>
              {days.map((d) => {
                const key = HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon';
                return <ShiftCell key={isoDay(d)} name={name} day={d} hours={hours[key]} off={isOff(state, name, d)?.note}
                  count={state.meetings.filter((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === d.toDateString()).length}
                  onChange={(next) => setHours(name, { ...hours, [key]: next })} />;
              })}
            </div>
          );
        })}
      </div>
      <p className="tf-bkf__muted tf-bkf-roster__hint">Click a shift to change that day. Click a name to set up their week, time off and round robins.</p>
      {person && <PersonDrawer name={person} state={state} dispatch={dispatch} onReassignMany={onReassignMany} onClose={() => setPerson(undefined)} />}
    </div>
  );
}

/** One person's day: a shift chip (or Off / time off) that opens a small editor for that day. */
function ShiftCell({ name, day, hours, off, count, onChange }: { readonly name: string; readonly day: Date; readonly hours: DayHours; readonly off: string | undefined; readonly count: number; readonly onChange: (h: DayHours) => void }) {
  const first0 = hours.ranges[0];
  const label = off !== undefined ? (off || 'Time off') : hours.on && first0 ? hours.ranges.map((r) => `${short(r.start)}–${short(r.end)}`).join(', ') : 'Off';
  const kind = off !== undefined ? 'away' : hours.on ? 'on' : 'off';
  return (
    <span role="cell" className="tf-bkf-roster__cell">
      <DialogTrigger>
        <AriaButton className={cx('tf-bkf-shift', `tf-bkf-shift--${kind}`)} aria-label={`${name}, ${formatLongDay(day)}: ${label}${count ? `, ${plural(count, 'meeting')}` : ''}. Change`}>
          <span className="tf-bkf-shift__time tf-num">{label}</span>
          {count > 0 && <span className="tf-bkf-shift__count tf-num">{plural(count, 'meeting')}</span>}
        </AriaButton>
        <Popover label={`${first(name)}, ${formatLongDay(day)}`} placement="bottom start" offset={6}>
          <div className="tf-bkf-shiftedit">
            <span className="tf-bkf-shiftedit__title">{first(name)} · {formatLongDay(day)}</span>
            {off !== undefined && <span className="tf-bkf__muted">On time off{off ? `: ${off}` : ''}. Guests can’t book then.</span>}
            <Switch isSelected={hours.on} onChange={(on) => onChange({ on, ranges: on && hours.ranges.length === 0 ? [{ id: nextId('r'), start: 9 * 60, end: 17 * 60 }] : hours.ranges })}>Works this day</Switch>
            {hours.on && first0 && (
              <div className="tf-bkf__pair">
                <TimeSelect label="From" hourCycle={12} value={toHHMM(first0.start)} onChange={(v) => { if (v) onChange({ ...hours, ranges: [{ ...first0, start: fromHHMM(v) }, ...hours.ranges.slice(1)] }); }} />
                <TimeSelect label="To" hourCycle={12} value={toHHMM(first0.end)} onChange={(v) => { if (v) onChange({ ...hours, ranges: [{ ...first0, end: fromHHMM(v) }, ...hours.ranges.slice(1)] }); }} />
              </div>
            )}
            {hours.ranges.length > 1 && <span className="tf-bkf__muted">Split shift: the second part is set in {first(name)}’s week.</span>}
          </div>
        </Popover>
      </DialogTrigger>
    </span>
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
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={name} subtitle={`${summarizeHours(hours)}, India time`} leading={<Avatar name={name} size={32} />} width="lg">
      <div className="tf-bkf-cards">
        <Section title="Weekly hours" description="When guests can book them." className="tf-bkf-card">
          <HoursEditor value={hours} onChange={(h) => setHours(name, h)} />
        </Section>
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

/** Keeps CSSProperties in use for callers that size the grid. */
export type RosterStyle = CSSProperties;
