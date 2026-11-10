import { Button as AriaButton, DialogTrigger, type Key, type Selection } from 'react-aria-components';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, Plus, SlidersHorizontal, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Switch, RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { MenuTrigger, Menu, MenuList, MenuItem, MenuSection, CLOSE_AFTER_PICK_MS } from '../Menu/Menu.tsx';
import { TextField } from '../Field/Field.tsx';
import { cx } from '../../lib/cx.ts';
import './FilterBar.css';

/** How a field filters: choice fields pick values, text and number fields type one. */
export type FilterFieldType = 'select' | 'status' | 'person' | 'text' | 'number';

/** An attribute the view can filter and sort by. */
export interface FilterField {
  readonly id: string;
  readonly name: string;
  readonly type: FilterFieldType;
  readonly icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly hue?: Hue; readonly status?: StatusShape }>;
}

/** One applied filter: field, operator in words, and its values (empty for bare operators). */
export interface FilterRule {
  readonly id: string;
  readonly field: string;
  readonly operator: string;
  readonly values: ReadonlyArray<string>;
}

/** One sort, the first deciding first. */
export interface SortRule {
  readonly field: string;
  readonly direction: 'ascending' | 'descending';
}

/** A column the view can show or hide. `isLocked` (the name) is always shown. */
export interface ViewColumn {
  readonly id: string;
  readonly name: string;
  readonly icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly isShown: boolean;
  readonly isLocked?: boolean;
}

/** Row height of the view. */
export type Density = 'comfortable' | 'compact';

/** The operators each field type offers, in words. */
export const FILTER_OPERATORS: Readonly<Record<FilterFieldType, ReadonlyArray<string>>> = {
  select: ['is', 'is not', 'is empty'],
  status: ['is', 'is not', 'is empty'],
  person: ['is', 'is not', 'is empty'],
  text: ['contains', 'is', 'is empty'],
  number: ['is greater than', 'is less than', 'is'],
};
const BARE: ReadonlySet<string> = new Set(['is empty']);
const CLEAR_MS = 1000; // transitions.dev 13 --clear-dur
const i14 = { size: 14, strokeWidth: 1.75 } as const;
const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** The one key a single-choice Selection holds. */
function firstKey(keys: Selection): string | undefined {
  if (keys === 'all') return undefined;
  const k = [...keys][0];
  return k === undefined ? undefined : String(k);
}

/** Props for FilterBar. Every list is controlled; the bar animates and edits, the screen stores and counts. */
export interface FilterBarProps {
  readonly fields: ReadonlyArray<FilterField>;
  readonly filters: ReadonlyArray<FilterRule>;
  readonly onFiltersChange: (f: ReadonlyArray<FilterRule>) => void;
  readonly sorts?: ReadonlyArray<SortRule>;
  readonly onSortsChange?: (s: ReadonlyArray<SortRule>) => void;
  readonly columns?: ReadonlyArray<ViewColumn>;
  readonly onColumnsChange?: (c: ReadonlyArray<ViewColumn>) => void;
  readonly density?: Density;
  readonly onDensityChange?: (d: Density) => void;
  /** Records the filters hide; shows the "14 companies hidden · Clear" line. */
  readonly hiddenCount?: number;
  readonly totalCount?: number;
  /** Plural noun for the records ("companies"). */
  readonly noun?: string;
  /** Opens "+ Filter" straight at this field's operators (a column menu's "Filter by this"); bump `seq` to open it again. */
  readonly startFilter?: { readonly field: string; readonly seq: number };
}

/** A view's toolbar: Linear-style filter chips with three clickable parts, + Filter, sort pills, view settings and the hidden-by-filters line. Replaces FilterChip, FilterBuilder, ConditionRow, SortBuilder and ViewSettings. */
export function FilterBar({ fields, filters, onFiltersChange, sorts = [], onSortsChange, columns, onColumnsChange, density = 'comfortable', onDensityChange, hiddenCount = 0, totalCount, noun = 'records', startFilter }: FilterBarProps) {
  const [clearing, setClearing] = useState<ReadonlySet<string>>(new Set());
  const [justCleared, setJustCleared] = useState(false);
  const latest = useRef(filters);
  latest.current = filters;
  const fieldOf = (id: string) => fields.find((f) => f.id === id);

  // transitions.dev 13: chips fly down, blur and fade over a soft streak, then leave the list.
  const dissolve = (ids: ReadonlyArray<string>) => {
    setClearing((s) => new Set([...s, ...ids]));
    window.setTimeout(() => {
      onFiltersChange(latest.current.filter((f) => !ids.includes(f.id)));
      setClearing((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    }, CLEAR_MS);
  };
  const clearAll = () => { dissolve(filters.map((f) => f.id)); setJustCleared(true); };
  useEffect(() => { if (filters.length > 0 && clearing.size === 0) setJustCleared(false); }, [filters.length, clearing.size]);
  const update = (id: string, patch: Partial<FilterRule>) => onFiltersChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <div className="tf-fbar">
      <div className="tf-fbar__row">
        <AddFilter fields={fields} filters={filters} onFiltersChange={onFiltersChange} start={startFilter} />
        {filters.map((rule) => {
          const field = fieldOf(rule.field);
          if (!field) return null;
          return (
            <span key={rule.id} className={cx('tf-fbar__chipwrap', clearing.has(rule.id) && 'is-clearing')} inert={clearing.has(rule.id) || undefined}>
              <span className="tf-fbar__chip" role="group" aria-label={`${field.name} ${rule.operator} ${valueText(field, rule)}`}>
                <MenuTrigger>
                  <AriaButton className="tf-fbar__seg" aria-label={`Change field, now ${field.name}`}>{field.icon && <field.icon {...i14} />}{field.name}</AriaButton>
                  <Menu aria-label="Field" selectionMode="single" selectedKeys={[field.id]}
                    onSelectionChange={(keys) => { const id = firstKey(keys); if (id === undefined || id === field.id) return; const t = fieldOf(id)?.type ?? 'text'; update(rule.id, { field: id, operator: FILTER_OPERATORS[t][0] ?? 'is', values: [] }); }}>
                    {fields.map((f) => <MenuItem key={f.id} id={f.id} icon={f.icon && <f.icon {...i16} />}>{f.name}</MenuItem>)}
                  </Menu>
                </MenuTrigger>
                <MenuTrigger>
                  <AriaButton className="tf-fbar__seg tf-fbar__seg--quiet" aria-label={`Change operator, now ${rule.operator}`}>{rule.operator}</AriaButton>
                  <Menu aria-label="Operator" selectionMode="single" selectedKeys={[rule.operator]}
                    onSelectionChange={(keys) => { const op = firstKey(keys); if (op !== undefined) update(rule.id, { operator: op, values: BARE.has(op) ? [] : rule.values }); }}>
                    {FILTER_OPERATORS[field.type].map((o) => <MenuItem key={o} id={o}>{o}</MenuItem>)}
                  </Menu>
                </MenuTrigger>
                {!BARE.has(rule.operator) && (
                  <ValueSegment field={field} rule={rule} onChange={(values) => update(rule.id, { values })} />
                )}
                <AriaButton className="tf-fbar__x" aria-label={`Remove filter ${field.name}`} onPress={() => dissolve([rule.id])}><X {...i14} /></AriaButton>
              </span>
            </span>
          );
        })}
        <span className="tf-fbar__spacer" />
        {onSortsChange && <SortPills fields={fields} sorts={sorts} onSortsChange={onSortsChange} />}
        {columns && onColumnsChange && <ViewSettings columns={columns} onColumnsChange={onColumnsChange} density={density} onDensityChange={onDensityChange} />}
      </div>
      {filters.length > 0 && hiddenCount > 0 && clearing.size < filters.length ? (
        <p className="tf-fbar__line" aria-live="polite">
          <span className="tf-num"><NumberRoll value={hiddenCount} /></span> {noun} hidden by filters ·{' '}
          <AriaButton className="tf-fbar__link" onPress={clearAll}>Clear</AriaButton>
        </p>
      ) : justCleared && totalCount !== undefined ? (
        <p className="tf-fbar__line tf-fbar__line--in" aria-live="polite">Showing all {totalCount} {noun}</p>
      ) : null}
    </div>
  );
}

function valueText(field: FilterField, rule: FilterRule): string {
  const labels = rule.values.map((v) => field.options?.find((o) => o.id === v)?.label ?? v);
  if (labels.length === 0) return 'Any';
  if (labels.length <= 2) return labels.join(', ');
  return `${labels[0] ?? ''} +${labels.length - 1}`;
}

/** The value part of a chip: a menu of choices that stays open while you toggle them, or a small text popover that applies on Enter. */
function ValueSegment({ field, rule, onChange }: { readonly field: FilterField; readonly rule: FilterRule; readonly onChange: (v: ReadonlyArray<string>) => void }) {
  const label = `Change value, now ${valueText(field, rule)}`;
  const trigger = <AriaButton className="tf-fbar__seg" aria-label={label}>{valueText(field, rule)}</AriaButton>;
  if (field.type === 'text' || field.type === 'number') {
    return <TextSegment label={label} trigger={trigger} field={field} values={rule.values} onChange={onChange} />;
  }
  return (
    <MenuTrigger>
      {trigger}
      <Menu aria-label={field.name} selectionMode="multiple" selectedKeys={rule.values} onSelectionChange={(keys) => onChange(keys === 'all' ? (field.options ?? []).map((o) => o.id) : [...keys].map(String))}>
        <ChoiceItems field={field} />
      </Menu>
    </MenuTrigger>
  );
}

function TextSegment({ label, trigger, field, values, onChange }: { readonly label: string; readonly trigger: ReactNode; readonly field: FilterField; readonly values: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      {trigger}
      <Popover label={label} width="menu">
        <TextValue field={field} values={values} onChange={onChange} onDone={() => setOpen(false)} />
      </Popover>
    </DialogTrigger>
  );
}

/** A choice field's options as menu rows: Tags for select and status, plain names for people. */
function ChoiceItems({ field }: { readonly field: FilterField }) {
  return <>{(field.options ?? []).map((o) => (
    <MenuItem key={o.id} id={o.id} textValue={o.label}>{field.type === 'person' ? o.label : <Tag size="sm" hue={o.hue} status={o.status}>{o.label}</Tag>}</MenuItem>
  ))}</>;
}

/** A typed filter value (text or an amount), applied on Enter. */
function TextValue({ field, values, onChange, onDone }: { readonly field: FilterField; readonly values: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void; readonly onDone: () => void }) {
  const [text, setText] = useState(values[0] ?? '');
  return (
    <TextField aria-label={field.name} value={text} onChange={setText} autoFocus className="tf-fbar__field"
      placeholder={field.type === 'number' ? 'Amount' : `${field.name} contains…`} inputMode={field.type === 'number' ? 'decimal' : undefined}
      onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onChange([text.trim()]); onDone(); } }} />
  );
}

/** Holds content whose height changes (a step of a flow) and eases the popover to the new height: transitions.dev 01 card resize. */
function ResizeBox({ children }: { readonly children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="tf-fbar__resize" style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

type Step = { readonly step: 'field' } | { readonly step: 'op'; readonly field: FilterField } | { readonly step: 'value'; readonly field: FilterField; readonly op: string; readonly ruleId: string };

/** "+ Filter": attributes, then operators, then values, in one popover that eases to each step's height. */
function AddFilter({ fields, filters, onFiltersChange, start }: { readonly fields: ReadonlyArray<FilterField>; readonly filters: ReadonlyArray<FilterRule>; readonly onFiltersChange: (f: ReadonlyArray<FilterRule>) => void; readonly start?: { readonly field: string; readonly seq: number } }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ step: 'field' });
  useEffect(() => { const f = start && fields.find((x) => x.id === start.field); if (f) { setStep({ step: 'op', field: f }); setOpen(true); } }, [start?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => window.setTimeout(() => setOpen(false), CLOSE_AFTER_PICK_MS);
  const rule = step.step === 'value' ? filters.find((f) => f.id === step.ruleId) : undefined;
  const put = (r: FilterRule) => onFiltersChange(filters.some((f) => f.id === r.id) ? filters.map((f) => (f.id === r.id ? r : f)) : [...filters, r]);
  const pickField = (id: Key) => { const f = fields.find((x) => x.id === id); if (f) setStep({ step: 'op', field: f }); };
  const pickOp = (field: FilterField, op: string) => {
    const id = `f${Date.now()}`;
    if (BARE.has(op)) { put({ id, field: field.id, operator: op, values: [] }); close(); return; }
    setStep({ step: 'value', field, op, ruleId: id });
  };
  const putValues = (field: FilterField, op: string, ruleId: string, values: ReadonlyArray<string>) => put({ id: ruleId, field: field.id, operator: op, values });
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (o && !(start && step.step === 'op')) setStep({ step: 'field' }); }}>
      <Button size="sm" icon={<ListFilter {...i14} />}>Filter</Button>
      <Popover label="Add filter" width="menu">
        <ResizeBox>
          {step.step === 'field' && (
            <div key="field" className="tf-fbar__step">
              <MenuList aria-label="Filter by" autoFocus="first" onAction={pickField}>
                <MenuSection title="Filter by">
                  {fields.map((f) => <MenuItem key={f.id} id={f.id} icon={f.icon && <f.icon {...i16} />}>{f.name}</MenuItem>)}
                </MenuSection>
              </MenuList>
            </div>
          )}
          {step.step === 'op' && (
            <div key="op" className="tf-fbar__step">
              <MenuList aria-label={`${step.field.name} operator`} autoFocus="first" onAction={(op) => pickOp(step.field, String(op))}>
                <MenuSection title={step.field.name}>
                  {FILTER_OPERATORS[step.field.type].map((o) => <MenuItem key={o} id={o}>{o}</MenuItem>)}
                </MenuSection>
              </MenuList>
            </div>
          )}
          {step.step === 'value' && (
            <div key="value" className="tf-fbar__step">
              <p className="tf-fbar__heading">{step.field.name} {step.op}</p>
              {step.field.type === 'text' || step.field.type === 'number'
                ? <TextValue field={step.field} values={rule?.values ?? []} onChange={(v) => putValues(step.field, step.op, step.ruleId, v)} onDone={close} />
                : (
                  <MenuList aria-label={step.field.name} autoFocus="first" selectionMode="multiple" selectedKeys={rule?.values ?? []}
                    onSelectionChange={(keys) => putValues(step.field, step.op, step.ruleId, keys === 'all' ? (step.field.options ?? []).map((o) => o.id) : [...keys].map(String))}>
                    <ChoiceItems field={step.field} />
                  </MenuList>
                )}
            </div>
          )}
        </ResizeBox>
      </Popover>
    </DialogTrigger>
  );
}

/** Sort pills: press to flip the direction (the arrow swaps), × to remove, Sort to add the next. */
function SortPills({ fields, sorts, onSortsChange }: { readonly fields: ReadonlyArray<FilterField>; readonly sorts: ReadonlyArray<SortRule>; readonly onSortsChange: (s: ReadonlyArray<SortRule>) => void }) {
  const free = fields.filter((f) => !sorts.some((s) => s.field === f.id));
  return (
    <>
      {sorts.map((s, i) => {
        const f = fields.find((x) => x.id === s.field);
        if (!f) return null;
        const flip = () => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, direction: x.direction === 'ascending' ? 'descending' : 'ascending' } : x)));
        return (
          <span key={s.field} className="tf-fbar__sort">
            <AriaButton className="tf-fbar__seg" onPress={flip} aria-label={`${f.name}, ${s.direction}. Press to reverse`}>
              <span className="tf-fbar__arrow" data-state={s.direction} aria-hidden="true">
                <ArrowUp data-icon="ascending" {...i14} /><ArrowDown data-icon="descending" {...i14} />
              </span>
              {f.name}
            </AriaButton>
            <AriaButton className="tf-fbar__x" aria-label={`Remove sort ${f.name}`} onPress={() => onSortsChange(sorts.filter((_, j) => j !== i))}><X {...i14} /></AriaButton>
          </span>
        );
      })}
      {free.length > 0 && sorts.length < 5 && (
        <MenuTrigger>
          {sorts.length ? <IconButton size="sm" label="Add sort"><Plus {...i14} /></IconButton> : <Button size="sm" variant="ghost" icon={<ArrowUpDown {...i14} />}>Sort</Button>}
          <Menu aria-label="Sort by" placement="bottom end" onAction={(id) => onSortsChange([...sorts, { field: String(id), direction: 'ascending' }])}>
            <MenuSection title={sorts.length ? 'Then by' : 'Sort by'}>
              {free.map((f) => <MenuItem key={f.id} id={f.id} icon={f.icon && <f.icon {...i16} />}>{f.name}</MenuItem>)}
            </MenuSection>
          </Menu>
        </MenuTrigger>
      )}
    </>
  );
}

/** View settings: show or hide columns with switches, and the row density. */
function ViewSettings({ columns, onColumnsChange, density, onDensityChange }: { readonly columns: ReadonlyArray<ViewColumn>; readonly onColumnsChange: (c: ReadonlyArray<ViewColumn>) => void; readonly density: Density; readonly onDensityChange?: (d: Density) => void }) {
  const shown = columns.filter((c) => c.isShown).length;
  return (
    <DialogTrigger>
      <Button size="sm" variant="ghost" icon={<SlidersHorizontal {...i14} />}>View</Button>
      <Popover label="View settings" placement="bottom end" className="tf-fbar__view">
        <p className="tf-fbar__heading">Columns · <span className="tf-num">{shown} of {columns.length}</span> shown</p>
        <ul className="tf-fbar__cols">
          {columns.map((c) => (
            <li key={c.id} className="tf-fbar__col">
              {c.icon && <span className="tf-fbar__colicon"><c.icon {...i14} /></span>}
              <span className="tf-fbar__colname">{c.name}</span>
              {c.isLocked ? <span className="tf-fbar__locked">Always shown</span> : (
                <Switch aria-label={`Show ${c.name}`} isSelected={c.isShown} onChange={(v) => onColumnsChange(columns.map((x) => (x.id === c.id ? { ...x, isShown: v } : x)))} />
              )}
            </li>
          ))}
        </ul>
        {onDensityChange && (
          <div className="tf-fbar__density">
            <RadioGroup label="Density" orientation="horizontal" value={density} onChange={(v) => onDensityChange(v === 'compact' ? 'compact' : 'comfortable')}>
              <Radio value="comfortable">Comfortable</Radio><Radio value="compact">Compact</Radio>
            </RadioGroup>
          </div>
        )}
      </Popover>
    </DialogTrigger>
  );
}
