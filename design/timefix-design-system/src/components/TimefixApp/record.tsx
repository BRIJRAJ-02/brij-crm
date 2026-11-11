// A record's full page: a header, then the work on it in tabs (Overview, Activity, Notes, Tasks, Comments), with its details down the side.
// Log a call or meeting in two clicks; every change has Undo.
import { useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Link2, ListPlus, Mail, Phone, Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { Select } from '../Select/Select.tsx';
import { TaskDialog } from './you.tsx';
import { customColumns, canEditRecords } from './records.tsx';
import { copyText } from '../../lib/copy.ts';
import { RecordHeader } from '../RecordHeader/RecordHeader.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { AttributeRow, RecordSection } from '../RecordPanel/RecordPanel.tsx';
import { ActivityFeed, type ActivityEvent } from '../ActivityFeed/ActivityFeed.tsx';
import { TaskList } from '../TaskList/TaskList.tsx';
import { NoteList, NotePage } from '../NoteList/NoteList.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { CommentThread } from '../CommentThread/CommentThread.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import type { BookedMeeting } from '../BookingsFlow/state.ts';
import { formatDay } from '../../lib/format.ts';
import { STAGES, dayFrom, inr, isEmptyNote, newId, recordName, ymdOf, type AppAction, type AppState, type ObjectId, type Stage } from './data.ts';

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
  /** Where Back goes, said on the button ("Back to Inbox"); plain "Back" when it returns to another record. */
  readonly backLabel?: string;
  /** The tab it opens on ("comments" when a mention brought you here). */
  readonly initialTab?: string;
  /** Every booking in the workspace; the ones with this person (by email, else name) or this company's people show as Meetings. */
  readonly meetings?: ReadonlyArray<BookedMeeting>;
  /** Opens one in Bookings. */
  readonly onMeeting?: (id: string) => void;
}

/** One record, full page. */
export function RecordPage({ state, dispatch, object, id, onBack, onOpen, backLabel, initialTab, meetings: allMeetings = [], onMeeting }: RecordPageProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState(initialTab ?? 'overview');
  const [logging, setLogging] = useState(false);
  const [noteId, setNoteId] = useState<string>();
  const [emailing, setEmailing] = useState(false);
  const [listing, setListing] = useState(false);
  const [taskOpen, setTaskOpen] = useState<string | 'new'>();
  /** Each thread's latest replies, so undoing a resolve never drops a reply written after it. */
  const latestReplies = useRef(new Map<string, ReadonlyArray<{ readonly id: string; readonly author: string; readonly body: string; readonly at: Date }>>());
  state.comments.forEach((c) => latestReplies.current.set(c.id, c.replies));
  const link = { object, id };
  const same = (r: { readonly object: ObjectId; readonly id: string } | undefined) => r?.object === object && r.id === id;
  const { name, sub } = recordName(state, link);
  const tasks = state.tasks.filter((t) => same(t.record) || (t.also ?? []).some((r) => same(r)));
  const notes = state.notes.filter((n) => same(n.record));
  const comments = state.comments.filter((c) => same(c.record));
  const activity = state.activity.filter((a) => same(a.record));
  const files = state.files.filter((f) => same(f.record));
  const openNote = notes.find((n) => n.id === noteId);
  const people = state.members.map((m) => m.name);
  const deal = object === 'deals' ? state.deals.find((d) => d.id === id) : undefined;
  const person = object === 'people' ? state.people.find((p) => p.id === id) : undefined;
  const company = object === 'companies' ? state.companies.find((c) => c.id === id) : object === 'people' ? state.companies.find((c) => c.id === person?.companyId) : state.companies.find((c) => c.id === deal?.companyId);
  const current = (object === 'people' ? person : object === 'companies' ? state.companies.find((c) => c.id === id) : deal) as (Readonly<Record<string, unknown>> & { readonly owner: string }) | undefined;
  const lists = state.lists.filter((l) => l.object === object && l.entries.some((e) => e.recordId === id));
  /** One field on this record. Saves on change, says so, and Undo puts back only this field. */
  const fieldRow = (attribute: Attribute, key: string, value: unknown, toValue: (v: unknown) => unknown = (v) => String(v ?? '')) => (
    <AttributeRow key={attribute.id} attribute={attribute} value={value as never} onChange={(v) => {
      if (!canEdit) { toast({ message: `You’re previewing as a ${state.previewRole?.toLowerCase()}: you can’t change this.` }); return; }
      const was = current?.[key]; const next = toValue(v); if (String(next) === String(was)) return;
      dispatch({ type: 'records/fields', object, changes: [{ id, patch: { [key]: next } }] });
      toast({ message: `${attribute.name} saved`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { [key]: was } }] }) } });
    }} />
  );
  const canEdit = canEditRecords(state);
  if (!current) {
    const binned = state.trash.find((t) => t.record.id === id);
    const into = binned?.mergedInto ? recordName(state, { object, id: binned.mergedInto }) : undefined;
    return <div className="tf-rec__gone"><p>{binned && into ? `${binned.record.name} was merged into ${into.name}.` : binned ? `${binned.record.name} is in Trash. ${binned.by} deleted it.` : 'This record was deleted for good.'}</p>
      {binned?.mergedInto && <Button variant="primary" onPress={() => { if (binned.mergedInto) onOpen(object, binned.mergedInto); }}>Open {into?.name}</Button>}
      <span className="tf-set__row">{binned && !binned.mergedInto && <Button variant="primary" onPress={() => { dispatch({ type: 'trash/restore', id: binned.id }); toast({ message: `${binned.record.name} restored`, tone: 'success' }); }}>Restore</Button>}
        <Button variant="secondary" onPress={onBack}>{backLabel ? `Back to ${backLabel}` : 'Back'}</Button></span></div>;
  }
  const events: ReadonlyArray<ActivityEvent> = [
    ...activity.map((a): ActivityEvent => (a.kind === 'created' ? { id: a.id, at: a.at, actor: a.actor, kind: 'created', object: object.slice(0, -1) }
      : a.kind === 'call' || a.kind === 'meeting' || a.kind === 'note' ? { id: a.id, at: a.at, actor: a.actor, kind: 'note', title: a.kind === 'call' ? `Call · ${a.text}` : a.kind === 'meeting' ? `Meeting · ${a.text}` : a.text } : { id: a.id, at: a.at, actor: a.actor, kind: 'comment', body: a.text })),
    ...notes.map((n): ActivityEvent => ({ id: `ev-${n.id}`, at: n.updated, actor: n.author, kind: 'note', title: n.title })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const stageAttr: Attribute = { id: 'stage', name: 'Stage', type: 'status', options: STAGES.map((x) => ({ id: x, label: x, hue: x === 'Won' ? 'green' : x === 'Lost' ? 'red' : x === 'Proposal' ? 'purple' : x === 'Qualified' ? 'blue' : 'gray' })) };
  const details = (
    <aside className="tf-recp__side" aria-label="Details">
      {person && <>
        {fieldRow({ id: 'email', name: 'Email', type: 'email' }, 'email', person.email)}
        {fieldRow({ id: 'phone', name: 'Phone', type: 'phone' }, 'phone', person.phone)}
        {fieldRow({ id: 'title', name: 'Job title', type: 'text' }, 'title', person.title)}
        {fieldRow({ id: 'tags', name: 'Tags', type: 'multiSelect', options: ['Decision maker', 'Champion', 'Technical', 'Budget', 'Partner'].map((x) => ({ id: x, label: x, hue: 'gray' as const })) }, 'tags', person.tags, (v) => (Array.isArray(v) ? v.map(String) : []))}
        {fieldRow({ id: 'company', name: 'Company', type: 'select', options: state.companies.map((c) => ({ id: c.id, label: c.name, hue: 'gray' as const })) }, 'companyId', person.companyId, (v) => (v ? String(v) : undefined))}
      </>}
      {deal && <>
        {fieldRow({ id: 'amount', name: 'Amount', type: 'currency', currency: 'INR' }, 'amount', deal.amount, (v) => Number(v) || 0)}
        {fieldRow({ id: 'close', name: 'Close date', type: 'date' }, 'close', ymdOf(deal.close), (v) => (typeof v === 'string' ? dayFrom(v) ?? deal.close : deal.close))}
        {fieldRow({ id: 'company', name: 'Company', type: 'select', options: state.companies.map((c) => ({ id: c.id, label: c.name, hue: 'gray' as const })) }, 'companyId', deal.companyId, (v) => String(v || deal.companyId))}
      </>}
      {company && object === 'companies' && <>
        {fieldRow({ id: 'domain', name: 'Domain', type: 'domain' }, 'domain', company.domain)}
        {fieldRow({ id: 'industry', name: 'Industry', type: 'select', options: (['Software', 'Fintech', 'Healthcare', 'Manufacturing', 'Logistics', 'Retail'] as const).map((x, n) => ({ id: x, label: x, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'yellow'] as const)[n] ?? 'gray' })) }, 'industry', company.industry)}
        {fieldRow({ id: 'city', name: 'City', type: 'text' }, 'city', company.city)}
      </>}
      {current && fieldRow({ id: 'owner', name: 'Owner', type: 'actor', candidates: state.members.map((m) => ({ id: m.name, name: m.name })) }, 'owner', { id: current.owner, name: current.owner }, (v) => (typeof v === 'object' && v !== null && 'name' in v ? String((v as { name: string }).name) : String(v ?? '')))}
      {(state.objects.find((o) => o.id === object)?.attributes ?? []).filter((a) => customColumns(state, object).some((c) => c.id === a.id)).map((a) => (
        <AttributeRow key={a.id} attribute={a} value={(current.extra as Readonly<Record<string, string>> | undefined)?.[a.id]} onChange={(v) => {
          if (!canEdit) return;
          const was = (current.extra as Readonly<Record<string, string>> | undefined)?.[a.id] ?? '';
          dispatch({ type: 'records/fields', object, changes: [{ id, patch: { extra: { [a.id]: Array.isArray(v) ? v.join(', ') : String(v ?? '') } } }] });
          toast({ message: `${a.name} saved`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { extra: { [a.id]: was } } }] }) } });
        }} />
      ))}
      <RecordSection title="Lists" count={lists.length}>
        {lists.map((l) => <span key={l.id} className="tf-rec__rel tf-rec__rel--static">{l.name}<span className="tf-rec__muted">{l.entries.find((e) => e.recordId === id)?.stage}</span></span>)}
        {canEdit && <Button size="sm" variant="ghost" icon={<ListPlus {...i14} />} onPress={() => setListing(true)}>Add to a list</Button>}
      </RecordSection>
      {company && object !== 'companies' && <RecordSection title="Company" count={1}><button type="button" className="tf-rec__rel" onClick={() => onOpen('companies', company.id)}><Avatar name={company.name} size={20} shape="square" />{company.name}</button></RecordSection>}
      {object === 'companies' && <RecordSection title="People" count={state.people.filter((p) => p.companyId === id).length}>{state.people.filter((p) => p.companyId === id).map((p) => <button key={p.id} type="button" className="tf-rec__rel" onClick={() => onOpen('people', p.id)}><Avatar name={p.name} size={20} />{p.name}</button>)}</RecordSection>}
      {(() => {
        // Meetings with them: this person's (or the deal contact's, or the company's people's) bookings, upcoming first, then the last three.
        const who = object === 'people' ? (person ? [person] : []) : object === 'deals' ? state.people.filter((p) => p.id === deal?.contactId) : state.people.filter((p) => p.companyId === id);
        const mails = new Set(who.map((p) => p.email.toLowerCase())); const names = new Set(who.map((p) => p.name.toLowerCase()));
        const domain = object === 'companies' ? (company?.domain ?? '').toLowerCase() : '';
        const theirs = allMeetings.filter((m) => m.status !== 'cancelled' && (mails.has(m.invitee.email.toLowerCase()) || names.has(m.invitee.name.toLowerCase()) || (domain !== '' && m.invitee.email.toLowerCase().endsWith(`@${domain}`))));
        if (theirs.length === 0) return null;
        const now = new Date();
        const next = theirs.filter((m) => m.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
        const past = theirs.filter((m) => m.end <= now).sort((a, b) => b.start.getTime() - a.start.getTime()).slice(0, 3);
        const line = (m: BookedMeeting) => (
          <button key={m.id} type="button" className="tf-rec__rel tf-rec__rel--meeting" onClick={() => onMeeting?.(m.id)} disabled={!onMeeting}>
            <CalendarDays size={14} strokeWidth={1.75} aria-hidden /><span className="tf-rec__relname">{m.title}{object !== 'people' ? <span className="tf-rec__muted"> · {m.invitee.name}</span> : null}</span>
            <span className="tf-rec__muted tf-num">{m.status === 'no-show' ? 'No-show' : m.status === 'pending' ? 'Asked' : formatDay(m.start)}</span>
          </button>
        );
        return <RecordSection title="Meetings" count={theirs.length}>{next.map(line)}{past.length > 0 && next.length > 0 && <span className="tf-rec__subhead">Earlier</span>}{past.map(line)}</RecordSection>;
      })()}
      {object !== 'deals' && <RecordSection title="Deals" count={state.deals.filter((d) => (object === 'people' ? d.contactId === id : d.companyId === id)).length}>
        {state.deals.filter((d) => (object === 'people' ? d.contactId === id : d.companyId === id)).map((d) => <button key={d.id} type="button" className="tf-rec__rel" onClick={() => onOpen('deals', d.id)}>{d.name}<span className="tf-rec__muted tf-num">{inr(d.amount)}</span></button>)}
      </RecordSection>}
    </aside>
  );
  return (
    <div className="tf-recp">
      <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>{backLabel ? `Back to ${backLabel}` : 'Back'}</Button>
      <RecordHeader name={name} kind={object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal'} sub={sub}
        tags={person?.tags.map((t) => ({ label: t })) ?? []}
        onRename={canEdit ? (n) => { const was = name; if (!n.trim() || n.trim() === was) return; dispatch({ type: 'records/fields', object, changes: [{ id, patch: { name: n.trim() } }] }); toast({ message: 'Renamed', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { name: was } }] }) } }); } : undefined}
        onEmail={person?.email ? () => setEmailing(true) : undefined}
        moreActions={<>
          <MenuItem id="copy" icon={<Link2 size={16} strokeWidth={1.75} />}>Copy link</MenuItem>
          {canEdit ? <MenuItem id="list" icon={<ListPlus size={16} strokeWidth={1.75} />}>Add to a list</MenuItem> : null}
          {canEdit ? <MenuSeparator /> : null}
          {canEdit ? <MenuItem id="delete" icon={<Trash2 size={16} strokeWidth={1.75} />} isDanger>Delete</MenuItem> : null}
        </>}
        onMoreAction={(k) => {
          if (k === 'copy') { const url = `https://timefix.com/${state.prefs.workspace.slug}/${object}/${id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }
          else if (k === 'list') setListing(true);
          else if (k === 'delete') { dispatch({ type: 'records/remove', object, ids: [id] }); onBack(); toast({ message: `${name} moved to Trash`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/untrash', ids: [id] }) } }); }
        }}
        stage={deal ? { attribute: stageAttr, value: deal.stage, onChange: (v) => { if (!canEdit) return; const was = deal.stage; dispatch({ type: 'records/fields', object: 'deals', changes: [{ id, patch: { stage: String(v) as Stage } }] }); toast({ message: `Moved to ${String(v)}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object: 'deals', changes: [{ id, patch: { stage: was } }] }) } }); } } : undefined} />
      <div className="tf-recp__body">
        <div className="tf-recp__main">
          <Tabs aria-label="Record" selectedKey={tab} onSelectionChange={setTab}
            items={[{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity', count: events.length }, { id: 'notes', label: 'Notes', count: notes.length }, { id: 'tasks', label: 'Tasks', count: tasks.filter((t) => !t.done).length }, { id: 'comments', label: 'Comments', count: comments.length }, { id: 'files', label: 'Files', count: files.length }]}>
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
              {openNote ? (
                <NotePage note={{ id: openNote.id, title: openNote.title, body: openNote.body, doc: openNote.doc, author: openNote.author, updated: ago(openNote.updated) }} people={state.members.map((m) => ({ id: m.id, name: m.name }))}
                  onBack={(l) => { setNoteId(undefined); if (isEmptyNote(l.title, l.body)) dispatch({ type: 'note/remove', id: openNote.id }); }}
                  onDelete={() => { const n = openNote; setNoteId(undefined); dispatch({ type: 'note/remove', id: n.id }); toast({ message: 'Note deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'note/set', note: n }) } }); }}
                  onSave={(n) => dispatch({ type: 'note/set', note: { ...openNote, title: n.title, body: n.body, doc: n.doc, updated: new Date() } })} />
              ) : (
                <NoteList notes={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, author: n.author, updated: ago(n.updated) }))}
                  onNew={() => { const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, record: link, updated: new Date() }; dispatch({ type: 'note/set', note: n }); setNoteId(n.id); }}
                  onOpen={setNoteId} />
              )}
            </TabPanel>
            <TabPanel id="tasks" className="tf-recp__panel">
              <div className="tf-recp__quick"><Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setTaskOpen('new')}>New task with a date</Button></div>
              <TaskList tasks={tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, assignee: t.assignee }))} onOpen={(tid) => setTaskOpen(tid)}
                onToggle={(tid, done) => { const t = state.tasks.find((x) => x.id === tid); if (!t) return; dispatch({ type: 'task/set', task: { ...t, done } }); toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); }}
                onAdd={(title) => dispatch({ type: 'task/set', task: { id: newId('t'), title, done: false, assignee: state.me, record: link, created: new Date() } })} />
            </TabPanel>
            <TabPanel id="files" className="tf-recp__panel">
              <FileDrop label="Drop files here" description="PDF, images, documents · up to 25 MB each" onFiles={(list) => {
                const bad = list.filter((f) => /\.(exe|bat|cmd|sh|js)$/i.test(f.name) || f.size > 25_000_000);
                list.filter((f) => !bad.includes(f)).forEach((f) => dispatch({ type: 'file/set', file: { id: newId('fl'), record: link, name: f.name, size: f.size, type: f.type, at: new Date(), by: state.me, blob: f } }));
                if (bad.length) toast({ message: `${bad.map((f) => f.name).join(', ')} can't be added: programs and files over 25 MB aren't allowed.` });
                else toast({ message: `${list.length} ${list.length === 1 ? 'file' : 'files'} added`, tone: 'success' });
              }} />
              {files.length === 0 ? <p className="tf-rec__muted">No files yet.</p> : (
                <ul className="tf-set__list">{files.map((f) => (
                  <li key={f.id}><span><strong>{f.name}</strong> <span className="tf-rec__muted tf-num">{f.size > 1_000_000 ? `${(f.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1000))} KB`} · {f.by} · {ago(f.at)}</span></span>
                    <span className="tf-set__row">
                      <Button size="sm" variant="ghost" onPress={() => { void saveFile(f.name, f.blob ?? new Blob([`${f.name}: a sample file in the prototype`], { type: 'text/plain' })).then((o) => { if (o === 'saved') toast({ message: 'Downloaded', tone: 'success' }); }); }}>Download</Button>
                      <Button size="sm" variant="ghost" onPress={() => { dispatch({ type: 'file/remove', id: f.id }); toast({ message: `${f.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'file/set', file: f }) } }); }}>Delete</Button>
                    </span></li>
                ))}</ul>
              )}
            </TabPanel>
            <TabPanel id="comments" className="tf-recp__panel">
              <CommentThread me={state.me} people={people}
                comments={comments.flatMap((c) => [{ id: c.id, author: c.author, time: ago(c.at), body: c.body, resolved: c.resolved, reactions: state.reactions[c.id] }, ...c.replies.map((r) => ({ id: r.id, author: r.author, time: ago(r.at), body: r.body, replyTo: c.author, reactions: state.reactions[r.id] }))])}
                onResolve={(cid, resolved) => { const c = comments.find((x) => x.id === cid); if (!c) return; dispatch({ type: 'comment/set', comment: { ...c, resolved } }); toast({ message: resolved ? 'Thread resolved' : 'Thread reopened', action: { label: 'Undo', onAction: () => { const now = state.comments.find((x) => x.id === cid) ?? c; dispatch({ type: 'comment/set', comment: { ...now, replies: latestReplies.current.get(cid) ?? now.replies, resolved: !resolved } }); } } }); }}
                onReact={(cid, kind) => dispatch({ type: 'reaction/toggle', id: cid, kind })}
                onSend={(body, _replyTo, replyId) => new Promise<void>((resolve) => {
                  // A reply files under its thread, whether they answered the first comment or a reply in it.
                  const parent = comments.find((c) => c.id === replyId || c.replies.some((r) => r.id === replyId));
                  if (parent) dispatch({ type: 'comment/set', comment: { ...parent, replies: [...parent.replies, { id: newId('cr'), author: state.me, body, at: new Date() }] } });
                  else dispatch({ type: 'comment/set', comment: { id: newId('cm'), record: link, author: state.me, body, at: new Date(), resolved: false, replies: [] } });
                  resolve();
                })} />
            </TabPanel>
          </Tabs>
        </div>
        {details}
      </div>
      {emailing && person && <EmailDialog to={person.email} name={person.name} onClose={() => setEmailing(false)} onSend={(subject) => {
        dispatch({ type: 'activity/add', activity: { id: newId('a'), record: link, kind: 'email', actor: state.me, text: `emailed “${subject}”`, at: new Date() } });
        setEmailing(false); toast({ message: `Sent to ${person.email} from your connected mailbox. It’s on the timeline.`, tone: 'success' });
      }} />}
      {listing && <AddToList state={state} object={object} id={id} onClose={() => setListing(false)} onAdd={(lid) => {
        const l = state.lists.find((x) => x.id === lid); if (!l) return;
        const e = { id: newId('e'), recordId: id, stage: l.stages[0] ?? '', priority: 'Medium' as const, next: '', added: new Date() };
        dispatch({ type: 'list/entries', id: l.id, add: [e] }); setListing(false);
        toast({ message: `Added to ${l.name}`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/entries', id: l.id, remove: [e.id] }) } });
      }} />}
      {taskOpen && <TaskDialog state={state} record={link} task={taskOpen === 'new' ? undefined : state.tasks.find((t) => t.id === taskOpen)} onClose={() => setTaskOpen(undefined)}
        onSave={(t) => { dispatch({ type: 'task/set', task: t }); setTaskOpen(undefined); toast({ message: taskOpen === 'new' ? 'Task added' : 'Task saved', tone: 'success' }); }}
        onDelete={taskOpen !== 'new' ? () => { const t = state.tasks.find((x) => x.id === taskOpen); if (!t) return; dispatch({ type: 'task/remove', id: t.id }); setTaskOpen(undefined); toast({ message: 'Task deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); } : undefined} />}
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

/** Write to a person from their record. It sends from the connected mailbox and lands on the timeline. */
function EmailDialog({ to, name, onClose, onSend }: { readonly to: string; readonly name: string; readonly onClose: () => void; readonly onSend: (subject: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(`Hi ${name.split(' ')[0]},\n\n`);
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title={`Email ${name}`} description={`To ${to}, from your connected mailbox.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" icon={<Mail size={14} strokeWidth={1.75} />} isDisabled={!subject.trim() || !body.trim()} onPress={() => onSend(subject.trim())}>Send</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Subject" value={subject} onChange={setSubject} autoFocus />
        <TextArea label="Message" rows={6} value={body} onChange={setBody} />
      </div>
    </Dialog>
  );
}

/** Put this record on one of the lists made for its kind. */
function AddToList({ state, object, id, onClose, onAdd }: { readonly state: AppState; readonly object: ObjectId; readonly id: string; readonly onClose: () => void; readonly onAdd: (listId: string) => void }) {
  const open = state.lists.filter((l) => l.object === object && !l.archived && !(l.oncePerRecord && l.entries.some((e) => e.recordId === id)));
  const [pick, setPick] = useState(open[0]?.id ?? '');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Add to a list"
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!pick} onPress={() => onAdd(pick)}>Add</Button></>}>
      {open.length === 0 ? <p className="tf-rec__muted">It’s already on every list for {object}. Make a new list from the sidebar.</p>
        : <Select label="List" value={pick} onChange={(v) => setPick(v ?? '')} items={open.map((l) => ({ id: l.id, label: l.name, description: `${l.entries.length} on it` }))} />}
    </Dialog>
  );
}
