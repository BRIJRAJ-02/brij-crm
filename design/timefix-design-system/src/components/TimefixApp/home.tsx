// Home: the day first. A greeting with what today holds, the setup checklist until it's hidden, today's meetings and your tasks
// side by side, then four numbers. Everything links to where the work is.
import { CalendarCheck, CalendarDays, CircleDollarSign, IdCard, Link2, Trophy, Upload, UserPlus, AlarmClock, Video, MapPin } from 'lucide-react';
import { Link } from '../Link/Link.tsx';
import { Card, CardLink, StatCard } from '../Card/Card.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Checklist, type ChecklistStep } from '../Checklist/Checklist.tsx';
import { TaskList, type Task } from '../TaskList/TaskList.tsx';
import { Button } from '../Button/Button.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { REPEATS, inr, recordName, type AppAction, type AppState } from './data.ts';
import { isOpenDeal, outcomeOf } from './model.tsx';
import type { AppPage } from './TimefixApp.tsx';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Props for HomeScreen. */
export interface HomeScreenProps {
  /** Records opened lately, newest first ("people:p1"), for Recently viewed. */
  readonly recent?: ReadonlyArray<string>;
  readonly onOpenRecord?: (object: 'people' | 'companies' | 'deals', id: string) => void;
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly bookings: BookingsState | undefined;
  readonly onGo: (p: AppPage) => void;
  readonly onBookings: (tab: string, who?: string) => void;
  /** The importer, Settings at a page, and a new task: where the checklist and empty states lead. */
  readonly onImport: () => void;
  readonly onSettings: (page: string) => void;
  readonly onNewTask: () => void;
  /** Insights › Reports, on one report. */
  readonly onReports?: (reportId?: string) => void;
}
/** Home's sections, in order; any can be turned off in Settings › Preferences. */
export const HOME_SECTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 'today', label: 'Today and my tasks' }, { id: 'numbers', label: 'The four numbers' }, { id: 'link', label: 'Link page' }, { id: 'team', label: 'Team this week' }, { id: 'reports', label: 'Saved reports' },
];

/** Home. */
export function HomeScreen({ state, dispatch, bookings, onGo, onBookings, onImport, onSettings, onNewTask, onReports, recent = [], onOpenRecord }: HomeScreenProps) {
  const hidden = new Set(state.prefs.homeHidden ?? []);
  const { toast } = useToast();
  const now = new Date();
  const hour = now.getHours();
  const first = state.me.split(' ')[0];
  const today = (bookings?.meetings ?? []).filter((m) => m.status !== 'cancelled' && m.start.toDateString() === now.toDateString()).sort((a, b) => a.start.getTime() - b.start.getTime());
  const left = today.filter((m) => m.end > now);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
  const mine = state.tasks.filter((t) => t.assignee === state.me);
  const due = mine.filter((t) => !t.done && t.due && t.due <= endOfToday);
  const shown = [...due, ...mine.filter((t) => !t.done && (!t.due || t.due > endOfToday))].slice(0, 6);
  const toTask = (t: (typeof mine)[number]): Task => ({ id: t.id, title: t.title, done: t.done, due: t.due, priority: t.priority, repeats: REPEATS.find((r) => r.id === t.repeat)?.label, assignee: t.assignee === state.me ? undefined : t.assignee,
    record: t.record ? { id: t.record.id, name: recordName(state, t.record).name, kind: t.record.object === 'people' ? 'person' : t.record.object === 'companies' ? 'company' : 'deal' } : undefined, more: t.also?.length });
  const open = state.deals.filter((d) => isOpenDeal(state, d));
  // This quarter against the last one, from the deals' own close dates; no made-up trend.
  const q0 = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); const qPrev = new Date(q0.getFullYear(), q0.getMonth() - 3, 1);
  const wonIn = (from: Date, to: Date) => state.deals.filter((d) => outcomeOf(state, d.stage) === 'won' && d.close >= from && d.close < to).reduce((n, d) => n + d.amount, 0);
  const wonNow = wonIn(q0, new Date(q0.getFullYear(), q0.getMonth() + 3, 1)); const wonBefore = wonIn(qPrev, q0);
  const wonDelta = wonBefore === 0 ? undefined : Math.round(((wonNow - wonBefore) / wonBefore) * 100);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = (bookings?.meetings ?? []).filter((m) => m.status !== 'cancelled' && m.start >= monday && m.start < new Date(monday.getTime() + 7 * 86_400_000));
  // Last week, for the change under each number (the references' "vs last week").
  const lastWeek = (bookings?.meetings ?? []).filter((m) => m.status !== 'cancelled' && m.start >= new Date(monday.getTime() - 7 * 86_400_000) && m.start < monday).length;
  const vs = (a: number, b: number) => (b === 0 ? (a === 0 ? { value: 'same as last week', direction: 'flat' as const } : { value: `+${a} vs last week`, direction: 'up' as const, isGood: true }) : a === b ? { value: 'same as last week', direction: 'flat' as const } : { value: `${a > b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs last week`, direction: a > b ? 'up' as const : 'down' as const, isGood: a > b });
  const newDeals = (from: Date, to: Date) => state.deals.filter((d) => d.created >= from && d.created < to);
  const steps: ReadonlyArray<ChecklistStep> = [
    // Each step ticks itself when the thing is really done, never on the click that leads there.
    { id: 'workspace', title: 'Create your workspace', icon: <IdCard {...i16} />, actionLabel: 'Open', isDone: true },
    { id: 'booking', title: 'Make a booking page', description: 'Guests pick a time that suits you both.', icon: <Link2 {...i16} />, actionLabel: 'Make one', isDone: (bookings?.pages.length ?? 0) > 0 },
    { id: 'link', title: 'Publish your link page', icon: <IdCard {...i16} />, actionLabel: 'Open', isDone: state.setupDone.includes('link') },
    { id: 'calendar', title: 'Connect your calendar', description: 'So nobody books over your busy time.', icon: <CalendarCheck {...i16} />, actionLabel: 'Connect', isDone: (bookings?.calendars ?? []).some((c) => c.status === 'connected') },
    { id: 'invite', title: 'Invite your team', description: 'Share records, pages and round robins.', icon: <UserPlus {...i16} />, actionLabel: 'Invite', isDone: state.members.length > 1 || state.prefs.invites.length > 0 },
    { id: 'import', title: 'Bring in your contacts', description: 'A CSV from your old CRM or a spreadsheet.', icon: <Upload {...i16} />, actionLabel: 'Import', isDone: state.setupDone.includes('import') || state.history.some((h) => h.text.includes(' imported ')) },
  ];
  const step = (id: string) => {
    if (id === 'booking') onBookings('pages'); else if (id === 'calendar') onBookings('availability'); else if (id === 'link') onGo('link');
    else if (id === 'invite') onSettings('members'); else if (id === 'import') onImport(); else if (id === 'workspace') onSettings('general');
  };
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const summary = [left.length ? `${left.length} ${left.length === 1 ? 'meeting' : 'meetings'} left today` : today.length ? 'No more meetings today' : 'No meetings today', due.length ? `${due.length} ${due.length === 1 ? 'task' : 'tasks'} due` : 'Nothing due'];

  return (
    <div className="tf-home">
      <header className="tf-home__head">
        <h1 className="tf-home__title">{greet}, {first}</h1>
        <p className="tf-home__sub tf-num">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {summary.join(' · ')}</p>
      </header>
      {!state.setupHidden && <Checklist title="Finish setting up" steps={steps} onAction={step} onHide={() => { dispatch({ type: 'setup/hide', hidden: true }); toast({ message: 'Setup hidden. Bring it back from Settings › Preferences.', action: { label: 'Undo', onAction: () => dispatch({ type: 'setup/hide', hidden: false }) } }); }} />}
      {!hidden.has('today') && <div className="tf-home__grid">
        <Card title="Today" action={<CardLink onPress={() => onBookings('meetings')}>All meetings</CardLink>}>
          {today.length === 0 ? (
            <div className="tf-home__none"><p>No meetings today.</p><Button size="sm" variant="secondary" onPress={() => onBookings('pages')}>Share a booking link</Button></div>
          ) : (
            <ul className="tf-home__agenda">
              {today.map((m) => {
                const past = m.end <= now; const live = m.start <= now && now < m.end;
                return (
                  <li key={m.id} className="tf-home__meet" data-state={past ? 'past' : live ? 'live' : 'next'}>
                    <span className="tf-home__time tf-num">{formatClockRange(minutesOf(m.start), minutesOf(m.end))}</span>
                    <button type="button" className="tf-home__what" onClick={() => onBookings('meetings', m.invitee.name)} aria-label={`${m.title} with ${m.invitee.name}, open in Meetings`}><strong>{m.title}</strong><span className="tf-home__muted">{m.invitee.name} · {m.place === 'in-person' ? <MapPin size={12} aria-hidden /> : <Video size={12} aria-hidden />} {m.placeLabel}</span></button>
                    {live && m.place !== 'in-person' && <Button size="sm" variant="primary" aria-label={`Copy the link to ${m.title}`} onPress={() => { const url = `https://timefix.com/m/${m.id.slice(-6)}`; void navigator.clipboard.writeText(url).then(() => toast({ message: 'Meeting link copied', tone: 'success' }), () => toast({ message: `Copy didn’t work. The link is ${url}` })); }}>Copy link</Button>}
                    {live && <span className="tf-home__now">Now</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="My tasks" action={<CardLink onPress={() => onGo('tasks')}>All tasks</CardLink>}>
          {shown.length === 0 ? <div className="tf-home__none"><p>You’re all caught up.</p><Button size="sm" variant="secondary" onPress={onNewTask}>Add a task</Button></div> : (<>
            <TaskList tasks={shown.map(toTask)} onToggle={(id, done) => {
              const t = state.tasks.find((x) => x.id === id); if (!t) return;
              dispatch({ type: 'task/set', task: { ...t, done } });
              toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } });
            }} onAdd={(title) => dispatch({ type: 'task/set', task: { id: `t-${Date.now().toString(36)}`, title, done: false, assignee: state.me, created: new Date() } })} />
            {mine.filter((t) => !t.done).length > shown.length && <Link onPress={() => onGo('tasks')}>{mine.filter((t) => !t.done).length - shown.length} more in Tasks</Link>}
          </>)}
        </Card>
      </div>}
      {!hidden.has('numbers') && <div className="tf-home__stats">
        <StatCard label="Open pipeline" icon={<CircleDollarSign {...i16} />} value={open.reduce((n, d) => n + d.amount, 0)} format={inr} delta={(() => { const now7 = newDeals(new Date(Date.now() - 7 * 86_400_000), new Date(Date.now() + 86_400_000)).length; const prev7 = newDeals(new Date(Date.now() - 14 * 86_400_000), new Date(Date.now() - 7 * 86_400_000)).length; return { ...vs(now7, prev7), value: `${open.length} deals · ${now7} new this week`, note: undefined }; })()} />
        <StatCard label="Won this quarter" icon={<Trophy {...i16} />} value={wonNow} format={inr} delta={wonDelta === undefined ? { value: wonBefore === 0 && wonNow > 0 ? 'First wins' : 'None yet', direction: 'flat' } : { value: `${wonDelta > 0 ? '+' : ''}${wonDelta}%`, direction: wonDelta > 0 ? 'up' : wonDelta < 0 ? 'down' : 'flat', note: 'vs last quarter', isGood: wonDelta >= 0 }} />
        <StatCard label="Meetings this week" icon={<CalendarDays {...i16} />} value={week.length} delta={{ ...vs(week.length, lastWeek), note: week.some((m) => m.status === 'pending') ? `${week.filter((m) => m.status === 'pending').length} to confirm` : undefined }} />
        <StatCard label="Overdue tasks" icon={<AlarmClock {...i16} />} value={mine.filter((t) => !t.done && t.due && t.due < new Date(now.getFullYear(), now.getMonth(), now.getDate())).length} delta={{ value: 'yours', direction: 'flat' }} />
      </div>}
      {(() => {
        // Records opened lately, so getting back to them is one click.
        const items = recent.map((key) => { const [o, id] = key.split(':'); const list = o === 'people' ? state.people : o === 'companies' ? state.companies : o === 'deals' ? state.deals : undefined; const r = list?.find((x) => x.id === id); return r && (o === 'people' || o === 'companies' || o === 'deals') ? { o, id: r.id, name: r.name } : undefined; }).filter((x): x is { o: 'people' | 'companies' | 'deals'; id: string; name: string } => x !== undefined).slice(0, 5);
        return items.length === 0 || !onOpenRecord ? null : (
          <Card title="Recently viewed">
            <ul className="tf-home__recent">{items.map((x) => <li key={`${x.o}:${x.id}`}><button type="button" className="tf-home__recentbtn" onClick={() => onOpenRecord(x.o, x.id)}>
              <Avatar name={x.name} size={24} shape={x.o === 'people' ? 'round' : 'square'} /><span>{x.name}</span><span className="tf-home__muted">{x.o === 'people' ? 'Person' : x.o === 'companies' ? 'Company' : 'Deal'}</span></button></li>)}</ul>
          </Card>);
      })()}
      {(!hidden.has('link') || !hidden.has('team') || !hidden.has('reports')) && <div className="tf-home__grid">
        {!hidden.has('link') && <Card title="Link page" action={<CardLink onPress={() => onGo('links')}>All links</CardLink>}>
          <div className="tf-home__none"><p className="tf-num">{state.linkPage || state.setupDone.includes('link') ? `Live at timefix.com/${bookings?.business?.handle || state.me.split(' ')[0]?.toLowerCase()}` : 'Not published yet'}</p>
            <Button size="sm" variant="secondary" onPress={() => onGo('link')}>Edit link page</Button></div>
        </Card>}
        {!hidden.has('team') && state.members.length > 1 && <Card title="Team this week" action={<CardLink onPress={() => onBookings('meetings')}>Meetings</CardLink>}>
          <ul className="tf-home__team">{state.members.map((m) => { const n = week.filter((x) => x.host === m.name).length; const deals = open.filter((d) => d.owner === m.name).length; return (
            <li key={m.id}><span>{m.name}</span><span className="tf-rec__muted tf-num">{n} {n === 1 ? 'meeting' : 'meetings'} · {deals} open {deals === 1 ? 'deal' : 'deals'}</span></li>); })}</ul>
        </Card>}
        {!hidden.has('reports') && <Card title="Saved reports" action={<CardLink onPress={() => onReports?.()}>Insights</CardLink>}>
          {state.reports.length === 0 ? <div className="tf-home__none"><p>No reports yet.</p><Button size="sm" variant="secondary" onPress={() => onReports?.()}>Make one</Button></div>
            : <ul className="tf-home__team">{state.reports.slice(0, 4).map((r) => <li key={r.id}><Link onPress={() => onReports?.(r.id)}>{r.name}</Link></li>)}</ul>}
        </Card>}
      </div>}
    </div>
  );
}