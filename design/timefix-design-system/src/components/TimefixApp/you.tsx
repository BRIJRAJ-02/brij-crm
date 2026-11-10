// The "You" pages: Inbox (mentions, replies, assignments and booking notices; Done keeps the handled ones), Tasks (grouped by when
// they're due, yours or everyone's, with a dialog to add or edit), and Notes (every note you can see, opened full page).
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { NotificationList } from '../NotificationList/NotificationList.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TaskList } from '../TaskList/TaskList.tsx';
import { NoteList, NotePage } from '../NoteList/NoteList.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { parseDate } from '@internationalized/date';
import { Inbox, CheckSquare, NotebookPen } from 'lucide-react';
import { newId, recordName, type AppAction, type AppState, type AppTask, type InboxItem, type ObjectId, type RecordLink } from './data.ts';

const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const KIND_WORD: Readonly<Record<InboxItem['kind'], string>> = { mention: 'Mentions', reply: 'Replies', assignment: 'Assignments', booking: 'Bookings' };

/** Props shared by the You pages. */
export interface YouProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly onOpenRecord: (object: ObjectId, id: string) => void;
  readonly onBookings: (tab: string) => void;
}

/** Inbox: what needs you. Opening one marks it read; Done moves it out of the way, with Undo. */
export function InboxScreen({ state, dispatch, onOpenRecord, onBookings }: YouProps) {
  const { toast } = useToast();
  const [box, setBox] = useState<'inbox' | 'done'>('inbox');
  const [kind, setKind] = useState<'all' | InboxItem['kind']>('all');
  const [unread, setUnread] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const today = startOf(new Date());
  const items = state.inbox.filter((x) => (box === 'done' ? x.done : !x.done) && (kind === 'all' || x.kind === kind) && (!unread || !x.read));
  const set = (x: InboxItem, patch: Partial<InboxItem>) => dispatch({ type: 'inbox/set', item: { ...x, ...patch } });
  const open = (id: string) => {
    const x = state.inbox.find((y) => y.id === id); if (!x) return;
    set(x, { read: true });
    if (x.kind === 'booking') onBookings('meetings'); else if (x.taskId) setTaskId(x.taskId); else if (x.record) onOpenRecord(x.record.object, x.record.id);
  };
  const task = state.tasks.find((t) => t.id === taskId);
  return (
    <div className="tf-you">
      <div className="tf-you__bar">
        <SegmentedControl aria-label="Box" selectedKey={box} onSelectionChange={(k) => setBox(k === 'done' ? 'done' : 'inbox')}
          items={[{ id: 'inbox', label: `Inbox · ${state.inbox.filter((x) => !x.done).length}` }, { id: 'done', label: 'Done' }]} />
        <Select label="Kind" isLabelHidden className="tf-you__select" value={kind} onChange={(v) => setKind((v ?? 'all') as typeof kind)}
          items={[{ id: 'all', label: 'Everything' }, ...(Object.keys(KIND_WORD) as InboxItem['kind'][]).map((k) => ({ id: k, label: KIND_WORD[k] }))]} />
        <Switch isSelected={unread} onChange={setUnread}>Unread only</Switch>
        <span className="tf-rec__spacer" />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Inbox size={20} strokeWidth={1.75} />} title={box === 'done' ? 'Nothing done yet' : 'You’re all caught up'}
          description={box === 'done' ? 'What you mark done lands here, out of the way.' : 'Mentions, replies, tasks given to you and new bookings show up here.'} />
      ) : (
        <div className="tf-you__list">
          <NotificationList items={items.map((x) => ({ id: x.id, actor: x.actor, action: x.text, object: x.record ? recordName(state, x.record).name : '', excerpt: x.excerpt, time: ago(x.at), group: x.at >= today ? 'Today' : 'Earlier', read: x.read }))}
            onOpen={open} onReadChange={(id, read) => { const x = state.inbox.find((y) => y.id === id); if (x) set(x, { read }); }} onReadAll={() => dispatch({ type: 'inbox/all-read' })}
            onArchive={(id) => { const x = state.inbox.find((y) => y.id === id); if (!x) return; set(x, { done: !x.done, read: true }); toast({ message: x.done ? 'Back in your inbox' : 'Marked done', action: { label: 'Undo', onAction: () => set(x, {}) } }); }} />
        </div>
      )}
      {task && <TaskDialog state={state} task={task} onClose={() => setTaskId(undefined)} onSave={(t) => { dispatch({ type: 'task/set', task: t }); setTaskId(undefined); toast({ message: 'Task saved', tone: 'success' }); }} />}
    </div>
  );
}

/** Tasks: yours or everyone's, grouped by when they're due. */
export function TasksScreen({ state, dispatch, onOpenRecord }: YouProps) {
  const { toast } = useToast();
  const [whose, setWhose] = useState<'mine' | 'all'>('mine');
  const [editing, setEditing] = useState<AppTask | 'new'>();
  const now = new Date(); const today = startOf(now); const tomorrow = new Date(today.getTime() + 86_400_000);
  const list = state.tasks.filter((t) => whose === 'all' || t.assignee === state.me);
  const open = list.filter((t) => !t.done);
  const groups = [
    { id: 'overdue', title: 'Overdue', tasks: open.filter((t) => t.due && t.due < today) },
    { id: 'today', title: 'Today', tasks: open.filter((t) => t.due && t.due >= today && t.due < tomorrow) },
    { id: 'upcoming', title: 'Upcoming', tasks: open.filter((t) => t.due && t.due >= tomorrow).sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)) },
    { id: 'none', title: 'No date', tasks: open.filter((t) => !t.due) },
  ].filter((g) => g.tasks.length > 0);
  // Done tasks fold under the last group (the list's own Completed fold), never a group of their own.
  const done = list.filter((t) => t.done);
  const last = groups[groups.length - 1];
  if (last && done.length) groups[groups.length - 1] = { ...last, tasks: [...last.tasks, ...done] };
  const toggle = (id: string, done: boolean) => { const t = state.tasks.find((x) => x.id === id); if (!t) return; dispatch({ type: 'task/set', task: { ...t, done } }); toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); };
  return (
    <div className="tf-you">
      <div className="tf-you__bar">
        <SegmentedControl aria-label="Whose tasks" selectedKey={whose} onSelectionChange={(k) => setWhose(k === 'all' ? 'all' : 'mine')} items={[{ id: 'mine', label: 'Mine' }, { id: 'all', label: 'Everyone' }]} />
        <span className="tf-rec__spacer" />
        <Button variant="primary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setEditing('new')}>New task</Button>
      </div>
      {groups.length === 0 ? <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />} title="No tasks" description="Add one here, or from any record." action={<Button size="sm" variant="primary" onPress={() => setEditing('new')}>New task</Button>} /> : groups.map((g) => (
        <section key={g.id} className="tf-you__group" aria-label={g.title}>
          <h3 className="tf-you__h" data-tone={g.id === 'overdue' ? 'danger' : undefined}>{g.title}<span className="tf-rec__muted tf-num">{g.tasks.length}</span></h3>
          <div className="tf-you__card">
            <TaskList tasks={g.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, assignee: t.assignee === state.me ? undefined : t.assignee,
              record: t.record ? { id: t.record.id, name: recordName(state, t.record).name, kind: t.record.object === 'people' ? 'person' : t.record.object === 'companies' ? 'company' : 'deal' } : undefined }))} onToggle={toggle} onOpen={(id) => setEditing(state.tasks.find((x) => x.id === id))} />
          </div>
        </section>
      ))}
      {editing && <TaskDialog state={state} task={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onOpenRecord={onOpenRecord}
        onSave={(t) => { dispatch({ type: 'task/set', task: t }); setEditing(undefined); toast({ message: editing === 'new' ? 'Task added' : 'Task saved', tone: 'success' }); }}
        onDelete={editing !== 'new' ? () => { const t = editing; dispatch({ type: 'task/remove', id: t.id }); setEditing(undefined); toast({ message: 'Task deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); } : undefined} />}
    </div>
  );
}

/** Add or edit a task: what, when, who, and the record it's about. */
export function TaskDialog({ state, task, onClose, onSave, onDelete, onOpenRecord }: { readonly state: AppState; readonly task?: AppTask; readonly onClose: () => void; readonly onSave: (t: AppTask) => void; readonly onDelete?: () => void; readonly onOpenRecord?: (o: ObjectId, id: string) => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [due, setDue] = useState<string | undefined>(task?.due ? task.due.toISOString().slice(0, 10) : undefined);
  const [assignee, setAssignee] = useState(task?.assignee ?? state.me);
  const [rec, setRec] = useState(task?.record ? `${task.record.object}:${task.record.id}` : '');
  const [description, setDescription] = useState(task?.description ?? '');
  const records = [...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, description: 'Person' })), ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, description: 'Company' })), ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, description: 'Deal' }))];
  const link = (): RecordLink | undefined => { if (!rec) return undefined; const [o, i] = rec.split(':') as [ObjectId, string]; return { object: o, id: i }; };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={task ? 'Task' : 'New task'}
      actions={<>{onDelete && <Button variant="ghost" onPress={onDelete}>Delete</Button>}<span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={!title.trim()} onPress={() => onSave({ id: task?.id ?? newId('t'), title: title.trim(), done: task?.done ?? false, due: due ? new Date(`${due}T17:00`) : undefined, assignee, record: link(), description: description.trim() || undefined, created: task?.created ?? new Date() })}>{task ? 'Save' : 'Add task'}</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Task" value={title} onChange={setTitle} autoFocus={!task} placeholder="Send the proposal" />
        <div className="tf-bkf__pair">
          <DatePicker label="Due" value={due ? parseDate(due) : null} onChange={(d) => setDue(d ? d.toString() : undefined)} />
          <Select label="Assignee" value={assignee} onChange={(v) => setAssignee(v ?? state.me)} items={state.members.map((m) => ({ id: m.name, label: m.name }))} />
        </div>
        <Select label="About" searchable value={rec || null} onChange={(v) => setRec(v ?? '')} placeholder="A person, company or deal" items={records} />
        {rec && onOpenRecord && <button type="button" className="tf-rec__link tf-you__open" onClick={() => { const l = link(); if (l) { onClose(); onOpenRecord(l.object, l.id); } }}>Open {recordName(state, link() ?? { object: 'people', id: '' }).name}</button>}
        <TextArea label="Details" aside="Optional" rows={3} value={description} onChange={setDescription} />
      </div>
    </Dialog>
  );
}

/** Notes: everything written, newest first; a note opens full page and saves as you type. */
export function NotesScreen({ state, dispatch, onOpenRecord }: YouProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [rec, setRec] = useState('');
  const note = state.notes.find((n) => n.id === openId);
  if (note) {
    const r = recordName(state, note.record);
    return (
      <div className="tf-you tf-you--note">
        <button type="button" className="tf-rec__link" onClick={() => onOpenRecord(note.record.object, note.record.id)}>On {r.name}</button>
        <NotePage note={{ id: note.id, title: note.title, body: note.body, author: note.author, updated: ago(note.updated) }} people={state.members.map((m) => ({ id: m.id, name: m.name }))}
          onBack={() => setOpenId(undefined)} onSave={(n) => dispatch({ type: 'note/set', note: { ...note, title: n.title, body: n.body, updated: new Date() } })} />
      </div>
    );
  }
  const notes = [...state.notes].sort((a, b) => b.updated.getTime() - a.updated.getTime());
  return (
    <div className="tf-you">
      {notes.length === 0 ? <EmptyState icon={<NotebookPen size={20} strokeWidth={1.75} />} title="No notes yet" description="Notes sit on a person, company or deal." action={<Button size="sm" variant="primary" onPress={() => setPicking(true)}>New note</Button>} />
        : <NoteList notes={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, author: n.author, updated: `${ago(n.updated)} · ${recordName(state, n.record).name}` }))} onOpen={setOpenId} onNew={() => setPicking(true)} />}
      {picking && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setPicking(false); }} title="New note" description="Every note sits on a record, so the team finds it there too."
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!rec} onPress={() => {
            const [o, i] = rec.split(':') as [ObjectId, string];
            const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, record: { object: o, id: i }, updated: new Date() };
            dispatch({ type: 'note/set', note: n }); setPicking(false); setOpenId(n.id); toast({ message: 'Note started' });
          }}>Start writing</Button></>}>
          <Select label="On" searchable value={rec || null} onChange={(v) => setRec(v ?? '')} placeholder="Pick a person, company or deal"
            items={[...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, description: 'Person' })), ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, description: 'Company' })), ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, description: 'Deal' }))]} />
        </Dialog>
      )}
    </div>
  );
}
