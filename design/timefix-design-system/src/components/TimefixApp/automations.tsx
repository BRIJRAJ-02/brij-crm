// Automations: "when X, only if Y, then Z". One trigger (a record made, a field changing or becoming a value, a task falling due), optional
// conditions on the same record, one to three actions (make a task, set a field, tell someone). They really run: the reducer is wrapped so a
// change that matches an automation that's on does its actions and leaves a run behind. Settings › Automations lists, builds and audits them.
import { useState } from 'react';
import { MoreHorizontal, Plus, Workflow, X } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Select } from '../Select/Select.tsx';
import { TextField } from '../Field/Field.tsx';
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Link } from '../Link/Link.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { AttributeRow } from '../RecordPanel/RecordPanel.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { valueToCell } from '../DataGrid/DataGrid.tsx';
import { newId, recordName, type AppAction, type AppState, type Automation, type AutomationAction, type AutomationRun, type AutomationTrigger, type InboxItem, type ObjectId, type RecordLink, type ViewFilter } from './data.ts';
import { OPERATORS, filterFields, kindOf, kindsOf, ownFields, passesView, patchFor, recordOf, schemaOf, valuesOf, wordsOf } from './model.tsx';
import { attributeOf, fieldValue } from './recordforms.tsx';

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const MAX_ACTIONS = 3;
const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60_000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

/* ------------------------------------------------------------- engine */

type Reducer = (s: AppState, a: AppAction) => AppState;

/** Wraps the app's reducer so automations run on the changes they watch. Their own actions go straight through the plain reducer, so one automation never sets off another. */
export function withAutomations(core: Reducer): Reducer {
  return (prev, a) => {
    const next = core(prev, a);
    if (prev.previewRole || next.automations.every((x) => !x.on)) return next;
    return automate(prev, next, a, core);
  };
}

/** What happened that an automation could watch: records made, fields changed, tasks due. */
function eventsOf(prev: AppState, next: AppState, a: AppAction): ReadonlyArray<{ readonly kind: 'created' | 'changed' | 'taskDue'; readonly object: ObjectId; readonly id: string; readonly fields?: ReadonlySet<string>; readonly taskId?: string }> {
  const made = (object: ObjectId, id: string) => (recordOf(prev, object, id) ? [] : [{ kind: 'created' as const, object, id }]);
  if (a.type === 'person/set') return made('people', a.person.id);
  if (a.type === 'company/set') return made('companies', a.company.id);
  if (a.type === 'deal/set') return made('deals', a.deal.id);
  if (a.type === 'custom/set') return made(a.object, a.record.id);
  if (a.type === 'records/fields') return a.changes.map((c) => {
    const keys = new Set<string>();
    for (const k of Object.keys(c.patch)) {
      if (k === 'extra') Object.keys((c.patch.extra ?? {}) as object).forEach((x) => keys.add(x));
      else keys.add(k === 'companyId' ? 'company' : k);
    }
    const before = recordOf(prev, a.object, c.id); const after = recordOf(next, a.object, c.id);
    if (!before || !after) return undefined;
    const b = valuesOf(prev, a.object, before); const n = valuesOf(next, a.object, after);
    const changed = new Set([...keys].filter((k) => String(b[k] ?? '') !== String(n[k] ?? '')));
    return changed.size ? { kind: 'changed' as const, object: a.object, id: c.id, fields: changed } : undefined;
  }).filter((x): x is { readonly kind: 'changed'; readonly object: ObjectId; readonly id: string; readonly fields: Set<string> } => x !== undefined);
  if (a.type === 'automations/tick') {
    return next.tasks.filter((t) => !t.done && t.due && t.due <= a.now && t.record).map((t) => ({ kind: 'taskDue' as const, object: t.record?.object ?? '', id: t.record?.id ?? '', taskId: t.id }));
  }
  return [];
}

function automate(prev: AppState, next: AppState, a: AppAction, core: Reducer): AppState {
  const events = eventsOf(prev, next, a);
  if (events.length === 0) return next;
  let s = next;
  const runs: AutomationRun[] = [];
  for (const auto of next.automations.filter((x) => x.on)) {
    for (const ev of events) {
      const t = auto.trigger;
      if (t.kind !== ev.kind) continue;
      if (t.kind === 'created' && t.object !== ev.object) continue;
      if (t.kind === 'changed') {
        if (t.object !== ev.object || !ev.fields?.has(t.field)) continue;
        const rec0 = recordOf(s, ev.object, ev.id); if (!rec0) continue;
        if (t.to !== undefined && t.to !== '' && String(valuesOf(s, ev.object, rec0)[t.field] ?? '') !== t.to) continue;
      }
      if (t.kind === 'taskDue' && (prev.runs.some((r) => r.automationId === auto.id && r.taskId === ev.taskId) || runs.some((r) => r.automationId === auto.id && r.taskId === ev.taskId))) continue;
      const rec = recordOf(s, ev.object, ev.id); if (!rec) continue;
      if (auto.conditions.length && !passesView(valuesOf(s, ev.object, rec), kindsOf(filterFields(s, ev.object)), auto.conditions, [], auto.match)) continue;
      const link: RecordLink = { object: ev.object, id: ev.id };
      const task = ev.taskId ? s.tasks.find((x) => x.id === ev.taskId) : undefined;
      const did: string[] = []; let failed: string | undefined;
      if (!s.members.some((m) => m.name === auto.runAs)) failed = 'The person it ran as left';
      for (const act of failed ? [] : auto.actions) {
        const whoOf = (w: string) => (w === 'owner' ? (task ? task.assignee : rec.owner) : w);
        if (act.kind === 'task') {
          const who = whoOf(act.who); if (!s.members.some((m) => m.name === who)) { failed = 'Someone or something is gone'; break; }
          const due = new Date(); due.setDate(due.getDate() + act.days); due.setHours(17, 0, 0, 0);
          const tid = newId('t');
          s = core(s, { type: 'task/set', task: { id: tid, title: act.title, done: false, due, assignee: who, record: link, created: new Date(), createdBy: auto.runAs } });
          if (who === s.me) s = { ...s, inbox: [inboxLine(auto, 'assignment', 'assigned you a task on', act.title, link, tid), ...s.inbox] };
          did.push(`Made the task “${act.title}” for ${who}`);
        } else if (act.kind === 'set') {
          const patch = patchFor(s, ev.object, rec, act.field, act.value);
          if (!patch) { failed = ownFields(s, ev.object).some((f) => f.id === act.field) ? 'The value doesn’t fit the field' : 'Its settings no longer fit'; break; }
          s = core(s, { type: 'records/fields', object: ev.object, changes: [{ id: ev.id, patch }] });
          did.push(`Set ${ownFields(s, ev.object).find((f) => f.id === act.field)?.name ?? 'a field'}`);
        } else {
          const who = whoOf(act.who);
          if (who === s.me) s = { ...s, inbox: [inboxLine(auto, 'automation', 'sent you a notice about', act.message || summaryOf(s, auto), link), ...s.inbox] };
          did.push(`Told ${who}`);
        }
      }
      runs.push({ id: newId('run'), automationId: auto.id, at: new Date(), record: link, taskId: ev.taskId, status: failed ? 'failed' : 'done', reason: failed, did: failed ? `Couldn’t finish: ${failed.toLowerCase()}` : did.join(' · ') });
      const failures = failed ? (auto.failures ?? 0) + 1 : 0;
      s = { ...s, automations: s.automations.map((x) => (x.id === auto.id ? { ...x, lastRun: new Date(), failures, ...(failures >= 5 ? { on: false, offReason: 'Turned off: 5 runs failed in a row' } : failed === 'The person it ran as left' ? { on: false, offReason: 'Turned off: the person it ran as left' } : {}) } : x)) };
    }
  }
  return runs.length ? { ...s, runs: [...runs, ...s.runs].slice(0, 200) } : s;
}
const inboxLine = (auto: Automation, kind: InboxItem['kind'], text: string, excerpt: string, record: RecordLink, taskId?: string): InboxItem => ({ id: newId('i'), kind, actor: `${auto.runAs}’s automation`, text, excerpt, at: new Date(), read: false, done: false, record, taskId });

/* -------------------------------------------------------------- words */

/** The one line a list row reads: "When a deal's Stage becomes Won, create task “Send contract” for Owner". */
export function summaryOf(state: AppState, a: Automation): string {
  const t = a.trigger;
  const obj = (o: ObjectId) => wordsOf(state, o).one;
  const field = (o: ObjectId, f: string) => ownFields(state, o).find((x) => x.id === f);
  const when = t.kind === 'taskDue' ? 'When a task is due' : t.kind === 'created' ? `When a ${obj(t.object)} is created`
    : t.to ? `When ${obj(t.object)} ${field(t.object, t.field)?.name ?? 'a field'} becomes ${field(t.object, t.field)?.options?.find((o) => o.id === t.to)?.label ?? t.to}` : `When ${obj(t.object)} ${field(t.object, t.field)?.name ?? 'a field'} changes`;
  const who = (w: string) => (w === 'owner' ? 'Owner' : w);
  const then = a.actions.map((x) => (x.kind === 'task' ? `create task “${x.title}” for ${who(x.who)}` : x.kind === 'set' ? `set ${t.kind === 'taskDue' ? 'a field' : field((t as { readonly object: ObjectId }).object, x.field)?.name ?? 'a field'}` : `notify ${who(x.who)}`)).join(', ');
  return `${when}${a.conditions.length ? ' (with conditions)' : ''}, ${then}`;
}

/** The three starters: a new deal makes a follow-up, a won deal makes "Send contract", a task due tells its owner. */
function starter(state: AppState, id: 'new-deal' | 'stage-won' | 'task-due'): Omit<Automation, 'id' | 'created' | 'runAs' | 'on'> {
  if (id === 'new-deal') return { trigger: { kind: 'created', object: 'deals' }, conditions: [], match: 'all', actions: [{ kind: 'task', title: 'Follow up', who: 'owner', days: 2 }] };
  if (id === 'stage-won') return { trigger: { kind: 'changed', object: 'deals', field: 'stage', to: state.objects.find((o) => o.id === 'deals')?.attributes.find((a) => a.id === 'stage')?.options?.find((o) => o.outcome === 'won')?.id ?? 'Won' }, conditions: [], match: 'all', actions: [{ kind: 'task', title: 'Send contract', who: 'owner', days: 1 }] };
  return { trigger: { kind: 'taskDue' }, conditions: [], match: 'all', actions: [{ kind: 'notify', who: 'owner', message: 'A task is due today' }] };
}

/* ------------------------------------------------------------- screen */

/** Settings › Automations: the list (switch, what it does, who it runs as, last run), the builder, and Runs with failures. */
export function AutomationsPage({ state, dispatch, onOpenRecord }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onOpenRecord?: (object: ObjectId, id: string) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Automation | 'new' | Omit<Automation, 'id' | 'created' | 'runAs' | 'on'>>();
  const [tab, setTab] = useState('automations');
  const list = state.automations;
  const remove = (a: Automation) => { const at = list.findIndex((x) => x.id === a.id); dispatch({ type: 'automation/remove', id: a.id }); toast({ message: 'Automation deleted', action: { label: 'Undo', onAction: () => dispatch({ type: 'automation/insert', automation: a, at }) } }); };
  const starters = (
    <ChoiceChips label="Start from" isLabelHidden size="sm" selectionMode="single" selectedKeys={[]} onSelectionChange={(k) => { const id = [...k][0]; if (id === 'new-deal' || id === 'stage-won' || id === 'task-due') setEditing(starter(state, id)); }}
      items={[{ id: 'new-deal', label: 'New deal → task' }, { id: 'stage-won', label: 'Stage won → task' }, { id: 'task-due', label: 'Task due → notify' }]} />
  );
  return (
    <>
      <Tabs aria-label="Automations views" selectedKey={tab} onSelectionChange={setTab} items={[{ id: 'automations', label: 'Automations', count: list.length }, { id: 'runs', label: 'Runs', count: state.runs.length }]}>
        <TabPanel id="automations">
          <SettingsSection title="Automations" description="When something happens to a record, do the next step for you. Each runs as the person who turned it on." action={<Button variant="primary" icon={<Plus {...i14} />} onPress={() => setEditing('new')}>New automation</Button>}>
            {list.length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="Nothing automated yet" description="Start from one of these." action={starters} /> : (
              <>
                <ul className="tf-auto">
                  {list.map((a) => (
                    <li key={a.id} className="tf-auto__row">
                      <Switch aria-label={`Turn on ${summaryOf(state, a)}`} isSelected={a.on} onChange={(on) => { dispatch({ type: 'automation/set', automation: { ...a, on, runAs: on ? state.me : a.runAs, offReason: on ? undefined : a.offReason, failures: on ? 0 : a.failures } }); toast({ message: on ? 'Automation on. It runs as you.' : 'Automation off', action: { label: 'Undo', onAction: () => dispatch({ type: 'automation/set', automation: a }) } }); }} />
                      <button type="button" className="tf-auto__text" onClick={() => setEditing(a)}>
                        <span className="tf-auto__what">{summaryOf(state, a)}</span>
                        <span className="tf-rec__muted">Runs as {state.members.some((m) => m.name === a.runAs) ? a.runAs : 'a former member'} · {a.lastRun ? `Last run ${ago(a.lastRun)}` : 'Hasn’t run'}</span>
                      </button>
                      {a.offReason ? <Tag size="sm" hue="orange">{a.offReason.replace('Turned off: ', '')}</Tag> : <span />}
                      <MenuTrigger>
                        <IconButton size="sm" label="More actions"><MoreHorizontal {...i14} /></IconButton>
                        <Menu aria-label="Automation" placement="bottom end" onAction={(k) => { if (k === 'edit') setEditing(a); else remove(a); }}>
                          <MenuItem id="edit">Edit</MenuItem>
                          <MenuItem id="delete" isDanger>Delete</MenuItem>
                        </Menu>
                      </MenuTrigger>
                    </li>
                  ))}
                </ul>
                <div className="tf-auto__start"><span className="tf-rec__muted">Start from</span>{starters}</div>
              </>
            )}
          </SettingsSection>
        </TabPanel>
        <TabPanel id="runs">
          <SettingsSection title="Runs" description="What each automation did, newest first. Failed runs say why.">
            {state.runs.length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="No runs yet" description="Runs show here once an automation that’s on meets its trigger." /> : (
              <ul className="tf-set__list tf-auto__runs">
                {state.runs.slice(0, 60).map((r) => {
                  const a = list.find((x) => x.id === r.automationId);
                  return (
                    <li key={r.id}>
                      <span className="tf-auto__run">
                        <strong>{a ? summaryOf(state, a) : 'Deleted automation'}</strong>
                        <span className="tf-rec__muted tf-num">{ago(r.at)} · For {r.record ? (onOpenRecord ? <Link onPress={() => { if (r.record) onOpenRecord(r.record.object, r.record.id); }}>{recordName(state, r.record).name}</Link> : recordName(state, r.record).name) : 'a task'} · {r.did}</span>
                      </span>
                      <Tag size="sm" hue={r.status === 'done' ? 'green' : 'red'}>{r.status === 'done' ? 'Done' : r.reason ?? 'Failed'}</Tag>
                    </li>
                  );
                })}
              </ul>
            )}
          </SettingsSection>
        </TabPanel>
      </Tabs>
      {editing && <AutomationDialog state={state} start={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSave={(a) => {
        const was = state.automations.find((x) => x.id === a.id);
        dispatch({ type: 'automation/set', automation: a }); setEditing(undefined);
        toast({ message: was ? 'Automation saved' : 'Automation on. It runs as you.', tone: 'success', action: was ? { label: 'Undo', onAction: () => dispatch({ type: 'automation/set', automation: was }) } : { label: 'Undo', onAction: () => dispatch({ type: 'automation/remove', id: a.id }) } });
      }} />}
    </>
  );
}

/** The builder, read as a sentence: When … Only if … Then …. */
function AutomationDialog({ state, start, onClose, onSave }: { readonly state: AppState; readonly start?: Automation | Omit<Automation, 'id' | 'created' | 'runAs' | 'on'>; readonly onClose: () => void; readonly onSave: (a: Automation) => void }) {
  const saved = start && 'id' in start ? start : undefined;
  const objects = state.objects.filter((o) => !o.archived);
  const [trigger, setTrigger] = useState<AutomationTrigger>(start?.trigger ?? { kind: 'created', object: 'deals' });
  const [conditions, setConditions] = useState<ReadonlyArray<ViewFilter>>(start?.conditions ?? []);
  const [match, setMatch] = useState<'all' | 'any'>(start?.match ?? 'all');
  const [actions, setActions] = useState<ReadonlyArray<AutomationAction>>(start?.actions ?? [{ kind: 'task', title: '', who: 'owner', days: 1 }]);
  const subject = trigger.kind === 'taskDue' ? 'task' : trigger.object;
  const object = trigger.kind === 'taskDue' ? undefined : trigger.object;
  const fields = object ? ownFields(state, object).filter((f) => !f.readOnly || f.id === 'company') : [];
  const watchField = trigger.kind === 'changed' ? fields.find((f) => f.id === trigger.field) : undefined;
  const condFields = object ? filterFields(state, object).filter((f) => !f.via) : [];
  const who = [{ id: 'owner', label: 'Owner' }, ...state.members.map((m) => ({ id: m.name, label: m.name }))];
  const ready = actions.length > 0 && actions.every((x) => (x.kind === 'task' ? x.title.trim() !== '' : x.kind === 'set' ? x.field !== '' && Boolean(object) : x.who !== '')) && conditions.every((c) => c.field && (c.operator.includes('empty') || c.values.length > 0));
  const setAct = (i: number, a: AutomationAction) => setActions((xs) => xs.map((x, j) => (j === i ? a : x)));
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title={saved ? 'Edit automation' : 'New automation'}
      actions={<><span className="tf-rec__muted tf-auto__runas">Runs as you, {state.me}. It can’t do more than you can.</span><Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isDisabled={!ready} onPress={() => onSave({ id: saved?.id ?? newId('au'), created: saved?.created ?? new Date(), on: saved ? saved.on : true, runAs: state.me, lastRun: saved?.lastRun, trigger, conditions, match, actions: actions.map((x) => (x.kind === 'task' ? { ...x, title: x.title.trim() } : x)) })}>{saved ? 'Save' : 'Turn on'}</Button></>}>
      <section className="tf-auto__part" aria-label="When">
        <h3 className="tf-auto__h">When</h3>
        <div className="tf-auto__line">
          <Select label="What" value={subject} onChange={(v) => { if (!v) return; setConditions([]); setActions((xs) => xs.filter((x) => x.kind !== 'set')); setTrigger(v === 'task' ? { kind: 'taskDue' } : { kind: 'created', object: v }); }}
            items={[...objects.map((o) => ({ id: o.id, label: `A ${o.one.toLowerCase()}` })), { id: 'task', label: 'A task' }]} />
          {object ? <Select label="Event" value={trigger.kind === 'changed' ? trigger.field : 'created'} onChange={(v) => { if (!v) return; setTrigger(v === 'created' ? { kind: 'created', object } : { kind: 'changed', object, field: v }); }}
            items={[{ id: 'created', label: 'is created' }, ...fields.map((f) => ({ id: f.id, label: `${f.name} changes` }))]} /> : <span className="tf-auto__fixed">is due</span>}
          {trigger.kind === 'changed' && watchField?.options && <Select label="Value" value={trigger.to ?? 'any'} onChange={(v) => setTrigger({ ...trigger, to: v && v !== 'any' ? v : undefined })}
            items={[{ id: 'any', label: 'to anything' }, ...(watchField.type === 'actor' ? state.members.map((m) => ({ id: m.name, label: `to ${m.name}` })) : watchField.options.filter((o) => o.id !== '').map((o) => ({ id: o.id, label: `to ${o.label}` })))]} />}
        </div>
      </section>
      {object && (
        <section className="tf-auto__part" aria-label="Only if">
          <h3 className="tf-auto__h">Only if <span className="tf-rec__muted">Only this record’s own fields.</span></h3>
          {conditions.length > 1 && <Select label="Match" isLabelHidden className="tf-you__select" value={match} onChange={(v) => setMatch(v === 'any' ? 'any' : 'all')} items={[{ id: 'all', label: 'Every condition' }, { id: 'any', label: 'Any condition' }]} />}
          {conditions.map((c, i) => {
            const f = condFields.find((x) => x.id === c.field); const kind = f ? kindOf(f.type) : 'text';
            const opts = f?.type === 'actor' ? state.members.map((m) => ({ id: m.name, label: m.name })) : f?.options?.filter((o) => o.id !== '');
            const put = (p: Partial<ViewFilter>) => setConditions((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={c.id} className="tf-auto__cond">
                <Select label="Field" isLabelHidden value={c.field || null} onChange={(v) => { if (v) { const k = kindOf(condFields.find((x) => x.id === v)?.type ?? 'text'); put({ field: v, operator: OPERATORS[k][0] ?? 'is', values: [] }); } }} items={condFields.map((x) => ({ id: x.id, label: x.name }))} />
                <Select label="Operator" isLabelHidden value={c.operator} onChange={(v) => v && put({ operator: v, values: v.includes('empty') ? [] : c.values })} items={OPERATORS[kind].map((o) => ({ id: o, label: o }))} />
                {c.operator.includes('empty') ? <span /> : opts && (c.operator === 'is' || c.operator === 'is not') ? <Select label="Value" isLabelHidden value={c.values[0] ?? null} onChange={(v) => put({ values: v ? [v] : [] })} items={opts.map((o) => ({ id: o.id, label: o.label }))} placeholder="Pick one" />
                  : <TextField aria-label="Value" value={c.values[0] ?? ''} onChange={(v) => put({ values: v ? [v] : [] })} type={kind === 'date' && !c.operator.startsWith('in the') ? 'date' : 'text'} placeholder={c.operator.startsWith('in the') ? 'Days' : kind === 'number' ? 'Amount' : 'Value'} />}
                <IconButton size="sm" label={`Remove condition ${i + 1}`} onPress={() => setConditions((xs) => xs.filter((_, j) => j !== i))}><X {...i14} /></IconButton>
              </div>
            );
          })}
          <div className="tf-rec__addrow"><Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setConditions((xs) => [...xs, { id: newId('ac'), field: condFields[0]?.id ?? '', operator: OPERATORS[kindOf(condFields[0]?.type ?? 'text')][0] ?? 'is', values: [] }])}>Add a condition</Button></div>
        </section>
      )}
      <section className="tf-auto__part" aria-label="Then">
        <h3 className="tf-auto__h">Then</h3>
        {actions.map((x, i) => (
          <div key={i} className="tf-auto__act">
            <Select label={`Action ${i + 1}`} isLabelHidden value={x.kind} onChange={(v) => setAct(i, v === 'set' ? { kind: 'set', field: fields[0]?.id ?? '', value: '' } : v === 'notify' ? { kind: 'notify', who: 'owner', message: '' } : { kind: 'task', title: '', who: 'owner', days: 1 })}
              items={[{ id: 'task', label: 'create a task' }, ...(object ? [{ id: 'set', label: 'set a field' }] : []), { id: 'notify', label: 'notify' }]} />
            {x.kind === 'task' && <>
              <TextField aria-label="Task title" value={x.title} onChange={(v) => setAct(i, { ...x, title: v })} placeholder="Send contract" />
              <Select label="For" isLabelHidden value={x.who} onChange={(v) => v && setAct(i, { ...x, who: v })} items={who.map((y) => ({ ...y, label: `for ${y.label}` }))} />
              <Select label="Due in" isLabelHidden value={String(x.days)} onChange={(v) => v && setAct(i, { ...x, days: Number(v) })} items={['0', '1', '2', '3', '7', '14'].map((d) => ({ id: d, label: d === '0' ? 'due today' : `due in ${d} ${d === '1' ? 'day' : 'days'}` }))} />
            </>}
            {x.kind === 'set' && (() => { const f = fields.find((y) => y.id === x.field); const attr = f ? attributeOf(state, f) : undefined; return <>
              <Select label="Field" isLabelHidden value={x.field || null} onChange={(v) => v && setAct(i, { ...x, field: v, value: '' })} items={fields.filter((y) => y.id !== 'name').map((y) => ({ id: y.id, label: y.name }))} />
              {attr && <span className="tf-auto__value"><AttributeRow attribute={{ ...attr, name: 'to' }} value={fieldValue(attr, x.value)} onChange={(v) => setAct(i, { ...x, value: valueToCell(attr, v) })} /></span>}
            </>; })()}
            {x.kind === 'notify' && <>
              <Select label="Who" isLabelHidden value={x.who} onChange={(v) => v && setAct(i, { ...x, who: v })} items={who} />
              <TextField aria-label="Message" value={x.message} onChange={(v) => setAct(i, { ...x, message: v })} placeholder="Message (optional)" />
            </>}
            <IconButton size="sm" label={`Remove action ${i + 1}`} isDisabled={actions.length === 1} onPress={() => setActions((xs) => xs.filter((_, j) => j !== i))}><X {...i14} /></IconButton>
          </div>
        ))}
        {actions.length < MAX_ACTIONS && <div className="tf-rec__addrow"><Button size="sm" variant="ghost" icon={<Plus {...i14} />} onPress={() => setActions((xs) => [...xs, { kind: 'task', title: '', who: 'owner', days: 1 }])}>Add action</Button></div>}
      </section>
    </Dialog>
  );
}

/** Which automations name an attribute (for the archive warning). */
export const automationsUsing = (state: AppState, object: ObjectId, field: string): ReadonlyArray<string> => state.automations.filter((a) => (a.trigger.kind === 'changed' && a.trigger.object === object && a.trigger.field === field) || (a.trigger.kind !== 'taskDue' && a.trigger.object === object && (a.conditions.some((c) => c.field === field) || a.actions.some((x) => x.kind === 'set' && x.field === field)))).map((a) => `automation “${summaryOf(state, a)}”`);
export const objectNameOf = (state: AppState, id: string) => schemaOf(state, id)?.many ?? id;
