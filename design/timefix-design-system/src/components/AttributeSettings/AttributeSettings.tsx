import { Button as AriaButton, DropIndicator, GridList, GridListItem, Radio, RadioGroup, useDragAndDrop, type DropTarget, type Key } from 'react-aria-components';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, GripVertical, Lock, Plus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { ATTRIBUTE_TYPES, AttributeIcon, AttributeField, type Attribute, type AttributeType, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Button } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Tag, Count } from '../Tag/Tag.tsx';
import { SettingsRow } from '../SettingsLayout/SettingsLayout.tsx';
import { OptionsEditor, type EditableOption } from '../OptionsEditor/OptionsEditor.tsx';
import { Collapse } from '../Motion/Motion.tsx';
import './AttributeSettings.css';

/* ------------------------------------------------------------------ model */

/** How a number attribute reads: plain (1,240), two decimals (1,240.00) or compact (1.2K). */
export type NumberFormat = 'plain' | 'decimal' | 'compact';

/** An attribute as the schema holds it: the field system's Attribute plus its rules and settings. */
export interface SchemaAttribute extends Attribute {
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  /** Made by Timefix (Name, Created at): its type can't change and it can't be archived. */
  readonly isSystem?: boolean;
  readonly numberFormat?: NumberFormat;
  /** What new records start with. Undefined is none. */
  readonly defaultValue?: AttributeValue;
  /** Options of a select, multi-select or status, archived ones included. */
  readonly options?: ReadonlyArray<EditableOption>;
}

/** One line under each type in the type picker: what the type holds. */
export const ATTRIBUTE_TYPE_HINTS: Readonly<Record<AttributeType, string>> = {
  text: 'A short line: a title, a code', longText: 'Paragraphs: notes, a summary', number: 'Counts and amounts', currency: 'Money in one currency',
  percent: 'A share out of 100', date: 'A day, no time', timestamp: 'Set by the system', checkbox: 'Yes or no', select: 'One choice from a list',
  multiSelect: 'Several choices from a list', status: 'Stages grouped by progress', rating: 'One to five stars', email: 'An email address',
  phone: 'A phone number', url: 'A link to a page', domain: 'A company website', location: 'A city and country', personalName: 'First and last name',
  record: 'Links to another record', actor: 'A workspace member', file: 'Attachments',
};

/** The types a person can pick, in picker order. Timestamps are only made by the system. */
export const PICKABLE_TYPES: ReadonlyArray<AttributeType> = [
  'text', 'longText', 'number', 'currency', 'percent', 'date', 'checkbox', 'select', 'multiSelect', 'status', 'rating',
  'email', 'phone', 'url', 'domain', 'location', 'personalName', 'record', 'actor', 'file',
];

/** Types the engine can keep unique (no two records share a value). Unique shows only for these. */
export const UNIQUE_TYPES: ReadonlySet<AttributeType> = new Set<AttributeType>(['text', 'number', 'email', 'phone', 'url', 'domain']);

const NO_DEFAULT: ReadonlySet<AttributeType> = new Set<AttributeType>(['timestamp', 'file', 'record', 'longText', 'personalName']);
const OPTION_TYPES: ReadonlySet<AttributeType> = new Set<AttributeType>(['select', 'multiSelect', 'status']);

/** Moves the dragged items to a drop target in a list of things with ids. Returns a new list; the old one is untouched. */
export function reorder<T extends { readonly id: string }>(list: ReadonlyArray<T>, keys: ReadonlySet<Key>, target: DropTarget): ReadonlyArray<T> {
  if (target.type !== 'item') return list;
  const moving = list.filter((x) => keys.has(x.id));
  const rest = list.filter((x) => !keys.has(x.id));
  const at = rest.findIndex((x) => x.id === target.key);
  if (at < 0) return list;
  const i = target.dropPosition === 'after' ? at + 1 : at;
  return [...rest.slice(0, i), ...moving, ...rest.slice(i)];
}

/** Marks an id for one settle (the dropped row eases from lifted to rest). */
function useSettle(): readonly [string | undefined, (id: string) => void] {
  const [id, setId] = useState<string>();
  useEffect(() => { if (!id) return; const t = window.setTimeout(() => setId(undefined), 300); return () => window.clearTimeout(t); }, [id]);
  return [id, setId];
}

/* ------------------------------------------------------------ the list */

const ATTR_TYPE = 'application/x-tf-attribute';

/** Props for AttributeList. */
export interface AttributeListProps {
  readonly label: string;
  readonly attributes: ReadonlyArray<SchemaAttribute>;
  /** The new order, every id. */
  readonly onReorder: (ids: ReadonlyArray<string>) => void;
  /** Opens an attribute's settings (press a row, or Enter on it). */
  readonly onEdit: (id: string) => void;
  /** The id to mark as just changed: its row washes once. */
  readonly changedId?: string;
}

/** An object's attributes in order: drag a row by its grip (or Enter on the grip, arrows, Enter) to move it; press a row to edit it. */
export function AttributeList({ label, attributes, onReorder, onEdit, changedId }: AttributeListProps) {
  const [settling, settle] = useSettle();
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ [ATTR_TYPE]: String(k), 'text/plain': attributes.find((a) => a.id === k)?.name ?? String(k) })),
    onReorder: (e) => {
      onReorder(reorder(attributes, e.keys, e.target).map((a) => a.id));
      const first = [...e.keys][0];
      if (first !== undefined) settle(String(first));
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-attributesettings__slot" />,
    renderDragPreview: (items) => {
      const a = attributes.find((x) => x.id === items[0]?.[ATTR_TYPE]);
      return <div className="tf-attributesettings__preview">{a ? <RowBody attribute={a} /> : null}</div>;
    },
  });
  return (
    <GridList aria-label={label} items={attributes} dragAndDropHooks={dragAndDropHooks} onAction={(k) => onEdit(String(k))} className="tf-attributesettings__list">
      {(a) => (
        <GridListItem id={a.id} textValue={a.name} className={cx('tf-attributesettings__row', settling === a.id && 'is-settling')}>
          {changedId === a.id && <span key={`${a.id}-${a.name}-${a.type}`} className="tf-attributesettings__wash" aria-hidden="true" />}
          <AriaButton slot="drag" className="tf-attributesettings__grip" aria-label={`Move ${a.name}`}><GripVertical size={14} strokeWidth={1.75} /></AriaButton>
          <RowBody attribute={a} />
          <ChevronRight className="tf-attributesettings__chev" size={16} strokeWidth={1.75} aria-hidden="true" />
        </GridListItem>
      )}
    </GridList>
  );
}

function RowBody({ attribute: a }: { readonly attribute: SchemaAttribute }) {
  return (
    <span className="tf-attributesettings__body">
      <span className="tf-attributesettings__icon"><AttributeIcon type={a.type} /></span>
      <span className="tf-attributesettings__name">{a.name}</span>
      <span className="tf-attributesettings__type">{ATTRIBUTE_TYPES[a.type].label}</span>
      <span className="tf-attributesettings__badges">
        {a.isRequired && <Tag size="sm">Required</Tag>}
        {a.isUnique && <Tag size="sm">Unique</Tag>}
        {a.isSystem && <span className="tf-attributesettings__system"><Lock size={12} strokeWidth={1.75} aria-hidden="true" />System</span>}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ type picker */

/** Props for AttributeTypePicker. */
export interface AttributeTypePickerProps {
  readonly value: AttributeType;
  readonly onChange: (type: AttributeType) => void;
  readonly types?: ReadonlyArray<AttributeType>;
  readonly isDisabled?: boolean;
}

/** Every type as a card with its icon and one line, two to a row. Arrows move between them and choose. */
export function AttributeTypePicker({ value, onChange, types = PICKABLE_TYPES, isDisabled }: AttributeTypePickerProps) {
  return (
    <RadioGroup aria-label="Type" value={value} onChange={(v) => onChange(v as AttributeType)} isDisabled={isDisabled} className="tf-attributesettings-typepick">
      {types.map((t) => (
        <Radio key={t} value={t} className="tf-attributesettings-typepick__card">
          <span className="tf-attributesettings-typepick__icon"><AttributeIcon type={t} /></span>
          <span className="tf-attributesettings-typepick__text">
            <span className="tf-attributesettings-typepick__label">{ATTRIBUTE_TYPES[t].label}</span>
            <span className="tf-attributesettings-typepick__hint">{ATTRIBUTE_TYPE_HINTS[t]}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

/* ------------------------------------------------------------ the drawer */

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'SGD'].map((c) => ({ id: c, label: c, description: new Intl.DisplayNames('en', { type: 'currency' }).of(c) }));
const FORMATS = [{ id: 'plain', label: '1,240', description: 'Whole numbers' }, { id: 'decimal', label: '1,240.00', description: 'Two decimals' }, { id: 'compact', label: '1.2K', description: 'Short' }];

/** Props for AttributeDialog. */
export interface AttributeDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The object it belongs to, singular ("Deal"). */
  readonly objectName: string;
  /** The attribute to edit; leave out to create one. */
  readonly attribute?: SchemaAttribute;
  /** How many records hold a value, for the type change warning. */
  readonly valueCount?: number;
  /** Saves; the drawer shows Saved, then closes. */
  readonly onSave: (attribute: SchemaAttribute) => void;
  /** Archives (edit only, never for a system attribute). */
  readonly onArchive?: (id: string) => void;
}

const blank = (): SchemaAttribute => ({ id: `attr-${Date.now().toString(36)}`, name: '', type: 'text' });
const same = (a: SchemaAttribute, b: SchemaAttribute) => JSON.stringify(a) === JSON.stringify(b);

/** Creates or edits one attribute in a dialog (the same surface as New object): name, type (cards with a line each), the type's own settings, its options, the default, Required and Unique. Changing an existing type warns first. */
export function AttributeDialog({ isOpen, onOpenChange, objectName, attribute, valueCount, onSave, onArchive }: AttributeDialogProps) {
  const start = useRef(attribute ?? blank()).current;
  const [draft, setDraft] = useState<SchemaAttribute>(start);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showTypes, setShowTypes] = useState(attribute === undefined);
  const [nameError, setNameError] = useState(false);
  const isNew = attribute === undefined;
  const set = (patch: Partial<SchemaAttribute>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = !same(draft, start);
  const typeChanged = !isNew && draft.type !== start.type;

  const pickType = (type: AttributeType) => setDraft((d) => ({
    ...d, type, defaultValue: undefined, isUnique: UNIQUE_TYPES.has(type) ? d.isUnique : false,
    currency: type === 'currency' ? (d.currency ?? 'USD') : d.currency,
    options: OPTION_TYPES.has(type) ? (d.options && d.options.length > 0 ? d.options : starterOptions(type)) : d.options,
  }));
  const save = () => {
    if (draft.name.trim() === '') { setNameError(true); return; }
    setPhase('saving');
    window.setTimeout(() => { onSave({ ...draft, name: draft.name.trim() }); setPhase('saved'); onOpenChange(false); }, 400);
  };
  const live = draft.options?.filter((o) => !o.archived);
  const fieldAttr: Attribute = { id: `${draft.id}-default`, name: 'Default value', type: draft.type, options: live, currency: draft.currency };

  return (
    <Dialog
      isOpen={isOpen} onOpenChange={onOpenChange} size="wide"
      title={isNew ? `New ${objectName.toLowerCase()} attribute` : draft.name || start.name}
      actions={<>
        {!isNew && !start.isSystem && onArchive ? <Button variant="ghost" className="tf-attributesettings__archive" onPress={() => { onArchive(start.id); onOpenChange(false); }}>Archive</Button> : null}
        <Button variant="ghost" slot="close">Cancel</Button>
        <Button variant="primary" isPending={phase === 'saving'} isDisabled={!isNew && !dirty} onPress={save}>{isNew ? 'Create attribute' : 'Save'}</Button>
      </>}
    >
      <TextField
        label="Name" value={draft.name} autoFocus={isNew} placeholder="Deal value" isRequired
        onChange={(v) => { set({ name: v }); if (v.trim()) setNameError(false); }}
        isInvalid={nameError} errorMessage="Give the attribute a name."
      />

      <section className="tf-attributesettings__group" aria-label="Type">
        <div className="tf-attributesettings__grouphead">
          <span className="tf-attributesettings__grouplabel">Type</span>
          {!isNew && !start.isSystem && <Button size="sm" variant="ghost" onPress={() => setShowTypes((s) => !s)} aria-expanded={showTypes}>{showTypes ? 'Keep type' : 'Change type…'}</Button>}
        </div>
        {!showTypes && (
          <div className="tf-attributesettings__current">
            <span className="tf-attributesettings__icon"><AttributeIcon type={draft.type} /></span>
            <span className="tf-attributesettings-typepick__text">
              <span className="tf-attributesettings-typepick__label">{ATTRIBUTE_TYPES[draft.type].label}</span>
              <span className="tf-attributesettings-typepick__hint">{ATTRIBUTE_TYPE_HINTS[draft.type]}</span>
            </span>
            {start.isSystem && <Lock className="tf-attributesettings__lock" size={14} strokeWidth={1.75} aria-label="Set by Timefix" />}
          </div>
        )}
        <Collapse open={showTypes}>
          <AttributeTypePicker value={draft.type} onChange={pickType} />
        </Collapse>
        {start.isSystem && <Callout tone="neutral">{start.name} is made by Timefix, so its type stays {ATTRIBUTE_TYPES[start.type].label.toLowerCase()}.</Callout>}
        <Collapse open={typeChanged}>
          <Callout tone="warning" title={`Change ${start.name || 'it'} to ${ATTRIBUTE_TYPES[draft.type].label.toLowerCase()}?`}>
            {valueCount !== undefined ? `${valueCount.toLocaleString('en-US')} values convert when you save.` : 'Every value converts when you save.'} Values that don&apos;t fit become empty, and views filtered by it may stop matching.
          </Callout>
        </Collapse>
      </section>

      <Collapse open={draft.type === 'currency'}>
        <Select label="Currency" items={CURRENCIES} value={draft.currency ?? 'USD'} onChange={(v) => v && set({ currency: v })} description="Values show its symbol. Changing it doesn't convert amounts." />
      </Collapse>
      <Collapse open={draft.type === 'number'}>
        <Select label="Format" items={FORMATS} value={draft.numberFormat ?? 'plain'} onChange={(v) => v && set({ numberFormat: v as NumberFormat })} />
      </Collapse>
      {OPTION_TYPES.has(draft.type) && (
        <OptionsEditor kind={draft.type === 'status' ? 'status' : 'select'} label={draft.type === 'status' ? 'Stages' : 'Options'} options={draft.options ?? []} onChange={(options) => set({ options })} />
      )}

      {!NO_DEFAULT.has(draft.type) && (
        <section className="tf-attributesettings__group" aria-label="Default value">
          <span className="tf-attributesettings__grouplabel">Default value</span>
          <div className="tf-attributesettings__default">
            <AttributeField key={`${draft.type}-${draft.currency ?? ''}`} attribute={fieldAttr} value={draft.defaultValue} onChange={(v) => set({ defaultValue: v })} empty="None. Set a default…" />
          </div>
          <span className="tf-attributesettings__hint">New records start with it. People can change it.</span>
        </section>
      )}

      <div className="tf-attributesettings__rules">
        <SettingsRow title="Required" description={`A ${objectName.toLowerCase()} can't be saved without it.`} control={<Switch aria-label="Required" isSelected={draft.isRequired === true} onChange={(v) => set({ isRequired: v })} isDisabled={start.isSystem} />} />
        {UNIQUE_TYPES.has(draft.type) && (
          <SettingsRow title="Unique" description={`No two ${objectName.toLowerCase()}s share a value. Imports match on it.`} control={<Switch aria-label="Unique" isSelected={draft.isUnique === true} onChange={(v) => set({ isUnique: v })} />} />
        )}
      </div>
    </Dialog>
  );
}

const HUE_ORDER = ['blue', 'green', 'orange', 'purple', 'sky', 'yellow', 'red', 'lime', 'gray'] as const;
function starterOptions(type: AttributeType): ReadonlyArray<EditableOption> {
  if (type === 'status') {
    return [
      { id: 's-new', label: 'Not started', hue: 'gray', shape: 'draft', group: 'notStarted' },
      { id: 's-doing', label: 'In progress', hue: 'orange', shape: 'progress', group: 'inProgress' },
      { id: 's-done', label: 'Done', hue: 'green', shape: 'done', group: 'done' },
    ];
  }
  return [{ id: 'o-1', label: 'Option 1', hue: HUE_ORDER[0] }];
}

/* ------------------------------------------------------------ the page part */

/** Props for AttributeSettings. */
export interface AttributeSettingsProps {
  /** Singular and plural ("Deal", "Deals"). */
  readonly objectName: string;
  readonly objectPlural: string;
  readonly attributes: ReadonlyArray<SchemaAttribute>;
  readonly onChange: (attributes: ReadonlyArray<SchemaAttribute>) => void;
  /** Values held per attribute id, for the type change warning. */
  readonly valueCounts?: Readonly<Record<string, number>>;
}

/** An object's attributes on its settings page: the ordered list, New attribute, and the drawer that creates and edits them. */
export function AttributeSettings({ objectName, objectPlural, attributes, onChange, valueCounts }: AttributeSettingsProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [session, setSession] = useState(0);
  const [changed, setChanged] = useState<string>();
  const [archived, setArchived] = useState<{ readonly attribute: SchemaAttribute; readonly index: number }>();
  const openFor = (id?: string) => { setEditing(id); setSession((s) => s + 1); setOpen(true); };
  const current = attributes.find((a) => a.id === editing);
  return (
    <section className="tf-attributesettings" aria-labelledby="tf-attributesettings-title">
      <header className="tf-attributesettings__head">
        <div className="tf-attributesettings__titles">
          <h2 id="tf-attributesettings-title" className="tf-attributesettings__title">Attributes <Count>{attributes.length}</Count></h2>
          <p className="tf-attributesettings__desc">What every {objectName.toLowerCase()} holds, in the order record pages show it.</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => openFor(undefined)}>New attribute</Button>
      </header>
      {archived && (
        <Callout
          key={archived.attribute.id} tone="neutral" onDismiss={() => setArchived(undefined)}
          action={{ label: 'Undo', onPress: () => { onChange([...attributes.slice(0, archived.index), archived.attribute, ...attributes.slice(archived.index)]); setChanged(archived.attribute.id); setArchived(undefined); } }}
        >
          {archived.attribute.name} archived. Its values are kept for 30 days.
        </Callout>
      )}
      <AttributeList
        label={`${objectPlural} attributes`} attributes={attributes} changedId={changed} onEdit={openFor}
        onReorder={(ids) => onChange(ids.map((id) => attributes.find((a) => a.id === id)).filter((a): a is SchemaAttribute => a !== undefined))}
      />
      <AttributeDialog
        key={session} isOpen={open} onOpenChange={setOpen} objectName={objectName} attribute={current}
        valueCount={editing ? valueCounts?.[editing] : undefined}
        onArchive={(id) => {
          const index = attributes.findIndex((a) => a.id === id);
          const a = attributes[index];
          if (a) { setArchived({ attribute: a, index }); onChange(attributes.filter((x) => x.id !== id)); }
        }}
        onSave={(a) => { onChange(current ? attributes.map((x) => (x.id === a.id ? a : x)) : [...attributes, a]); setChanged(a.id); }}
      />
    </section>
  );
}
