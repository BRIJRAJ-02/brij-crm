import { Button as AriaButton, Disclosure, DisclosurePanel, Input, TextField } from 'react-aria-components';
import { useEffect, useRef, useState } from 'react';
import { Plus, Calendar, ChevronRight, CircleCheck } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { NumberRoll, Collapse, DropIn } from '../Motion/Motion.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { type AttributeRecordRef } from '../AttributeField/AttributeField.tsx';
import { RecordChip } from '../RecordChip/RecordChip.tsx';
import { formatDate, relativeDayLabel } from '../../lib/format.ts';
import './TaskList.css';

/** A task. `due` is the day it is due; the chip words it ("Today", "Tomorrow", "13 Nov") and turns red once the day has passed. */
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly due?: Date;
  readonly assignee?: string;
  readonly record?: AttributeRecordRef;
}

/** A due chip's words and whether the day has passed: Yesterday, Today and Tomorrow by name, other days as "13 Nov". */
function dueOf(due: Date, now: Date): { readonly label: string; readonly overdue: boolean } {
  const rel = relativeDayLabel(due, now);
  const label = rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? rel : formatDate(due, now);
  const overdue = new Date(due.getFullYear(), due.getMonth(), due.getDate()) < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { label, overdue };
}

function TaskRow({ task, checked, open, onChange }: { readonly task: Task; readonly checked: boolean; readonly open: boolean; readonly onChange: (v: boolean) => void }) {
  const due = task.due && dueOf(task.due, new Date());
  return (
    <Collapse open={open}>
      <div className={cx('tf-task', checked && 'is-done')}>
        <Checkbox round isSelected={checked} onChange={onChange} className="tf-task__check">{task.title}</Checkbox>
        <span className="tf-task__meta">
          {task.record && <RecordChip name={task.record.name} src={task.record.src} kind={task.record.kind === 'person' ? 'person' : 'company'} />}
          {due && <Tag size="sm" hue={due.overdue && !checked ? 'red' : 'gray'} icon={<Calendar size={12} strokeWidth={1.75} />}>{due.overdue && !checked ? `Overdue · ${due.label}` : due.label}</Tag>}
          {task.assignee && <Tooltip label={`Assigned to ${task.assignee}`}><AriaButton className="tf-task__who" aria-label={`Assigned to ${task.assignee}`}><Avatar name={task.assignee} size={20} /></AriaButton></Tooltip>}
        </span>
      </div>
    </Collapse>
  );
}

/** Props for TaskList. */
export interface TaskListProps {
  readonly tasks: ReadonlyArray<Task>;
  /** Marks a task done or open. Called after the done row has struck through and collapsed. */
  readonly onToggle: (id: string, done: boolean) => void;
  /** Adds a task from the inline row. */
  readonly onAdd?: (title: string) => void;
  /** Ids added since the list drew; they drop in. */
  readonly freshIds?: ReadonlySet<string>;
}

/** A record's or a person's tasks: round checks, due chips (red when overdue), the record and the assignee. A done task strikes through, then folds into "Completed". */
export function TaskList({ tasks, onToggle, onAdd, freshIds }: TaskListProps) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [folding, setFolding] = useState<ReadonlySet<string>>(new Set());
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState('');
  const timers = useRef(new Map<string, number[]>());
  useEffect(() => () => { for (const ts of timers.current.values()) ts.forEach((t) => window.clearTimeout(t)); }, []);
  const without = (s: ReadonlySet<string>, id: string) => { const n = new Set(s); n.delete(id); return n; };

  const complete = (id: string, v: boolean) => {
    for (const t of timers.current.get(id) ?? []) window.clearTimeout(t);
    timers.current.delete(id);
    if (!v) { setPending((s) => without(s, id)); setFolding((s) => without(s, id)); return; }
    setPending((s) => new Set(s).add(id));
    timers.current.set(id, [
      window.setTimeout(() => setFolding((s) => new Set(s).add(id)), 700),
      window.setTimeout(() => { onToggle(id, true); setPending((s) => without(s, id)); setFolding((s) => without(s, id)); timers.current.delete(id); }, 960),
    ]);
  };
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const add = () => { const t = draft.trim(); if (t && onAdd) { onAdd(t); setDraft(''); } };

  return (
    <section className="tf-tasks" aria-label="Tasks">
      <ul className="tf-tasks__list">
        {open.map((t) => (
          <li key={t.id}><DropIn animate={(freshIds?.has(t.id) ?? false) || reopened.has(t.id)}>
            <TaskRow task={t} checked={pending.has(t.id)} open={!folding.has(t.id)} onChange={(v) => complete(t.id, v)} />
          </DropIn></li>
        ))}
      </ul>
      {open.length === 0 && <p className="tf-tasks__clear"><CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />All caught up</p>}

      {onAdd && (
        <TextField aria-label="New task" value={draft} onChange={setDraft} className="tf-tasks__add">
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          <Input className="tf-tasks__add-input" placeholder="Add a task…" autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') setDraft(''); }} />
          {draft.trim() && <Kbd>↵</Kbd>}
        </TextField>
      )}

      {done.length > 0 && (
        <Disclosure className="tf-tasks__done">
          <AriaButton slot="trigger" className="tf-tasks__done-trigger">
            <ChevronRight className="tf-tasks__chev" size={14} strokeWidth={2} aria-hidden="true" />
            Completed <span className="tf-tasks__done-count">(<NumberRoll value={done.length} />)</span>
          </AriaButton>
          <DisclosurePanel className="tf-tasks__done-panel">
            <ul className="tf-tasks__list tf-tasks__done-inner">
              {done.map((t) => (
                <li key={t.id}><TaskRow task={t} checked open onChange={(v) => { if (!v) { setReopened((s) => new Set(s).add(t.id)); onToggle(t.id, false); } }} /></li>
              ))}
            </ul>
          </DisclosurePanel>
        </Disclosure>
      )}
    </section>
  );
}
