// The record dialogs: New record (with "Add more fields" and required attributes), Bulk edit (several fields at once, add, remove
// or replace for multi-selects), New view, Who can see a view, and Rename. All library Dialogs; ending actions ask first elsewhere.
import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox, Radio, RadioGroup } from '../Checkbox/Checkbox.tsx';
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { AttributeRow } from '../RecordPanel/RecordPanel.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { cellToValue, valueToCell } from '../DataGrid/DataGrid.tsx';
import type { Attribute, AttributeValue } from '../AttributeField/AttributeField.tsx';
import { isBuiltIn, type AppState, type ObjectId, type ViewAccess } from './data.ts';
import { isRequiredFor, liveAttributes, ownFields, schemaOf, wordsOf, type FieldDef } from './model.tsx';

/** A field as the field system draws it: owners pick from members, companies from the workspace's companies. */
export function attributeOf(state: AppState, f: FieldDef): Attribute {
  if (f.id === 'company') return { id: f.id, name: f.name, type: 'select', options: state.companies.map((c) => ({ id: c.id, label: c.name, hue: 'gray' })) };
  if (f.type === 'actor') return { id: f.id, name: f.name, type: 'actor', candidates: state.members.map((m) => ({ id: m.name, name: m.name })) };
  if (f.attribute && !f.attribute.computed && !f.attribute.relation) return f.attribute;
  return { id: f.id, name: f.name, type: f.type === 'timestamp' ? 'date' : f.type, options: f.options?.filter((o) => o.id !== '').map((o) => ({ id: o.id, label: o.label, hue: o.hue ?? 'gray' })), currency: f.money ? 'INR' : undefined };
}
/** A cell's text as the field's value (owners are people). */
export const fieldValue = (a: Attribute, cell: string | undefined): AttributeValue => (a.type === 'actor' ? (cell ? { id: cell, name: cell } : undefined) : cellToValue(a, cell));
/** Fields a person may type into when making or bulk-editing a record. */
export const writableFields = (state: AppState, object: ObjectId): ReadonlyArray<FieldDef> => ownFields(state, object).filter((f) => (!f.readOnly || f.id === 'company') && f.id !== 'created' && !(object === 'people' && f.id === 'company' && false));

/** New record: the name and the object's key fields, required attributes, and any other field through "Add more fields". */
export function NewRecordDialog({ state, object, initialName = '', start = {}, onClose, onCreate }: {
  readonly state: AppState; readonly object: ObjectId; readonly initialName?: string;
  /** Values to start with (a board column's stage or owner), by field id. */
  readonly start?: Readonly<Record<string, string>>;
  readonly onClose: () => void;
  /** The name, every field's value as text by field id, and whether to keep the dialog open for another. */
  readonly onCreate: (name: string, values: Readonly<Record<string, string>>, more: boolean) => void;
}) {
  const w = wordsOf(state, object);
  const one = isBuiltIn(object) ? (object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal') : w.one;
  const attrs = liveAttributes(schemaOf(state, object));
  const defaults = Object.fromEntries(attrs.filter((a) => a.defaultValue !== undefined && !a.computed).map((a) => [a.id, valueToCell(a, a.defaultValue)]));
  const [name, setName] = useState(initialName);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({ ...defaults, ...start });
  const [shown, setShown] = useState<ReadonlyArray<string>>(Object.keys(start).filter((k) => !['company', 'amount', 'email', 'title', 'domain'].includes(k)));
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (k: string, v: string) => setValues((e) => ({ ...e, [k]: v }));
  const fields = writableFields(state, object).filter((f) => f.id !== 'name');
  const key = object === 'people' ? ['email', 'title', 'company'] : object === 'companies' ? ['domain'] : object === 'deals' ? ['company', 'amount'] : [];
  // Required ones always show: always required, or required by a rule that holds now.
  const required = fields.filter((f) => f.attribute && isRequiredFor(f.attribute, { ...values, name }));
  const visible = [...required.map((f) => f.id), ...shown.filter((id) => !key.includes(id) && !required.some((r) => r.id === id))];
  const addable = fields.filter((f) => !key.includes(f.id) && !visible.includes(f.id));
  const missing = [...required.filter((f) => !values[f.id]), ...(object === 'deals' && !values.company ? fields.filter((f) => f.id === 'company') : [])];
  // A likely duplicate: say so under the field, never block.
  const pool = object === 'people' ? state.people : object === 'companies' ? state.companies : object === 'deals' ? state.deals : state.customRecords[object] ?? [];
  const twin = name.trim().length > 2 ? pool.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) : undefined;
  const mail = (values.email ?? '').trim().toLowerCase();
  const [mailLeft, setMailLeft] = useState(false);
  const badMail = mail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
  const mailTwin = mail && !badMail ? state.people.find((p) => p.email.toLowerCase() === mail) : undefined;
  const domain = (values.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const domainTwin = object === 'companies' && domain ? state.companies.find((c) => c.domain.toLowerCase() === domain) : undefined;
  const go = () => {
    setTried(true);
    if (!name.trim() || badMail || missing.length > 0) return;
    onCreate(name.trim(), domain ? { ...values, domain } : values, more);
    setName(''); setValues({ ...defaults, ...start }); setTried(false);
  };
  const row = (f: FieldDef) => {
    const a = attributeOf(state, f);
    const isReq = required.some((r) => r.id === f.id);
    return (
      <div key={f.id} className="tf-rec__morefield" data-missing={tried && isReq && !values[f.id] ? '' : undefined}>
        <AttributeRow attribute={{ ...a, name: isReq ? `${a.name} *` : a.name }} value={fieldValue(a, values[f.id])} onChange={(v) => set(f.id, valueToCell(a, v))} />
        {!isReq && <IconButton size="sm" label={`Remove ${f.name}`} onPress={() => { setShown((s) => s.filter((x) => x !== f.id)); setValues((e) => { const n = { ...e }; delete n[f.id]; return n; }); }}><X size={14} strokeWidth={1.75} /></IconButton>}
      </div>
    );
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`New ${one}`}
      actions={<><Checkbox isSelected={more} onChange={setMore}>Create more</Checkbox><span className="tf-rec__spacer" /><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || badMail} onPress={go}>Create {one}</Button></>}>
      <form className="tf-rec__form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <TextField label={object === 'deals' ? 'Deal name' : 'Name'} value={name} onChange={setName} autoFocus isRequired description={twin ? `There's already a ${one} called ${twin.name}.` : undefined} />
        {object === 'people' && <><TextField label="Email" type="email" value={values.email ?? ''} onChange={(v) => set('email', v)} onBlur={() => setMailLeft(true)} isInvalid={badMail && mailLeft} errorMessage="Check the email: it needs an @ and a domain." description={mailTwin ? `${mailTwin.name} already has this email.` : undefined} /><TextField label="Job title" value={values.title ?? ''} onChange={(v) => set('title', v)} /></>}
        {object === 'companies' && <TextField label="Domain" value={values.domain ?? ''} onChange={(v) => set('domain', v)} placeholder="acme.com" description={domainTwin ? `${domainTwin.name} already uses ${domain}.` : undefined} />}
        {(object === 'people' || object === 'deals') && <Select label="Company" searchable value={values.company ?? null} onChange={(v) => set('company', v ?? '')} placeholder="Pick a company" description={object === 'deals' ? 'Every deal is with a company.' : 'Optional'} items={state.companies.map((c) => ({ id: c.id, label: c.name }))} isInvalid={tried && object === 'deals' && !values.company} errorMessage="Pick the company this deal is with." />}
        {object === 'deals' && <TextField label="Amount (₹)" value={values.amount ?? ''} onChange={(v) => set('amount', v.replace(/[^\d]/g, ''))} />}
        {visible.length > 0 && <div className="tf-rec__morefields" aria-label="More fields">{visible.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDef => f !== undefined).map(row)}</div>}
        {tried && missing.length > 0 && <Callout tone="warning">Fill in {missing.map((f) => f.name).join(', ')} first.</Callout>}
        {addable.length > 0 && (
          <MenuTrigger>
            <Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} />} iconEnd={<ChevronDown size={14} strokeWidth={1.75} />} className="tf-rec__addmore">Add more fields</Button>
            <Menu aria-label="Add a field" placement="bottom start" onAction={(k) => setShown((s) => [...s, String(k)])}>
              {addable.map((f) => <MenuItem key={f.id} id={f.id}>{f.name}</MenuItem>)}
            </Menu>
          </MenuTrigger>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** One change in Bulk edit: a field, its new value, and for multi-selects whether to add, remove or replace. */
interface BulkRow { readonly id: string; readonly field: string; readonly value: string; readonly mode: 'set' | 'clear' | 'add' | 'remove' }

/** Edit several fields on many records at once. Undo puts each record back as it was. */
export function BulkEditDialog({ state, object, count, onClose, onApply }: {
  readonly state: AppState; readonly object: ObjectId; readonly count: number; readonly onClose: () => void;
  /** Each change: the field, the text value, and how (set, clear, add to or remove from a multi-select). */
  readonly onApply: (changes: ReadonlyArray<{ readonly field: string; readonly value: string; readonly mode: BulkRow['mode'] }>) => void;
}) {
  const fields = writableFields(state, object).filter((f) => !['name', 'email', 'domain'].includes(f.id));
  const [rows, setRows] = useState<ReadonlyArray<BulkRow>>([{ id: 'b0', field: fields[0]?.id ?? '', value: '', mode: 'set' }]);
  const w = wordsOf(state, object);
  const noun = count === 1 ? (isBuiltIn(object) ? (object === 'people' ? 'person' : object === 'companies' ? 'company' : 'deal') : w.one) : w.many;
  const patch = (id: string, p: Partial<BulkRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const ready = rows.length > 0 && rows.every((r) => r.field && (r.mode === 'clear' || r.value !== ''));
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title={`Edit ${count} ${noun}`} description="Every change goes on each one. Undo puts them back as they were."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!ready} onPress={() => onApply(rows.map((r) => ({ field: r.field, value: r.value, mode: r.mode })))}>Apply to {count}</Button></>}>
      <ul className="tf-bulk" aria-label="Changes">
        {rows.map((r) => {
          const f = fields.find((x) => x.id === r.field);
          const a = f ? attributeOf(state, f) : undefined;
          const multi = f?.type === 'multiSelect';
          return (
            <li key={r.id} className="tf-bulk__row">
              <Select label="Field" isLabelHidden value={r.field || null} onChange={(v) => v && patch(r.id, { field: v, value: '', mode: 'set' })} items={fields.filter((x) => x.id === r.field || !rows.some((y) => y.field === x.id)).map((x) => ({ id: x.id, label: x.name }))} />
              <SegmentedControl aria-label={`How to change ${f?.name ?? 'it'}`} size="sm" selectedKey={r.mode} onSelectionChange={(k) => patch(r.id, { mode: k as BulkRow['mode'] })}
                items={multi ? [{ id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }, { id: 'set', label: 'Replace' }] : [{ id: 'set', label: 'Set' }, { id: 'clear', label: 'Clear' }]} />
              <span className="tf-bulk__value">{a && r.mode !== 'clear' ? <AttributeRow attribute={{ ...a, name: 'Value' }} value={fieldValue(a, r.value)} onChange={(v) => patch(r.id, { value: valueToCell(a, v) })} /> : <span className="tf-rec__muted">Leaves it empty</span>}</span>
              <IconButton size="sm" label={`Remove ${f?.name ?? 'change'}`} isDisabled={rows.length === 1} onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><X size={14} strokeWidth={1.75} /></IconButton>
            </li>
          );
        })}
      </ul>
      {rows.length < fields.length && <div className="tf-rec__addrow"><Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => setRows((rs) => [...rs, { id: `b${Date.now()}`, field: fields.find((x) => !rs.some((y) => y.field === x.id))?.id ?? '', value: '', mode: 'set' }])}>Change another field</Button></div>}
    </Dialog>
  );
}

/** Who can see a saved view, in words. */
export const ACCESS_WORDS: Readonly<Record<ViewAccess, { readonly label: string; readonly hint: string }>> = {
  private: { label: 'Only me', hint: 'Nobody else sees it' },
  everyone: { label: 'Everyone', hint: 'Anyone can see and change it' },
  admins: { label: 'Everyone, only admins edit', hint: 'Anyone sees it; owners and admins change it' },
};

/** New view: a name and who sees it; it starts from what's on screen. */
export function ViewNamer({ onClose, onSave }: { readonly onClose: () => void; readonly onSave: (name: string, access: ViewAccess) => void }) {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ViewAccess>('everyone');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="New view" description="Starts from what you see now: its filters, sorts and columns."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim()} onPress={() => onSave(name.trim(), access)}>Create view</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Name" value={name} onChange={setName} autoFocus placeholder="Hot leads" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim(), access); }} />
        <AccessPicker value={access} onChange={setAccess} />
      </div>
    </Dialog>
  );
}
function AccessPicker({ value, onChange }: { readonly value: ViewAccess; readonly onChange: (v: ViewAccess) => void }) {
  return (
    <RadioGroup label="Who can see it" value={value} onChange={(v) => onChange(v === 'private' ? 'private' : v === 'admins' ? 'admins' : 'everyone')}>
      {(Object.keys(ACCESS_WORDS) as ViewAccess[]).map((k) => <Radio key={k} value={k}>{ACCESS_WORDS[k].label}<span className="tf-rec__radiohint">{ACCESS_WORDS[k].hint}</span></Radio>)}
    </RadioGroup>
  );
}
/** Change who sees a view after it's made. */
export function ViewAccessDialog({ name, value, onClose, onSave }: { readonly name: string; readonly value: ViewAccess; readonly onClose: () => void; readonly onSave: (v: ViewAccess) => void }) {
  const [access, setAccess] = useState<ViewAccess>(value);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={`Who can see ${name}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={access === value} onPress={() => onSave(access)}>Save</Button></>}>
      <AccessPicker value={access} onChange={setAccess} />
    </Dialog>
  );
}

/** One name, in a dialog: rename a view, a list, a stage. Empty names are refused. */
export function RenameDialog({ title, label, value, onClose, onSave }: { readonly title: string; readonly label: string; readonly value: string; readonly onClose: () => void; readonly onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={title}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!v.trim() || v.trim() === value} onPress={() => onSave(v.trim())}>Save</Button></>}>
      <TextField label={label} value={v} onChange={setV} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && v.trim() && v.trim() !== value) onSave(v.trim()); }} />
    </Dialog>
  );
}
