// The "You" pages: Inbox (mentions, replies, assignments and booking notices; Done keeps the handled ones), Tasks (grouped by when
// they're due, yours or everyone's, with a dialog to add or edit), and Notes (every note you can see, opened full page).
import { useEffect, useState } from 'react';
import { NoResults } from '../EmptyState/EmptyState.tsx';
import { Link } from '../Link/Link.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Plus, X } from 'lucide-react';
import { SearchField } from '../SearchField/SearchField.tsx';
import { NotificationList } from '../NotificationList/NotificationList.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TaskList } from '../TaskList/TaskList.tsx';
import { NoteList, NotePage } from '../NoteList/NoteList.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { parseDate } from '@internationalized/date';
import { Inbox, CheckSquare, ChevronRight, NotebookPen, UserRound, Building2, CircleDollarSign, Bell, Link2, Boxes } from 'lucide-react';
import { copyText } from '../../lib/copy.ts';
import { MultiSelect } from '../Select/Select.tsx';
import { Button as AriaButton, Disclosure, DisclosurePanel } from 'react-aria-components';
import { NOTE_TEMPLATES, REPEATS, isEmptyNote, newId, noteFromTemplate, type TaskRepeat, recordName, type AppAction, type AppState, type AppTask, type InboxItem, type ObjectId, type RecordLink, dayFrom, ymdOf } from './data.ts';

const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const KIND_WORD: Readonly<Record<InboxItem['kind'], string>> = { mention: 'Mentions', reply: 'Replies', assignment: 'Assignments', booking: 'Bookings', form: 'Form submissions', automation: 'Automations' };

/** Props shared by the You pages. */
export interface YouProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly onOpenRecord: (object: ObjectId, id: string, tab?: string) => void;
  readonly onBookings: (tab: string, who?: string) => void;
  /** Tasks: open with the New task dialog. Notes: open this note. */
  readonly startNew?: boolean;
  readonly openTask?: string;
  /** A new task starts on this record (⌘K "New task" while a record is open). */
  readonly newFor?: RecordLink;
  readonly openNote?: string;
  /** Opens Settings at a page ("notifications"). */
  readonly onSettings?: (at?: string) => void;
}

/** Inbox: what needs you. Opening one marks it read; Done moves it out of the way, with Undo. */
export function InboxScreen({ state, dispatch, onOpenRecord, onBookings, onSettings }: YouProps) {
  const { toast } = useToast();
  const [box, setBox] = useState<'inbox' | 'snoozed' | 'done'>('inbox');
  // Snoozes end as time passes: checked each minute so an item comes back without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);
  const asleep = (x: InboxItem) => !x.done && x.snoozedUntil !== undefined && x.snoozedUntil > now;
  const back = (d: Date) => { const days = Math.round((startOf(d).getTime() - startOf(now).getTime()) / 86_400_000); return `Back ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`; };
  const [kind, setKind] = useState<'all' | 'due' | InboxItem['kind']>('all');
  const [unread, setUnread] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const today = startOf(new Date());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const dueToday = (x: InboxItem) => { const t = state.tasks.find((y) => y.id === x.taskId); return t !== undefined && !t.done && t.due !== undefined && t.due < tomorrow; };
  const items = state.inbox.filter((x) => (box === 'done' ? x.done : box === 'snoozed' ? asleep(x) : !x.done && !asleep(x)) && (kind === 'all' || (kind === 'due' ? dueToday(x) : x.kind === kind)) && (!unread || !x.read));
  const filtered = kind !== 'all' || unread;
  const set = (x: InboxItem, patch: Partial<InboxItem>) => dispatch({ type: 'inbox/set', item: { ...x, ...patch } });
  const open = (id: string) => {
    const x = state.inbox.find((y) => y.id === id); if (!x) return;
    set(x, { read: true });
    if (x.kind === 'booking') onBookings('meetings', x.actor); else if (x.taskId) setTaskId(x.taskId); else if (x.record) onOpenRecord(x.record.object, x.record.id, x.kind === 'mention' || x.kind === 'reply' ? 'comments' : undefined);
  };
  const task = state.tasks.find((t) => t.id === taskId);
  return (
    <div className="tf-you">
      <div className="tf-you__bar">
        <SegmentedControl aria-label="Box" size="sm" selectedKey={box} onSelectionChange={(k) => setBox(k === 'done' ? 'done' : k === 'snoozed' ? 'snoozed' : 'inbox')}
          items={[{ id: 'inbox', label: `Inbox · ${state.inbox.filter((x) => !x.done && !asleep(x)).length}` }, ...(state.inbox.some(asleep) || box === 'snoozed' ? [{ id: 'snoozed', label: `Snoozed · ${state.inbox.filter(asleep).length}` }] : []), { id: 'done', label: 'Done' }]} />
        <Select label="Kind" isLabelHidden className="tf-you__select" value={kind} onChange={(v) => setKind((v ?? 'all') as typeof kind)}
          items={[{ id: 'all', label: 'Everything' }, { id: 'due', label: 'Tasks due by today' }, ...(Object.keys(KIND_WORD) as InboxItem['kind'][]).map((k) => ({ id: k, label: KIND_WORD[k] }))]} />
        <Switch isSelected={unread} onChange={setUnread}>Unread only</Switch>
        <span className="tf-rec__spacer" />
        {onSettings && <Button size="sm" variant="ghost" icon={<Bell size={14} strokeWidth={1.75} />} onPress={() => onSettings('notifications')}>Notification settings</Button>}
      </div>
      {items.length === 0 ? (filtered
        ? <EmptyState icon={<Inbox size={20} strokeWidth={1.75} />} title="Nothing matches" description="Nothing here fits what you picked." action={<Button size="sm" variant="secondary" onPress={() => { setKind('all'); setUnread(false); }}>Show everything</Button>} />
        : <EmptyState icon={<Inbox size={20} strokeWidth={1.75} />} title={box === 'done' ? 'Nothing done yet' : 'You’re all caught up'}
          description={box === 'done' ? 'What you mark done lands here, out of the way.' : 'Mentions, replies, tasks given to you and new bookings show up here.'} />
      ) : (
        <div className="tf-you__list">
          <NotificationList key={box} title="" archiveLabel={box === 'done' ? 'Move to inbox' : box === 'snoozed' ? 'Back to inbox now' : 'Mark done'} archivedLabel={box === 'done' || box === 'snoozed' ? 'Moved to inbox' : 'Done'}
            onSnooze={box === 'inbox' ? (id, until) => { const x = state.inbox.find((y) => y.id === id); if (!x) return; set(x, { snoozedUntil: until, read: false }); toast({ message: back(until).replace('Back', 'Snoozed till'), action: { label: 'Undo', onAction: () => set(x, { snoozedUntil: x.snoozedUntil, read: x.read }) } }); } : undefined}
            items={items.map((x) => ({ id: x.id, actor: x.actor, action: x.text, object: x.record ? recordName(state, x.record).name : '', excerpt: x.excerpt, time: box === 'snoozed' && x.snoozedUntil ? back(x.snoozedUntil) : ago(x.at), group: x.at >= today ? 'Today' : 'Earlier', read: x.read }))}
            onOpen={open} onReadChange={(id, read) => { const x = state.inbox.find((y) => y.id === id); if (x) set(x, { read }); }} allLabel={box === 'done' ? 'Mark all read' : 'Mark all done'} onReadAll={() => { if (box === 'done') { items.forEach((x) => { if (!x.read) set(x, { read: true }); }); return; } const was = items; was.forEach((x) => set(x, { done: true, read: true })); toast({ message: `${was.length} moved to Done`, action: { label: 'Undo', onAction: () => was.forEach((x) => set(x, { done: x.done, read: x.read })) } }); }}
            onArchive={(id) => { const x = state.inbox.find((y) => y.id === id); if (!x) return; if (box === 'snoozed') set(x, { snoozedUntil: undefined }); else set(x, { done: !x.done, read: true }); }} />
        </div>
      )}
      {task && <TaskDialog state={state} task={task} onClose={() => setTaskId(undefined)} onOpenRecord={onOpenRecord} onSave={(t) => { dispatch({ type: 'task/set', task: t }); setTaskId(undefined); toast({ message: 'Task saved', tone: 'success' }); }}
        onDelete={() => { const t = task; dispatch({ type: 'task/remove', id: t.id }); setTaskId(undefined); toast({ message: 'Task deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); }} />}
    </div>
  );
}

/** Tasks: yours or everyone's, grouped by when they're due. */
export function TasksScreen({ state, dispatch, onOpenRecord, startNew, openTask, newFor }: YouProps) {
  const { toast } = useToast();
  const [whose, setWhose] = useState<'mine' | 'made' | 'all'>('mine');
  const [editing, setEditing] = useState<AppTask | 'new' | undefined>(startNew ? 'new' : state.tasks.find((t) => t.id === openTask));
  const now = new Date(); const today = startOf(now); const tomorrow = new Date(today.getTime() + 86_400_000);
  const list = state.tasks.filter((t) => whose === 'all' || (whose === 'made' ? (t.createdBy ?? t.assignee) === state.me : t.assignee === state.me));
  const open = list.filter((t) => !t.done);
  const rank = (t: AppTask) => (t.priority === 'high' ? 0 : t.priority === 'low' ? 2 : 1);
  const groups = [
    { id: 'overdue', title: 'Overdue', tasks: open.filter((t) => t.due && t.due < today) },
    // High priority first in each group, low last; otherwise as they were.
    { id: 'today', title: 'Today', tasks: open.filter((t) => t.due && t.due >= today && t.due < tomorrow) },
    { id: 'upcoming', title: 'Upcoming', tasks: open.filter((t) => t.due && t.due >= tomorrow).sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)) },
    { id: 'none', title: 'No date', tasks: open.filter((t) => !t.due) },
  ].filter((g) => g.tasks.length > 0).map((g) => ({ ...g, tasks: [...g.tasks].sort((a, b) => rank(a) - rank(b)) }));
  // Done tasks get their own section at the bottom, open, newest first; its head folds it away.
  const done = list.filter((t) => t.done).reverse();
  const toggle = (id: string, done: boolean) => { const t = state.tasks.find((x) => x.id === id); if (!t) return; dispatch({ type: 'task/set', task: { ...t, done } }); toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); };
  return (
    <div className="tf-you">
      <div className="tf-you__bar">
        <SegmentedControl aria-label="Whose tasks" size="sm" selectedKey={whose} onSelectionChange={(k) => setWhose(k === 'all' ? 'all' : k === 'made' ? 'made' : 'mine')} items={[{ id: 'mine', label: 'Mine' }, { id: 'made', label: 'Created by me' }, { id: 'all', label: 'Everyone' }]} />
        <span className="tf-rec__spacer" />
        <Button variant="primary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setEditing('new')}>New task</Button>
      </div>
      {groups.length === 0 && done.length === 0 ? <EmptyState icon={<CheckSquare size={20} strokeWidth={1.75} />} title={whose === 'mine' ? 'Nothing for you right now' : 'No tasks'}
        description={whose === 'mine' && state.tasks.some((t) => !t.done && t.assignee !== state.me) ? 'Others on the team have open tasks.' : 'Add one here, or from any record.'}
        action={<span className="tf-set__row"><Button size="sm" variant="primary" onPress={() => setEditing('new')}>New task</Button>{whose === 'mine' && state.tasks.some((t) => !t.done && t.assignee !== state.me) && <Button size="sm" variant="secondary" onPress={() => setWhose('all')}>See everyone’s tasks</Button>}</span>} /> : groups.map((g) => (
        <Disclosure key={g.id} className="tf-you__group tf-you__done" defaultExpanded aria-label={g.title}>
          <h3 className="tf-you__h" data-tone={g.id === 'overdue' ? 'danger' : undefined}><AriaButton slot="trigger" className="tf-you__fold"><ChevronRight className="tf-you__foldchev" size={16} strokeWidth={1.75} aria-hidden="true" />{g.title}<span className="tf-rec__muted tf-num">{g.tasks.filter((t) => !t.done).length}</span></AriaButton></h3>
          <DisclosurePanel className="tf-you__donepanel">
          <div className="tf-you__card">
            <TaskList isFlush tasks={g.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, dueTime: t.dueTime, priority: t.priority, repeats: REPEATS.find((r) => r.id === t.repeat)?.label, assignee: t.assignee === state.me ? undefined : t.assignee,
              record: t.record ? { id: t.record.id, name: recordName(state, t.record).name, kind: t.record.object === 'people' ? 'person' : t.record.object === 'companies' ? 'company' : 'deal' } : undefined, more: t.also?.length }))} onToggle={toggle} onOpen={(id) => setEditing(state.tasks.find((x) => x.id === id))} />
          </div>
          </DisclosurePanel>
        </Disclosure>
      ))}
      {groups.length === 0 && done.length > 0 && <p className="tf-you__clear"><CheckSquare size={16} strokeWidth={1.75} aria-hidden="true" />Nothing open. Everything below is done.</p>}
      {done.length > 0 && (
        <Disclosure className="tf-you__group tf-you__done" defaultExpanded>
          <h3 className="tf-you__h"><AriaButton slot="trigger" className="tf-you__fold"><ChevronRight className="tf-you__foldchev" size={16} strokeWidth={1.75} aria-hidden="true" />Completed<span className="tf-rec__muted tf-num">{done.length}</span></AriaButton></h3>
          <DisclosurePanel className="tf-you__donepanel">
            <div className="tf-you__card">
              <TaskList isFlush isDoneList tasks={done.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, dueTime: t.dueTime, priority: t.priority, repeats: REPEATS.find((r) => r.id === t.repeat)?.label, assignee: t.assignee === state.me ? undefined : t.assignee,
                record: t.record ? { id: t.record.id, name: recordName(state, t.record).name, kind: t.record.object === 'people' ? 'person' : t.record.object === 'companies' ? 'company' : 'deal' } : undefined, more: t.also?.length }))} onToggle={toggle} onOpen={(id) => setEditing(state.tasks.find((x) => x.id === id))} />
            </div>
          </DisclosurePanel>
        </Disclosure>
      )}
      {editing && <TaskDialog state={state} record={editing === 'new' ? newFor : undefined} task={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onOpenRecord={onOpenRecord}
        onSave={(t) => { dispatch({ type: 'task/set', task: t }); setEditing(undefined); toast({ message: editing === 'new' ? 'Task added' : 'Task saved', tone: 'success' }); }}
        onDelete={editing !== 'new' ? () => { const t = editing; dispatch({ type: 'task/remove', id: t.id }); setEditing(undefined); toast({ message: 'Task deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); } : undefined} />}
    </div>
  );
}

/** Add or edit a task: what, when, who, and the record it's about. */
export function TaskDialog({ state, task, onClose, onSave, onDelete, onOpenRecord, record }: { /** A new task's record, when made from a record page. */ readonly record?: RecordLink; readonly state: AppState; readonly task?: AppTask; readonly onClose: () => void; readonly onSave: (t: AppTask) => void; readonly onDelete?: () => void; readonly onOpenRecord?: (o: ObjectId, id: string) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(task?.title ?? '');
  const [due, setDue] = useState<string | undefined>(task?.due ? ymdOf(task.due) : undefined);
  const [at, setAt] = useState<string>(task?.due && task.dueTime ? String(task.due.getHours() * 60 + task.due.getMinutes()) : 'none');
  const [assignee, setAssignee] = useState(task?.assignee ?? state.me);
  const [rec, setRec] = useState(task?.record ? `${task.record.object}:${task.record.id}` : record ? `${record.object}:${record.id}` : '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<string>(task?.priority ?? 'normal');
  const [repeat, setRepeat] = useState<string>(task?.repeat ?? 'none');
  const [also, setAlso] = useState<ReadonlyArray<string>>(() => (task?.also ?? []).map((r) => `${r.object}:${r.id}`));
  const records = allRecordItems(state);
  const toLink = (key: string): RecordLink => { const [o = '', i = ''] = key.split(':'); return { object: o, id: i }; };
  const link = (): RecordLink | undefined => (rec ? toLink(rec) : undefined);
  const save = () => { if (title.trim()) onSave({ priority: priority === 'high' || priority === 'low' ? priority : undefined, repeat: due && REPEATS.some((r) => r.id === repeat) ? (repeat as TaskRepeat) : undefined, id: task?.id ?? newId('t'), title: title.trim(), done: task?.done ?? false, due: due ? (() => { const d = dayFrom(due, 17); if (!d || at === 'none') return d; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(Number(at) / 60), Number(at) % 60); })() : undefined, dueTime: Boolean(due) && at !== 'none', assignee, record: link(), also: also.filter((k) => k !== rec).length ? also.filter((k) => k !== rec).map(toLink) : undefined, description: description.trim() || undefined, created: task?.created ?? new Date(), createdBy: task?.createdBy ?? state.me }); };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={task ? 'Task' : 'New task'}
      actions={<>{onDelete && <Button variant="ghost" onPress={onDelete}>Delete</Button>}{task && <Button variant="ghost" icon={<Link2 size={14} strokeWidth={1.75} />} onPress={() => { const url = `https://timefix.com/${state.prefs.workspace.slug}/tasks/${task.id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link to task copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }}>Copy link</Button>}<span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={!title.trim()} onPress={save}>{task ? 'Save' : 'Add task'}</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Task" value={title} onChange={setTitle} autoFocus={!task} placeholder="Send the proposal" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        <div className="tf-bkf__pair">
          <DatePicker label="Due" value={due ? parseDate(due) : null} onChange={(d) => setDue(d ? d.toString() : undefined)} />
          <Select label="At" value={at} isDisabled={!due} onChange={(v) => setAt(v ?? 'none')} items={[{ id: 'none', label: 'Any time that day' }, ...Array.from({ length: 23 }, (_, n) => 7 * 60 + n * 30).map((m) => ({ id: String(m), label: new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }))]} />
        </div>
        {due && <Select label="Repeat" value={repeat} onChange={(v) => setRepeat(v ?? 'none')} items={[{ id: 'none', label: 'Doesn’t repeat' }, ...REPEATS.map((r) => ({ id: r.id, label: r.label, description: 'The next one is added when you tick this one' }))]} />}
        <div className="tf-bkf__pair">
          <Select label="Assignee" value={assignee} onChange={(v) => setAssignee(v ?? state.me)} items={state.members.map((m) => ({ id: m.name, label: m.name }))} />
          <Select label="Priority" value={priority} onChange={(v) => setPriority(v ?? 'normal')} items={[{ id: 'high', label: 'High' }, { id: 'normal', label: 'Normal' }, { id: 'low', label: 'Low' }]} />
        </div>
        <Select label="About" searchable value={rec || null} onChange={(v) => setRec(v ?? '')} placeholder="A person, company or deal" items={records} />
        {rec && onOpenRecord && <Link onPress={() => { const l = link(); if (!l) return; if (title.trim()) save(); else onClose(); onOpenRecord(l.object, l.id); }} className="tf-you__open">Open {recordName(state, link() ?? { object: 'people', id: '' }).name}</Link>}
        {/* More records it's about (Attio links a task to several): the task shows on each one's page. */}
        {rec && <div className="tf-bkf__group">
          <Select label="Also about" searchable value={null} onChange={(v) => { if (v && v !== rec && !also.includes(v)) setAlso((a) => [...a, v]); }} placeholder="Add another record" items={records.filter((r) => r.id !== rec && !also.includes(r.id))} />
          {also.length > 0 && <ul className="tf-you__also" aria-label="Also about">{also.map((k) => { const l = toLink(k); return (
            <li key={k}><span>{recordName(state, l).name}<span className="tf-rec__muted"> · {l.object === 'people' ? 'Person' : l.object === 'companies' ? 'Company' : l.object === 'deals' ? 'Deal' : state.objects.find((o) => o.id === l.object)?.one ?? 'Record'}</span></span>
              <IconButton size="sm" label={`Remove ${recordName(state, l).name}`} onPress={() => setAlso((a) => a.filter((x) => x !== k))}><X size={14} strokeWidth={1.75} /></IconButton></li>); })}</ul>}
        </div>}
        <TextArea label="Details" aside="Optional" rows={3} value={description} onChange={setDescription} />
      </div>
    </Dialog>
  );
}

/** Notes: everything written, newest first; a note opens full page and saves as you type. */
export function NotesScreen({ state, dispatch, onOpenRecord, openNote }: YouProps) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | undefined>(openNote);
  const [picking, setPicking] = useState(false);
  const [rec, setRec] = useState('');
  const [template, setTemplate] = useState('blank');
  const [noteQuery, setNoteQuery] = useState('');
  const note = state.notes.find((n) => n.id === openId);
  if (note) {
    const on = note.record;
    return (
      <div className="tf-you tf-you--note">
        <span className="tf-recp__notebar">
          {on && <Link onPress={() => onOpenRecord(on.object, on.id)}>On {recordName(state, on).name}</Link>}
          {(note.also ?? []).map((r) => <Link key={`${r.object}:${r.id}`} onPress={() => onOpenRecord(r.object, r.id)}>{recordName(state, r).name}</Link>)}
          <span className="tf-rec__spacer" />
          <MultiSelect label="Records" isLabelHidden searchable className="tf-you__select" placeholder={on ? 'Link more records' : 'Link records'} optionStyle="plain"
            values={[...(on ? [`${on.object}:${on.id}`] : []), ...(note.also ?? []).map((r) => `${r.object}:${r.id}`)]}
            onChange={(keys) => { const links = keys.map((k) => { const [o = '', i = ''] = k.split(':'); return { object: o, id: i }; }); const [first, ...rest] = links; dispatch({ type: 'note/set', note: { ...note, record: first, also: rest.length ? rest : undefined } }); }}
            items={allRecordItems(state)} />
          <Button size="sm" variant="ghost" icon={<Link2 size={14} strokeWidth={1.75} />} onPress={() => { const url = `https://timefix.com/${state.prefs.workspace.slug}/notes/${note.id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link to note copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }}>Copy link</Button>
        </span>
        <NotePage note={{ id: note.id, title: note.title, body: note.body, doc: note.doc, author: note.author, updated: ago(note.updated) }} people={state.members.map((m) => ({ id: m.id, name: m.name }))}
          onBack={(l) => { setOpenId(undefined); if (isEmptyNote(l.title, l.body)) dispatch({ type: 'note/remove', id: note.id }); }}
          onDelete={() => { const n = note; setOpenId(undefined); dispatch({ type: 'note/remove', id: n.id }); toast({ message: 'Note deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'note/set', note: n }) } }); }}
          onSave={(n) => dispatch({ type: 'note/set', note: { ...note, title: n.title, body: n.body, doc: n.doc, updated: new Date() } })} />
      </div>
    );
  }
  const all = [...state.notes].sort((a, b) => b.updated.getTime() - a.updated.getTime());
  const q = noteQuery.trim().toLowerCase();
  const notes = q ? all.filter((n) => `${n.title} ${n.body} ${n.record ? recordName(state, n.record).name : ''}`.toLowerCase().includes(q)) : all;
  return (
    <div className="tf-you">
      {all.length > 0 && <div className="tf-you__bar">
        <SearchField label="Search notes" placeholder="Search notes" size="sm" value={noteQuery} onChange={setNoteQuery} className="tf-rec__search" />
        <span className="tf-rec__muted tf-num">{q ? `${notes.length} of ${all.length}` : all.length} {all.length === 1 ? 'note' : 'notes'}</span>
        <span className="tf-rec__spacer" />
        <Button variant="primary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setPicking(true)}>New note</Button>
      </div>}
      {all.length > 0 && notes.length === 0 ? <NoResults size="sm" query={noteQuery} noun="notes" onClearFilters={() => setNoteQuery('')} /> : null}
      {all.length === 0 ? <EmptyState icon={<NotebookPen size={20} strokeWidth={1.75} />} title="No notes yet" description="Notes sit on a person, company or deal." action={<Button size="sm" variant="primary" onPress={() => setPicking(true)}>New note</Button>} />
        : notes.length === 0 ? null : <NoteList notes={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, author: n.author, updated: n.record ? `${ago(n.updated)} · ${recordName(state, n.record).name}` : ago(n.updated) }))} onOpen={setOpenId} isHeadless />}
      {picking && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setPicking(false); }} title="New note"
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => {
            const [o = '', i = ''] = rec.split(':');
            const tpl = NOTE_TEMPLATES.find((x) => x.id === template);
            const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, ...(rec ? { record: { object: o, id: i } } : {}), updated: new Date(), ...(tpl ? noteFromTemplate(tpl) : {}) };
            dispatch({ type: 'note/set', note: n }); setPicking(false); setOpenId(n.id);
          }}>Start writing</Button></>}>
          <ChoiceChips label="Start from" selectionMode="single" size="sm" selectedKeys={[template]} onSelectionChange={(k) => setTemplate([...k][0] ?? 'blank')}
            items={[{ id: 'blank', label: 'Blank' }, ...NOTE_TEMPLATES.map((t) => ({ id: t.id, label: t.label }))]} />
          <Select label="On a record" searchable value={rec || null} onChange={(v) => setRec(v ?? '')} placeholder="None" description="Optional. The note shows on that record too."
            items={[...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, icon: <UserRound size={16} strokeWidth={1.75} aria-label="Person" /> })), ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, icon: <Building2 size={16} strokeWidth={1.75} aria-label="Company" /> })), ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, icon: <CircleDollarSign size={16} strokeWidth={1.75} aria-label="Deal" /> })),
              ...state.objects.filter((x) => x.custom && !x.archived).flatMap((x) => (state.customRecords[x.id] ?? []).map((r) => ({ id: `${x.id}:${r.id}`, label: r.name, icon: <Boxes size={16} strokeWidth={1.75} aria-label={x.one} /> })))]} />
        </Dialog>
      )}
    </div>
  );
}

/** Every record as a picker item ("people:p-liam"), with what it is beside it: people, companies, deals and owner-made objects' records. */
export function allRecordItems(state: AppState): ReadonlyArray<{ readonly id: string; readonly label: string; readonly description: string }> {
  return [...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, description: 'Person' })), ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, description: 'Company' })), ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, description: 'Deal' })),
    ...state.objects.filter((o) => o.custom && !o.archived).flatMap((o) => (state.customRecords[o.id] ?? []).map((r) => ({ id: `${o.id}:${r.id}`, label: r.name, description: o.one })))];
}
