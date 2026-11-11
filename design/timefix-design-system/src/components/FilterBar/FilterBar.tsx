import { Button as AriaButton, DialogTrigger, type Key, type Selection } from 'react-aria-components';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Brackets, ListFilter, Plus, SlidersHorizontal, X } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Switch, RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { MenuTrigger, Menu, MenuList, MenuItem, MenuSection, CLOSE_AFTER_PICK_MS } from '../Menu/Menu.tsx';
import { TextField } from '../Field/Field.tsx';
import { SortableList } from '../DragHandle/DragHandle.tsx';
import { cx } from '../../lib/cx.ts';
import './FilterBar.css';

/** How a field filters: choice fields pick values, text and number fields type one, dates pick a day or a number of days. */
export type FilterFieldType = 'select' | 'status' | 'person' | 'text' | 'number' | 'date';

/** An attribute the view can filter and sort by. */
export interface FilterField {
  readonly id: string;
  readonly name: string;
  readonly type: FilterFieldType;
  readonly icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly hue?: Hue; readonly status?: StatusShape }>;
  /** A related record's field ("Company"): listed under that heading, and the chip reads "Company › Industry". */
  readonly section?: string;
}

/** Filters in brackets with their own and/or ("(Industry is Software or City is Pune)"). */
export interface FilterGroup {
  readonly id: string;
  readonly match: 'all' | 'any';
  readonly rules: ReadonlyArray<FilterRule>;
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
  select: ['is', 'is not', 'is empty', 'is not empty'],
  status: ['is', 'is not', 'is empty', 'is not empty'],
  person: ['is', 'is not', 'is empty', 'is not empty'],
  text: ['contains', 'does not contain', 'is', 'is empty', 'is not empty'],
  number: ['is greater than', 'is less than', 'is between', 'is', 'is empty', 'is not empty'],
  date: ['is before', 'is after', 'is between', 'in the last', 'in the next', 'is empty', 'is not empty'],
};
const BARE: ReadonlySet<string> = new Set(['is empty', 'is not empty']);
/** Operators whose value is typed (or picked as a day), not chosen from options. */
const TYPED: ReadonlySet<string> = new Set(['is between', 'in the last', 'in the next', 'is before', 'is after']);
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
  /** With two or more filters: whether a record must match all of them (and) or any one (or). The word between chips switches it. */
  readonly match?: 'all' | 'any';
  readonly onMatchChange?: (m: 'all' | 'any') => void;
  /** Bracketed filter groups, each with its own and/or; joined to the chips by `match`. "Filter" then offers "Add a filter group". */
  readonly groups?: ReadonlyArray<FilterGroup>;
  readonly onGroupsChange?: (g: ReadonlyArray<FilterGroup>) => void;
  /** More settings at the top of the View popover (group by, board totals, card fields). */
  readonly viewOptions?: ReactNode;
}

/** A view's toolbar: Linear-style filter chips with three clickable parts, + Filter, sort pills, view settings and the hidden-by-filters line. Replaces FilterChip, FilterBuilder, ConditionRow, SortBuilder and ViewSettings. */
export function FilterBar({ fields, filters, onFiltersChange, sorts = [], onSortsChange, columns, onColumnsChange, density = 'comfortable', onDensityChange, hiddenCount = 0, totalCount, noun = 'records', startFilter, match = 'all', onMatchChange, groups = [], onGroupsChange, viewOptions }: FilterBarProps) {
  const [clearing, setClearing] = useState<ReadonlySet<string>>(new Set());
  const [justCleared, setJustCleared] = useState(false);
  const latest = useRef(filters);
  latest.current = filters;
  const fieldOf = (id: string) => fields.find((f) => f.id === id);

  // transitions.dev 13: chips fly down and fade over a soft streak, then leave the list.
  const dissolve = (ids: ReadonlyArray<string>) => {
    setClearing((s) => new Set([...s, ...ids]));
    window.setTimeout(() => {
      onFiltersChange(latest.current.filter((f) => !ids.includes(f.id)));
      setClearing((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    }, CLEAR_MS);
  };
  const clearAll = () => { dissolve(filters.map((f) => f.id)); onGroupsChange?.([]); setJustCleared(true); };
  useEffect(() => { if (filters.length + groups.length > 0 && clearing.size === 0) setJustCleared(false); }, [filters.length, groups.length, clearing.size]);
  const update = (id: string, patch: Partial<FilterRule>) => onFiltersChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const setGroup = (gid: string, patch: Partial<FilterGroup>) => onGroupsChange?.(groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)));
  const join = (n: number, m: 'all' | 'any', onChange?: (m: 'all' | 'any') => void) => n > 0 && (onChange
    ? <MenuTrigger>
        <AriaButton className="tf-fbar__join" aria-label={m === 'any' ? 'Matching any filter. Change' : 'Matching every filter. Change'}>{m === 'any' ? 'or' : 'and'}</AriaButton>
        <Menu aria-label="Match" selectionMode="single" selectedKeys={[m]} onSelectionChange={(keys) => { const k = firstKey(keys); if (k === 'all' || k === 'any') onChange(k); }}>
          <MenuItem id="all" description="Records that match every filter">and</MenuItem>
          <MenuItem id="any" description="Records that match at least one">or</MenuItem>
        </Menu>
      </MenuTrigger>
    : <span className="tf-fbar__join" aria-hidden="true">and</span>);
  const total = filters.length + groups.length;

  return (
    <div className="tf-fbar">
      <div className="tf-fbar__row">
        <AddFilter fields={fields} onPut={(r) => onFiltersChange(filters.some((f) => f.id === r.id) ? filters.map((f) => (f.id === r.id ? r : f)) : [...filters, r])} rules={filters} start={startFilter}
          onAddGroup={onGroupsChange ? (r) => { const g = groups.find((x) => x.rules.some((y) => y.id === r.id)); if (g) setGroup(g.id, { rules: g.rules.map((y) => (y.id === r.id ? r : y)) }); else onGroupsChange([...groups, { id: `g${Date.now()}`, match: 'any', rules: [r] }]); } : undefined} />
        {filters.map((rule, n) => {
          const field = fieldOf(rule.field);
          if (!field) return null;
          return (
            <span key={rule.id} className={cx('tf-fbar__chipwrap', clearing.has(rule.id) && 'is-clearing')} inert={clearing.has(rule.id) || undefined}>
              {join(n, match, onMatchChange)}
              <Chip field={field} fields={fields} rule={rule} onChange={(patch) => update(rule.id, patch)} onRemove={() => dissolve([rule.id])} />
            </span>
          );
        })}
        {groups.map((g, gi) => (
          <span key={g.id} className="tf-fbar__chipwrap">
            {join(filters.length + gi, match, onMatchChange)}
            <span className="tf-fbar__group" role="group" aria-label={`Filter group, ${g.match === 'any' ? 'any' : 'every'} of ${g.rules.length}`}>
              {g.rules.map((rule, n) => {
                const field = fieldOf(rule.field);
                if (!field) return null;
                return (
                  <span key={rule.id} className="tf-fbar__chipwrap">
                    {join(n, g.match, (m) => setGroup(g.id, { match: m }))}
                    <Chip field={field} fields={fields} rule={rule} onChange={(patch) => setGroup(g.id, { rules: g.rules.map((x) => (x.id === rule.id ? { ...x, ...patch } : x)) })}
                      onRemove={() => { const rest = g.rules.filter((x) => x.id !== rule.id); if (rest.length === 0) onGroupsChange?.(groups.filter((x) => x.id !== g.id)); else setGroup(g.id, { rules: rest }); }} />
                  </span>
                );
              })}
              <AddFilter fields={fields} rules={g.rules} isCompact label="Add to this group" onPut={(r) => setGroup(g.id, { rules: g.rules.some((x) => x.id === r.id) ? g.rules.map((x) => (x.id === r.id ? r : x)) : [...g.rules, r] })} />
              <AriaButton className="tf-fbar__x tf-fbar__ungroup" aria-label="Remove this filter group" onPress={() => onGroupsChange?.(groups.filter((x) => x.id !== g.id))}><X {...i14} /></AriaButton>
            </span>
          </span>
        ))}
        {onSortsChange && <SortPills fields={fields} sorts={sorts} onSortsChange={onSortsChange} />}
        {columns && onColumnsChange && <ViewSettings columns={columns} onColumnsChange={onColumnsChange} density={density} onDensityChange={onDensityChange} extra={viewOptions} />}
      </div>
      {total > 0 && hiddenCount > 0 && clearing.size < filters.length + (groups.length ? 1 : 0) ? (
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

/** One filter as a chip: field, operator, value and ×, each its own button. */
function Chip({ field, fields, rule, onChange, onRemove }: { readonly field: FilterField; readonly fields: ReadonlyArray<FilterField>; readonly rule: FilterRule; readonly onChange: (patch: Partial<FilterRule>) => void; readonly onRemove: () => void }) {
  const name = field.section ? `${field.section} › ${field.name}` : field.name;
  return (
    <span className="tf-fbar__chip" role="group" aria-label={`${name} ${rule.operator} ${valueText(field, rule)}`}>
      <MenuTrigger>
        <AriaButton className="tf-fbar__seg" aria-label={`Change field, now ${name}`}>{field.icon && <field.icon {...i14} />}{name}</AriaButton>
        <Menu aria-label="Field" selectionMode="single" selectedKeys={[field.id]}
          onSelectionChange={(keys) => { const id = firstKey(keys); if (id === undefined || id === field.id) return; const t = fields.find((x) => x.id === id)?.type ?? 'text'; onChange({ field: id, operator: FILTER_OPERATORS[t][0] ?? 'is', values: [] }); }}>
          <FieldItems fields={fields} />
        </Menu>
      </MenuTrigger>
      <MenuTrigger>
        <AriaButton className="tf-fbar__seg tf-fbar__seg--quiet" aria-label={`Change operator, now ${rule.operator}`}>{rule.operator}</AriaButton>
        <Menu aria-label="Operator" selectionMode="single" selectedKeys={[rule.operator]}
          onSelectionChange={(keys) => { const op = firstKey(keys); if (op !== undefined) onChange({ operator: op, values: BARE.has(op) || TYPED.has(op) !== TYPED.has(rule.operator) ? [] : rule.values }); }}>
          {FILTER_OPERATORS[field.type].map((o) => <MenuItem key={o} id={o}>{o}</MenuItem>)}
        </Menu>
      </MenuTrigger>
      {!BARE.has(rule.operator) && (
        <ValueSegment field={field} rule={rule} onChange={(values) => onChange({ values })} />
      )}
      <AriaButton className="tf-fbar__x" aria-label={`Remove filter ${name}`} onPress={onRemove}><X {...i14} /></AriaButton>
    </span>
  );
}

/** Fields as menu rows: own fields first, then each related record's under its name. */
function FieldItems({ fields }: { readonly fields: ReadonlyArray<FilterField> }) {
  const own = fields.filter((f) => !f.section);
  const sections = [...new Set(fields.map((f) => f.section).filter((x): x is string => Boolean(x)))];
  const row = (f: FilterField) => <MenuItem key={f.id} id={f.id} textValue={f.section ? `${f.section} ${f.name}` : f.name} icon={f.icon && <f.icon {...i16} />}>{f.name}</MenuItem>;
  if (sections.length === 0) return <>{own.map(row)}</>;
  return <>{own.length > 0 && <MenuSection title="This record">{own.map(row)}</MenuSection>}{sections.map((sec) => <MenuSection key={sec} title={sec}>{fields.filter((f) => f.section === sec).map(row)}</MenuSection>)}</>;
}

const dateWord = (v: string | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : v ?? ''; };
function valueText(field: FilterField, rule: FilterRule): string {
  if (rule.operator === 'in the last' || rule.operator === 'in the next') return rule.values[0] ? `${rule.values[0]} ${rule.values[0] === '1' ? 'day' : 'days'}` : 'Any';
  if (rule.operator === 'is between') { const [a, b] = rule.values; const w = field.type === 'date' ? dateWord : (x: string | undefined) => x ?? ''; return a || b ? `${a ? w(a) : 'any'} – ${b ? w(b) : 'any'}` : 'Any'; }
  if (field.type === 'date') return rule.values[0] ? dateWord(rule.values[0]) : 'Any';
  const labels = rule.values.map((v) => field.options?.find((o) => o.id === v)?.label ?? v);
  if (labels.length === 0) return 'Any';
  if (labels.length <= 2) return labels.join(', ');
  return `${labels[0] ?? ''} +${labels.length - 1}`;
}

/** The value part of a chip: a menu of choices that stays open while you toggle them, or a small text popover that applies on Enter. */
function ValueSegment({ field, rule, onChange }: { readonly field: FilterField; readonly rule: FilterRule; readonly onChange: (v: ReadonlyArray<string>) => void }) {
  const label = `Change value, now ${valueText(field, rule)}`;
  const trigger = <AriaButton className="tf-fbar__seg" aria-label={label}>{valueText(field, rule)}</AriaButton>;
  if (field.type === 'text' || field.type === 'number' || field.type === 'date' || TYPED.has(rule.operator)) {
    return <TextSegment label={label} trigger={trigger} field={field} operator={rule.operator} values={rule.values} onChange={onChange} />;
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

function TextSegment({ label, trigger, field, operator, values, onChange }: { readonly operator: string; readonly label: string; readonly trigger: ReactNode; readonly field: FilterField; readonly values: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      {trigger}
      <Popover label={label} width="menu">
        <TextValue field={field} operator={operator} values={values} onChange={onChange} onDone={() => setOpen(false)} />
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

/** A typed filter value, applied on Enter: text or an amount, a day, a number of days, or two ends of a range. */
function TextValue({ field, operator, values, onChange, onDone }: { readonly field: FilterField; readonly operator: string; readonly values: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void; readonly onDone: () => void }) {
  const [text, setText] = useState(values[0] ?? '');
  const [to, setTo] = useState(values[1] ?? '');
  const isDate = field.type === 'date';
  const enter = (e: { readonly key: string }) => { if (e.key === 'Enter') apply(); };
  const apply = () => {
    if (operator === 'is between') { if (!text.trim() && !to.trim()) return; onChange([text.trim(), to.trim()]); onDone(); return; }
    if (text.trim()) { onChange([text.trim()]); onDone(); }
  };
  if (operator === 'is between') {
    return (
      <div className="tf-fbar__range">
        <TextField label="From" value={text} onChange={setText} autoFocus type={isDate ? 'date' : 'text'} inputMode={isDate ? undefined : 'decimal'} onKeyDown={enter} />
        <TextField label="To" value={to} onChange={setTo} type={isDate ? 'date' : 'text'} inputMode={isDate ? undefined : 'decimal'} onKeyDown={enter} />
        <Button size="sm" variant="primary" onPress={apply} isDisabled={!text.trim() && !to.trim()}>Apply</Button>
      </div>
    );
  }
  if (operator === 'in the last' || operator === 'in the next') {
    return <TextField aria-label={`${field.name} ${operator}`} value={text} onChange={(v) => setText(v.replace(/[^\d]/g, ''))} autoFocus className="tf-fbar__field" inputMode="numeric" placeholder="7" suffix={<span className="tf-fbar__unit">days</span>} onKeyDown={enter} />;
  }
  if (isDate) return <TextField aria-label={`${field.name} ${operator}`} value={text} onChange={setText} autoFocus className="tf-fbar__field" type="date" onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} onBlur={() => { if (text && text !== values[0]) onChange([text]); }} />;
  return (
    <TextField aria-label={field.name} value={text} onChange={setText} autoFocus className="tf-fbar__field"
      placeholder={field.type === 'number' ? 'Amount' : `${field.name} contains…`} inputMode={field.type === 'number' ? 'decimal' : undefined}
      onKeyDown={enter} />
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

/** "+ Filter": attributes, then operators, then values, in one popover that eases to each step's height. With `onAddGroup` the first step also offers "Add a filter group"; the rule made then starts the group. */
function AddFilter({ fields, rules, onPut, start, onAddGroup, isCompact = false, label = 'Add filter' }: { readonly fields: ReadonlyArray<FilterField>; readonly rules: ReadonlyArray<FilterRule>; readonly onPut: (r: FilterRule) => void; readonly start?: { readonly field: string; readonly seq: number }; readonly onAddGroup?: (first: FilterRule) => void; readonly isCompact?: boolean; readonly label?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ step: 'field' });
  const [grouping, setGrouping] = useState(false);
  const [madeGroup, setMadeGroup] = useState<string>();
  useEffect(() => { const f = start && fields.find((x) => x.id === start.field); if (f) { setStep({ step: 'op', field: f }); setGrouping(false); setOpen(true); } }, [start?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => window.setTimeout(() => setOpen(false), CLOSE_AFTER_PICK_MS);
  const rule = step.step === 'value' ? rules.find((f) => f.id === step.ruleId) : undefined;
  // A group's first rule makes the group; its later edits (more values) go to the same rule inside it.
  const put = (r: FilterRule) => { if ((grouping || madeGroup) && onAddGroup) { setMadeGroup(r.id); onAddGroup(r); return; } onPut(r); };
  const pickField = (id: Key) => { if (id === '__group') { setGrouping(true); return; } const f = fields.find((x) => x.id === id); if (f) setStep({ step: 'op', field: f }); };
  const pickOp = (field: FilterField, op: string) => {
    const id = `f${Date.now()}`;
    if (BARE.has(op)) { put({ id, field: field.id, operator: op, values: [] }); close(); return; }
    setStep({ step: 'value', field, op, ruleId: id });
  };
  const putValues = (field: FilterField, op: string, ruleId: string, values: ReadonlyArray<string>) => put({ id: ruleId, field: field.id, operator: op, values });
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (o && !(start && step.step === 'op')) { setStep({ step: 'field' }); setGrouping(false); setMadeGroup(undefined); } }}>
      {isCompact ? <IconButton size="sm" label={label}><Plus {...i14} /></IconButton> : <Button size="sm" icon={<ListFilter {...i14} />}>Filter</Button>}
      <Popover label={label} width="menu">
        <ResizeBox>
          {step.step === 'field' && (
            <div key={grouping ? 'group' : 'field'} className="tf-fbar__step">
              <MenuList aria-label="Filter by" autoFocus="first" keepOpen onAction={pickField}>
                <MenuSection title={grouping ? 'A group that starts with' : 'Filter by'}>
                  <FieldItemsFlat fields={fields} />
                </MenuSection>
                {onAddGroup && !grouping && !madeGroup ? <MenuSection><MenuItem id="__group" icon={<Brackets {...i16} />} description="Filters with their own and/or">Add a filter group</MenuItem></MenuSection> : null}
              </MenuList>
            </div>
          )}
          {step.step === 'op' && (
            <div key="op" className="tf-fbar__step">
              <MenuList aria-label={`${step.field.name} operator`} autoFocus="first" keepOpen onAction={(op) => pickOp(step.field, String(op))}>
                <MenuSection title={step.field.section ? `${step.field.section} › ${step.field.name}` : step.field.name}>
                  {FILTER_OPERATORS[step.field.type].map((o) => <MenuItem key={o} id={o}>{o}</MenuItem>)}
                </MenuSection>
              </MenuList>
            </div>
          )}
          {step.step === 'value' && (
            <div key="value" className="tf-fbar__step">
              <p className="tf-fbar__heading">{step.field.name} {step.op}</p>
              {step.field.type === 'text' || step.field.type === 'number' || step.field.type === 'date' || TYPED.has(step.op)
                ? <TextValue field={step.field} operator={step.op} values={rule?.values ?? []} onChange={(v) => putValues(step.field, step.op, step.ruleId, v)} onDone={close} />
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

/** The field step's rows: related fields read "Company › Industry" so one flat list stays scannable. */
function FieldItemsFlat({ fields }: { readonly fields: ReadonlyArray<FilterField> }) {
  return <>{fields.map((f) => <MenuItem key={f.id} id={f.id} textValue={f.section ? `${f.section} ${f.name}` : f.name} icon={f.icon && <f.icon {...i16} />}>{f.section ? `${f.section} › ${f.name}` : f.name}</MenuItem>)}</>;
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

/** View settings: the screen's own options (group by, totals), then columns: drag to reorder, switch to show or hide; and the row density. */
function ViewSettings({ columns, onColumnsChange, density, onDensityChange, extra }: { readonly columns: ReadonlyArray<ViewColumn>; readonly onColumnsChange: (c: ReadonlyArray<ViewColumn>) => void; readonly density: Density; readonly onDensityChange?: (d: Density) => void; readonly extra?: ReactNode }) {
  const shown = columns.filter((c) => c.isShown).length;
  const locked = columns.filter((c) => c.isLocked);
  const free = columns.filter((c) => !c.isLocked);
  return (
    <DialogTrigger>
      <Button size="sm" variant="ghost" icon={<SlidersHorizontal {...i14} />}>View</Button>
      <Popover label="View settings" placement="bottom end" className="tf-fbar__view">
        {extra && <div className={cx('tf-fbar__extra', columns.length === 0 && 'tf-fbar__extra--only')}>{extra}</div>}
        {columns.length > 0 && <p className="tf-fbar__heading">Columns · <span className="tf-num">{shown} of {columns.length}</span> shown · drag to reorder</p>}
        <ul className="tf-fbar__cols">
          {locked.map((c) => (
            <li key={c.id} className="tf-fbar__col">
              {c.icon && <span className="tf-fbar__colicon"><c.icon {...i14} /></span>}
              <span className="tf-fbar__colname">{c.name}</span>
              <span className="tf-fbar__locked">Always first</span>
            </li>
          ))}
        </ul>
        <SortableList items={free} label="Columns" getText={(c) => c.name} onReorder={(next) => onColumnsChange([...locked, ...next])}>
          {(c) => (
            <span className="tf-fbar__col tf-fbar__col--drag">
              {c.icon && <span className="tf-fbar__colicon"><c.icon {...i14} /></span>}
              <span className="tf-fbar__colname">{c.name}</span>
              <Switch aria-label={`Show ${c.name}`} isSelected={c.isShown} onChange={(v) => onColumnsChange(columns.map((x) => (x.id === c.id ? { ...x, isShown: v } : x)))} />
            </span>
          )}
        </SortableList>
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
