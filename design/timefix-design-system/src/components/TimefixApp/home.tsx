// Home: the day first. A greeting with what today holds, the setup checklist until it's hidden, today's meetings and your tasks
// side by side, then four numbers. Everything links to where the work is.
import { CalendarCheck, CalendarDays, CircleDollarSign, IdCard, Link2, Trophy, Upload, UserPlus, AlarmClock, Video, MapPin } from 'lucide-react';
import { Card, CardLink, StatCard } from '../Card/Card.tsx';
import { Checklist, type ChecklistStep } from '../Checklist/Checklist.tsx';
import { TaskList, type Task } from '../TaskList/TaskList.tsx';
import { Button } from '../Button/Button.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import type { BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { inr, recordName, type AppAction, type AppState } from './data.ts';
import type { AppPage } from './TimefixApp.tsx';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Props for HomeScreen. */
export interface HomeScreenProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly bookings: BookingsState | undefined;
  readonly onGo: (p: AppPage) => void;
  readonly onBookings: (tab: string) => void;
}

/** Home. */
export function HomeScreen({ state, dispatch, bookings, onGo, onBookings }: HomeScreenProps) {
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
  const toTask = (t: (typeof mine)[number]): Task => ({ id: t.id, title: t.title, done: t.done, due: t.due, assignee: t.assignee === state.me ? undefined : t.assignee,
    record: t.record ? { id: t.record.id, name: recordName(state, t.record).name, kind: t.record.object === 'people' ? 'person' : t.record.object === 'companies' ? 'company' : 'deal' } : undefined });
  const open = state.deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost');
  const won = state.deals.filter((d) => d.stage === 'Won');
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = (bookings?.meetings ?? []).filter((m) => m.status !== 'cancelled' && m.start >= monday && m.start < new Date(monday.getTime() + 7 * 86_400_000));
  const steps: ReadonlyArray<ChecklistStep> = [
    { id: 'workspace', title: 'Create your workspace', icon: <IdCard {...i16} />, actionLabel: 'Open', isDone: state.setupDone.includes('workspace') },
    { id: 'booking', title: 'Make a booking page', description: 'Guests pick a time that suits you both.', icon: <Link2 {...i16} />, actionLabel: 'Make one', isDone: state.setupDone.includes('booking') },
    { id: 'link', title: 'Claim your link page', icon: <IdCard {...i16} />, actionLabel: 'Claim', isDone: state.setupDone.includes('link') },
    { id: 'calendar', title: 'Connect your calendar', description: 'So nobody books over your busy time.', icon: <CalendarCheck {...i16} />, actionLabel: 'Connect', isDone: state.setupDone.includes('calendar') },
    { id: 'invite', title: 'Invite your team', description: 'Share records, pages and round robins.', icon: <UserPlus {...i16} />, actionLabel: 'Invite', isDone: state.setupDone.includes('invite') },
    { id: 'import', title: 'Bring in your contacts', description: 'A CSV from your old CRM or a spreadsheet.', icon: <Upload {...i16} />, actionLabel: 'Import', isDone: state.setupDone.includes('import') },
  ];
  const step = (id: string) => {
    dispatch({ type: 'setup/done', id });
    if (id === 'booking') onBookings('pages'); else if (id === 'calendar') onBookings('availability'); else if (id === 'link') onGo('link');
    else if (id === 'invite') onGo('settings'); else if (id === 'import') onGo('records:people');
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
      <div className="tf-home__grid">
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
                    <span className="tf-home__what"><strong>{m.title}</strong><span className="tf-home__muted">{m.invitee.name} · {m.place === 'in-person' ? <MapPin size={12} aria-hidden /> : <Video size={12} aria-hidden />} {m.placeLabel}</span></span>
                    {live && m.place !== 'in-person' && <Button size="sm" variant="primary" onPress={() => toast({ message: `Opening ${m.placeLabel}…` })}>Join</Button>}
                    {live && <span className="tf-home__now">Now</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="My tasks" action={<CardLink onPress={() => onGo('tasks')}>All tasks</CardLink>}>
          {shown.length === 0 ? <div className="tf-home__none"><p>You’re all caught up.</p></div> : (
            <TaskList tasks={shown.map(toTask)} onToggle={(id, done) => {
              const t = state.tasks.find((x) => x.id === id); if (!t) return;
              dispatch({ type: 'task/set', task: { ...t, done } });
              toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } });
            }} onAdd={(title) => dispatch({ type: 'task/set', task: { id: `t-${Date.now().toString(36)}`, title, done: false, assignee: state.me, created: new Date() } })} />
          )}
        </Card>
      </div>
      <div className="tf-home__stats">
        <StatCard label="Open pipeline" icon={<CircleDollarSign {...i16} />} value={open.reduce((n, d) => n + d.amount, 0)} format={inr} delta={{ value: `${open.length} deals`, direction: 'flat' }} />
        <StatCard label="Won this quarter" icon={<Trophy {...i16} />} value={won.reduce((n, d) => n + d.amount, 0)} format={inr} delta={{ value: '+18%', direction: 'up', note: 'vs last quarter', isGood: true }} sparkline={[2, 3, 3, 5, 4, 6, 7]} />
        <StatCard label="Meetings this week" icon={<CalendarDays {...i16} />} value={week.length} delta={{ value: `${week.filter((m) => m.status === 'pending').length} to confirm`, direction: 'flat' }} />
        <StatCard label="Overdue tasks" icon={<AlarmClock {...i16} />} value={mine.filter((t) => !t.done && t.due && t.due < new Date(now.getFullYear(), now.getMonth(), now.getDate())).length} delta={{ value: 'yours', direction: 'flat' }} />
      </div>
    </div>
  );
}
