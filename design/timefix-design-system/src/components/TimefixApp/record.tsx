// A record's full page: a header, then the work on it in tabs (Overview, Activity, Notes, Tasks, Comments), with its details down the side.
// Log a call or meeting in two clicks; every change has Undo.
import { useState } from 'react';
import { ArrowLeft, Phone, Users as UsersIcon } from 'lucide-react';
import { RecordHeader } from '../RecordHeader/RecordHeader.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { AttributeRow, RecordSection } from '../RecordPanel/RecordPanel.tsx';
import { ActivityFeed, type ActivityEvent } from '../ActivityFeed/ActivityFeed.tsx';
import { TaskList } from '../TaskList/TaskList.tsx';
import { NoteList } from '../NoteList/NoteList.tsx';
import { CommentThread } from '../CommentThread/CommentThread.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import { STAGES, inr, newId, recordName, type AppAction, type AppState, type ObjectId, type Stage } from './data.ts';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

/** Props for RecordPage. */
export interface RecordPageProps {
  readonly state: AppState;
  readonly dispatch: (a: AppAction) => void;
  readonly object: ObjectId;
  readonly id: string;
  readonly onBack: () => void;
  readonly onOpen: (object: ObjectId, id: string) => void;
}

/** One record, full page. */
export function RecordPage({ state, dispatch, object, id, onBack, onOpen }: RecordPageProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState('overview');
  const [logging, setLogging] = useState(false);
  const link = { object, id };
  const same = (r: { readonly object: ObjectId; readonly id: string } | undefined) => r?.object === object && r.id === id;
  const { name, sub } = recordName(state, link);
  const tasks = state.tasks.filter((t) => same(t.record));
  const notes = state.notes.filter((n) => same(n.record));
  const comments = state.comments.filter((c) => same(c.record));
  const activity = state.activity.filter((a) => same(a.record));
  const people = state.members.map((m) => m.name);
  const deal = object === 'deals' ? state.deals.find((d) => d.id === id) : undefined;
  const person = object === 'people' ? state.people.find((p) => p.id === id) : undefined;
  const company = object === 'companies' ? state.companies.find((c) => c.id === id) : object === 'people' ? state.companies.find((c) => c.id === person?.companyId) : state.companies.find((c) => c.id === deal?.companyId);
  if (name.startsWith('Deleted')) return <div className="tf-rec__gone"><p>This record was deleted.</p><Button variant="secondary" onPress={onBack}>Back</Button></div>;
  const events: ReadonlyArray<ActivityEvent> = [
    ...activity.map((a): ActivityEvent => (a.kind === 'created' ? { id: a.id, at: a.at, actor: a.actor, kind: 'created', object: object.slice(0, -1) }
      : a.kind === 'call' || a.kind === 'meeting' || a.kind === 'note' ? { id: a.id, at: a.at, actor: a.actor, kind: 'note', title: a.kind === 'call' ? `Call · ${a.text}` : a.kind === 'meeting' ? `Meeting · ${a.text}` : a.text } : { id: a.id, at: a.at, actor: a.actor, kind: 'comment', body: a.text })),
    ...notes.map((n): ActivityEvent => ({ id: `ev-${n.id}`, at: n.updated, actor: n.author, kind: 'note', title: n.title })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const stageAttr: Attribute = { id: 'stage', name: 'Stage', type: 'status', options: STAGES.map((x) => ({ id: x, label: x, hue: x === 'Won' ? 'green' : x === 'Lost' ? 'red' : x === 'Proposal' ? 'purple' : x === 'Qualified' ? 'blue' : 'gray' })) };
  const details = (
    <aside className="tf-recp__side" aria-label="Details">
      {person && <>
        <AttributeRow attribute={{ id: 'email', name: 'Email', type: 'email' }} value={person.email} onChange={(v) => dispatch({ type: 'person/set', person: { ...person, email: String(v ?? '') } })} />
        <AttributeRow attribute={{ id: 'phone', name: 'Phone', type: 'phone' }} value={person.phone} onChange={(v) => dispatch({ type: 'person/set', person: { ...person, phone: String(v ?? '') } })} />
        <AttributeRow attribute={{ id: 'title', name: 'Job title', type: 'text' }} value={person.title} onChange={(v) => dispatch({ type: 'person/set', person: { ...person, title: String(v ?? '') } })} />
        <AttributeRow attribute={{ id: 'tags', name: 'Tags', type: 'multiSelect', options: ['Decision maker', 'Champion', 'Technical', 'Budget', 'Partner'].map((x) => ({ id: x, label: x, hue: 'gray' as const })) }} value={person.tags} onChange={(v) => dispatch({ type: 'person/set', person: { ...person, tags: Array.isArray(v) ? v.map(String) : [] } })} />
      </>}
      {deal && <>
        <AttributeRow attribute={{ id: 'amount', name: 'Amount', type: 'currency', currency: 'INR' }} value={deal.amount} onChange={(v) => dispatch({ type: 'deal/set', deal: { ...deal, amount: Number(v) || 0 } })} />
        <AttributeRow attribute={{ id: 'close', name: 'Close date', type: 'date' }} value={deal.close.toISOString().slice(0, 10)} onChange={(v) => { if (typeof v === 'string') dispatch({ type: 'deal/set', deal: { ...deal, close: new Date(v) } }); }} />
      </>}
      {company && object === 'companies' && <>
        <AttributeRow attribute={{ id: 'domain', name: 'Domain', type: 'domain' }} value={company.domain} onChange={(v) => dispatch({ type: 'company/set', company: { ...company, domain: String(v ?? '') } })} />
        <AttributeRow attribute={{ id: 'industry', name: 'Industry', type: 'text' }} value={company.industry} onChange={(v) => dispatch({ type: 'company/set', company: { ...company, industry: String(v ?? '') } })} />
        <AttributeRow attribute={{ id: 'city', name: 'City', type: 'text' }} value={company.city} onChange={(v) => dispatch({ type: 'company/set', company: { ...company, city: String(v ?? '') } })} />
      </>}
      {company && object !== 'companies' && <RecordSection title="Company" count={1}><button type="button" className="tf-rec__rel" onClick={() => onOpen('companies', company.id)}><Avatar name={company.name} size={20} shape="square" />{company.name}</button></RecordSection>}
      {object === 'companies' && <RecordSection title="People" count={state.people.filter((p) => p.companyId === id).length}>{state.people.filter((p) => p.companyId === id).map((p) => <button key={p.id} type="button" className="tf-rec__rel" onClick={() => onOpen('people', p.id)}><Avatar name={p.name} size={20} />{p.name}</button>)}</RecordSection>}
      {object !== 'deals' && <RecordSection title="Deals" count={state.deals.filter((d) => (object === 'people' ? d.contactId === id : d.companyId === id)).length}>
        {state.deals.filter((d) => (object === 'people' ? d.contactId === id : d.companyId === id)).map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<span className="tf-rec__muted tf-num">{inr(d.amount)}</span></button>)}
      </RecordSection>}
    </aside>
  );
  return (
    <div className="tf-recp">
      <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>Back</Button>
      <RecordHeader name={name} kind={object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal'} sub={sub}
        tags={person?.tags.map((t) => ({ label: t })) ?? []}
        onRename={(n) => { if (person) dispatch({ type: 'person/set', person: { ...person, name: n } }); else if (deal) dispatch({ type: 'deal/set', deal: { ...deal, name: n } }); else if (company) dispatch({ type: 'company/set', company: { ...company, name: n } }); }}
        onEmail={person ? () => toast({ message: `Writing to ${person.email}…` }) : undefined}
        stage={deal ? { attribute: stageAttr, value: deal.stage, onChange: (v) => { const before = deal; dispatch({ type: 'deal/set', deal: { ...deal, stage: String(v) as Stage } }); toast({ message: `Moved to ${String(v)}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'deal/set', deal: before }) } }); } } : undefined} />
      <div className="tf-recp__body">
        <div className="tf-recp__main">
          <Tabs aria-label="Record" selectedKey={tab} onSelectionChange={setTab}
            items={[{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity', count: events.length }, { id: 'notes', label: 'Notes', count: notes.length }, { id: 'tasks', label: 'Tasks', count: tasks.filter((t) => !t.done).length }, { id: 'comments', label: 'Comments', count: comments.length }]}>
            <TabPanel id="overview" className="tf-recp__panel">
              <div className="tf-recp__quick">
                <Button variant="secondary" icon={<Phone {...i14} />} onPress={() => setLogging(true)}>Log a call or meeting</Button>
                <Button variant="ghost" onPress={() => setTab('notes')}>Add a note</Button>
                <Button variant="ghost" onPress={() => setTab('tasks')}>Add a task</Button>
              </div>
              <section className="tf-recp__sec"><h3>Open tasks</h3>
                {tasks.filter((t) => !t.done).length === 0 ? <p className="tf-rec__muted">Nothing open.</p>
                  : <ul className="tf-recp__mini">{tasks.filter((t) => !t.done).map((t) => <li key={t.id}>{t.title}<span className="tf-rec__muted">{t.due ? t.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date'} · {t.assignee}</span></li>)}</ul>}
              </section>
              <section className="tf-recp__sec"><h3>Latest</h3>
                {events.length === 0 ? <p className="tf-rec__muted">Nothing yet.</p> : <ActivityFeed events={events.slice(0, 4)} />}
              </section>
            </TabPanel>
            <TabPanel id="activity" className="tf-recp__panel">{events.length === 0 ? <p className="tf-rec__muted">Nothing yet.</p> : <ActivityFeed events={events} />}</TabPanel>
            <TabPanel id="notes" className="tf-recp__panel">
              <NoteList notes={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, author: n.author, updated: ago(n.updated) }))}
                onNew={() => { const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, record: link, updated: new Date() }; dispatch({ type: 'note/set', note: n }); toast({ message: 'Note added' }); }}
                onOpen={() => toast({ message: 'Notes open full page in the Notes pass.' })} />
            </TabPanel>
            <TabPanel id="tasks" className="tf-recp__panel">
              <TaskList tasks={tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, assignee: t.assignee }))}
                onToggle={(tid, done) => { const t = state.tasks.find((x) => x.id === tid); if (!t) return; dispatch({ type: 'task/set', task: { ...t, done } }); toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); }}
                onAdd={(title) => dispatch({ type: 'task/set', task: { id: newId('t'), title, done: false, assignee: state.me, record: link, created: new Date() } })} />
            </TabPanel>
            <TabPanel id="comments" className="tf-recp__panel">
              <CommentThread me={state.me} people={people}
                comments={comments.flatMap((c) => [{ id: c.id, author: c.author, time: ago(c.at), body: c.body }, ...c.replies.map((r) => ({ id: r.id, author: r.author, time: ago(r.at), body: r.body, replyTo: c.id }))])}
                onReact={() => undefined}
                onSend={(body, replyTo) => new Promise<void>((resolve) => {
                  const parent = comments.find((c) => c.id === replyTo);
                  if (parent) dispatch({ type: 'comment/set', comment: { ...parent, replies: [...parent.replies, { id: newId('cr'), author: state.me, body, at: new Date() }] } });
                  else dispatch({ type: 'comment/set', comment: { id: newId('cm'), record: link, author: state.me, body, at: new Date(), resolved: false, replies: [] } });
                  resolve();
                })} />
            </TabPanel>
          </Tabs>
        </div>
        {details}
      </div>
      {logging && <LogActivity onClose={() => setLogging(false)} onLog={(kind, text) => {
        dispatch({ type: 'activity/add', activity: { id: newId('a'), record: link, kind, actor: state.me, text, at: new Date() } });
        setLogging(false); toast({ message: kind === 'call' ? 'Call logged' : 'Meeting logged', tone: 'success' }); setTab('activity');
      }} />}
    </div>
  );
}

function LogActivity({ onClose, onLog }: { readonly onClose: () => void; readonly onLog: (kind: 'call' | 'meeting', text: string) => void }) {
  const [kind, setKind] = useState<'call' | 'meeting'>('call');
  const [what, setWhat] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Log activity"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!what.trim()} onPress={() => onLog(kind, `${kind === 'call' ? 'called' : 'met'}: ${what.trim()}${notes.trim() ? `. ${notes.trim()}` : ''}`)}>Log {kind}</Button></>}>
      <div className="tf-rec__form">
        <SegmentedControl aria-label="Kind" selectedKey={kind} onSelectionChange={(k) => setKind(k === 'meeting' ? 'meeting' : 'call')} items={[{ id: 'call', label: 'Call', icon: <Phone {...i14} /> }, { id: 'meeting', label: 'Meeting', icon: <UsersIcon {...i14} /> }]} />
        <TextField label="What about" value={what} onChange={setWhat} autoFocus placeholder="Rollout plan" />
        <TextArea label="Notes" aside="Optional" rows={3} value={notes} onChange={setNotes} />
      </div>
    </Dialog>
  );
}
