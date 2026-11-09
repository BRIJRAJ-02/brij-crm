// Step 7: the meeting drawer, and its Reschedule and Reassign dialogs.
import { useEffect, useMemo, useState } from 'react';
import { type Key } from 'react-aria-components';
import { Clock, Link2, MoreHorizontal, UserRound, UserX, Users, Video, X } from 'lucide-react';
import { Drawer } from '../Drawer/Drawer.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { PlaceIcon, MeetingStatusTag } from '../MeetingList/MeetingList.tsx';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import { TextArea } from '../Field/Field.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { ReferencePicker } from '../ComboBox/ComboBox.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay, formatLongDay } from '../../lib/format.ts';
import { cx } from '../../lib/cx.ts';
import { i14, i16 } from './parts.tsx';
import { PEOPLE, searchPeople } from './meetings.tsx';
import { HOST, HOST_ZONE, TEAM, ZONES, at, dayFrom, first, hostFor, isoDay, openTimes, plural, type BookedMeeting, type BookingPage, type BookingsState } from './state.ts';

/** Props for MeetingDrawer. */
export interface MeetingDrawerProps {
  readonly meeting: BookedMeeting | undefined;
  readonly page: BookingPage | undefined;
  readonly onClose: () => void;
  readonly onUpdate: (m: BookedMeeting) => void;
  readonly onCancel: (m: BookedMeeting) => void;
  readonly onReschedule: (m: BookedMeeting) => void;
  readonly onReassign: (m: BookedMeeting) => void;
  readonly onNoShow: (m: BookedMeeting) => void;
  readonly onJoin: (m: BookedMeeting) => void;
  readonly onConfirm: (m: BookedMeeting) => void;
  readonly onDecline: (m: BookedMeeting) => void;
}

/** The meeting: time (both zones when they differ), guest, place with Join, answers, notes, the linked record and activity. */
export function MeetingDrawer({ meeting, page, onClose, onUpdate, onCancel, onReschedule, onReassign, onNoShow, onJoin, onConfirm, onDecline }: MeetingDrawerProps) {
  const [last, setLast] = useState(meeting);
  if (meeting && meeting !== last) setLast(meeting);
  const m = meeting ?? last;
  const [notes, setNotes] = useState(m?.notes ?? '');
  useEffect(() => { setNotes(meeting?.notes ?? ''); }, [meeting?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const zoneTime = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(m.start);
  const guestZone = ZONES.find((z) => z.id === m.guestZone);
  const open = m.status === 'confirmed' || m.status === 'pending';
  const past = m.end <= new Date();
  const saveNotes = () => { if (notes !== m.notes) onUpdate({ ...m, notes, activity: [...m.activity, { id: `a-${Date.now()}`, text: `${HOST} edited the notes`, at: new Date() }] }); };
  return (
    <Drawer isOpen={meeting !== undefined} onOpenChange={(o) => { if (!o) { saveNotes(); onClose(); } }} title={m.title} subtitle={<span className="tf-num">{formatLongDay(m.start)}</span>}
      actions={<>
        <MeetingStatusTag status={m.status} />
        <MenuTrigger>
          <IconButton label="More for this meeting"><MoreHorizontal {...i16} /></IconButton>
          <Menu aria-label="Meeting actions" placement="bottom end" onAction={(k: Key) => {
            if (k === 'reassign') onReassign(m);
            else if (k === 'noshow') onNoShow(m);
            else if (k === 'copy') void navigator.clipboard?.writeText(`https://timefix.com/m/${m.id.slice(-6)}`).catch(() => undefined);
          }}>
            <MenuItem id="reassign" icon={<Users {...i16} />} isDisabled={!open}>Reassign</MenuItem>
            <MenuItem id="copy" icon={<Link2 {...i16} />}>Copy meeting link</MenuItem>
            <MenuItem id="noshow" icon={<UserX {...i16} />} isDisabled={!past || m.status === 'no-show'}>Mark as no-show</MenuItem>
          </Menu>
        </MenuTrigger>
      </>}
      footerStart={m.status === 'pending' ? <span className="tf-bkf__row">
        <Button variant="primary" onPress={() => onConfirm(m)}>Confirm</Button>
        <Button variant="ghost" onPress={() => onDecline(m)}>Decline</Button>
      </span> : open && !past ? <span className="tf-bkf__row">
        <Button variant="secondary" onPress={() => onReschedule(m)}>Reschedule</Button>
        <Button variant="ghost" onPress={() => onCancel(m)}>Cancel meeting</Button>
      </span> : undefined}>
      <dl className="tf-bkf__facts">
        <dt><Clock {...i16} aria-label="When" /></dt>
        <dd>
          <span className="tf-num">{formatClockRange(minutesOf(m.start), minutesOf(m.end))}</span> <span className="tf-bkf__muted">India time</span>
          {guestZone && m.guestZone !== HOST_ZONE && <span className="tf-bkf__sub tf-num">{zoneTime(m.guestZone)} for {first(m.invitee.name)} · {guestZone.label}</span>}
        </dd>
        <dt><UserRound {...i16} aria-label="Guest" /></dt>
        <dd>
          <PersonLine name={m.invitee.name} sub={m.invitee.email} />
          {m.guests && m.guests.length > 0 && <span className="tf-bkf__sub">and {m.guests.join(', ')}</span>}
        </dd>
        <dt><PlaceIcon place={m.place} /></dt>
        <dd className="tf-bkf__place">
          <span>{m.placeLabel}{m.host !== HOST ? ` · hosted by ${m.host}` : ''}</span>
          {m.place === 'video' && open && <Button size="sm" variant="secondary" icon={<Video {...i14} />} onPress={() => onJoin(m)}>Join</Button>}
        </dd>
      </dl>
      <section className="tf-bkf__block" aria-label="Answers">
        <h3 className="tf-bkf__block-title">Answers</h3>
        {m.answers.length === 0 ? <p className="tf-bkf__muted">Only name and email were asked.</p> : (
          <dl className="tf-bkf__answers">{m.answers.map((a) => <div key={a.question}><dt>{a.question}</dt><dd>{a.answer || '—'}</dd></div>)}</dl>
        )}
      </section>
      <section className="tf-bkf__block" aria-label="Notes">
        <TextArea label="Your notes" rows={3} value={notes} onChange={setNotes} onBlur={saveNotes} placeholder="Only your team sees these" />
      </section>
      <section className="tf-bkf__block" aria-label="Linked record">
        <h3 className="tf-bkf__block-title">Linked record</h3>
        {m.record ? (
          <span className="tf-bkf__record">
            <PersonLine name={m.record.name} sub={m.record.sub} shape={m.record.kind === 'company' ? 'square' : 'round'} />
            <Tag size="sm" hue={m.record.kind === 'company' ? 'purple' : 'blue'}>{m.record.kind === 'company' ? 'Company' : 'Person'}</Tag>
            <IconButton size="sm" label={`Unlink ${m.record.name}`} onPress={() => onUpdate({ ...m, record: undefined })}><X {...i14} /></IconButton>
          </span>
        ) : (
          <ReferencePicker label="Link to record" placeholder="Search people, companies and deals…" recent={PEOPLE.slice(0, 3)} search={searchPeople}
            onSelect={(record) => onUpdate({ ...m, record, activity: [...m.activity, { id: `a-${Date.now()}`, text: `Linked to ${record.name}`, at: new Date() }] })} />
        )}
      </section>
      <section className="tf-bkf__block" aria-label="Activity">
        <h3 className="tf-bkf__block-title">Activity</h3>
        <ul className="tf-bkf__activity">
          {[...m.activity].reverse().map((a) => (
            <li key={a.id}><span>{a.text}</span><span className="tf-bkf__muted tf-num">{formatDay(a.at)}</span></li>
          ))}
        </ul>
      </section>
      {page && <p className="tf-bkf__muted">Booked through {page.name}.</p>}
    </Drawer>
  );
}

/** Reschedule: the next two weeks of open times on the meeting's page; the guest is told. */
export function RescheduleDialog({ meeting, state, onClose, onMove }: { readonly meeting: BookedMeeting | undefined; readonly state: BookingsState; readonly onClose: () => void; readonly onMove: (m: BookedMeeting, start: Date) => void }) {
  const [picked, setPicked] = useState<string>();
  useEffect(() => { setPicked(undefined); }, [meeting?.id]);
  const days = useMemo(() => {
    if (!meeting) return [];
    const now = new Date();
    const len = (meeting.end.getTime() - meeting.start.getTime()) / 60_000;
    const page = state.pages.find((p) => p.id === meeting.pageId);
    const others = { ...state, meetings: state.meetings.filter((x) => x.id !== meeting.id) };
    const out: Array<{ day: Date; times: ReadonlyArray<number> }> = [];
    for (let n = 0; n < 14; n += 1) {
      const d = dayFrom(now, n);
      const times = page ? openTimes(page, others, d, now, len) : d.getDay() === 0 || d.getDay() === 6 ? [] : [10, 11, 14, 15, 16].map((h) => h * 60);
      if (times.length) out.push({ day: d, times: times.slice(0, 8) });
    }
    return out;
  }, [meeting, state]);
  return (
    <Dialog isOpen={meeting !== undefined} onOpenChange={(o) => { if (!o) onClose(); }} size="wide" title={`Reschedule ${meeting?.title ?? ''}`}
      description={meeting ? `Now ${formatDay(meeting.start)}, ${formatClockRange(minutesOf(meeting.start), minutesOf(meeting.end))}. ${meeting.invitee.name} gets an email with the new time.` : undefined}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!picked} onPress={() => { if (meeting && picked) { const [day, min] = picked.split('T'); const d = days.find((x) => isoDay(x.day) === day)?.day; if (d) onMove(meeting, at(d, Number(min))); } }}>Move meeting</Button></>}>
      <div className="tf-bkf__reslots">
        {days.length === 0 ? <p className="tf-bkf__muted">No open times in the next two weeks.</p> : days.map((d) => (
          <div key={isoDay(d.day)} className="tf-bkf__reslot-day">
            <span className="tf-bkf__label tf-num">{formatDay(d.day)}</span>
            <ChoiceChips label={formatLongDay(d.day)} isLabelHidden size="sm" selectedKeys={picked && picked.startsWith(isoDay(d.day)) ? [picked] : []}
              items={d.times.map((t) => ({ id: `${isoDay(d.day)}T${t}`, label: formatClockRange(t, t).split(' – ')[0] ?? '' }))}
              onSelectionChange={(keys) => { const k = [...keys][0]; if (k) setPicked(k); }} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Reassign: a teammate who's free then, or "Next in rotation" for round robin pages. */
export function ReassignDialog({ meeting, state, onClose, onReassign }: { readonly meeting: BookedMeeting | undefined; readonly state: BookingsState; readonly onClose: () => void; readonly onReassign: (m: BookedMeeting, host: string) => void }) {
  const [to, setTo] = useState('');
  useEffect(() => { setTo(''); }, [meeting?.id]);
  if (!meeting) return <Dialog isOpen={false} title="Reassign" />;
  const page = state.pages.find((p) => p.id === meeting.pageId);
  const others = { ...state, meetings: state.meetings.filter((x) => x.id !== meeting.id) };
  const s = minutesOf(meeting.start);
  const e = minutesOf(meeting.end);
  const nextUp = page?.hostMode === 'roundrobin' ? hostFor(others, { ...page, hosts: page.hosts.filter((h) => h !== meeting.host) }, meeting.start, s, e) : undefined;
  const free = (name: string) => !state.meetings.some((x) => x.id !== meeting.id && x.host === name && x.status !== 'cancelled' && x.start < meeting.end && meeting.start < x.end);
  const pick = to === 'next' ? nextUp : to;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} size="md" title={`Reassign ${meeting.title}`} description={`${meeting.invitee.name} keeps the same time; the new host gets the invitation.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!pick} onPress={() => { if (pick) onReassign(meeting, pick); }}>Reassign</Button></>}>
      <RadioGroup label="Give it to" value={to} onChange={setTo}>
        {nextUp && <Radio value="next">Next in rotation · {nextUp}</Radio>}
        {TEAM.filter((n) => n !== meeting.host).map((n) => <Radio key={n} value={n} isDisabled={!free(n)}>{n}{free(n) ? '' : ' · busy then'}</Radio>)}
      </RadioGroup>
      {page?.hostMode === 'roundrobin' && <p className={cx('tf-bkf__muted', 'tf-bkf__gap-top')}>{page.name} is shared by {plural(page.hosts.length, 'host')}.</p>}
    </Dialog>
  );
}
