// A record's full page, for any object: a header and a strip of facts (last activity, last contacted, next meeting, entered stage), a
// duplicate banner when one looks likely, then the work on it in tabs (Overview, Activity with a filter, Notes, Tasks, Comments, Files),
// with its details and related records down the side. Log a call or meeting with its time, length and outcome; every change has Undo.
import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, GitMerge, Link2, ListPlus, Mail, MoreHorizontal, Phone, Plus, Settings2, Trash2, Users as UsersIcon, X } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { MultiSelect, Select } from '../Select/Select.tsx';
import { TaskDialog } from './you.tsx';
import { canEditRecords } from './records.tsx';
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
import { Button, IconButton } from '../Button/Button.tsx';
import { ConfirmDialog, Dialog } from '../Dialog/Dialog.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { DatePicker } from '../DatePicker/DatePicker.tsx';
import { TimeSelect } from '../TimeField/TimeField.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { AttributeDialog } from '../AttributeSettings/AttributeSettings.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import type { BookedMeeting } from '../BookingsFlow/state.ts';
import { parseDate } from '@internationalized/date';
import { formatDay } from '../../lib/format.ts';
import { LOST_REASONS } from './deals.tsx';
import { MergeDialog, twinOf } from './duplicates.tsx';
import { NewRecordDialog, attributeOf, fieldValue } from './recordforms.tsx';
import { valueToCell } from '../DataGrid/DataGrid.tsx';
import { dayFrom, inr, isBuiltIn, isEmptyNote, newId, recordName, ymdOf, type Activity, type AnyRecord, type AppAction, type AppState, type ObjectId, type RecordLink, type Stage, LISTS_ON } from './data.ts';
import { STAGE_LOOK, blankCustom, isRequiredFor, linkedRecords, liveAttributes, outcomeOf, ownFields, patchFor, recordOf, recordsOf, relationsOf, schemaOf, stagesOf, valuesOf, wordsOf } from './model.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const dayWord = (d: Date | undefined) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

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
  /** Opens with the log dialog ("call" or "meeting") or a new note: ⌘K on an open record. */
  readonly startAction?: { readonly kind: 'call' | 'meeting' | 'note'; readonly n: number };
  /** Every booking in the workspace; the ones with this person (by email, else name) or this company's people show as Meetings. */
  readonly meetings?: ReadonlyArray<BookedMeeting>;
  /** Opens one in Bookings. */
  readonly onMeeting?: (id: string) => void;
  /** Settings › Objects for this object's attributes. */
  readonly onAttributes?: () => void;
  /** A trashed record opened from Trash: read only, with Restore. */
  readonly trashed?: boolean;
}

type Cat = 'changes' | 'notes' | 'calls' | 'tasks' | 'comments' | 'meetings' | 'other';
const CATS: ReadonlyArray<{ readonly id: Cat | 'all'; readonly label: string }> = [{ id: 'all', label: 'All' }, { id: 'changes', label: 'Changes' }, { id: 'notes', label: 'Notes' }, { id: 'calls', label: 'Calls' }, { id: 'tasks', label: 'Tasks' }, { id: 'comments', label: 'Comments' }, { id: 'meetings', label: 'Meetings' }];

/** One record, full page. */
export function RecordPage({ state, dispatch, object, id, onBack, onOpen, backLabel, initialTab, startAction, meetings: allMeetings = [], onMeeting, onAttributes, trashed = false }: RecordPageProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState(initialTab ?? (startAction?.kind === 'note' ? 'notes' : 'overview'));
  const [logging, setLogging] = useState<Activity | 'call' | 'meeting' | undefined>(startAction && startAction.kind !== 'note' ? startAction.kind : undefined);
  const [noteId, setNoteId] = useState<string>();
  const [emailing, setEmailing] = useState(false);
  const [listing, setListing] = useState(false);
  const [taskOpen, setTaskOpen] = useState<string | 'new'>();
  const [cat, setCat] = useState<Cat | 'all'>('all');
  const [merging, setMerging] = useState<readonly [AnyRecord, AnyRecord]>();
  const [deleting, setDeleting] = useState<string>();
  const [linking, setLinking] = useState<{ readonly via: string; readonly target: ObjectId; readonly title: string; readonly many: boolean }>();
  const [making, setMaking] = useState<{ readonly target: ObjectId; readonly via: string; readonly start: Readonly<Record<string, string>> }>();
  const [addingAttr, setAddingAttr] = useState(false);
  const startedNote = useRef(false);
  /** Each thread's latest replies, so undoing a resolve never drops a reply written after it. */
  const latestReplies = useRef(new Map<string, ReadonlyArray<{ readonly id: string; readonly author: string; readonly body: string; readonly at: Date }>>());
  state.comments.forEach((c) => latestReplies.current.set(c.id, c.replies));
  const link: RecordLink = { object, id };
  const same = (r: RecordLink | undefined) => r?.object === object && r.id === id;
  const { name, sub } = recordName(state, link);
  const w = wordsOf(state, object);
  const tasks = state.tasks.filter((t) => same(t.record) || (t.also ?? []).some((r) => same(r)));
  const notes = state.notes.filter((n) => same(n.record) || (n.also ?? []).some((r) => same(r)));
  const comments = state.comments.filter((c) => same(c.record));
  const activity = state.activity.filter((a) => same(a.record) || (a.also ?? []).some((r) => same(r)));
  const files = state.files.filter((f) => same(f.record));
  const openNote = notes.find((n) => n.id === noteId);
  const people = state.members.map((m) => m.name);
  const deal = object === 'deals' ? state.deals.find((d) => d.id === id) : undefined;
  const person = object === 'people' ? state.people.find((p) => p.id === id) : undefined;
  const company = object === 'companies' ? state.companies.find((c) => c.id === id) : object === 'people' ? state.companies.find((c) => c.id === person?.companyId) : state.companies.find((c) => c.id === deal?.companyId);
  const binnedItem = state.trash.find((t) => t.record.id === id);
  const current = (trashed ? binnedItem?.record : recordOf(state, object, id)) as (AnyRecord & Readonly<Record<string, unknown>>) | undefined;
  const lists = state.lists.filter((l) => l.object === object && l.entries.some((e) => e.recordId === id));
  const canEdit = canEditRecords(state) && !trashed;
  // ⌘K "New note" on an open record: one note, started once.
  if (startAction?.kind === 'note' && !startedNote.current && current && !trashed) {
    startedNote.current = true;
    const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, record: link, updated: new Date() };
    window.setTimeout(() => { dispatch({ type: 'note/set', note: n }); setNoteId(n.id); }, 0);
  }
  /** One field on this record. Saves on change, says so, and Undo puts back only this field. */
  const fieldRow = (attribute: Attribute, key: string, value: unknown, toValue: (v: unknown) => unknown = (v) => String(v ?? '')) => (
    <AttributeRow key={attribute.id} attribute={trashed ? { ...attribute, readOnlyReason: 'In Trash' } : attribute} value={value as never} onChange={(v) => {
      if (!canEdit) { toast({ message: trashed ? 'Restore it to make changes.' : `You’re previewing as a ${state.previewRole?.toLowerCase()}: you can’t change this.` }); return; }
      const was = current?.[key]; const next = toValue(v); if (String(next) === String(was)) return;
      dispatch({ type: 'records/fields', object, changes: [{ id, patch: { [key]: next } }] });
      toast({ message: `${attribute.name} saved`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { [key]: was } }] }) } });
    }} />
  );
  if (!current) {
    const into = binnedItem?.mergedInto ? recordName(state, { object, id: binnedItem.mergedInto }) : undefined;
    return <div className="tf-rec__gone"><p>{binnedItem && into ? `${binnedItem.record.name} was merged into ${into.name}.` : binnedItem ? `${binnedItem.record.name} is in Trash. ${binnedItem.by} deleted it.` : 'This record was deleted for good.'}</p>
      {binnedItem?.mergedInto && <Button variant="primary" onPress={() => { if (binnedItem.mergedInto) onOpen(object, binnedItem.mergedInto); }}>Open {into?.name}</Button>}
      <span className="tf-set__row">{binnedItem && !binnedItem.mergedInto && <Button variant="primary" onPress={() => { dispatch({ type: 'trash/restore', id: binnedItem.id }); toast({ message: `${binnedItem.record.name} restored`, tone: 'success' }); }}>Restore</Button>}
        <Button variant="secondary" onPress={onBack}>{backLabel ? `Back to ${backLabel}` : 'Back'}</Button></span></div>;
  }
  const values = trashed ? {} : valuesOf(state, object, current);
  const recName = (r: RecordLink) => recordName(state, r).name;

  // The timeline: changes, logged calls and meetings, notes, tasks, comments and bookings, newest first, each with its kind for the filter.
  const myMeetings = (() => {
    const who = object === 'people' ? (person ? [person] : []) : object === 'deals' ? state.people.filter((p) => p.id === deal?.contactId) : object === 'companies' ? state.people.filter((p) => p.companyId === id) : [];
    const mails = new Set(who.map((p) => p.email.toLowerCase())); const names = new Set(who.map((p) => p.name.toLowerCase()));
    const domain = object === 'companies' ? (company?.domain ?? '').toLowerCase() : '';
    return allMeetings.filter((m) => m.status !== 'cancelled' && (mails.has(m.invitee.email.toLowerCase()) || names.has(m.invitee.name.toLowerCase()) || (domain !== '' && m.invitee.email.toLowerCase().endsWith(`@${domain}`))));
  })();
  const timeline: ReadonlyArray<{ readonly e: ActivityEvent; readonly cat: Cat; readonly logged?: Activity }> = [
    ...activity.map((a) => {
      if (a.kind === 'created') return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'created' as const, object: w.one }, cat: 'changes' as const };
      if ((a.kind === 'call' || a.kind === 'meeting') && !a.title) return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'line' as const, text: a.text, mark: a.kind }, cat: (a.kind === 'call' ? 'calls' : 'meetings') as Cat, logged: a };
      if (a.kind === 'call' || a.kind === 'meeting') {
        const with_ = [a.record, ...(a.also ?? [])].filter((r) => !same(r)).map(recName);
        const detail = [a.minutes ? `${a.minutes} min` : '', a.outcome ?? '', with_.length ? `with ${with_.join(', ')}` : ''].filter(Boolean).join(' · ');
        return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'logged' as const, what: a.kind, title: a.title ?? a.text.replace(/^(called|met): /, ''), detail: detail || undefined, notes: a.notes }, cat: (a.kind === 'call' ? 'calls' : 'meetings') as Cat, logged: a };
      }
      if (a.kind === 'note') return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'note' as const, title: a.text }, cat: 'notes' as const };
      if (a.kind === 'email') return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'line' as const, text: a.text, mark: 'email' as const }, cat: 'other' as const };
      if (a.kind === 'form') return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'line' as const, text: a.text, mark: 'form' as const }, cat: 'other' as const };
      return { e: { id: a.id, at: a.at, actor: a.actor, kind: 'line' as const, text: a.text, mark: 'change' as const }, cat: 'changes' as const };
    }),
    ...notes.map((n) => ({ e: { id: `ev-${n.id}`, at: n.updated, actor: n.author, kind: 'note' as const, title: n.title }, cat: 'notes' as const })),
    ...tasks.map((t) => ({ e: { id: `ev-${t.id}`, at: t.created, actor: t.createdBy ?? t.assignee, kind: 'task' as const, title: t.title, done: t.done }, cat: 'tasks' as const })),
    ...comments.map((c) => ({ e: { id: `ev-${c.id}`, at: c.at, actor: c.author, kind: 'comment' as const, body: c.body }, cat: 'comments' as const })),
    ...myMeetings.map((m) => ({ e: { id: `ev-${m.id}`, at: m.start, actor: m.invitee.name, kind: 'booked' as const, meeting: m.title, when: m.start }, cat: 'meetings' as const })),
  ].sort((a, b) => b.e.at.getTime() - a.e.at.getTime());
  const shown = timeline.filter((x) => cat === 'all' || x.cat === cat);
  const loggedById = new Map(timeline.filter((x) => x.logged).map((x) => [x.e.id, x.logged as Activity]));
  const feedActions = (e: ActivityEvent): ReactNode => {
    const a = loggedById.get(e.id); if (!a || !canEdit) return null;
    return (
      <MenuTrigger>
        <IconButton size="sm" label={`More for ${a.kind}`}><MoreHorizontal {...i14} /></IconButton>
        <Menu aria-label={`Logged ${a.kind}`} placement="bottom end" onAction={(k) => {
          if (k === 'edit') setLogging(a);
          else { dispatch({ type: 'activity/remove', id: a.id }); toast({ message: a.kind === 'call' ? 'Call deleted' : 'Meeting deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'activity/set', activity: a }) } }); }
        }}>
          <MenuItem id="edit">Edit</MenuItem>
          <MenuItem id="delete" isDanger>Delete</MenuItem>
        </Menu>
      </MenuTrigger>
    );
  };

  // The strip of facts under the header.
  const lastActivity = timeline.find((x) => x.e.at.getTime() <= Date.now())?.e.at;
  const lastContacted = person?.lastContact ?? (object === 'companies' ? state.people.filter((p) => p.companyId === id).map((p) => p.lastContact).filter((d): d is Date => d !== undefined).sort((a, b) => b.getTime() - a.getTime())[0]
    : object === 'deals' ? state.people.find((p) => p.id === deal?.contactId)?.lastContact : undefined) ?? activity.filter((a) => a.kind === 'call' || a.kind === 'meeting').map((a) => a.at).sort((a, b) => b.getTime() - a.getTime())[0];
  const nextMeeting = myMeetings.filter((m) => m.start > new Date()).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const stats: ReadonlyArray<readonly [string, string]> = [
    ['Last activity', lastActivity ? `${ago(lastActivity)} ago` : 'Nothing yet'],
    ['Last contacted', lastContacted ? dayWord(lastContacted) : 'Not yet'],
    ['Next meeting', nextMeeting ? `${formatDay(nextMeeting.start)}` : 'None booked'],
    ...(deal ? [['Entered stage', `${dayWord(deal.stageAt ?? deal.created)} · ${Number(values.inStage ?? 0)}d in ${deal.stage}`] as const] : []),
  ];

  const twin = !trashed ? twinOf(state, object, id) : undefined;
  const ownAttrs = liveAttributes(schemaOf(state, object));
  // Required fields left empty, by "required" or a "required when" rule that holds now.
  const missing = trashed ? [] : ownAttrs.filter((a) => !a.computed && !a.relation && isRequiredFor(a, values) && (values[a.id] === undefined || values[a.id] === '') && a.id !== 'name' && a.id !== 'created');
  const stageAttr: Attribute = { id: 'stage', name: 'Stage', type: 'status', options: stagesOf(state).map((x) => ({ id: x.id, label: x.label, hue: STAGE_LOOK[x.id as Stage]?.hue ?? 'gray', shape: STAGE_LOOK[x.id as Stage]?.status })) };

  /** Links two records along a relationship (a person to a company, a deal to a contact, an owner-made link), with Undo. */
  const linkTo = (via: string, targetId: string, on: boolean) => {
    const rel = relationsOf(state, object).find((r) => r.id === via); if (!rel) return;
    const undo: Array<() => void> = [];
    const setField = (o: ObjectId, rid: string, key: string, value: unknown) => { const r = recordOf(state, o, rid) as (AnyRecord & Readonly<Record<string, unknown>>) | undefined; if (!r) return; const was = key.startsWith('extra.') ? { extra: { [key.slice(6)]: r.extra?.[key.slice(6)] ?? '' } } : { [key]: r[key] }; dispatch({ type: 'records/fields', object: o, changes: [{ id: rid, patch: key.startsWith('extra.') ? { extra: { [key.slice(6)]: String(value ?? '') } } : { [key]: value } }] }); undo.push(() => dispatch({ type: 'records/fields', object: o, changes: [{ id: rid, patch: was }] })); };
    if (via === 'company') setField(object, id, 'companyId', on ? targetId : undefined);
    else if (via === 'contact') setField('deals', id, 'contactId', on ? targetId : undefined);
    else if (via === 'people' && object === 'companies') setField('people', targetId, 'companyId', on ? id : undefined);
    else if (via === 'deals') setField('deals', targetId, object === 'people' ? 'contactId' : 'companyId', on ? id : undefined);
    else if (via.startsWith('rev:')) { const [, o = '', attr = ''] = via.split(':'); const r = recordOf(state, o, targetId); const have = (r?.extra?.[attr] ?? '').split(/,\s*/).filter(Boolean); const many = schemaOf(state, o)?.attributes.find((a) => a.id === attr)?.relation?.many; setField(o, targetId, `extra.${attr}`, (on ? (many ? [...new Set([...have, id])] : [id]) : have.filter((x) => x !== id)).join(', ')); }
    else { const have = (current.extra?.[via] ?? '').split(/,\s*/).filter(Boolean); setField(object, id, `extra.${via}`, (on ? (rel.many ? [...new Set([...have, targetId])] : [targetId]) : have.filter((x) => x !== targetId)).join(', ')); }
    const other = recName({ object: rel.target, id: targetId });
    toast({ message: on ? `${other} linked` : `${other} unlinked`, action: { label: 'Undo', onAction: () => undo.forEach((f) => f()) } });
  };
  // Related records down the side: built-in links and owner-made ones, both ways. Each can add, remove and make a new linked record.
  const relSections = relationsOf(state, object).filter((r) => !(object === 'people' && r.id === 'company' && false)).map((rel) => {
    const linked = linkedRecords(state, object, current, rel.id);
    const canRemove = canEdit && !(rel.id === 'deals' && object === 'companies') && !(object === 'deals' && rel.id === 'company');
    const tw = wordsOf(state, rel.target);
    return (
      <RecordSection key={rel.id} title={rel.name} count={linked.length} onAdd={canEdit && (rel.many || linked.length === 0 || rel.id === 'company') ? () => setLinking({ via: rel.id, target: rel.target, title: rel.name, many: rel.many }) : undefined}>
        {linked.map((x) => (
          <span key={x.rec.id} className="tf-rec__relrow">
            <button type="button" className="tf-rec__rel" onClick={() => onOpen(x.object, x.rec.id)}><Avatar name={x.rec.name} size={20} shape={x.object === 'people' ? 'round' : 'square'} />{x.rec.name}
              {x.object === 'deals' ? <span className="tf-rec__muted tf-num">{inr((x.rec as AppState['deals'][number]).amount)}</span> : x.object === 'people' ? <span className="tf-rec__muted">{(x.rec as AppState['people'][number]).title}</span> : null}</button>
            {canRemove && <IconButton size="sm" label={`Unlink ${x.rec.name}`} onPress={() => linkTo(rel.id, x.rec.id, false)}><X {...i14} /></IconButton>}
          </span>
        ))}
        {linked.length === 0 && <p className="tf-rec__muted tf-rec__relnone">No {tw.many} linked.</p>}
      </RecordSection>
    );
  });
  const meetingsSection = (() => {
    if (myMeetings.length === 0) return null;
    const now = new Date();
    const next = myMeetings.filter((m) => m.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
    const past = myMeetings.filter((m) => m.end <= now).sort((a, b) => b.start.getTime() - a.start.getTime()).slice(0, 3);
    const line = (m: BookedMeeting) => (
      <button key={m.id} type="button" className="tf-rec__rel tf-rec__rel--meeting" onClick={() => onMeeting?.(m.id)} disabled={!onMeeting}>
        <CalendarDays size={14} strokeWidth={1.75} aria-hidden /><span className="tf-rec__relname">{m.title}{object !== 'people' ? <span className="tf-rec__muted"> · {m.invitee.name}</span> : null}</span>
        {m.outcome && <Tag size="sm" hue={m.outcome === 'Qualified' ? 'green' : m.outcome === 'Not a fit' ? 'gray' : 'blue'}>{m.outcome}</Tag>}
        <span className="tf-rec__muted tf-num">{m.status === 'no-show' ? 'No-show' : m.status === 'pending' ? 'Asked' : formatDay(m.start)}</span>
      </button>
    );
    return <RecordSection title="Meetings" count={myMeetings.length}>{next.map(line)}{past.length > 0 && next.length > 0 && <span className="tf-rec__subhead">Earlier</span>}{past.map(line)}</RecordSection>;
  })();
  const ownerRow = fieldRow({ id: 'owner', name: 'Owner', type: 'actor', candidates: state.members.map((m) => ({ id: m.name, name: m.name })) }, 'owner', { id: current.owner, name: current.owner }, (v) => (typeof v === 'object' && v !== null && 'name' in v ? String((v as { name: string }).name) : String(v ?? '')));
  const details = (
    <aside className="tf-recp__side" aria-label="Details">
      {missing.length > 0 && <Callout tone="warning">{missing.map((a) => a.name).join(', ')} {missing.length === 1 ? 'is' : 'are'} required{missing.some((a) => !a.isRequired && a.requiredWhen) ? ' now' : ''}.</Callout>}
      {person && <>
        {fieldRow({ id: 'email', name: 'Email', type: 'email' }, 'email', person.email)}
        {fieldRow({ id: 'phone', name: 'Phone', type: 'phone' }, 'phone', person.phone)}
        {fieldRow({ id: 'title', name: 'Job title', type: 'text' }, 'title', person.title)}
        {fieldRow({ id: 'tags', name: 'Tags', type: 'multiSelect', options: (schemaOf(state, 'people')?.attributes.find((a) => a.id === 'tags')?.options ?? []).filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label, hue: o.hue })) }, 'tags', person.tags, (v) => (Array.isArray(v) ? v.map(String) : []))}
      </>}
      {deal && <>
        {fieldRow({ id: 'amount', name: 'Amount', type: 'currency', currency: 'INR' }, 'amount', deal.amount, (v) => Number(v) || 0)}
        {fieldRow({ id: 'close', name: 'Close date', type: 'date' }, 'close', ymdOf(deal.close), (v) => (typeof v === 'string' ? dayFrom(v) ?? deal.close : deal.close))}
        {outcomeOf(state, deal.stage) === 'lost' && fieldRow({ id: 'lostReason', name: 'Lost reason', type: 'select', options: LOST_REASONS.map((x) => ({ id: x, label: x, hue: 'red' as const })) }, 'lostReason', deal.lostReason, (v) => (v ? String(v) : undefined))}
        {outcomeOf(state, deal.stage) === 'lost' && fieldRow({ id: 'lostNote', name: 'Lost note', type: 'text' }, 'lostNote', deal.lostNote ?? '')}
      </>}
      {company && object === 'companies' && <>
        {fieldRow({ id: 'domain', name: 'Domain', type: 'domain' }, 'domain', company.domain)}
        {fieldRow({ id: 'industry', name: 'Industry', type: 'select', options: (['Software', 'Fintech', 'Healthcare', 'Manufacturing', 'Logistics', 'Retail'] as const).map((x, n) => ({ id: x, label: x, hue: (['blue', 'purple', 'green', 'orange', 'sky', 'yellow'] as const)[n] ?? 'gray' })) }, 'industry', company.industry)}
        {fieldRow({ id: 'city', name: 'City', type: 'text' }, 'city', company.city)}
      </>}
      {ownerRow}
      {/* Owner-made attributes, each with its own field; computed ones read only. */}
      {ownFields(state, object).filter((f) => f.custom && !f.attribute?.relation).map((f) => {
        const a = f.attribute; if (!a) return null;
        if (a.computed) return <AttributeRow key={a.id} attribute={{ id: a.id, name: a.name, type: f.type, readOnlyReason: a.computed.kind === 'formula' ? 'Worked out by its formula' : 'Read from linked records' }} value={values[a.id] as never} onChange={() => undefined} />;
        const attr = attributeOf(state, f);
        return <AttributeRow key={a.id} attribute={trashed ? { ...attr, readOnlyReason: 'In Trash' } : { ...attr, name: isRequiredFor(a, values) ? `${attr.name} *` : attr.name }} value={fieldValue(attr, current.extra?.[a.id])} onChange={(v) => {
          if (!canEdit) return;
          const was = current.extra?.[a.id] ?? '';
          dispatch({ type: 'records/fields', object, changes: [{ id, patch: { extra: { [a.id]: valueToCell(attr, v) } } }] });
          toast({ message: `${a.name} saved`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { extra: { [a.id]: was } } }] }) } });
        }} />;
      })}
      {canEdit && <span className="tf-recp__attracts">
        <Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setAddingAttr(true)}>Add attribute</Button>
        {onAttributes && <Button size="sm" variant="ghost" icon={<Settings2 {...i14} />} onPress={onAttributes}>Manage attributes</Button>}
      </span>}
      {LISTS_ON && isBuiltIn(object) && <RecordSection title="Lists" count={lists.length}>
        {lists.map((l) => <span key={l.id} className="tf-rec__rel tf-rec__rel--static">{l.name}<span className="tf-rec__muted">{l.entries.find((e) => e.recordId === id)?.stage}</span></span>)}
        {canEdit && <Button size="sm" variant="ghost" icon={<ListPlus {...i14} />} onPress={() => setListing(true)}>Add to a list</Button>}
      </RecordSection>}
      {relSections}
      {meetingsSection}
    </aside>
  );
  const linkingRel = linking;
  return (
    <div className="tf-recp">
      <Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={onBack}>{backLabel ? `Back to ${backLabel}` : 'Back'}</Button>
      {trashed && binnedItem && <Callout tone="warning" action={{ label: 'Restore', onPress: () => { dispatch({ type: 'trash/restore', id: binnedItem.id }); toast({ message: `${binnedItem.record.name} restored`, tone: 'success', action: { label: 'Open', onAction: () => onOpen(object, id) } }); onBack(); } }}>In Trash: {binnedItem.by} deleted it. You can look, but not change it.</Callout>}
      <RecordHeader name={trashed ? current.name : name} kind={object === 'people' ? 'person' : object === 'deals' ? 'deal' : 'company'} sub={trashed ? w.One : sub}
        tags={person?.tags.map((t) => ({ label: t })) ?? []}
        onRename={canEdit ? (n) => { const was = name; if (!n.trim() || n.trim() === was) return; dispatch({ type: 'records/fields', object, changes: [{ id, patch: { name: n.trim() } }] }); toast({ message: 'Renamed', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object, changes: [{ id, patch: { name: was } }] }) } }); } : undefined}
        onEmail={person?.email && !trashed ? () => setEmailing(true) : undefined}
        moreActions={trashed ? undefined : <>
          <MenuItem id="copy" icon={<Link2 {...i16} />}>Copy link</MenuItem>
          {canEdit && LISTS_ON && isBuiltIn(object) ? <MenuItem id="list" icon={<ListPlus {...i16} />}>Add to a list</MenuItem> : null}
          {canEdit ? <MenuSeparator /> : null}
          {canEdit ? <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem> : null}
        </>}
        onMoreAction={(k) => {
          if (k === 'copy') { const url = `https://timefix.com/${state.prefs.workspace.slug}/${object}/${id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }
          else if (k === 'list') setListing(true);
          else if (k === 'delete') { dispatch({ type: 'records/remove', object, ids: [id] }); onBack(); toast({ message: `${name} moved to Trash`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/untrash', ids: [id] }) } }); }
        }}
        stage={deal && !trashed ? { attribute: stageAttr, value: deal.stage, onChange: (v) => { if (!canEdit) return; const was = deal.stage; dispatch({ type: 'records/fields', object: 'deals', changes: [{ id, patch: { stage: String(v) as Stage } }] }); toast({ message: `Moved to ${String(v)}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'records/fields', object: 'deals', changes: [{ id, patch: { stage: was } }] }) } }); } } : undefined} />
      {!trashed && <dl className="tf-recp__stats" aria-label="At a glance">{stats.map(([k, v]) => <div key={k} className="tf-recp__stat"><dt>{k}</dt><dd className="tf-num">{v}</dd></div>)}</dl>}
      {twin && canEdit && (
        <Callout tone="info" className="tf-recp__twin">
          <span className="tf-recp__twinline"><span>Possible duplicate of <strong>{twin.other.name}</strong> · {twin.why.toLowerCase()}</span>
            <span className="tf-set__row"><Button size="sm" variant="ghost" onPress={() => { const key = [twin.self.id, twin.other.id].sort().join('|'); dispatch({ type: 'dupes/dismiss', key, on: true }); toast({ message: 'Marked as not a duplicate', action: { label: 'Undo', onAction: () => dispatch({ type: 'dupes/dismiss', key, on: false }) } }); }}>Not a duplicate</Button>
              <Button size="sm" variant="secondary" icon={<GitMerge {...i14} />} onPress={() => setMerging([twin.self, twin.other])}>Merge</Button></span></span>
        </Callout>
      )}
      <div className="tf-recp__body">
        <div className="tf-recp__main">
          <Tabs aria-label="Record" selectedKey={tab} onSelectionChange={setTab}
            items={[{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity', count: timeline.length }, { id: 'notes', label: 'Notes', count: notes.length }, { id: 'tasks', label: 'Tasks', count: tasks.filter((t) => !t.done).length }, { id: 'comments', label: 'Comments', count: comments.length }, { id: 'files', label: 'Files', count: files.length }]}>
            <TabPanel id="overview" className="tf-recp__panel">
              {canEdit && <div className="tf-recp__quick">
                <Button variant="secondary" icon={<Phone {...i14} />} onPress={() => setLogging('call')}>Log a call or meeting</Button>
                <Button variant="ghost" onPress={() => setTab('notes')}>Add a note</Button>
                <Button variant="ghost" onPress={() => setTab('tasks')}>Add a task</Button>
              </div>}
              <section className="tf-recp__sec"><h3>Open tasks</h3>
                {tasks.filter((t) => !t.done).length === 0 ? <p className="tf-rec__muted">Nothing open.</p>
                  : <ul className="tf-recp__mini">{tasks.filter((t) => !t.done).map((t) => <li key={t.id}>{t.title}<span className="tf-rec__muted">{t.due ? t.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date'} · {t.assignee}</span></li>)}</ul>}
              </section>
              <section className="tf-recp__sec"><h3>Latest</h3>
                {timeline.length === 0 ? <p className="tf-rec__muted">Nothing yet.</p> : <ActivityFeed events={timeline.slice(0, 4).map((x) => x.e)} actions={feedActions} />}
              </section>
            </TabPanel>
            <TabPanel id="activity" className="tf-recp__panel">
              <div className="tf-recp__feedbar">
                <ChoiceChips label="Show" isLabelHidden size="sm" selectionMode="single" selectedKeys={[cat]} onSelectionChange={(k) => setCat(([...k][0] ?? 'all') as Cat | 'all')}
                  items={CATS.filter((c) => c.id === 'all' || c.id === cat || timeline.some((x) => x.cat === c.id)).map((c) => ({ id: c.id, label: c.id === 'all' ? `All ${timeline.length}` : `${c.label} ${timeline.filter((x) => x.cat === c.id).length}` }))} />
                {canEdit && <Button size="sm" variant="secondary" icon={<Phone {...i14} />} onPress={() => setLogging(cat === 'meetings' ? 'meeting' : 'call')}>Log</Button>}
              </div>
              {shown.length === 0 ? <p className="tf-rec__muted">{cat === 'all' ? 'Nothing yet.' : `No ${CATS.find((c) => c.id === cat)?.label.toLowerCase()} yet.`}</p> : <ActivityFeed events={shown.map((x) => x.e)} actions={feedActions} />}
            </TabPanel>
            <TabPanel id="notes" className="tf-recp__panel">
              {openNote ? (
                <>
                  <span className="tf-recp__notebar">
                    {(openNote.also ?? []).length > 0 && <span className="tf-rec__muted">Also on {(openNote.also ?? []).map(recName).join(', ')}</span>}
                    <Button size="sm" variant="ghost" icon={<Link2 {...i14} />} onPress={() => { const url = `https://timefix.com/${state.prefs.workspace.slug}/notes/${openNote.id}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link to note copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }}>Copy link</Button>
                  </span>
                  <NotePage note={{ id: openNote.id, title: openNote.title, body: openNote.body, doc: openNote.doc, author: openNote.author, updated: ago(openNote.updated) }} people={state.members.map((m) => ({ id: m.id, name: m.name }))}
                    onBack={(l) => { setNoteId(undefined); if (isEmptyNote(l.title, l.body)) dispatch({ type: 'note/remove', id: openNote.id }); }}
                    onDelete={() => { const n = openNote; setNoteId(undefined); dispatch({ type: 'note/remove', id: n.id }); toast({ message: 'Note deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'note/set', note: n }) } }); }}
                    onSave={(n) => dispatch({ type: 'note/set', note: { ...openNote, title: n.title, body: n.body, doc: n.doc, updated: new Date() } })} />
                </>
              ) : (
                <NoteList notes={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, author: n.author, updated: ago(n.updated) }))}
                  onNew={canEdit ? () => { const n = { id: newId('n'), title: 'Untitled note', body: '', author: state.me, record: link, updated: new Date() }; dispatch({ type: 'note/set', note: n }); setNoteId(n.id); } : () => toast({ message: 'Restore it to add notes.' })}
                  onOpen={setNoteId} />
              )}
            </TabPanel>
            <TabPanel id="tasks" className="tf-recp__panel">
              {canEdit && <div className="tf-recp__quick"><Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => setTaskOpen('new')}>New task with a date</Button></div>}
              <TaskList tasks={tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, due: t.due, assignee: t.assignee }))} onOpen={(tid) => setTaskOpen(tid)}
                onToggle={(tid, done) => { const t = state.tasks.find((x) => x.id === tid); if (!t) return; dispatch({ type: 'task/set', task: { ...t, done } }); toast({ message: done ? 'Task done' : 'Task reopened', action: { label: 'Undo', onAction: () => dispatch({ type: 'task/set', task: t }) } }); }}
                onAdd={(title) => dispatch({ type: 'task/set', task: { id: newId('t'), title, done: false, assignee: state.me, record: link, created: new Date(), createdBy: state.me } })} />
            </TabPanel>
            <TabPanel id="files" className="tf-recp__panel">
              {canEdit && <FileDrop label="Drop files here" description="PDF, images, documents · up to 25 MB each" onFiles={(list) => {
                const bad = list.filter((f) => /\.(exe|bat|cmd|sh|js)$/i.test(f.name) || f.size > 25_000_000);
                list.filter((f) => !bad.includes(f)).forEach((f) => dispatch({ type: 'file/set', file: { id: newId('fl'), record: link, name: f.name, size: f.size, type: f.type, at: new Date(), by: state.me, blob: f } }));
                if (bad.length) toast({ message: `${bad.map((f) => f.name).join(', ')} can't be added: programs and files over 25 MB aren't allowed.` });
                else toast({ message: `${list.length} ${list.length === 1 ? 'file' : 'files'} added`, tone: 'success' });
              }} />}
              {files.length === 0 ? <p className="tf-rec__muted">No files yet.</p> : (
                <ul className="tf-set__list">{files.map((f) => (
                  <li key={f.id}><span><strong>{f.name}</strong> <span className="tf-rec__muted tf-num">{f.size > 1_000_000 ? `${(f.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1000))} KB`} · {f.by} · {ago(f.at)}</span></span>
                    <span className="tf-set__row">
                      <Button size="sm" variant="ghost" onPress={() => { void saveFile(f.name, f.blob ?? new Blob([`${f.name}: a sample file in the prototype`], { type: 'text/plain' })).then((o) => { if (o === 'saved') toast({ message: 'Downloaded', tone: 'success' }); }); }}>Download</Button>
                      {canEdit && <Button size="sm" variant="ghost" onPress={() => { dispatch({ type: 'file/remove', id: f.id }); toast({ message: `${f.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'file/set', file: f }) } }); }}>Delete</Button>}
                    </span></li>
                ))}</ul>
              )}
            </TabPanel>
            <TabPanel id="comments" className="tf-recp__panel">
              <CommentThread me={state.me} people={people}
                comments={comments.flatMap((c) => [{ id: c.id, author: c.author, time: ago(c.at), body: c.body, resolved: c.resolved, reactions: state.reactions[c.id], history: c.history?.map((h) => ({ body: h.body, time: ago(h.at) })) }, ...c.replies.map((r) => ({ id: r.id, author: r.author, time: ago(r.at), body: r.body, replyTo: c.author, reactions: state.reactions[r.id], history: r.history?.map((h) => ({ body: h.body, time: ago(h.at) })) }))])}
                onResolve={(cid, resolved) => { const c = comments.find((x) => x.id === cid); if (!c) return; dispatch({ type: 'comment/set', comment: { ...c, resolved } }); toast({ message: resolved ? 'Thread resolved' : 'Thread reopened', action: { label: 'Undo', onAction: () => { const now = state.comments.find((x) => x.id === cid) ?? c; dispatch({ type: 'comment/set', comment: { ...now, replies: latestReplies.current.get(cid) ?? now.replies, resolved: !resolved } }); } } }); }}
                onReact={(cid, kind) => dispatch({ type: 'reaction/toggle', id: cid, kind })}
                onEdit={(cid, body) => {
                  const top = comments.find((c) => c.id === cid);
                  if (top) dispatch({ type: 'comment/set', comment: { ...top, body, history: [...(top.history ?? []), { body: top.body, at: top.at }] } });
                  else { const parent = comments.find((c) => c.replies.some((r) => r.id === cid)); if (parent) dispatch({ type: 'comment/set', comment: { ...parent, replies: parent.replies.map((r) => (r.id === cid ? { ...r, body, history: [...(r.history ?? []), { body: r.body, at: r.at }] } : r)) } }); }
                  toast({ message: 'Comment edited', tone: 'success' });
                }}
                onDelete={setDeleting}
                onCopyLink={(cid) => { const top = comments.find((c) => c.id === cid || c.replies.some((r) => r.id === cid)); const url = `https://timefix.com/${state.prefs.workspace.slug}/${object}/${id}?thread=${top?.id ?? cid}`; void copyText(url).then((ok) => toast(ok ? { message: 'Link to thread copied', tone: 'success' } : { message: `Copy didn’t work: ${url}`, tone: 'danger' })); }}
                onSend={(body, _replyTo, replyId) => new Promise<void>((resolve) => {
                  if (!canEdit) { toast({ message: 'Restore it to comment.' }); resolve(); return; }
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
      {(() => {
        const top = comments.find((c) => c.id === deleting); const parent = top ? undefined : comments.find((c) => c.replies.some((r) => r.id === deleting));
        return <ConfirmDialog isOpen={deleting !== undefined} onOpenChange={(o) => { if (!o) setDeleting(undefined); }} title={top ? 'Delete this thread?' : 'Delete this reply?'} confirmLabel="Delete"
          consequence={top ? (top.replies.length ? `The comment and its ${top.replies.length} ${top.replies.length === 1 ? 'reply' : 'replies'} go for good.` : 'It goes for good.') : 'It goes for good.'}
          onConfirm={() => { if (top) dispatch({ type: 'comment/remove', id: top.id }); else if (parent) dispatch({ type: 'comment/set', comment: { ...parent, replies: parent.replies.filter((r) => r.id !== deleting) } }); setDeleting(undefined); toast({ message: 'Deleted' }); }} />;
      })()}
      {merging && <MergeDialog state={state} dispatch={dispatch} object={object} pair={merging} onClose={() => setMerging(undefined)} onMerged={(kept) => { if (kept !== id) onOpen(object, kept); }} />}
      {linkingRel && <LinkDialog state={state} title={linkingRel.title} target={linkingRel.target} taken={linkedRecords(state, object, current, linkingRel.via).map((x) => x.rec.id).concat(linkingRel.target === object ? [id] : [])} many={linkingRel.many}
        onClose={() => setLinking(undefined)} onPick={(ids) => { ids.forEach((x) => linkTo(linkingRel.via, x, true)); setLinking(undefined); }}
        onMake={() => { const start: Record<string, string> = linkingRel.target === 'deals' ? (object === 'companies' ? { company: id } : object === 'people' && person?.companyId ? { company: person.companyId } : {}) : linkingRel.target === 'people' && object === 'companies' ? { company: id } : linkingRel.target === 'people' && object === 'deals' && deal ? { company: deal.companyId } : {}; setMaking({ target: linkingRel.target, via: linkingRel.via, start }); setLinking(undefined); }} />}
      {making && <NewRecordDialog state={state} object={making.target} start={making.start} onClose={() => setMaking(undefined)} onCreate={(nm, vals) => {
        const nid = newId(making.target.slice(0, 1)); const t = making.target;
        const owner = state.me;
        const base = t === 'people' ? { id: nid, name: nm, email: vals.email ?? '', title: vals.title ?? '', companyId: vals.company || undefined, owner, tags: [], created: new Date() }
          : t === 'companies' ? { id: nid, name: nm, domain: vals.domain ?? '', industry: '', size: '', city: '', owner, created: new Date() }
          : t === 'deals' ? { id: nid, name: nm, companyId: vals.company ?? '', contactId: object === 'people' ? id : undefined, stage: (stagesOf(state)[0]?.id ?? 'Lead') as Stage, amount: Number(vals.amount) || 0, owner, close: new Date(Date.now() + 30 * 86_400_000), created: new Date(), stageAt: new Date() }
          : blankCustom(nid, nm, owner);
        const rest = Object.entries(vals).filter(([k, v]) => v !== '' && !['email', 'title', 'company', 'domain', 'amount'].includes(k));
        const rec = rest.reduce<Record<string, unknown>>((r, [k, v]) => { const p = patchFor(state, t, base as never, k, v); return p ? { ...r, ...p, ...(p.extra ? { extra: { ...(r.extra as object | undefined), ...(p.extra as object) } } : {}) } : r; }, { ...base });
        if (t === 'people') dispatch({ type: 'person/set', person: rec as never }); else if (t === 'companies') dispatch({ type: 'company/set', company: rec as never }); else if (t === 'deals') dispatch({ type: 'deal/set', deal: rec as never }); else dispatch({ type: 'custom/set', object: t, record: { ...(rec as never as ReturnType<typeof blankCustom>), extra: (rec.extra as Readonly<Record<string, string>> | undefined) ?? {} } });
        // Linked as it's made (a new deal's contact is already set).
        const via = making.via; setMaking(undefined);
        window.setTimeout(() => { if (!(t === 'deals' && (via === 'deals'))) linkTo(via, nid, true); else toast({ message: `${nm} created and linked`, tone: 'success', action: { label: 'Open', onAction: () => onOpen(t, nid) } }); }, 0);
      }} />}
      {addingAttr && <AttributeDialog isOpen onOpenChange={(o) => { if (!o) setAddingAttr(false); }} objectName={w.One} siblings={schemaOf(state, object)?.attributes}
        onSave={(a) => { const o = schemaOf(state, object); if (!o) return; dispatch({ type: 'object/set', object: { ...o, attributes: [...o.attributes, a] } }); dispatch({ type: 'history/add', text: `${state.me} added the attribute ${a.name} to ${o.many}` }); toast({ message: `${a.name} added to ${o.many}`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'object/set', object: o }) } }); }} />}
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
      {logging && <LogActivity state={state} self={link} initial={typeof logging === 'string' ? undefined : logging} kind={typeof logging === 'string' ? logging : logging.kind === 'meeting' ? 'meeting' : 'call'} onClose={() => setLogging(undefined)} onLog={(a, isNew) => {
        dispatch({ type: isNew ? 'activity/add' : 'activity/set', activity: a });
        // Logging a call or meeting with people moves their "last contacted" on.
        [a.record, ...(a.also ?? [])].filter((r) => r.object === 'people').forEach((r) => { const p = state.people.find((x) => x.id === r.id); if (p && (!p.lastContact || p.lastContact < a.at)) dispatch({ type: 'records/fields', object: 'people', changes: [{ id: p.id, patch: { lastContact: a.at } }] }); });
        setLogging(undefined); toast({ message: isNew ? (a.kind === 'call' ? 'Call logged' : 'Meeting logged') : 'Saved', tone: 'success' }); setTab('activity');
      }} />}
    </div>
  );
}

/** Pick records to link (or make a new one). */
function LinkDialog({ state, title, target, taken, many, onClose, onPick, onMake }: { readonly state: AppState; readonly title: string; readonly target: ObjectId; readonly taken: ReadonlyArray<string>; readonly many: boolean; readonly onClose: () => void; readonly onPick: (ids: ReadonlyArray<string>) => void; readonly onMake: () => void }) {
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const tw = wordsOf(state, target);
  const one = target === 'people' ? 'person' : target === 'companies' ? 'company' : target === 'deals' ? 'deal' : tw.one;
  const items = recordsOf(state, target).filter((r) => !taken.includes(r.id)).map((r) => ({ id: r.id, label: r.name, description: recordName(state, { object: target, id: r.id }).sub || undefined }));
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Link ${title.toLowerCase()}`}
      actions={<><Button variant="ghost" icon={<Plus {...i14} />} onPress={onMake}>Create {one}</Button><span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={picked.length === 0} onPress={() => onPick(picked)}>Link</Button></>}>
      {items.length === 0 ? <p className="tf-rec__muted">Every {one} is linked already. Make a new one.</p>
        : many ? <MultiSelect label={tw.Many} searchable values={picked} onChange={setPicked} items={items} optionStyle="plain" placeholder={`Pick ${tw.many}`} />
        : <Select label={tw.One} searchable value={picked[0] ?? null} onChange={(v) => setPicked(v ? [v] : [])} items={items} placeholder={`Pick a ${one}`} />}
    </Dialog>
  );
}

const OUTCOMES: Readonly<Record<'call' | 'meeting', ReadonlyArray<string>>> = { call: ['Connected', 'Left a voicemail', 'No answer', 'Wrong number'], meeting: ['Went well', 'Needs a follow-up', 'Not a fit', 'No-show'] };

/** Log a call or meeting: what about, when, how long, how it went, who else it was with, and notes. Edits keep its id. */
function LogActivity({ state, self, initial, kind: startKind, onClose, onLog }: { readonly state: AppState; readonly self: RecordLink; readonly initial?: Activity; readonly kind: 'call' | 'meeting'; readonly onClose: () => void; readonly onLog: (a: Activity, isNew: boolean) => void }) {
  const at0 = initial?.at ?? new Date();
  const [kind, setKind] = useState<'call' | 'meeting'>(startKind);
  const [what, setWhat] = useState(initial?.title ?? initial?.text.replace(/^(called|met): /, '') ?? '');
  const [day, setDay] = useState(ymdOf(at0));
  const [time, setTime] = useState(`${String(at0.getHours()).padStart(2, '0')}:${String(Math.floor(at0.getMinutes() / 15) * 15).padStart(2, '0')}`);
  const [minutes, setMinutes] = useState(String(initial?.minutes ?? 30));
  const [outcome, setOutcome] = useState(initial?.outcome ?? '');
  const [also, setAlso] = useState<ReadonlyArray<string>>((initial?.also ?? []).map((r) => `${r.object}:${r.id}`));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const others = [...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, description: 'Person' })), ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, description: 'Company' })), ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, description: 'Deal' })),
    ...state.objects.filter((o) => o.custom && !o.archived).flatMap((o) => (state.customRecords[o.id] ?? []).map((r) => ({ id: `${o.id}:${r.id}`, label: r.name, description: o.one })))].filter((x) => x.id !== `${self.object}:${self.id}`);
  const save = () => {
    const d = dayFrom(day, 12) ?? new Date(); const [h = 9, m = 0] = time.split(':').map(Number); const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    onLog({ id: initial?.id ?? newId('a'), record: initial?.record ?? self, kind, actor: initial?.actor ?? state.me, text: `${kind === 'call' ? 'called' : 'met'}: ${what.trim()}`, title: what.trim(), at, minutes: Number(minutes) || undefined, outcome: outcome || undefined, notes: notes.trim() || undefined,
      also: also.map((k) => { const [o = '', i = ''] = k.split(':'); return { object: o, id: i }; }) }, !initial);
  };
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title={initial ? `Edit ${kind}` : 'Log activity'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!what.trim() || !day} onPress={save}>{initial ? 'Save' : `Log ${kind}`}</Button></>}>
      <div className="tf-rec__form">
        <SegmentedControl aria-label="Kind" selectedKey={kind} onSelectionChange={(k) => { setKind(k === 'meeting' ? 'meeting' : 'call'); setOutcome(''); }} items={[{ id: 'call', label: 'Call', icon: <Phone {...i14} /> }, { id: 'meeting', label: 'Meeting', icon: <UsersIcon {...i14} /> }]} />
        <TextField label="What about" value={what} onChange={setWhat} autoFocus placeholder="Rollout plan" />
        <div className="tf-recp__logwhen">
          <DatePicker label="Date" value={day ? parseDate(day) : null} onChange={(v) => setDay(v ? v.toString() : '')} />
          <TimeSelect label="Time" value={time} onChange={(v) => setTime(v ?? '09:00')} hourCycle={12} />
          <Select label="How long" value={minutes} onChange={(v) => setMinutes(v ?? '30')} items={['5', '15', '30', '45', '60', '90'].map((x) => ({ id: x, label: `${x} min` }))} />
        </div>
        <Select label="How it went" value={outcome || null} onChange={(v) => setOutcome(v ?? '')} placeholder="Optional" items={OUTCOMES[kind].map((x) => ({ id: x, label: x }))} />
        <MultiSelect label="Also with" searchable values={also} onChange={setAlso} items={others} optionStyle="plain" placeholder="Other records it was with" description="It shows on each one’s timeline too." />
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
