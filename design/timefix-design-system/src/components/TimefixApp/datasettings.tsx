// Settings › Data: Objects (reorder, attributes with formula, lookup, rollup and relationship kinds, archived attributes, stage outcomes and
// target times), Trash (filter by object, select many to restore or delete for good, open one read only) and Imports and exports (each
// import's rows and errors, the error rows as a CSV, Undo for 7 days).
import { useState } from 'react';
import { ArrowLeft, Boxes, Building2, ChevronRight, CircleDollarSign, Download, FileDown, Trash2, Undo2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { AttributeSettings, type SchemaAttribute } from '../AttributeSettings/AttributeSettings.tsx';
import { FormulaEditor } from '../FormulaEditor/FormulaEditor.tsx';
import { RelationshipSettings, sidesHoldMany, type Relationship, type SchemaObject } from '../RelationshipSettings/RelationshipSettings.tsx';
import { SortableList } from '../DragHandle/DragHandle.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Button } from '../Button/Button.tsx';
import { ConfirmDialog, Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { newId, type AppAction, type AppState, type ImportJob, type ObjectId, type ObjectSchema } from './data.ts';
import { computedValues, formulaAttributes, liveAttributes, ownFields, recordsOf, relationsOf, schemaOf, valuesOf, wordsOf } from './model.tsx';
import { automationsUsing } from './automations.tsx';
import { undoImport } from './importer.tsx';
import { IconPicker, IconTile } from '../IconPicker/IconPicker.tsx';
import { Meter } from '../Progress/Progress.tsx';
import { Link } from '../Link/Link.tsx';
import type { Hue } from '../Tag/Tag.tsx';

/** The plan's limits, as the real app's engine has them (#38 later reads them from the plan). */
export const LIMITS = { customObjects: 50, attributes: 250, lists: 500, automations: 50, teams: 100, invites: 100, reports: 200 } as const;
/** A limit for this workspace; the prototype's "at its plan limits" demo lowers it to what's used. */
export const limitOf = (state: AppState, key: keyof typeof LIMITS, used: number) => (state.prefs.tightLimits ? Math.max(1, used) : LIMITS[key]);
/** The calm at-limit line: how much is used, the way forward, and who to ask for more room. */
export function AtLimit({ used, limit, what }: { readonly used: number; readonly limit: number; readonly what: string }) {
  const [asking, setAsking] = useState(false);
  return <>
    <span className="tf-rec__muted tf-num">{used} of {limit} used. Archive one first, or <Link onPress={() => setAsking(true)}>ask for more room</Link>.</span>
    {asking && <Dialog isOpen onOpenChange={setAsking} title="More room" description={`Your plan holds ${limit} ${what}. Write to us and we’ll raise it for your workspace.`}
      actions={<><Button variant="ghost" slot="close">Not now</Button><Button variant="primary" onPress={() => { window.open('mailto:hello@timefix.com?subject=More%20room', '_blank', 'noopener'); setAsking(false); }}>Email Timefix</Button></>} />}
  </>;
}
const DEFAULT_ICON: Readonly<Record<string, string>> = { people: 'Person', companies: 'Building', deals: 'Handshake' };
/** An object's icon name, its own or the built-in default. */
export const iconOf = (o: ObjectSchema) => o.icon ?? DEFAULT_ICON[o.id] ?? 'Folder';
const hueOf = (o: ObjectSchema): Hue => (['blue', 'green', 'purple', 'orange', 'gray'].includes(o.colour ?? '') ? (o.colour as Hue) : 'blue');
/** The object's icon picker, drawn on its hue. */
export function ObjectIcon({ o, onPick }: { readonly o: ObjectSchema; readonly onPick: (name: string) => void }) {
  return <IconPicker label={`Icon: ${iconOf(o)}`} value={iconOf(o)} hue={hueOf(o)} onChange={onPick} />;
}

const i14 = { size: 14, strokeWidth: 1.75 } as const;
const when = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const ICONS: Readonly<Record<string, LucideIcon>> = { people: Users, companies: Building2, deals: CircleDollarSign };

/** What uses an attribute: saved views, forms that fill it, automations and reports. Said before archiving. */
export function usageOf(state: AppState, object: ObjectId, id: string): ReadonlyArray<string> {
  const views = (state.views[object] ?? []).filter((v) => v.filters.some((f) => f.field === id) || (v.groups ?? []).some((g) => g.rules.some((f) => f.field === id)) || v.sorts.some((x) => x.field === id) || v.groupBy === id || v.rowGroup === id || v.boardSum === id).map((v) => `view “${v.name}”`);
  const forms = state.forms.filter((f) => f.saveTo === object && Object.values(f.mapping ?? {}).includes(id)).map((f) => `form “${f.name}”`);
  const reports = state.reports.filter((r) => (r.object ?? 'deals') === object && (r.group === id || r.field === id)).map((r) => `report “${r.name}”`);
  return [...views, ...forms, ...reports, ...automationsUsing(state, object, id)];
}

/** Settings › Objects: drag to reorder, open one for its attributes, configuration and access. */
export function ObjectsList({ state, dispatch, onOpen, onNew }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onOpen: (id: string) => void; readonly onNew: () => void }) {
  const { toast } = useToast();
  const counts = (id: string) => recordsOf(state, id).length;
  const custom = state.objects.filter((o) => o.custom).length; const limit = limitOf(state, 'customObjects', custom);
  return (
    <SettingsSection title="Objects" description="What your workspace keeps records of. Drag to reorder the sidebar; open one to add or change its attributes."
      action={<span className="tf-set__row">{custom >= limit && <AtLimit used={custom} limit={limit} what="custom objects" />}<Button variant="secondary" isDisabled={custom >= limit} onPress={onNew}>New object</Button></span>}>
      {custom >= limit * 0.8 && <Meter label="Custom objects" value={custom} maxValue={limit} valueLabel={`${custom} of ${limit}`} />}
      <SortableList items={state.objects} label="Objects" getText={(o) => o.many} onReorder={(next) => { const was = state.objects.map((o) => o.id); dispatch({ type: 'objects/order', ids: next.map((o) => o.id) }); toast({ message: 'Order saved', action: { label: 'Undo', onAction: () => dispatch({ type: 'objects/order', ids: was }) } }); }}>
        {(x) => (
          <button type="button" className="tf-set__open tf-set__open--drag tf-set__objrow" onClick={() => onOpen(x.id)}>
            <IconTile name={iconOf(x)} hue={hueOf(x)} size="sm" />
            <strong>{x.many}</strong><Tag size="sm" hue={x.custom ? 'purple' : 'gray'}>{x.custom ? 'Custom' : 'Standard'}</Tag>
            <span className="tf-rec__muted tf-num">{counts(x.id)} {counts(x.id) === 1 ? 'record' : 'records'} · {liveAttributes(x).length} attributes{x.archived ? ' · archived' : ''}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </SortableList>
    </SettingsSection>
  );
}

/** One object's attributes, with the extra kinds and the archive warning. */
export function ObjectAttributes({ state, dispatch, o }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly o: ObjectSchema }) {
  const [special, setSpecial] = useState<{ readonly kind: 'formula' | 'lookup' | 'rollup' | 'relationship'; readonly attribute?: SchemaAttribute }>();
  const put = (attributes: ReadonlyArray<SchemaAttribute>) => dispatch({ type: 'object/set', object: { ...o, attributes } });
  const used = o.attributes.filter((a) => !a.archived).length; const limit = limitOf(state, 'attributes', used);
  return (
    <>
      <div className="tf-set__meter"><Meter label="Attributes" value={used} maxValue={limit} valueLabel={`${used} of ${limit}`} hint={used >= limit ? <AtLimit used={used} limit={limit} what={`attributes on ${o.many.toLowerCase()}`} /> : undefined} /></div>
      <AttributeSettings objectName={o.one} objectPlural={o.many} attributes={o.attributes} valueCounts={Object.fromEntries(o.attributes.map((a) => [a.id, recordsOf(state, o.id).length]))}
        onChange={put} usageOf={(id) => usageOf(state, o.id, id)} pluralOf={(id) => schemaOf(state, id)?.many ?? 'Records'}
        onNewSpecial={(kind) => setSpecial({ kind })} onEditSpecial={(a) => setSpecial({ kind: a.relation ? 'relationship' : a.computed?.kind ?? 'formula', attribute: a })} />
      {special && special.kind !== 'relationship' && <ComputedDialog state={state} o={o} kind={special.kind} attribute={special.attribute} onClose={() => setSpecial(undefined)}
        onSave={(a) => { put(special.attribute ? o.attributes.map((x) => (x.id === a.id ? a : x)) : [...o.attributes, a]); setSpecial(undefined); }}
        onArchive={special.attribute ? () => { put(o.attributes.map((x) => (x.id === special.attribute?.id ? { ...x, archived: true } : x))); setSpecial(undefined); } : undefined} />}
      {special?.kind === 'relationship' && <RelationshipDialog state={state} o={o} attribute={special.attribute} onClose={() => setSpecial(undefined)}
        onSave={(a) => { put(special.attribute ? o.attributes.map((x) => (x.id === a.id ? a : x)) : [...o.attributes, a]); setSpecial(undefined); }} />}
    </>
  );
}

/** A formula, lookup or rollup: its name and rule, with a preview on one of the object's records. */
function ComputedDialog({ state, o, kind, attribute, onClose, onSave, onArchive }: { readonly state: AppState; readonly o: ObjectSchema; readonly kind: 'formula' | 'lookup' | 'rollup'; readonly attribute?: SchemaAttribute; readonly onClose: () => void; readonly onSave: (a: SchemaAttribute) => void; readonly onArchive?: () => void }) {
  const c = attribute?.computed;
  const [name, setName] = useState(attribute?.name ?? '');
  const [source, setSource] = useState(c?.kind === 'formula' ? c.source : '');
  const rels = relationsOf(state, o.id);
  const [via, setVia] = useState(c && c.kind !== 'formula' ? c.via : rels[0]?.id ?? '');
  const rel = rels.find((r) => r.id === via);
  const theirFields = rel ? ownFields(state, rel.target).filter((f) => !f.id.includes('.')) : [];
  const [field, setField] = useState(c && c.kind !== 'formula' ? c.field : '');
  const [fn, setFn] = useState<'count' | 'sum' | 'avg' | 'min' | 'max'>(c?.kind === 'rollup' ? c.fn : 'count');
  const [sampleId, setSampleId] = useState(recordsOf(state, o.id)[0]?.id ?? '');
  const sample = recordsOf(state, o.id).find((r) => r.id === sampleId);
  const rule = kind === 'formula' ? { kind, source } as const : kind === 'lookup' ? { kind, via, field } as const : { kind, via, field, fn } as const;
  const draft: SchemaAttribute = { id: attribute?.id ?? newId('attr'), name: name.trim(), type: kind === 'lookup' ? 'text' : 'number', computed: rule };
  // The preview: the attribute worked out for one record, as if it were saved.
  const preview = sample ? computedValues({ ...state, objects: state.objects.map((x) => (x.id === o.id ? { ...x, attributes: [...x.attributes.filter((y) => y.id !== draft.id), draft] } : x)) }, o.id, sample, valuesOf(state, o.id, sample, 2))[draft.id] : undefined;
  const numbers = theirFields.filter((f) => ['number', 'currency', 'percent', 'rating'].includes(f.type));
  const ready = name.trim() !== '' && (kind === 'formula' ? source.trim() !== '' : via !== '' && (kind === 'rollup' && fn === 'count' ? true : field !== ''));
  const title = kind === 'formula' ? 'Formula' : kind === 'lookup' ? 'Lookup' : 'Rollup';
  return (
    <Dialog isOpen size="wide" onOpenChange={(v) => { if (!v) onClose(); }} title={attribute ? attribute.name : `New ${title.toLowerCase()}`} description={kind === 'formula' ? 'Works out a number from this record’s fields. Type @ for a field.' : kind === 'lookup' ? 'Shows a value from a linked record.' : 'Counts or adds up linked records.'}
      actions={<>{onArchive && <Button variant="ghost" onPress={onArchive}>Archive</Button>}<span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ready} onPress={() => onSave(draft)}>{attribute ? 'Save' : `Create ${title.toLowerCase()}`}</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} autoFocus={!attribute} placeholder={kind === 'formula' ? 'Weighted value' : kind === 'lookup' ? 'Company industry' : 'Open deals'} />
        {attribute && <span className="tf-rec__muted">{`It stays a ${title.toLowerCase()}: for ${kind === 'formula' ? 'a lookup or rollup' : kind === 'lookup' ? 'a formula or rollup' : 'a formula or lookup'}, or a different result type, create a new attribute.`}</span>}
        {kind === 'formula' ? (
          <FormulaEditor label="Formula" value={source} onChange={setSource} attributes={formulaAttributes(state, o.id)} sample={{ name: sample?.name ?? 'A record', values: Object.fromEntries(Object.entries(sample ? valuesOf(state, o.id, sample, 2) : {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Number(v)])) }} />
        ) : (
          <>
            {rels.length === 0 ? <Callout tone="info">{o.many} don’t link to anything yet. Add a relationship first.</Callout> : <>
              <div className="tf-bkf__pair">
                <Select label="Through" value={via || null} onChange={(v) => { setVia(v ?? ''); setField(''); }} items={rels.map((r) => ({ id: r.id, label: r.name, description: `${wordsOf(state, r.target).Many} · ${r.many ? 'many' : 'one'}` }))} />
                {kind === 'rollup' && <Select label="Work out" value={fn} onChange={(v) => setFn((v ?? 'count') as typeof fn)} items={[{ id: 'count', label: 'How many' }, { id: 'sum', label: 'Total' }, { id: 'avg', label: 'Average' }, { id: 'min', label: 'Smallest' }, { id: 'max', label: 'Largest' }]} />}
              </div>
              {(kind === 'lookup' || fn !== 'count') && <Select label={kind === 'lookup' ? 'Show their' : 'Of their'} value={field || null} onChange={(v) => setField(v ?? '')} placeholder="Pick a field" items={(kind === 'lookup' ? theirFields : numbers).map((f) => ({ id: f.id, label: f.name }))} />}
            </>}
          </>
        )}
        <div className="tf-set__preview">
          <Select label="Preview on" value={sampleId || null} onChange={(v) => setSampleId(v ?? '')} items={recordsOf(state, o.id).slice(0, 40).map((r) => ({ id: r.id, label: r.name }))} placeholder={`No ${o.many.toLowerCase()} yet`} />
          {kind !== 'formula' && <p className="tf-set__previewval"><span className="tf-rec__muted">Gives</span> <strong className="tf-num">{preview === undefined || preview === '' ? 'Nothing yet' : typeof preview === 'number' ? preview.toLocaleString('en-IN') : String(preview)}</strong></p>}
        </div>
      </div>
    </Dialog>
  );
}

/** A relationship between two objects: the library's RelationshipSettings, saved as an attribute on this object that the other side shows too. */
function RelationshipDialog({ state, o, attribute, onClose, onSave }: { readonly state: AppState; readonly o: ObjectSchema; readonly attribute?: SchemaAttribute; readonly onClose: () => void; readonly onSave: (a: SchemaAttribute) => void }) {
  const objects: ReadonlyArray<SchemaObject> = state.objects.filter((x) => !x.archived).map((x) => ({ id: x.id, singular: x.one, plural: x.many, icon: ICONS[x.id] ?? Boxes, hue: (x.colour === 'green' || x.colour === 'purple' || x.colour === 'orange' || x.colour === 'gray' ? x.colour : 'blue') }));
  const target = attribute?.relation?.target ?? state.objects.find((x) => x.id !== o.id && !x.archived)?.id ?? o.id;
  const [value, setValue] = useState<Relationship>(attribute?.relation ? { fromId: o.id, toId: attribute.relation.target, cardinality: attribute.relation.many ? 'manyToMany' : 'oneToOne', fromName: attribute.name, toName: attribute.relation.otherName }
    : { fromId: o.id, toId: target, cardinality: 'oneToMany', fromName: schemaOf(state, target)?.many ?? 'Records', toName: o.one });
  const clash = value.fromId === value.toId && value.fromName.trim().toLowerCase() === value.toName.trim().toLowerCase();
  return (
    <Dialog isOpen size="wide" onOpenChange={(v) => { if (!v) onClose(); }} title={attribute ? `Relationship · ${attribute.name}` : 'New relationship'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!value.fromName.trim() || !value.toName.trim() || clash} onPress={() => onSave({ id: attribute?.id ?? newId('rel'), name: value.fromName.trim(), type: 'record', relation: { target: value.toId, many: sidesHoldMany(value.cardinality).fromHoldsMany, otherName: value.toName.trim() } })}>{attribute ? 'Save' : 'Create relationship'}</Button></>}>
      <RelationshipSettings objects={objects} value={value} onChange={(v) => { if (v.fromId === o.id) setValue(v); }} mode={attribute ? 'edit' : 'create'} />
    </Dialog>
  );
}

/** The stages of a status attribute: each one's outcome (open, won, lost) and its target time; a record sitting longer reads as stale. */
export function StageRules({ o, save }: { readonly o: ObjectSchema; readonly save: (patch: Partial<ObjectSchema>, message?: string) => void }) {
  const statuses = liveAttributes(o).filter((a) => a.type === 'status');
  if (statuses.length === 0) return null;
  return (
    <>
      {statuses.map((a) => (
        <SettingsSection key={a.id} title={a.name === 'Stage' ? 'Stages' : `${a.name} stages`} description="Won and lost stages end a pipeline: forecasts and open totals read them. A target time marks records that sit too long as stale.">
          <ul className="tf-set__list tf-stage">
            {(a.options ?? []).filter((x) => !x.archived).map((opt) => {
              const outcome = opt.outcome ?? (o.id === 'deals' && opt.id === 'Won' ? 'won' : o.id === 'deals' && opt.id === 'Lost' ? 'lost' : undefined);
              const setOpt = (p: Partial<typeof opt>, msg: string) => save({ attributes: o.attributes.map((x) => (x.id === a.id ? { ...x, options: (x.options ?? []).map((y) => (y.id === opt.id ? { ...y, ...p } : y)) } : x)) }, msg);
              return (
                <li key={opt.id}>
                  <span className="tf-stage__name"><Tag size="sm" hue={opt.hue}>{opt.label}</Tag></span>
                  <Select label={`${opt.label} outcome`} isLabelHidden className="tf-you__select" value={outcome ?? 'open'} onChange={(v) => v && setOpt({ outcome: v === 'won' ? 'won' : v === 'lost' ? 'lost' : undefined }, `${opt.label}: ${v === 'open' ? 'still open' : v}`)} items={[{ id: 'open', label: 'Still open' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' }]} />
                  <TextField aria-label={`Target days in ${opt.label}`} className="tf-stage__days" value={opt.targetDays === undefined ? '' : String(opt.targetDays)} placeholder={outcome ? '—' : '21'} isDisabled={outcome !== undefined} suffix={<span className="tf-rec__muted">days</span>}
                    onChange={(v) => { const n = v.replace(/[^\d]/g, ''); setOpt({ targetDays: n ? Number(n) : undefined }, n ? `${opt.label}: stale after ${n} days` : `${opt.label}: default target`); }} />
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      ))}
    </>
  );
}

/** Settings › Trash: deleted records for 30 days, any object. Filter by object, pick several to restore or delete for good (asks first), open one read only. */
export function TrashPage({ state, dispatch, onOpenRecord, onOpenTrashed, startObject }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onOpenRecord?: (object: ObjectId, id: string) => void; readonly onOpenTrashed?: (object: ObjectId, id: string) => void; readonly startObject?: string }) {
  const { toast } = useToast();
  const [purge, setPurge] = useState<ReadonlyArray<string>>();
  const [only, setOnly] = useState(startObject && state.objects.some((o) => o.id === startObject) ? startObject : 'all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const days = (d: Date) => Math.max(0, 30 - Math.floor((Date.now() - d.getTime()) / 86_400_000));
  const kind = (o: ObjectId) => schemaOf(state, o)?.one ?? 'Record';
  const items = state.trash.filter((t) => only === 'all' || t.object === only);
  const objectsIn = state.objects.filter((o) => state.trash.some((t) => t.object === o.id));
  const sel = items.filter((t) => picked.has(t.id));
  const restore = (ids: ReadonlyArray<string>) => {
    const list = state.trash.filter((t) => ids.includes(t.id));
    dispatch({ type: 'records/untrash', ids: list.map((t) => t.record.id) }); setPicked(new Set());
    toast({ message: list.length === 1 ? `${list[0]?.record.name ?? 'Record'} restored` : `${list.length} records restored`, tone: 'success', action: list.length === 1 && onOpenRecord ? { label: 'Open', onAction: () => { const t = list[0]; if (t) onOpenRecord(t.object, t.record.id); } } : undefined });
  };
  return (
    <SettingsSection title="Trash" description="Deleted records wait here for 30 days, then they're gone for good."
      action={state.trash.length > 0 ? <Button variant="ghost" onPress={() => setPurge(state.trash.map((t) => t.id))}>Empty trash</Button> : undefined}>
      {state.trash.length === 0 ? <EmptyState size="sm" icon={<Trash2 size={20} strokeWidth={1.75} />} title="Trash is empty" description="Records you delete land here, and you can restore them." /> : (
        <>
          <div className="tf-trash__bar">
            <ChoiceChips label="Show" isLabelHidden size="sm" selectionMode="single" selectedKeys={[only]} onSelectionChange={(k) => { setOnly([...k][0] ?? 'all'); setPicked(new Set()); }}
              items={[{ id: 'all', label: `All ${state.trash.length}` }, ...objectsIn.map((o) => ({ id: o.id, label: `${o.many} ${state.trash.filter((t) => t.object === o.id).length}` }))]} />
            <span className="tf-rec__spacer" />
            {sel.length > 0 && <>
              <span className="tf-rec__muted tf-num">{sel.length} selected</span>
              <Button size="sm" variant="secondary" onPress={() => restore(sel.map((t) => t.id))}>Restore</Button>
              <Button size="sm" variant="ghost" onPress={() => setPurge(sel.map((t) => t.id))}>Delete for good</Button>
            </>}
          </div>
          {items.length === 0 ? <p className="tf-rec__muted">Nothing of that kind in Trash.</p> : (
            <ul className="tf-set__list tf-trash">
              <li className="tf-trash__all"><Checkbox isSelected={sel.length === items.length} isIndeterminate={sel.length > 0 && sel.length < items.length} onChange={(on) => setPicked(on ? new Set(items.map((t) => t.id)) : new Set())}>Select all {items.length}</Checkbox></li>
              {items.map((t) => (
                <li key={t.id}>
                  <Checkbox aria-label={`Select ${t.record.name}`} isSelected={picked.has(t.id)} onChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(t.id); else n.delete(t.id); return n; })} />
                  <button type="button" className="tf-trash__open" onClick={() => onOpenTrashed?.(t.object, t.record.id)} disabled={!onOpenTrashed}>
                    <strong>{t.record.name}</strong> <span className="tf-rec__muted">{kind(t.object)} · deleted by {t.by} · {days(t.at) === 0 ? 'goes today' : `${days(t.at)} ${days(t.at) === 1 ? 'day' : 'days'} left`}{t.mergedInto ? ' · merged' : ''}</span>
                  </button>
                  <span className="tf-set__row">
                    <Button size="sm" variant="secondary" onPress={() => restore([t.id])}>Restore</Button>
                    <Button size="sm" variant="ghost" onPress={() => setPurge([t.id])}>Delete for good</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog isOpen={purge !== undefined} onOpenChange={(v) => { if (!v) setPurge(undefined); }} title={purge?.length === 1 ? 'Delete for good?' : `Delete ${purge?.length ?? 0} records for good?`} consequence="They can't be restored after this." confirmLabel="Delete for good" cancelLabel="Keep them"
        onConfirm={() => { if (purge) dispatch({ type: 'trash/purge', ids: purge }); setPicked(new Set()); setPurge(undefined); toast({ message: 'Deleted for good' }); }} />
    </SettingsSection>
  );
}

/** Settings › Imports and exports: every CSV that came in or went out; an import opens to its rows and errors, with Undo for 7 days. */
export function JobsPage({ state, dispatch, onImport, startJob }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onImport?: () => void; readonly startJob?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<string | undefined>(startJob);
  const jobs = state.prefs.jobs ?? [];
  const job = jobs.find((j) => j.id === open);
  const fresh = (j: ImportJob) => Date.now() - j.at.getTime() < 7 * 86_400_000;
  const setJob = (id: string, patch: Partial<ImportJob>) => dispatch({ type: 'prefs/update', fn: (p) => ({ jobs: (p.jobs ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }) });
  if (job) {
    const errors = (job.lines ?? []).filter((l) => l.result === 'error' || l.result === 'skipped');
    return (
      <SettingsSection title={job.what} description={`${job.kind === 'import' ? 'Imported' : 'Exported'} by ${job.by} · ${when(job.at)}`} action={<Button size="sm" variant="ghost" icon={<ArrowLeft {...i14} />} onPress={() => setOpen(undefined)}>Imports and exports</Button>}>
        <ul className="tf-imp__sum"><li><strong className="tf-num">{job.made ?? job.rows}</strong> added</li><li><strong className="tf-num">{job.updated ?? 0}</strong> updated</li><li><strong className="tf-num">{errors.length}</strong> not imported</li></ul>
        <span className="tf-set__row">
          {errors.length > 0 && <Button size="sm" variant="secondary" icon={<Download {...i14} />} onPress={() => { const csv = ['Row,Name,Why', ...errors.map((l) => `${l.row},"${l.name.replace(/"/g, '""')}","${(l.reason ?? '').replace(/"/g, '""')}"`)].join('\n'); void saveFile(`${(job.name ?? 'import').replace(/\.csv$/i, '')}-errors.csv`, new Blob([csv], { type: 'text/csv' })).then((o) => { if (o === 'saved') toast({ message: 'Rows with errors downloaded', tone: 'success' }); }); }}>Download rows with errors</Button>}
          {job.undo && !job.undone && fresh(job) && <Button size="sm" variant="ghost" icon={<Undo2 {...i14} />} onPress={() => { if (job.undo && job.object) { undoImport(dispatch, job.object, { made: job.made ?? 0, updated: job.updated ?? 0, skipped: [], created: job.undo.created, newCompanies: job.undo.newCompanies ?? [], before: job.undo.before }, state.me); setJob(job.id, { undone: true }); toast({ message: 'Import undone' }); } }}>Undo import</Button>}
          {job.undone && <Tag size="sm">Undone</Tag>}
          {job.undo && !job.undone && !fresh(job) && <span className="tf-rec__muted">Undo was open for 7 days.</span>}
        </span>
        {(job.lines ?? []).length === 0 ? <p className="tf-rec__muted">This import kept no row details.</p> : (
          <ul className="tf-set__list tf-imp__lines">{(job.lines ?? []).map((l) => (
            <li key={l.row}><span><span className="tf-rec__muted tf-num">Row {l.row}</span> <strong>{l.name || 'No name'}</strong>{l.reason ? <span className="tf-rec__muted"> · {l.reason}</span> : null}</span>
              <Tag size="sm" hue={l.result === 'added' ? 'green' : l.result === 'updated' ? 'blue' : l.result === 'error' ? 'red' : 'gray'}>{l.result === 'added' ? 'Added' : l.result === 'updated' ? 'Updated' : l.result === 'error' ? 'Error' : 'Skipped'}</Tag></li>
          ))}</ul>
        )}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Imports and exports" description="Every CSV that came in or went out. Open an import for its rows and errors; Undo stays open for 7 days." action={onImport ? <Button variant="secondary" onPress={onImport}>Import a CSV</Button> : undefined}>
      {jobs.length === 0 ? <EmptyState size="sm" icon={<FileDown size={20} strokeWidth={1.75} />} title="Nothing yet" description="Imports and exports show here when they finish." />
        : <ul className="tf-set__list">{jobs.map((j) => (
          <li key={j.id}>
            {j.kind === 'import' ? <button type="button" className="tf-set__open" onClick={() => setOpen(j.id)}><strong>{j.what}</strong><span className="tf-rec__muted tf-num">Import · {j.rows.toLocaleString('en-IN')} rows · {j.by} · {when(j.at)}{j.undone ? ' · undone' : ''}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button>
              : <span><strong>{j.what}</strong> <span className="tf-rec__muted tf-num">Export · {j.rows.toLocaleString('en-IN')} rows · {j.by} · {when(j.at)}</span></span>}
            {j.kind === 'export' && (j.file !== undefined && j.name ? <Button size="sm" variant="secondary" onPress={() => { void saveFile(j.name ?? 'export.csv', new Blob([j.file ?? ''], { type: 'text/csv' })).then((o) => { if (o === 'saved') toast({ message: `${j.name} downloaded`, tone: 'success' }); }); }}>Download</Button> : <Tag size="sm" hue="green">Done</Tag>)}
          </li>
        ))}</ul>}
    </SettingsSection>
  );
}
