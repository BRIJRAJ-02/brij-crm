// The record model every screen reads: each object's fields (built in, owner-made, computed and related), its rows as plain values,
// filters (nested and/or, through a relationship, between, dates), footer calculations, grouping and the patch a typed value makes.
// Pure functions over AppState; the screens hold what's shown and dispatch what changes.
import type { ReactNode } from 'react';
import { Boxes, Building2, CircleDollarSign, Users } from 'lucide-react';
import type { GridColumn, GridRecord } from '../DataGrid/DataGrid.tsx';
import type { Attribute, AttributeType } from '../AttributeField/AttributeField.tsx';
import type { SchemaAttribute } from '../AttributeSettings/AttributeSettings.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { evaluateFormula } from '../FormulaEditor/FormulaEditor.tsx';
import { BUILT_IN_ATTRIBUTES, STAGES, STAGE_ODDS, STALE_DAYS, inr, isBuiltIn, type AnyRecord, type AppState, type CalcKind, type CustomRecord, type Deal, type ObjectId, type ObjectSchema, type SavedView, type Stage, type ViewFilter, type ViewFilterGroup } from './data.ts';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
/** "2026-11-10" for a local date. */
export const ymd = (d: Date | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined);
/** "2026-11-10" back to a local date. */
export const dayOf = (v: string): Date | undefined => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined; };

/** A stage's look on tags and the board. */
export const STAGE_LOOK: Readonly<Record<Stage, { readonly hue: 'gray' | 'blue' | 'purple' | 'green' | 'red'; readonly status: StatusShape }>> = {
  Lead: { hue: 'gray', status: 'draft' }, Qualified: { hue: 'blue', status: 'progress' }, Proposal: { hue: 'purple', status: 'review' }, Won: { hue: 'green', status: 'done' }, Lost: { hue: 'red', status: 'failed' },
};
const INDUSTRY_HUES = ['blue', 'purple', 'green', 'orange', 'sky', 'yellow'] as const;
export const INDUSTRIES = ['Software', 'Fintech', 'Healthcare', 'Manufacturing', 'Logistics', 'Retail'] as const;

/** Every record of an object. */
export function recordsOf(state: AppState, object: ObjectId): ReadonlyArray<AnyRecord> {
  return object === 'people' ? state.people : object === 'companies' ? state.companies : object === 'deals' ? state.deals : state.customRecords[object] ?? [];
}
/** One record. */
export const recordOf = (state: AppState, object: ObjectId, id: string): AnyRecord | undefined => recordsOf(state, object).find((r) => r.id === id);
/** An object's schema (names, attributes). */
export const schemaOf = (state: AppState, object: ObjectId): ObjectSchema | undefined => state.objects.find((o) => o.id === object);
/** Live attributes (not archived). */
export const liveAttributes = (o: ObjectSchema | undefined): ReadonlyArray<SchemaAttribute> => (o?.attributes ?? []).filter((a) => !a.archived);
/** One and many, lower case ("deal", "deals"). */
export function wordsOf(state: AppState, object: ObjectId): { readonly one: string; readonly many: string; readonly One: string; readonly Many: string } {
  const o = schemaOf(state, object);
  const One = o?.one ?? 'Record'; const Many = o?.many ?? 'Records';
  return { one: One.toLowerCase(), many: Many.toLowerCase(), One, Many };
}
/** The sidebar icon for an object. */
export const iconOf = (object: ObjectId): ReactNode => (object === 'people' ? <Users {...i16} /> : object === 'companies' ? <Building2 {...i16} /> : object === 'deals' ? <CircleDollarSign {...i16} /> : <Boxes {...i16} />);

/** How likely a deal in each stage is to close: the workspace's own numbers where set. */
export const oddsOf = (state: AppState, stage: string): number => state.prefs.winChance?.[stage] ?? STAGE_ODDS[stage as Stage] ?? 0;
/** The stage options as Settings › Objects keeps them: outcome (won, lost) and a target time in stage. */
export function stagesOf(state: AppState): ReadonlyArray<{ readonly id: string; readonly label: string; readonly outcome?: 'won' | 'lost'; readonly targetDays?: number }> {
  const attr = schemaOf(state, 'deals')?.attributes.find((a) => a.id === 'stage');
  return (attr?.options ?? STAGES.map((x) => ({ id: x, label: x }))).filter((o) => !('archived' in o && o.archived)).map((o) => ({ id: o.id, label: o.label, outcome: 'outcome' in o ? o.outcome : o.id === 'Won' ? 'won' : o.id === 'Lost' ? 'lost' : undefined, targetDays: 'targetDays' in o ? o.targetDays : undefined }));
}
/** A stage's outcome, read from Settings › Objects (never from its name), so a renamed Won or a second won stage still counts. */
export const outcomeOf = (state: AppState, stage: string): 'won' | 'lost' | undefined => stagesOf(state).find((s) => s.id === stage)?.outcome;
/** Is the deal still open (its stage has no won or lost outcome)? */
export const isOpenDeal = (state: AppState, d: Deal): boolean => !stagesOf(state).find((s) => s.id === d.stage)?.outcome;
/** Days a deal may sit in its stage before it reads as stale: the stage's target, else the workspace default. */
export const staleAfter = (state: AppState, stage: string): number => stagesOf(state).find((s) => s.id === stage)?.targetDays ?? STALE_DAYS;

/** A cell's value as the grid keeps it. */
export type Cell = string | number | undefined;

/** A field the views can show, filter, sort, group and total. `path` fields reach through a relationship ("company.industry"). */
export interface FieldDef {
  readonly id: string; readonly name: string; readonly type: AttributeType;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly hue?: Hue; readonly status?: StatusShape }>;
  /** The relationship it reaches through ("Company"); own fields have none. */
  readonly via?: string;
  readonly readOnly?: boolean;
  /** Owner-made: its value lives in the record's `extra`. */
  readonly custom?: boolean;
  readonly attribute?: SchemaAttribute;
  /** Money: totals read as currency. */
  readonly money?: boolean;
}

/** The kinds a filter or a footer reads a field as. */
export type FieldKind = 'select' | 'status' | 'person' | 'text' | 'number' | 'date';
export const kindOf = (t: AttributeType): FieldKind => (t === 'status' ? 'status' : t === 'select' || t === 'multiSelect' || t === 'checkbox' ? 'select' : t === 'actor' ? 'person' : t === 'number' || t === 'currency' || t === 'percent' || t === 'rating' ? 'number' : t === 'date' || t === 'timestamp' ? 'date' : 'text');

/** An owner-made attribute's stored text as the field's own value, and back. */
export function toFieldValue(a: Attribute, s: string | undefined): import('../AttributeField/AttributeField.tsx').AttributeValue {
  if (s === undefined || s === '') return a.type === 'checkbox' ? false : undefined;
  switch (a.type) {
    case 'number': case 'currency': case 'rating': return Number(s) || 0;
    case 'percent': return (Number(s) || 0) / 100;
    case 'checkbox': return s === 'true';
    case 'multiSelect': return s.split(/,\s*/).filter(Boolean);
    case 'actor': return { id: s, name: s };
    case 'location': { const [city = '', country = ''] = s.split(/,\s*/); return { city, country }; }
    case 'personalName': { const [first = '', ...rest] = s.split(' '); return { first, last: rest.join(' ') }; }
    default: return s;
  }
}
/** A field's value as the text `extra` keeps. */
export function fromFieldValue(a: Attribute, v: import('../AttributeField/AttributeField.tsx').AttributeValue): string {
  if (v === undefined || v === null) return '';
  if (a.type === 'checkbox') return v === true ? 'true' : '';
  if (a.type === 'percent' && typeof v === 'number') return String(Math.round(v * 100));
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (typeof v === 'object') { if ('name' in v) return String((v as { name: string }).name); if ('city' in v) return [v.city, v.country].filter(Boolean).join(', '); if ('first' in v) return `${v.first} ${v.last}`.trim(); return ''; }
  return String(v);
}

/** The grid column type that draws an attribute: its own field where the grid has none. */
const gridType = (a: SchemaAttribute): GridColumn['type'] => (a.id === 'created' ? 'date' : a.type === 'select' || a.type === 'status' ? a.type : a.type === 'number' || a.type === 'currency' ? 'number' : a.type === 'actor' ? 'person' : 'text');
/** Types the grid draws and edits with the attribute's own field (date picker, checkbox, rating, multi-select…). */
const OWN_FIELD: ReadonlySet<AttributeType> = new Set<AttributeType>(['date', 'checkbox', 'rating', 'multiSelect', 'percent', 'email', 'phone', 'url', 'domain', 'location', 'personalName', 'longText', 'currency']);

/** Owner-made attributes on an object, as grid columns: drawn and edited with their own field. Computed ones are read only. */
export function customColumns(state: AppState, object: ObjectId): ReadonlyArray<GridColumn> {
  return liveAttributes(schemaOf(state, object)).filter((a) => !BUILT_IN_ATTRIBUTES.has(a.id) && (isBuiltIn(object) || (a.id !== 'name'))).map((a) => ({
    id: a.id, name: a.name, width: 160, isSortable: true, isReadOnly: a.isSystem || a.computed !== undefined || (!isBuiltIn(object) && a.id === 'created'),
    type: a.relation ? 'text' : gridType(a),
    options: a.options?.filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label, hue: o.hue })),
    attribute: a.relation || a.computed || a.id === 'created' || !OWN_FIELD.has(a.type) ? undefined : a,
  }));
}

/** The record a relationship attribute points at, by id, across any object. */
export const nameIn = (state: AppState, object: ObjectId, id: string): string | undefined => recordOf(state, object, id)?.name;

/** Computed values (formula, lookup, rollup) for one record. */
export function computedValues(state: AppState, object: ObjectId, rec: AnyRecord, base: Readonly<Record<string, Cell>>): Readonly<Record<string, Cell>> {
  const attrs = liveAttributes(schemaOf(state, object));
  const out: Record<string, Cell> = {};
  for (const a of attrs) {
    const c = a.computed; if (!c) continue;
    if (c.kind === 'formula') {
      const nums = Object.fromEntries(Object.entries({ ...base, ...out }).map(([k, v]) => [k, typeof v === 'number' ? v : v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined]));
      const r = evaluateFormula(c.source, formulaAttributes(state, object), nums);
      out[a.id] = r.ok ? Math.round(r.value * 100) / 100 : undefined;
    } else {
      const linked = linkedRecords(state, object, rec, c.via);
      const vals = linked.map((x) => valuesOf(state, x.object, x.rec)[c.field]);
      if (c.kind === 'lookup') out[a.id] = vals.filter((v) => v !== undefined && v !== '').map(String).join(', ') || undefined;
      else {
        const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
        out[a.id] = c.fn === 'count' ? linked.length : nums.length === 0 ? undefined : c.fn === 'sum' ? nums.reduce((n, x) => n + x, 0) : c.fn === 'avg' ? Math.round(nums.reduce((n, x) => n + x, 0) / nums.length) : c.fn === 'min' ? Math.min(...nums) : Math.max(...nums);
      }
    }
  }
  return out;
}
/** The number-ish fields a formula can name. */
export function formulaAttributes(state: AppState, object: ObjectId): ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: AttributeType }> {
  return ownFields(state, object).filter((f) => kindOf(f.type) === 'number').map((f) => ({ id: f.id, name: f.name, type: f.type }));
}

/** The relationships an object has: built in ones (a person's company, a company's people and deals) and owner-made ones, both ways. */
export function relationsOf(state: AppState, object: ObjectId): ReadonlyArray<{ readonly id: string; readonly name: string; readonly target: ObjectId; readonly many: boolean }> {
  const own: Array<{ readonly id: string; readonly name: string; readonly target: ObjectId; readonly many: boolean }> = [];
  if (object === 'people') own.push({ id: 'company', name: 'Company', target: 'companies', many: false }, { id: 'deals', name: 'Deals', target: 'deals', many: true });
  if (object === 'companies') own.push({ id: 'people', name: 'People', target: 'people', many: true }, { id: 'deals', name: 'Deals', target: 'deals', many: true });
  if (object === 'deals') own.push({ id: 'company', name: 'Company', target: 'companies', many: false }, { id: 'contact', name: 'Contact', target: 'people', many: false });
  liveAttributes(schemaOf(state, object)).forEach((a) => { if (a.relation) own.push({ id: a.id, name: a.name, target: a.relation.target, many: a.relation.many }); });
  // The other side of owner-made relationships pointing here.
  state.objects.forEach((o) => liveAttributes(o).forEach((a) => { if (a.relation?.target === object) own.push({ id: `rev:${o.id}:${a.id}`, name: a.relation.otherName || o.many, target: o.id, many: true }); }));
  return own;
}
/** The records a relationship links this record to. */
export function linkedRecords(state: AppState, object: ObjectId, rec: AnyRecord, via: string): ReadonlyArray<{ readonly object: ObjectId; readonly rec: AnyRecord }> {
  const r = rec as AnyRecord & Readonly<Record<string, unknown>>;
  const one = (o: ObjectId, id: unknown) => { const x = typeof id === 'string' ? recordOf(state, o, id) : undefined; return x ? [{ object: o, rec: x }] : []; };
  if (via === 'company') return one('companies', r.companyId);
  if (via === 'contact') return one('people', r.contactId);
  if (via === 'people' && object === 'companies') return state.people.filter((p) => p.companyId === rec.id).map((p) => ({ object: 'people', rec: p }));
  if (via === 'deals') return state.deals.filter((d) => (object === 'people' ? d.contactId : d.companyId) === rec.id).map((d) => ({ object: 'deals', rec: d }));
  if (via.startsWith('rev:')) {
    const [, o = '', attr = ''] = via.split(':');
    return recordsOf(state, o).filter((x) => (x.extra?.[attr] ?? '').split(/,\s*/).includes(rec.id)).map((x) => ({ object: o, rec: x }));
  }
  const a = schemaOf(state, object)?.attributes.find((x) => x.id === via);
  if (a?.relation) { const target = a.relation.target; return (rec.extra?.[via] ?? '').split(/,\s*/).filter(Boolean).flatMap((id) => one(target, id)); }
  return [];
}

/** Every value of a record, by field id: built-in, owner-made, relationship names and computed. */
export function valuesOf(state: AppState, object: ObjectId, rec: AnyRecord, depth = 0): Readonly<Record<string, Cell>> {
  const coName = (cid: string | undefined) => state.companies.find((c) => c.id === cid)?.name;
  let base: Record<string, Cell> = { name: rec.name, owner: rec.owner, created: ymd(rec.created) };
  if (object === 'people') { const p = rec as AppState['people'][number]; base = { ...base, email: p.email, phone: p.phone, company: coName(p.companyId), title: p.title, tags: p.tags.join(', '), lastContact: ymd(p.lastContact) }; }
  else if (object === 'companies') { const c = rec as AppState['companies'][number]; const open = state.deals.filter((d) => d.companyId === c.id && isOpenDeal(state, d)); base = { ...base, domain: c.domain, industry: c.industry, size: c.size, city: c.city, people: state.people.filter((p) => p.companyId === c.id).length, open: open.length ? inr(open.reduce((n, d) => n + d.amount, 0)) : undefined, openAmount: open.reduce((n, d) => n + d.amount, 0) }; }
  else if (object === 'deals') { const d = rec as Deal; base = { ...base, company: coName(d.companyId), contact: state.people.find((p) => p.id === d.contactId)?.name, stage: d.stage, amount: d.amount, weighted: Math.round((d.amount * oddsOf(state, d.stage)) / 100), inStage: Math.max(0, Math.floor((Date.now() - (d.stageAt ?? d.created).getTime()) / 86_400_000)), close: ymd(d.close) }; }
  const attrs = liveAttributes(schemaOf(state, object));
  for (const a of attrs) {
    if (BUILT_IN_ATTRIBUTES.has(a.id) || a.computed) continue;
    const raw = rec.extra?.[a.id];
    if (a.relation) { base[a.id] = (raw ?? '').split(/,\s*/).filter(Boolean).map((id) => nameIn(state, a.relation?.target ?? '', id) ?? '').filter(Boolean).join(', ') || undefined; continue; }
    base[a.id] = raw === undefined || raw === '' ? undefined : kindOf(a.type) === 'number' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  }
  const computed = depth > 1 ? {} : computedValues(state, object, rec, base);
  const out: Record<string, Cell> = { ...base, ...computed };
  // Related records' fields, one step away, for filters ("Company › Industry").
  if (depth === 0) for (const rel of relationsOf(state, object)) {
    if (rel.many) { out[`${rel.id}.count`] = linkedRecords(state, object, rec, rel.id).length; continue; }
    const [first] = linkedRecords(state, object, rec, rel.id);
    if (!first) continue;
    const theirs = valuesOf(state, first.object, first.rec, depth + 1);
    for (const [k, v] of Object.entries(theirs)) if (!k.includes('.')) out[`${rel.id}.${k}`] = v;
  }
  return out;
}

/** An object's own fields, in the order a table shows them. */
export function ownFields(state: AppState, object: ObjectId): ReadonlyArray<FieldDef> {
  const owners = state.members.map((m) => ({ id: m.name, label: m.name }));
  const stageOpts = stagesOf(state).map((s) => ({ id: s.id, label: s.label, hue: STAGE_LOOK[s.id as Stage]?.hue ?? 'gray', status: STAGE_LOOK[s.id as Stage]?.status ?? ('progress' as const) }));
  const builtIn: Readonly<Record<string, ReadonlyArray<FieldDef>>> = {
    people: [{ id: 'name', name: 'Name', type: 'text' }, { id: 'email', name: 'Email', type: 'email' }, { id: 'phone', name: 'Phone', type: 'phone' }, { id: 'company', name: 'Company', type: 'text', readOnly: true }, { id: 'title', name: 'Job title', type: 'text' },
      { id: 'tags', name: 'Tags', type: 'multiSelect', options: (schemaOf(state, 'people')?.attributes.find((a) => a.id === 'tags')?.options ?? []).map((o) => ({ id: o.id, label: o.label, hue: o.hue })) }, { id: 'owner', name: 'Owner', type: 'actor', options: owners }, { id: 'lastContact', name: 'Last contact', type: 'date', readOnly: true }, { id: 'created', name: 'Created at', type: 'timestamp', readOnly: true }],
    companies: [{ id: 'name', name: 'Name', type: 'text' }, { id: 'domain', name: 'Domain', type: 'domain' }, { id: 'industry', name: 'Industry', type: 'select', options: INDUSTRIES.map((x, n) => ({ id: x, label: x, hue: INDUSTRY_HUES[n] })) }, { id: 'size', name: 'Employees', type: 'text' }, { id: 'city', name: 'City', type: 'text' },
      { id: 'people', name: 'People', type: 'number', readOnly: true }, { id: 'openAmount', name: 'Open deals (₹)', type: 'currency', readOnly: true, money: true }, { id: 'owner', name: 'Owner', type: 'actor', options: owners }, { id: 'created', name: 'Created at', type: 'timestamp', readOnly: true }],
    deals: [{ id: 'name', name: 'Deal', type: 'text' }, { id: 'company', name: 'Company', type: 'text', readOnly: true }, { id: 'contact', name: 'Contact', type: 'text', readOnly: true }, { id: 'stage', name: 'Stage', type: 'status', options: stageOpts }, { id: 'amount', name: 'Amount (₹)', type: 'currency', money: true },
      { id: 'weighted', name: 'Weighted (₹)', type: 'currency', readOnly: true, money: true }, { id: 'inStage', name: 'Days in stage', type: 'number', readOnly: true }, { id: 'close', name: 'Close date', type: 'date' }, { id: 'owner', name: 'Owner', type: 'actor', options: owners }, { id: 'created', name: 'Created at', type: 'timestamp', readOnly: true }],
  };
  const base = builtIn[object] ?? [{ id: 'name', name: 'Name', type: 'text' as const }, { id: 'owner', name: 'Owner', type: 'actor' as const, options: owners }];
  const extra = liveAttributes(schemaOf(state, object)).filter((a) => !BUILT_IN_ATTRIBUTES.has(a.id)).map((a): FieldDef => ({
    id: a.id, name: a.name, type: a.relation ? 'text' : a.computed ? (a.computed.kind === 'lookup' ? 'text' : 'number') : a.type, custom: true, attribute: a, readOnly: a.isSystem || a.computed !== undefined || a.relation !== undefined,
    options: a.type === 'checkbox' ? [{ id: 'true', label: 'Yes' }, { id: '', label: 'No' }] : a.options?.filter((o) => !o.archived).map((o) => ({ id: o.id, label: o.label, hue: o.hue })), money: a.type === 'currency',
  }));
  return [...base, ...extra.filter((f) => !base.some((b) => b.id === f.id))];
}
/** Own fields plus those reached through a relationship, for filters. */
export function filterFields(state: AppState, object: ObjectId): ReadonlyArray<FieldDef> {
  const own = ownFields(state, object);
  const related = relationsOf(state, object).flatMap((rel): ReadonlyArray<FieldDef> => rel.many
    ? [{ id: `${rel.id}.count`, name: `Number of ${rel.name.toLowerCase()}`, type: 'number', via: rel.name, readOnly: true }]
    : ownFields(state, rel.target).filter((f) => f.id !== 'created').map((f) => ({ ...f, id: `${rel.id}.${f.id}`, name: f.name, via: rel.name, readOnly: true })));
  return [...own, ...related];
}

/** The grid's columns and rows for any object: the three built in, and owner-made ones from their attributes. */
export interface ObjectDef { readonly id: ObjectId; readonly one: string; readonly many: string; readonly icon: ReactNode; readonly columns: ReadonlyArray<GridColumn>; readonly rows: (s: AppState) => ReadonlyArray<GridRecord> }
export function objectDef(id: ObjectId, state: AppState): ObjectDef {
  const owners = state.members.map((m) => ({ id: m.name, label: m.name }));
  const w = wordsOf(state, id);
  const rows = (s: AppState): ReadonlyArray<GridRecord> => recordsOf(s, id).map((r) => ({ id: r.id, kind: id === 'people' ? 'person' : 'company', values: valuesOf(s, id, r) }));
  const custom = customColumns(state, id);
  if (id === 'people') return {
    id, one: 'person', many: 'people', icon: iconOf(id), rows,
    columns: [{ id: 'name', name: 'Name', type: 'name', width: 220, isSortable: true }, { id: 'email', name: 'Email', type: 'text', width: 220, isSortable: true }, { id: 'company', name: 'Company', type: 'text', width: 160, isSortable: true, isReadOnly: true },
      { id: 'title', name: 'Job title', type: 'text', width: 170, isSortable: true }, { id: 'tags', name: 'Tags', type: 'text', width: 170, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true, options: owners }, { id: 'lastContact', name: 'Last contact', type: 'date', width: 130, isSortable: true, isReadOnly: true }, ...custom],
  };
  if (id === 'companies') return {
    id, one: 'company', many: 'companies', icon: iconOf(id), rows,
    columns: [{ id: 'name', name: 'Name', type: 'name', width: 200, isSortable: true }, { id: 'domain', name: 'Domain', type: 'text', width: 160, isSortable: true },
      { id: 'industry', name: 'Industry', type: 'select', width: 150, isSortable: true, options: INDUSTRIES.map((x, n) => ({ id: x, label: x, hue: INDUSTRY_HUES[n] })) },
      { id: 'size', name: 'Employees', type: 'text', width: 120, isSortable: true }, { id: 'city', name: 'City', type: 'text', width: 130, isSortable: true }, { id: 'people', name: 'People', type: 'number', width: 100, isReadOnly: true, isSortable: true },
      { id: 'open', name: 'Open deals', type: 'text', width: 140, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true }, ...custom],
  };
  if (id === 'deals') return {
    id, one: 'deal', many: 'deals', icon: iconOf(id), rows,
    columns: [{ id: 'name', name: 'Deal', type: 'name', width: 230, isSortable: true }, { id: 'company', name: 'Company', type: 'text', width: 160, isReadOnly: true, isSortable: true },
      { id: 'stage', name: 'Stage', type: 'status', width: 140, isSortable: true, options: stagesOf(state).map((x) => ({ id: x.id, label: x.label, hue: STAGE_LOOK[x.id as Stage]?.hue ?? 'gray', status: STAGE_LOOK[x.id as Stage]?.status ?? 'progress' })) },
      { id: 'amount', name: 'Amount (₹)', type: 'number', width: 140, isSortable: true }, { id: 'weighted', name: 'Weighted (₹)', type: 'number', width: 140, isSortable: true, isReadOnly: true },
      { id: 'inStage', name: 'Days in stage', type: 'number', width: 130, isSortable: true, isReadOnly: true }, { id: 'close', name: 'Close date', type: 'date', width: 130, isSortable: true, isReadOnly: true }, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true }, ...custom],
  };
  return {
    id, one: w.one, many: w.many, icon: iconOf(id), rows,
    columns: [{ id: 'name', name: 'Name', type: 'name', width: 220, isSortable: true }, ...custom, { id: 'owner', name: 'Owner', type: 'person', width: 150, isSortable: true, options: owners }, { id: 'created', name: 'Created at', type: 'date', width: 130, isSortable: true, isReadOnly: true }],
  };
}

/* ------------------------------------------------------------- filters */

/** The operators each kind of field offers, in words. */
export const OPERATORS: Readonly<Record<FieldKind, ReadonlyArray<string>>> = {
  select: ['is', 'is not', 'is empty', 'is not empty'],
  status: ['is', 'is not', 'is empty', 'is not empty'],
  person: ['is', 'is not', 'is empty', 'is not empty'],
  text: ['contains', 'does not contain', 'is', 'is empty', 'is not empty'],
  number: ['is greater than', 'is less than', 'is between', 'is', 'is empty', 'is not empty'],
  date: ['is before', 'is after', 'is between', 'in the last', 'in the next', 'is empty', 'is not empty'],
};

/** Does one value pass one filter? Multi-select values ("a, b") pass "is" when any of them is picked. */
export function passesRule(v: Cell, kind: FieldKind, f: ViewFilter, now = new Date()): boolean {
  const s = v === undefined ? '' : String(v).toLowerCase();
  const vals = f.values.map((x) => x.toLowerCase());
  const parts = s.split(/,\s*/).filter(Boolean);
  const day = (x: string | undefined) => (x ? dayOf(x) : undefined);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (f.operator) {
    case 'is empty': return s === '';
    case 'is not empty': return s !== '';
    case 'is': return vals.length === 0 || (kind === 'number' ? Number(v) === Number(f.values[0]) : vals.includes(s) || parts.some((x) => vals.includes(x)));
    case 'is not': return !vals.includes(s) && !parts.some((x) => vals.includes(x));
    case 'contains': return vals.length === 0 || vals.some((x) => s.includes(x));
    case 'does not contain': return !vals.some((x) => x && s.includes(x));
    case 'is greater than': return s !== '' && Number(v) > Number(f.values[0] ?? 0);
    case 'is less than': return s !== '' && Number(v) < Number(f.values[0] ?? 0);
    case 'is between': {
      if (s === '') return false;
      if (kind === 'date') { const d = day(String(v)); const a = day(f.values[0]); const b = day(f.values[1]); return d !== undefined && (!a || d >= a) && (!b || d <= b); }
      const n = Number(v); const lo = f.values[0] ? Number(f.values[0]) : -Infinity; const hi = f.values[1] ? Number(f.values[1]) : Infinity; return n >= lo && n <= hi;
    }
    case 'is before': { const d = day(String(v ?? '')); const a = day(f.values[0]); return d !== undefined && a !== undefined && d < a; }
    case 'is after': { const d = day(String(v ?? '')); const a = day(f.values[0]); return d !== undefined && a !== undefined && d > a; }
    case 'in the last': { const d = day(String(v ?? '')); const n = Number(f.values[0] ?? 0); return d !== undefined && d <= today && d >= new Date(today.getTime() - n * 86_400_000); }
    case 'in the next': { const d = day(String(v ?? '')); const n = Number(f.values[0] ?? 0); return d !== undefined && d >= today && d <= new Date(today.getTime() + n * 86_400_000); }
    default: return true;
  }
}

/** Does a row pass a view's filters: its rules and bracketed groups, joined by the view's and/or? */
export function passesView(values: Readonly<Record<string, Cell>>, kinds: Readonly<Record<string, FieldKind>>, filters: ReadonlyArray<ViewFilter>, groups: ReadonlyArray<ViewFilterGroup> = [], match: 'all' | 'any' = 'all'): boolean {
  const one = (f: ViewFilter) => passesRule(values[f.field], kinds[f.field] ?? 'text', f);
  const tests: Array<() => boolean> = [...filters.map((f) => () => one(f)), ...groups.filter((g) => g.rules.length > 0).map((g) => () => (g.match === 'any' ? g.rules.some(one) : g.rules.every(one)))];
  if (tests.length === 0) return true;
  return match === 'any' ? tests.some((t) => t()) : tests.every((t) => t());
}
/** Field id → how it filters. */
export const kindsOf = (fields: ReadonlyArray<FieldDef>): Readonly<Record<string, FieldKind>> => Object.fromEntries(fields.map((f) => [f.id, kindOf(f.type)]));

/** The rows a saved view shows, filtered and sorted (search aside). */
export function viewRows(state: AppState, object: ObjectId, view: SavedView | undefined): ReadonlyArray<GridRecord> {
  const all = objectDef(object, state).rows(state);
  if (!view) return all;
  const kinds = kindsOf(filterFields(state, object));
  return all.filter((r) => passesView(r.values, kinds, view.filters, view.groups, view.match));
}

/* ------------------------------------------------------- calculations */

/** The calculations a column offers. Numbers add up; everything counts. */
export function calcsFor(kind: FieldKind): ReadonlyArray<{ readonly id: CalcKind; readonly label: string }> {
  const base = [{ id: 'none' as const, label: 'None' }, { id: 'count' as const, label: 'Count all' }, { id: 'empty' as const, label: 'Count empty' }, { id: 'filled' as const, label: 'Count filled' }];
  if (kind === 'number') return [...base, { id: 'sum', label: 'Sum' }, { id: 'avg', label: 'Average' }, { id: 'min', label: 'Smallest' }, { id: 'max', label: 'Largest' }];
  if (kind === 'date') return [...base, { id: 'min', label: 'Earliest' }, { id: 'max', label: 'Latest' }];
  return base;
}
/** One column's calculation over the rows, worded for the footer ("Sum ₹48,20,000"). */
export function calcText(kind: CalcKind, field: FieldDef | undefined, rows: ReadonlyArray<GridRecord>, colId: string): string {
  const vals = rows.map((r) => r.values[colId]);
  const filled = vals.filter((v) => v !== undefined && v !== '');
  const money = field?.money === true;
  const n = (x: number) => (money ? inr(Math.round(x)) : Math.round(x * 100) / 100 === Math.round(x) ? Math.round(x).toLocaleString('en-IN') : (Math.round(x * 100) / 100).toLocaleString('en-IN'));
  const nums = filled.map(Number).filter((x) => !Number.isNaN(x));
  const dates = filled.map((x) => dayOf(String(x))).filter((d): d is Date => d !== undefined).sort((a, b) => a.getTime() - b.getTime());
  const isDate = field ? kindOf(field.type) === 'date' : false;
  const fmt = (d: Date | undefined) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  switch (kind) {
    case 'count': return `Count ${rows.length}`;
    case 'empty': return `Empty ${rows.length - filled.length}`;
    case 'filled': return `Filled ${filled.length}`;
    case 'sum': return `Sum ${n(nums.reduce((a, b) => a + b, 0))}`;
    case 'avg': return `Average ${nums.length ? n(nums.reduce((a, b) => a + b, 0) / nums.length) : '—'}`;
    case 'min': return isDate ? `Earliest ${fmt(dates[0])}` : `Smallest ${nums.length ? n(Math.min(...nums)) : '—'}`;
    case 'max': return isDate ? `Latest ${fmt(dates[dates.length - 1])}` : `Largest ${nums.length ? n(Math.max(...nums)) : '—'}`;
    default: return '';
  }
}

/* ------------------------------------------------------------- groups */

/** Fields rows and board columns can group by: a status, a select or the owner. */
export const groupableFields = (state: AppState, object: ObjectId): ReadonlyArray<FieldDef> => ownFields(state, object).filter((f) => (f.type === 'status' || f.type === 'select' || f.type === 'actor' || f.type === 'checkbox') && !f.readOnly);
/** A field's groups, in its options' order, then "No value". */
export function groupsOf(field: FieldDef, rows: ReadonlyArray<GridRecord>): ReadonlyArray<{ readonly id: string; readonly label: string; readonly hue?: Hue; readonly status?: StatusShape; readonly rows: ReadonlyArray<GridRecord> }> {
  const opts = field.options ?? [];
  const known = opts.map((o) => ({ id: o.id, label: o.label, hue: o.hue, status: o.status, rows: rows.filter((r) => String(r.values[field.id] ?? '') === o.id) }));
  const other = [...new Set(rows.map((r) => String(r.values[field.id] ?? '')).filter((v) => v && !opts.some((o) => o.id === v)))].map((v) => ({ id: v, label: v, hue: undefined, status: undefined, rows: rows.filter((r) => String(r.values[field.id] ?? '') === v) }));
  const none = rows.filter((r) => !r.values[field.id]);
  // "No <field>" only when some record has none.
  return [...known, ...other, ...(opts.some((o) => o.id === '') || none.length === 0 ? [] : [{ id: '', label: `No ${field.name.toLowerCase()}`, hue: 'gray' as const, status: undefined, rows: none }])];
}

/* ------------------------------------------------------------- writes */

/** The patch one typed value makes on a record: built-in keys, or `extra` for owner-made attributes. Undefined when it can't be set. */
export function patchFor(state: AppState, object: ObjectId, rec: AnyRecord, col: string, value: string): Readonly<Record<string, unknown>> | undefined {
  const field = ownFields(state, object).find((f) => f.id === col);
  if (!field || (field.readOnly && col !== 'company')) return undefined;
  if (field.custom) return { extra: { [col]: value } };
  if (col === 'amount') return { amount: Number(String(value).replace(/[^\d.-]/g, '')) || 0 };
  if (col === 'close' || col === 'lastContact') { const d = dayOf(value); return d ? { [col]: d } : undefined; }
  if (col === 'tags') return { tags: value.split(/,\s*/).filter(Boolean) };
  if (col === 'company') { const c = state.companies.find((x) => x.id === value || x.name.toLowerCase() === value.toLowerCase()); return object === 'deals' ? (c ? { companyId: c.id } : undefined) : { companyId: c?.id }; }
  if (col === 'stage' && !stagesOf(state).some((s) => s.id === value)) return undefined;
  if (col === 'owner' && !state.members.some((m) => m.name === value)) return undefined;
  if (col === 'name' && !value.trim()) return undefined;
  void rec;
  return { [col]: value };
}
/** The record's current values for the keys a patch touches, so Undo puts back only those. */
export function beforeOf(rec: AnyRecord, patch: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const r = rec as AnyRecord & Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => (k === 'extra' ? [k, Object.fromEntries(Object.keys(v as Readonly<Record<string, string>>).map((x) => [x, rec.extra?.[x] ?? '']))] : [k, r[k]])));
}

/** Is an attribute required for this record: always, or by a "required when" rule that holds? */
export function isRequiredFor(a: SchemaAttribute, values: Readonly<Record<string, Cell>>): boolean {
  if (a.isRequired) return true;
  const w = a.requiredWhen; if (!w) return false;
  return String(values[w.field] ?? '') === w.is;
}

/** Would writing this value leave a required field empty, by Required or by a "required when" rule that now holds? The same words as the
 *  record page and New record, or undefined. Only fields the edit touches count: the field itself, and fields whose rule reads it. */
export function requiredProblem(state: AppState, object: ObjectId, rec: AnyRecord, col: string, value: string): string | undefined {
  const next: Readonly<Record<string, Cell>> = { ...valuesOf(state, object, rec), [col]: value };
  const empty = (v: Cell) => v === undefined || String(v).trim() === '';
  const hit = liveAttributes(schemaOf(state, object)).filter((a) => !a.computed && !a.relation && (a.id === col || a.requiredWhen?.field === col) && isRequiredFor(a, next) && empty(next[a.id]));
  if (hit.length === 0) return undefined;
  const names = hit.map((a) => a.name).join(', ');
  const now = hit.some((a) => !a.isRequired && a.requiredWhen);
  if (hit.every((a) => a.id === col)) return `${names} is required${now ? ' now' : ''}.`;
  const w = hit.find((a) => a.requiredWhen)?.requiredWhen;
  const gate = w ? ownFields(state, object).find((f) => f.id === w.field) : undefined;
  const is = w ? (gate?.options?.find((o) => o.id === w.is)?.label ?? (w.field === 'stage' ? stagesOf(state).find((x) => x.id === w.is)?.label : undefined) ?? w.is) : '';
  return `Fill in ${names} first: ${hit.length === 1 ? 'it is' : 'they are'} required${w && gate ? ` when ${gate.name} is ${is}` : ''}.`;
}

/** A new custom record's starting shape. */
export const blankCustom = (id: string, name: string, owner: string): CustomRecord => ({ id, name, owner, created: new Date(), extra: {} });
