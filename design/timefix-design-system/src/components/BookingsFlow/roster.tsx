// Roster: the team's week at a glance, and one drawer per person to set their hours, time off and whether they take meetings.
import { useState, type CSSProperties } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { HoursEditor, summarizeHours, HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { formatClockRange } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';
import { Section, TabToolbar, i14, i16 } from './parts.tsx';
import { TimeOffSection } from './availability.tsx';
import {
  HOST, TEAM, busyOn, dayFrom, first, isOff, isoDay, memberHours, mondayOf, plural,
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

/** The Roster page (team workspaces only): who works when this week; pick a person to set them up. */
export function RosterTab({ state, dispatch, onReassignMany, onManageGroups }: RosterTabProps) {
  const [week, setWeek] = useState(0);
  const [person, setPerson] = useState<string>();
  const now = new Date();
  const monday = dayFrom(mondayOf(now), week * 7);
  const days = Array.from({ length: 5 }, (_, n) => dayFrom(monday, n));
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
      <div className="tf-bkf-tw" role="table" aria-label="Team week" style={{ '--tf-bkf-days': days.length } as CSSProperties}>
        <div className="tf-bkf-tw__row" role="row">
          <span role="columnheader" className="tf-bkf-tw__corner">Person</span>
          {days.map((d) => <span key={isoDay(d)} role="columnheader" className="tf-bkf-tw__day tf-num">{formatDay(d)}</span>)}
        </div>
        {TEAM.map((name) => (
          <div key={name} className="tf-bkf-tw__row" role="row">
            <span role="rowheader" className="tf-bkf-tw__whocell">
              <AriaButton className="tf-bkf-tw__who" onPress={() => setPerson(name)} aria-label={`Set up ${name}`}>
                <Avatar name={name} size={24} />
                <span className="tf-bkf-tw__name">{name === HOST ? `${first(name)} (you)` : first(name)}</span>
                <ChevronRight {...i14} aria-hidden="true" className="tf-bkf-tw__go" />
              </AriaButton>
            </span>
            {days.map((d) => {
              const hours = memberHours(state, name)[HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon'];
              const off = isOff(state, name, d);
              const booked = state.meetings.filter((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === d.toDateString());
              const busy = busyOn(state, name, d);
              const open = hours.on ? hours.ranges.reduce((s, r) => s + r.end - r.start, 0) : 0;
              const taken = booked.reduce((s, m) => s + (m.end.getTime() - m.start.getTime()) / 60_000, 0) + busy.reduce((s, b) => s + b.end - b.start, 0);
              const share = open ? Math.min(1, taken / open) : 0;
              return (
                <span key={isoDay(d)} role="cell" className="tf-bkf-tw__cell" data-off={off ? true : undefined}
                  aria-label={off ? `${name} is off` : hours.on ? `${name}: ${hours.ranges.map((r) => formatClockRange(r.start, r.end)).join(', ')}, ${plural(booked.length, 'meeting')}` : `${name} doesn't work this day`}>
                  {off ? <Tag size="sm" hue="orange">{off.note || 'Off'}</Tag> : hours.on ? (
                    <>
                      <span className="tf-bkf-tw__hours tf-num">{hours.ranges.map((r) => formatClockRange(r.start, r.end)).join(', ')}</span>
                      <span className="tf-bkf-tw__bar" style={{ '--tf-bkf-share': share } as CSSProperties} aria-hidden="true" />
                      <span className="tf-bkf__muted tf-num">{plural(booked.length, 'meeting')}</span>
                    </>
                  ) : <span className="tf-bkf__muted">Not working</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="tf-bkf__muted tf-bkf-tw__hint">Pick a person to set their hours, time off and meetings.</p>
      {person && <PersonDrawer name={person} state={state} dispatch={dispatch} onReassignMany={onReassignMany} onClose={() => setPerson(undefined)} />}
    </div>
  );
}

/** One person's setup: weekly hours, time off, and which round robins they take meetings for. */
function PersonDrawer({ name, state, dispatch, onReassignMany, onClose }: { readonly name: string; readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly onReassignMany: (meetings: ReadonlyArray<BookedMeeting>) => number; readonly onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  const hours = memberHours(state, name);
  const groups = state.groups.filter((g) => g.members.some((m) => m.name === name));
  // Your own hours are your default saved hours, so Availability and Roster edit the same thing.
  const setHours = (h: typeof hours) => (name === HOST ? dispatch({ type: 'hours/set', id: state.defaultHoursId, hours: h }) : dispatch({ type: 'member/hours', name, hours: h }));
  const setPaused = (gid: string, paused: boolean) => dispatch({ type: 'groups/set', groups: state.groups.map((g) => (g.id === gid ? { ...g, members: g.members.map((m) => (m.name === name ? { ...m, paused } : m)) } : g)) });
  return (
    <Drawer isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={name} subtitle={`${summarizeHours(hours)}, India time`} leading={<Avatar name={name} size={32} />} width="lg">
      <div className="tf-bkf-sections">
        <Section title="Weekly hours" description="When guests can book them.">
          <HoursEditor value={hours} onChange={setHours} />
        </Section>
        <TimeOffSection state={state} dispatch={dispatch} onReassignMany={onReassignMany} adding={adding} onAddingChange={setAdding} only={name} />
        <Section title="Round robin" description="Paused people are skipped for new meetings.">
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
