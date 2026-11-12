import { useState } from 'react';
import { CalendarCheck, CalendarDays, ClipboardList, Clock, Link2, UserPlus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Checklist, type ChecklistStep } from './Checklist.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const initial: readonly ChecklistStep[] = [
  { id: 'cal', title: 'Connect your calendar', description: 'So guests never book over a meeting.', icon: <CalendarCheck {...i} />, actionLabel: 'Connect', isDone: true },
  { id: 'hours', title: 'Set your working hours', description: 'Mon to Fri, 9 to 5 until you change it.', icon: <Clock {...i} />, actionLabel: 'Set hours', isDone: false },
  { id: 'page', title: 'Create a booking page', description: 'Start from Discovery call, 30 min.', icon: <CalendarDays {...i} />, actionLabel: 'Create', isDone: false },
  { id: 'form', title: 'Add a form', description: 'Ask guests a question before they book.', icon: <ClipboardList {...i} />, actionLabel: 'Add form', isDone: true },
  { id: 'team', title: 'Invite your team', description: 'Sam, Jo and Ava can take bookings too.', icon: <UserPlus {...i} />, actionLabel: 'Invite', isDone: false },
  { id: 'share', title: 'Share your link', description: 'timefix.com/priya', icon: <Link2 {...i} />, actionLabel: 'Copy link', isDone: false },
];

export function ChecklistDemo() {
  const [steps, setSteps] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const finish = (id: string) => window.setTimeout(() => setSteps((list) => list.map((s) => (s.id === id ? { ...s, isDone: true } : s))), 250);
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-24)', alignItems: 'start' }}>
      {hidden
        ? <div><Button size="sm" onPress={() => { setHidden(false); setSteps(initial); }}>Show setup again</Button></div>
        : <Checklist title="Finish setting up" steps={steps} onAction={finish} onHide={() => setHidden(true)} />}
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Press an action: the step checks off and slides below the open ones. The head folds the list.</p>
        <div className="tf-row">
          <Button size="sm" onPress={() => setSteps((l) => l.map((s) => ({ ...s, isDone: true })))}>Finish all</Button>
          <Button size="sm" variant="ghost" onPress={() => setSteps(initial)}>Reset</Button>
        </div>
      </div>
    </div>
  );
}
