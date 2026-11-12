import { Button as AriaButton, DialogTrigger, type Key, type Selection } from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { AttributeDisplay, AttributeIcon, type Attribute, type AttributeType, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { TextField } from '../Field/Field.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { TextSwap, Collapse, DropIn } from '../Motion/Motion.tsx';
import './Sentence.css';

/** How a condition compares. Each type offers the ones that make sense for it. */
export type Operator = 'is' | 'isNot' | 'contains' | 'gt' | 'lt' | 'before' | 'after' | 'isChecked' | 'isNotChecked' | 'isEmpty' | 'isNotEmpty';

/** One condition: an attribute, how it compares, and the value (none for "is empty", "is checked"). */
export interface Condition { readonly id: string; readonly attributeId: string; readonly operator: Operator; readonly value?: AttributeValue }

/** Whether every condition must hold, or any one. */
export type Conjunction = 'and' | 'or';

/** The words each operator reads as. */
export const OPERATOR_LABELS: Readonly<Record<Operator, string>> = {
  is: 'is', isNot: 'is not', contains: 'contains', gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after',
  isChecked: 'is checked', isNotChecked: 'is not checked', isEmpty: 'is empty', isNotEmpty: 'is not empty',
};
const NO_VALUE: ReadonlySet<Operator> = new Set<Operator>(['isChecked', 'isNotChecked', 'isEmpty', 'isNotEmpty']);

/** The operators an attribute type offers, the usual one first. */
export function operatorsFor(type: AttributeType): ReadonlyArray<Operator> {
  switch (type) {
    case 'checkbox': return ['isChecked', 'isNotChecked'];
    case 'number': case 'currency': case 'percent': case 'rating': return ['gt', 'lt', 'is', 'isNot', 'isEmpty', 'isNotEmpty'];
    case 'date': case 'timestamp': return ['before', 'after', 'is', 'isEmpty', 'isNotEmpty'];
    case 'select': case 'status': case 'multiSelect': case 'actor': case 'record': return ['is', 'isNot', 'isEmpty', 'isNotEmpty'];
    default: return ['contains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'];
  }
}

/** The condition said as plain words, for a screen reader and a rule's summary: "Stage is Qualified". */
export function conditionText(c: Condition, attributes: ReadonlyArray<Attribute>): string {
  const a = attributes.find((x) => x.id === c.attributeId);
  if (!a) return '';
  const v = NO_VALUE.has(c.operator) ? '' : c.value === undefined ? ' …' : ` ${valueWords(a, c.value)}`;
  return `${a.name} ${OPERATOR_LABELS[c.operator]}${v}`;
}
function valueWords(a: Attribute, v: AttributeValue): string {
  if (typeof v === 'string') return a.options?.find((o) => o.id === v)?.label ?? v;
  if (typeof v === 'number') return a.type === 'currency' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: a.currency ?? 'USD', maximumFractionDigits: 0 }).format(v) : v.toLocaleString('en-US');
  if (v && typeof v === 'object' && 'name' in v) return v.name;
  return '';
}

const DATES: ReadonlyArray<{ readonly id: string; readonly label: string }> = (() => {
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  return [{ id: day(0), label: 'Today' }, { id: day(-7), label: 'A week ago' }, { id: day(-30), label: '30 days ago' }, { id: day(7), label: 'In a week' }, { id: day(30), label: 'In 30 days' }];
})();

/** Props for Sentence. */
export interface SentenceProps {
  /** The word before the first condition: "When", "Only if", "Show when". */
  readonly lead: string;
  readonly attributes: ReadonlyArray<Attribute>;
  readonly conditions: ReadonlyArray<Condition>;
  readonly onChange: (conditions: ReadonlyArray<Condition>) => void;
  readonly conjunction: Conjunction;
  readonly onConjunctionChange: (c: Conjunction) => void;
  /** Names the group for screen readers ("Trigger conditions"). */
  readonly label: string;
  /** Read only: pills are words, no add or remove. */
  readonly isReadOnly?: boolean;
}

/**
 * A rule read as a sentence: "When [Stage] [is] [Qualified] and [Deal value] [is more than] [$10,000]". Every part is a pill that opens its picker
 * (the attribute's list, the operators its type allows, the value's own editor); add drops a line in and opens its attribute list; remove collapses it.
 */
export function Sentence({ lead, attributes, conditions, onChange, conjunction, onConjunctionChange, label, isReadOnly = false }: SentenceProps) {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [fresh, setFresh] = useState<string>();
  const latest = useRef(conditions);
  latest.current = conditions;
  const update = (id: string, patch: Partial<Condition>) => onChange(latest.current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = () => {
    const used = new Set(conditions.map((c) => c.attributeId));
    const a = attributes.find((x) => !used.has(x.id)) ?? attributes[0];
    if (!a) return;
    const id = `cond-${Date.now().toString(36)}`;
    setFresh(id);
    onChange([...conditions, { id, attributeId: a.id, operator: operatorsFor(a.type)[0] ?? 'is' }]);
  };
  const remove = (id: string) => {
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => { onChange(latest.current.filter((c) => c.id !== id)); setLeaving((s) => { const n = new Set(s); n.delete(id); return n; }); }, 250);
  };
  return (
    <div className={cx('tf-sentence', isReadOnly && 'is-readonly')} role="group" aria-label={label}>
      {conditions.map((c, i) => {
        const a = attributes.find((x) => x.id === c.attributeId);
        if (!a) return null;
        const line = (
          <div className="tf-sentence__line" aria-label={`${i === 0 ? lead : conjunction} ${conditionText(c, attributes)}`} role="group">
            <span className="tf-sentence__lead">
              {i === 0 ? <span className="tf-sentence__word">{lead}</span> : (
                <AriaButton
                  className="tf-sentence__conj" isDisabled={isReadOnly}
                  aria-label={conjunction === 'and' ? 'All conditions must hold. Switch to any' : 'Any condition can hold. Switch to all'}
                  onPress={() => onConjunctionChange(conjunction === 'and' ? 'or' : 'and')}
                >
                  <TextSwap swapKey={conjunction}>{conjunction}</TextSwap>
                </AriaButton>
              )}
            </span>
            <span className="tf-sentence__parts">
              <AttributePill attribute={a} attributes={attributes} autoOpen={fresh === c.id} isReadOnly={isReadOnly}
                onPick={(next) => { const na = attributes.find((x) => x.id === next); if (na) update(c.id, { attributeId: next, operator: operatorsFor(na.type)[0] ?? 'is', value: undefined }); }} />
              <OperatorPill attribute={a} operator={c.operator} isReadOnly={isReadOnly} onPick={(op) => update(c.id, { operator: op, value: NO_VALUE.has(op) ? undefined : c.value })} />
              {!NO_VALUE.has(c.operator) && <ValuePill attribute={a} value={c.value} isReadOnly={isReadOnly} onChange={(v) => update(c.id, { value: v })} />}
            </span>
            {!isReadOnly && conditions.length > 1 && (
              <IconButton label={`Remove ${conditionText(c, attributes)}`} size="sm" className="tf-sentence__remove" onPress={() => remove(c.id)}><X size={14} strokeWidth={1.75} /></IconButton>
            )}
          </div>
        );
        return (
          <Collapse key={c.id} open={!leaving.has(c.id)}>
            {fresh === c.id ? <DropIn>{line}</DropIn> : line}
          </Collapse>
        );
      })}
      {!isReadOnly && (
        <div className="tf-sentence__line">
          <span className="tf-sentence__lead" />
          <Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} />} onPress={add}>Add condition</Button>
        </div>
      )}
    </div>
  );
}

/** One part of the sentence: a pill that stays pressed while its picker is open. */
function Pill({ kind, children, isEmpty = false, isDisabled, label }: { readonly kind: 'field' | 'op' | 'value'; readonly children: ReactNode; readonly isEmpty?: boolean; readonly isDisabled?: boolean; readonly label: string }) {
  return (
    <AriaButton className={cx('tf-sentence__pill', `tf-sentence__pill--${kind}`, isEmpty && 'is-empty')} isDisabled={isDisabled} aria-label={label}>
      {children}
      {kind === 'op' && !isDisabled && <ChevronDown className="tf-sentence__chev" size={12} strokeWidth={2} aria-hidden="true" />}
    </AriaButton>
  );
}

function AttributePill({ attribute, attributes, onPick, autoOpen, isReadOnly }: { readonly attribute: Attribute; readonly attributes: ReadonlyArray<Attribute>; readonly onPick: (id: string) => void; readonly autoOpen: boolean; readonly isReadOnly: boolean }) {
  const [open, setOpen] = useState(false);
  // A new line opens its attribute list once it has dropped in, so the list grows from where the pill settled.
  useEffect(() => { if (!autoOpen) return; const t = window.setTimeout(() => setOpen(true), 260); return () => window.clearTimeout(t); }, [autoOpen]);
  const pick = (keys: Selection) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) onPick(String(k)); };
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <Pill kind="field" isDisabled={isReadOnly} label={`Attribute: ${attribute.name}. Change`}><AttributeIcon type={attribute.type} size={14} />{attribute.name}</Pill>
      <Menu aria-label="Attribute" filterPlaceholder="Find an attribute…" selectionMode="single" selectedKeys={new Set([attribute.id])} onSelectionChange={pick}>
        {attributes.map((a) => <MenuItem key={a.id} id={a.id} icon={<AttributeIcon type={a.type} />}>{a.name}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}

function OperatorPill({ attribute, operator, onPick, isReadOnly }: { readonly attribute: Attribute; readonly operator: Operator; readonly onPick: (op: Operator) => void; readonly isReadOnly: boolean }) {
  const pick = (keys: Selection) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) onPick(String(k) as Operator); };
  return (
    <MenuTrigger>
      <Pill kind="op" isDisabled={isReadOnly} label={`Comparison: ${OPERATOR_LABELS[operator]}. Change`}><TextSwap swapKey={operator}>{OPERATOR_LABELS[operator]}</TextSwap></Pill>
      <Menu aria-label="Comparison" selectionMode="single" selectedKeys={new Set<Key>([operator])} onSelectionChange={pick} width="content">
        {operatorsFor(attribute.type).map((op) => <MenuItem key={op} id={op}>{OPERATOR_LABELS[op]}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}

function ValuePill({ attribute: a, value, onChange, isReadOnly }: { readonly attribute: Attribute; readonly value: AttributeValue; readonly onChange: (v: AttributeValue) => void; readonly isReadOnly: boolean }) {
  const empty = value === undefined || value === '';
  const shown = empty ? <span>{a.type === 'date' ? 'a date' : 'a value'}…</span> : <AttributeDisplay attribute={a} value={value} asLink={false} />;
  const label = `Value: ${empty ? 'not set' : valueWords(a, value)}. Change`;
  const pickOne = (keys: Selection, find: (k: string) => AttributeValue) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) onChange(find(String(k))); };
  const selected = new Set<Key>(typeof value === 'string' ? [value] : value && typeof value === 'object' && 'id' in value ? [value.id] : []);

  if (a.type === 'select' || a.type === 'status' || a.type === 'multiSelect') {
    return (
      <MenuTrigger>
        <Pill kind="value" isEmpty={empty} isDisabled={isReadOnly} label={label}>{shown}</Pill>
        <Menu aria-label={a.name} selectionMode="single" selectedKeys={selected} onSelectionChange={(k) => pickOne(k, (id) => id)}>
          {(a.options ?? []).map((o) => <MenuItem key={o.id} id={o.id} textValue={o.label}><Tag size="sm" hue={o.hue} status={o.shape}>{o.label}</Tag></MenuItem>)}
        </Menu>
      </MenuTrigger>
    );
  }
  if (a.type === 'actor' || a.type === 'record') {
    const people = a.candidates ?? [];
    return (
      <MenuTrigger>
        <Pill kind="value" isEmpty={empty} isDisabled={isReadOnly} label={label}>{shown}</Pill>
        <Menu aria-label={a.name} filterPlaceholder={`Find ${a.name.toLowerCase()}…`} selectionMode="single" selectedKeys={selected} onSelectionChange={(k) => pickOne(k, (id) => people.find((p) => p.id === id))}>
          {people.map((p) => <MenuItem key={p.id} id={p.id} icon={<Avatar name={p.name} size={20} />}>{p.name}</MenuItem>)}
        </Menu>
      </MenuTrigger>
    );
  }
  if (a.type === 'date' || a.type === 'timestamp') {
    return (
      <MenuTrigger>
        <Pill kind="value" isEmpty={empty} isDisabled={isReadOnly} label={label}>{shown}</Pill>
        <Menu aria-label={a.name} selectionMode="single" selectedKeys={selected} onSelectionChange={(k) => pickOne(k, (id) => id)}>
          {DATES.map((d) => <MenuItem key={d.id} id={d.id} description={new Date(`${d.id}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}>{d.label}</MenuItem>)}
        </Menu>
      </MenuTrigger>
    );
  }
  const numeric = a.type === 'number' || a.type === 'currency' || a.type === 'percent' || a.type === 'rating';
  return (
    <DialogTrigger>
      <Pill kind="value" isEmpty={empty} isDisabled={isReadOnly} label={label}>{shown}</Pill>
      <Popover label={a.name} className="tf-sentence__pop">
        {numeric ? (
          <NumberField
            label={a.name} autoFocus mode={a.type === 'currency' ? 'currency' : a.type === 'percent' ? 'percent' : 'number'} currency={a.currency}
            value={typeof value === 'number' ? (a.type === 'percent' ? value * 100 : value) : Number.NaN} showSteppers={false}
            onChange={(n) => onChange(Number.isNaN(n) ? undefined : a.type === 'percent' ? n / 100 : n)}
          />
        ) : (
          <TextField label={a.name} autoFocus value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(v === '' ? undefined : v)} />
        )}
      </Popover>
    </DialogTrigger>
  );
}
