import { useState } from 'react';
import { TaskList, type Task } from './TaskList.tsx';
import { DEMO_COMPANIES } from '../AttributeField/AttributeField.demo.tsx';

/** Today moved by `days`, so the chips always read Today, Tomorrow and overdue. */
const day = (days: number) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); };

const start: ReadonlyArray<Task> = [
  { id: 't1', title: 'Send one-depot pricing to Acme', done: false, due: day(-1), assignee: 'Priya Raman', record: DEMO_COMPANIES[0] },
  { id: 't2', title: 'Prepare the Northwind demo', done: false, due: day(0), assignee: 'Sam Kim', record: DEMO_COMPANIES[1] },
  { id: 't3', title: 'Follow up with Maria about SSO', done: false, due: day(4), assignee: 'Jo Mendes' },
  { id: 't4', title: 'Book a discovery call with Globex', done: true, due: day(-3), assignee: 'Ava Chen', record: DEMO_COMPANIES[2] },
  { id: 't5', title: 'Share the security pack', done: true, assignee: 'Jo Mendes', record: DEMO_COMPANIES[0] },
];

export function TaskListDemo() {
  const [tasks, setTasks] = useState(start);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="tf-demo">
      <div className="tf-tasks-demo">
        <p className="tf-demo-label">Tick a task: it strikes through, folds away and lands in Completed. Type below and press Enter to add one.</p>
        <TaskList tasks={tasks} freshIds={fresh}
          onToggle={(id, done) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, done } : t)))}
          onAdd={(title) => { const id = `t${Date.now()}`; setTasks((list) => [...list, { id, title, done: false, assignee: 'Priya Raman', due: day(1) }]); setFresh((s) => new Set(s).add(id)); }} />
      </div>
    </div>
  );
}
