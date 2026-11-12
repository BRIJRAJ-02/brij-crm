import { Radio, RadioGroup } from 'react-aria-components';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeftRight, type LucideIcon } from 'lucide-react';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import './RelationshipSettings.css';

/** An object a relationship can join: its names, icon and tile colour. */
export interface SchemaObject {
  readonly id: string;
  readonly singular: string;
  readonly plural: string;
  readonly icon: LucideIcon;
  readonly hue: Hue;
}

/** How many records each side holds. `oneToMany`: one record on the left side links to many on the right. */
export type Cardinality = 'oneToOne' | 'oneToMany' | 'manyToMany';

/** A relationship as the schema holds it: both objects, how they link, and the attribute name each side shows. */
export interface Relationship {
  readonly fromId: string;
  readonly toId: string;
  readonly cardinality: Cardinality;
  /** The attribute on the `from` object (shows the `to` records). */
  readonly fromName: string;
  /** The attribute on the `to` object (shows the `from` records). */
  readonly toName: string;
}

/** Each cardinality's name and the one line under it. */
export const CARDINALITIES: ReadonlyArray<{ readonly id: Cardinality; readonly label: string }> = [
  { id: 'oneToOne', label: 'One to one' },
  { id: 'oneToMany', label: 'One to many' },
  { id: 'manyToMany', label: 'Many to many' },
];

const lower = (s: string) => s.toLowerCase();
/** Whether the `from` side holds many `to` records, and the other way. */
export function sidesHoldMany(c: Cardinality): { readonly fromHoldsMany: boolean; readonly toHoldsMany: boolean } {
  return { fromHoldsMany: c !== 'oneToOne', toHoldsMany: c === 'manyToMany' };
}
/** The names each side gets until someone types over them: the other object's singular when it holds one, plural when many. */
export function defaultNames(from: SchemaObject, to: SchemaObject, c: Cardinality): { readonly fromName: string; readonly toName: string } {
  const { fromHoldsMany, toHoldsMany } = sidesHoldMany(c);
  return { fromName: fromHoldsMany ? to.plural : to.singular, toName: toHoldsMany ? from.plural : from.singular };
}
/** The relationship said in words: "Each company has many people. Each person belongs to one company." */
export function describeRelationship(from: SchemaObject, to: SchemaObject, c: Cardinality): string {
  const { fromHoldsMany, toHoldsMany } = sidesHoldMany(c);
  return `Each ${lower(from.singular)} has ${fromHoldsMany ? `many ${lower(to.plural)}` : `one ${lower(to.singular)}`}. Each ${lower(to.singular)} belongs to ${toHoldsMany ? `many ${lower(from.plural)}` : `one ${lower(from.singular)}`}.`;
}

/** A small picture of a cardinality: dots for records on each side, lines for links. */
export function CardinalityDiagram({ cardinality }: { readonly cardinality: Cardinality }) {
  const left = cardinality === 'manyToMany' ? [6, 16, 26] : [16];
  const right = cardinality === 'oneToOne' ? [16] : [6, 16, 26];
  const links = cardinality === 'manyToMany' ? [[6, 6], [6, 16], [16, 6], [16, 26], [26, 16], [26, 26]] : left.flatMap((l) => right.map((r) => [l, r]));
  return (
    <svg className="tf-relationship__diagram" width={56} height={32} viewBox="0 0 56 32" aria-hidden="true">
      {links.map(([a, b]) => <line key={`${a}-${b}`} x1={10} y1={a} x2={46} y2={b} />)}
      {left.map((y) => <circle key={`l${y}`} cx={8} cy={y} r={3} />)}
      {right.map((y) => <circle key={`r${y}`} cx={48} cy={y} r={3} />)}
    </svg>
  );
}

function ObjectTile({ object }: { readonly object: SchemaObject }) {
  const I = object.icon;
  return <span className="tf-relationship__tile" style={{ '--tf-relationship-bg': `var(--tag-${object.hue}-bg)`, '--tf-relationship-fg': `var(--tag-${object.hue}-text)` } as CSSProperties}><I size={16} strokeWidth={1.75} aria-hidden="true" /></span>;
}

/** Props for RelationshipSettings. */
export interface RelationshipSettingsProps {
  /** Every object a side can be. */
  readonly objects: ReadonlyArray<SchemaObject>;
  readonly value: Relationship;
  readonly onChange: (value: Relationship) => void;
  /** `edit`: both objects and the cardinality are fixed once created; only the names change. */
  readonly mode?: 'create' | 'edit';
  /** Lets the `from` object be chosen too (the schema map); otherwise it is the object you came from. */
  readonly canChooseFrom?: boolean;
}

/**
 * Defines a link between two objects: the two object cards with ⟷ between them, a cardinality picked from three small diagrams,
 * the attribute name each side shows, and the relationship said back as a sentence. Names follow the objects and the cardinality until someone types.
 */
export function RelationshipSettings({ objects, value, onChange, mode = 'create', canChooseFrom = false }: RelationshipSettingsProps) {
  const [typed, setTyped] = useState({ from: mode === 'edit', to: mode === 'edit' });
  const from = objects.find((o) => o.id === value.fromId);
  const to = objects.find((o) => o.id === value.toId);
  if (!from || !to) return null;
  const fixed = mode === 'edit';
  const self = from.id === to.id;

  /** Applies a change, refreshing the names nobody typed. */
  const apply = (next: Relationship) => {
    const f = objects.find((o) => o.id === next.fromId) ?? from;
    const t = objects.find((o) => o.id === next.toId) ?? to;
    const names = defaultNames(f, t, next.cardinality);
    onChange({ ...next, fromName: typed.from ? next.fromName : names.fromName, toName: typed.to ? next.toName : names.toName });
  };
  const swap = () => {
    setTyped({ from: typed.to, to: typed.from });
    onChange({ ...value, fromId: value.toId, toId: value.fromId, fromName: value.toName, toName: value.fromName });
  };
  const objectItems = objects.map((o) => ({ id: o.id, label: o.plural, icon: <ObjectTile object={o} /> }));

  const side = (o: SchemaObject, which: 'from' | 'to', picker: ReactNode) => (
    <div className="tf-relationship__side">
      <div className="tf-relationship__object">
        <ObjectTile object={o} />
        <span className="tf-relationship__objtext">
          <span className="tf-relationship__objname">{o.plural}</span>
          <span className="tf-relationship__objsub">{which === 'from' ? 'This object' : 'Linked object'}</span>
        </span>
      </div>
      {picker}
    </div>
  );

  return (
    <div className="tf-relationship">
      <div className="tf-relationship__pair">
        {side(from, 'from', canChooseFrom && !fixed ? <Select label="Object" isLabelHidden items={objectItems} value={from.id} onChange={(id) => id && apply({ ...value, fromId: id })} /> : null)}
        <div className="tf-relationship__link">
          <span key={value.cardinality} className="tf-relationship__glyph"><CardinalityDiagram cardinality={value.cardinality} /></span>
          {!fixed && (
            <Tooltip label="Swap sides">
              <IconButton label="Swap sides" size="sm" onPress={swap}><ArrowLeftRight size={14} strokeWidth={1.75} /></IconButton>
            </Tooltip>
          )}
        </div>
        {side(to, 'to', !fixed ? <Select label="Linked object" isLabelHidden items={objectItems} value={to.id} onChange={(id) => id && apply({ ...value, toId: id })} /> : null)}
      </div>

      <RadioGroup
        className="tf-relationship__cards" orientation="horizontal" value={value.cardinality} isDisabled={fixed}
        onChange={(c) => apply({ ...value, cardinality: c as Cardinality })} aria-label="How records link"
      >
        {CARDINALITIES.map((c) => {
          const { fromHoldsMany, toHoldsMany } = sidesHoldMany(c.id);
          return (
            <Radio key={c.id} value={c.id} className="tf-relationship__card">
              <CardinalityDiagram cardinality={c.id} />
              <span className="tf-relationship__cardlabel">{c.label}</span>
              <span className="tf-relationship__cardhint">{fromHoldsMany ? 'Many' : 'One'} {lower(fromHoldsMany ? to.plural : to.singular)} per {lower(from.singular)}{toHoldsMany ? ', and back' : ''}</span>
            </Radio>
          );
        })}
      </RadioGroup>
      {fixed && <p className="tf-relationship__note">Objects and how they link are fixed once created. You can rename both sides.</p>}

      <div className="tf-relationship__names">
        <TextField
          label={`Name on ${from.plural}`} value={value.fromName}
          description={`${from.plural} show linked ${lower(sidesHoldMany(value.cardinality).fromHoldsMany ? to.plural : to.singular)} here.`}
          onChange={(v) => { setTyped((t) => ({ ...t, from: v !== '' })); onChange({ ...value, fromName: v }); }}
        />
        <TextField
          label={self ? `Reverse name on ${to.plural}` : `Name on ${to.plural}`} value={value.toName}
          isInvalid={self && value.toName.trim() !== '' && lower(value.toName.trim()) === lower(value.fromName.trim())}
          errorMessage="Give the reverse side its own name."
          description={`${to.plural} show linked ${lower(sidesHoldMany(value.cardinality).toHoldsMany ? from.plural : from.singular)} here.`}
          onChange={(v) => { setTyped((t) => ({ ...t, to: v !== '' })); onChange({ ...value, toName: v }); }}
        />
      </div>

      <p className="tf-relationship__sentence" aria-live="polite">
        <TextSwap swapKey={`${from.id}-${to.id}-${value.cardinality}`}>{describeRelationship(from, to, value.cardinality)}</TextSwap>
      </p>
    </div>
  );
}
