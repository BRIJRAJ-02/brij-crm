import {
  Button as AriaButton, DateInput, DatePicker, DateSegment, FileTrigger, Group, Input, NumberField, Radio, RadioGroup, TextArea, TextField, type Selection,
} from 'react-aria-components';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { useEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent, type FocusEvent } from 'react';
import {
  Type, AlignLeft, Hash, CircleDollarSign, Percent, Calendar as CalendarIcon, Clock, SquareCheck, CircleChevronDown, Tags, CircleDotDashed,
  Star, Mail, Phone, Link2, Globe, MapPin, UserRound, ArrowLeftRight, CircleUser, Paperclip, Lock, X, Upload, type LucideIcon,
} from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { RecordChip } from '../RecordChip/RecordChip.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { MenuList, MenuItem, CLOSE_AFTER_PICK_MS } from '../Menu/Menu.tsx';
import { Calendar } from '../DatePicker/DatePicker.tsx';
import { formatClock, minutesOf } from '../WeekCalendar/clock.ts';
import { formatBytes, formatDate } from '../../lib/format.ts';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { AIMark } from '../AIAssist/AIAssist.tsx';
import './AttributeField.css';

/* ------------------------------------------------------------------ types */

/** Every attribute type. Each has exactly one display and one editor, the same in tables, record pages, forms and filters. */
export type AttributeType =
  | 'text' | 'longText' | 'number' | 'currency' | 'percent' | 'date' | 'timestamp' | 'checkbox' | 'select' | 'multiSelect' | 'status'
  | 'rating' | 'email' | 'phone' | 'url' | 'domain' | 'location' | 'personalName' | 'record' | 'actor' | 'file';

/** One choice of a select, multi-select or status. A status option carries its shape. */
export interface AttributeOption { readonly id: string; readonly label: string; readonly hue: Hue; readonly shape?: StatusShape }
/** A record another record points at, drawn as a chip. */
export interface AttributeRecordRef { readonly id: string; readonly name: string; readonly kind: 'person' | 'company' | 'deal'; readonly src?: string }
/** A workspace member (an owner, an assignee, who created something). */
export interface PersonRef { readonly id: string; readonly name: string; readonly src?: string }
/** An uploaded file. `size` in bytes. */
export interface FileRef { readonly id: string; readonly name: string; readonly size: number }
/** A personal name in its two parts. */
export interface NameValue { readonly first: string; readonly last: string }
/** A place, as people say it. */
export interface LocationValue { readonly city: string; readonly country: string }
/** Any attribute's value. `undefined` is empty. Selects hold option ids; dates hold ISO `YYYY-MM-DD`; percents hold a fraction. */
export type AttributeValue =
  | string | number | boolean | ReadonlyArray<string> | NameValue | LocationValue | AttributeRecordRef | PersonRef | ReadonlyArray<FileRef> | undefined;

/** An attribute: its name, type, and what the type needs (options, currency, candidates for a reference). */
export interface Attribute {
  readonly id: string;
  readonly name: string;
  readonly type: AttributeType;
  readonly options?: ReadonlyArray<AttributeOption>;
  /** ISO currency code for `currency`. */
  readonly currency?: string;
  /** Who or what a reference can point at. */
  readonly candidates?: ReadonlyArray<AttributeRecordRef | PersonRef>;
  /** Filled by AI enrichment: the display carries the violet AI mark. A hand edit replaces it. */
  readonly isAI?: boolean;
  /** Why it can't be edited ("Set by the system"). Timestamps are always read only. */
  readonly readOnlyReason?: string;
}

/** Each type's people-facing name and icon: what a type picker, a column header and a record row show. */
export const ATTRIBUTE_TYPES: Readonly<Record<AttributeType, { readonly label: string; readonly icon: LucideIcon }>> = {
  text: { label: 'Text', icon: Type }, longText: { label: 'Long text', icon: AlignLeft }, number: { label: 'Number', icon: Hash },
  currency: { label: 'Currency', icon: CircleDollarSign }, percent: { label: 'Percent', icon: Percent }, date: { label: 'Date', icon: CalendarIcon },
  timestamp: { label: 'Timestamp', icon: Clock }, checkbox: { label: 'Checkbox', icon: SquareCheck }, select: { label: 'Select', icon: CircleChevronDown },
  multiSelect: { label: 'Multi-select', icon: Tags }, status: { label: 'Status', icon: CircleDotDashed }, rating: { label: 'Rating', icon: Star },
  email: { label: 'Email', icon: Mail }, phone: { label: 'Phone', icon: Phone }, url: { label: 'URL', icon: Link2 }, domain: { label: 'Domain', icon: Globe },
  location: { label: 'Location', icon: MapPin }, personalName: { label: 'Personal name', icon: UserRound }, record: { label: 'Record', icon: ArrowLeftRight },
  actor: { label: 'Person', icon: CircleUser }, file: { label: 'File', icon: Paperclip },
};

/** The icon beside an attribute's name, at 16 (14 in small slots). */
export function AttributeIcon({ type, size = 16 }: { readonly type: AttributeType; readonly size?: number }) {
  const I = ATTRIBUTE_TYPES[type].icon;
  return <I size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/* ---------------------------------------------------------------- narrowing */

const str = (v: AttributeValue): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const num = (v: AttributeValue): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v: AttributeValue): ReadonlyArray<unknown> => (Array.isArray(v) ? (v as ReadonlyArray<unknown>) : []);
const ids = (v: AttributeValue): ReadonlyArray<string> => list(v).filter((x): x is string => typeof x === 'string');
const files = (v: AttributeValue): ReadonlyArray<FileRef> => list(v).filter((x): x is FileRef => typeof x === 'object' && x !== null && 'size' in x);
const isObj = (v: AttributeValue): v is Exclude<AttributeValue, string | number | boolean | undefined | ReadonlyArray<unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nameOf = (v: AttributeValue): NameValue | undefined => (isObj(v) && 'first' in v ? v : undefined);
const placeOf = (v: AttributeValue): LocationValue | undefined => (isObj(v) && 'city' in v ? v : undefined);
const refOf = (v: AttributeValue): AttributeRecordRef | PersonRef | undefined => (isObj(v) && 'id' in v && 'name' in v ? (v as AttributeRecordRef | PersonRef) : undefined);
const isRecord = (r: AttributeRecordRef | PersonRef): r is AttributeRecordRef => 'kind' in r;

/** A timestamp as "13 Nov, 2:05 PM": the shared date words and the one clock. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${formatDate(d)}, ${formatClock(minutesOf(d))}`;
}
const money = (code: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 });
function fromIso(iso: string): Date | undefined {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

/** A value as plain text: the screen reader name of a cell, copy, and the search index. Empty is "". */
export function attributeText(attribute: Attribute, value: AttributeValue): string {
  const opt = (id: string) => attribute.options?.find((o) => o.id === id)?.label ?? '';
  switch (attribute.type) {
    case 'number': return num(value)?.toLocaleString('en-US') ?? '';
    case 'currency': return num(value) === undefined ? '' : money(attribute.currency ?? 'USD').format(num(value) ?? 0);
    case 'percent': return num(value) === undefined ? '' : `${Math.round((num(value) ?? 0) * 100)}%`;
    case 'date': { const d = str(value) && fromIso(str(value) ?? ''); return d ? formatDate(d) : ''; }
    case 'timestamp': return str(value) ? formatStamp(str(value) ?? '') : '';
    case 'checkbox': return value === true ? 'Yes' : 'No';
    case 'select': case 'status': return str(value) ? opt(str(value) ?? '') : '';
    case 'multiSelect': return ids(value).map(opt).join(', ');
    case 'rating': return num(value) ? `${num(value)} of 5` : '';
    case 'location': { const p = placeOf(value); return p ? [p.city, p.country].filter(Boolean).join(', ') : ''; }
    case 'personalName': { const n = nameOf(value); return n ? `${n.first} ${n.last}`.trim() : ''; }
    case 'record': case 'actor': return refOf(value)?.name ?? '';
    case 'file': return files(value).map((f) => f.name).join(', ');
    default: return str(value) ?? '';
  }
}

/* ----------------------------------------------------------------- display */

/** Five stars. Read only it is a picture of the score; interactive, the hovered star and those before it preview the pick. */
export function Rating({ value, onChange, isReadOnly = false, label = 'Rating', autoFocus }: { readonly value?: number; readonly onChange?: (v: number) => void; readonly isReadOnly?: boolean; readonly label?: string; readonly autoFocus?: boolean }) {
  const v = value ?? 0;
  if (isReadOnly) {
    return (
      <span className="tf-rating tf-rating--static" role="img" aria-label={v ? `${v} of 5` : 'No rating'}>
        {[1, 2, 3, 4, 5].map((n) => <span key={n} className={cx('tf-rating__star', n <= v && 'is-on')}><Star size={14} strokeWidth={1.75} /></span>)}
      </span>
    );
  }
  return (
    <RadioGroup aria-label={label} value={v ? String(v) : null} onChange={(s) => onChange?.(Number(s))} orientation="horizontal" className="tf-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <Radio key={n} value={String(n)} aria-label={`${n} of 5`} autoFocus={autoFocus && n === Math.max(1, v)} className={cx('tf-rating__star', n <= v && 'is-on')}>
          <Star size={16} strokeWidth={1.75} />
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** Props for AttributeDisplay. */
export interface AttributeDisplayProps {
  readonly attribute: Attribute;
  readonly value: AttributeValue;
  /** Links open (mailto, tel, the site). Off inside a pressable cell, where pressing edits. */
  readonly asLink?: boolean;
  /** What an empty value says. Nothing by default (a blank cell); a record's details pass "Add industry…". */
  readonly empty?: string;
  /** Chips show this many, then "+n". */
  readonly maxVisible?: number;
}

/** Draws any value: the one display per type, the same in a table cell, a record panel, a card and a filter. */
export function AttributeDisplay({ attribute, value, asLink = true, empty = '', maxVisible = 3 }: AttributeDisplayProps) {
  const t = attribute.type;
  const text = attributeText(attribute, value);
  const opt = (id: string) => attribute.options?.find((o) => o.id === id);
  const ai = attribute.isAI && text !== '' ? <AIMark /> : null;
  const none = <span className="tf-attr-empty">{empty}<span className="tf-sr-only">Empty</span></span>;
  const link = (href: string, label: string) => (asLink ? <a className="tf-attr-link" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{label}</a> : <span className="tf-attr-link">{label}</span>);

  let body: ReactNode;
  switch (t) {
    case 'checkbox': return <span className="tf-attr-display"><Checkbox isSelected={value === true} isReadOnly aria-label={attribute.name} /></span>;
    case 'rating': body = <Rating value={num(value)} isReadOnly />; break;
    case 'select': case 'status': { const o = str(value) ? opt(str(value) ?? '') : undefined; body = o ? <Tag size="sm" hue={o.hue} status={t === 'status' ? o.shape ?? 'draft' : undefined}>{o.label}</Tag> : undefined; break; }
    case 'multiSelect': {
      const os = ids(value).map(opt).filter((o): o is AttributeOption => o !== undefined);
      body = os.length ? <span className="tf-attr-chips">{os.slice(0, maxVisible).map((o) => <Tag key={o.id} size="sm" hue={o.hue}>{o.label}</Tag>)}{os.length > maxVisible && <span className="tf-attr-more">+{os.length - maxVisible}</span>}</span> : undefined;
      break;
    }
    case 'record': { const r = refOf(value); body = r && isRecord(r) ? <RecordChip name={r.name} src={r.src} kind={r.kind === 'person' ? 'person' : 'company'} /> : undefined; break; }
    case 'actor': { const p = refOf(value); body = p ? <span className="tf-attr-actor"><Avatar name={p.name} src={p.src} size={20} /><span>{p.name}</span></span> : undefined; break; }
    case 'file': {
      const fs = files(value);
      body = fs.length ? <span className="tf-attr-chips">{fs.slice(0, maxVisible).map((f) => <span key={f.id} className="tf-attr-file"><Paperclip size={14} strokeWidth={1.75} aria-hidden="true" /><span className="tf-attr-file__name">{f.name}</span><span className="tf-attr-file__size">{formatBytes(f.size)}</span></span>)}{fs.length > maxVisible && <span className="tf-attr-more">+{fs.length - maxVisible}</span>}</span> : undefined;
      break;
    }
    case 'email': body = text ? link(`mailto:${text}`, text) : undefined; break;
    case 'phone': body = text ? link(`tel:${text.replace(/[^\d+]/g, '')}`, text) : undefined; break;
    case 'url': body = text ? link(text, text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) : undefined; break;
    case 'domain': body = text ? link(`https://${text}`, text) : undefined; break;
    case 'longText': body = text ? <span className="tf-attr-long">{text}</span> : undefined; break;
    case 'number': case 'currency': case 'percent': body = text ? <span className="tf-num">{text}</span> : undefined; break;
    case 'timestamp': body = text ? <span className="tf-num tf-attr-stamp">{text}</span> : undefined; break;
    default: body = text ? <span className="tf-attr-text">{text}</span> : undefined;
  }
  return <span className={cx('tf-attr-display', `tf-attr-display--${t}`)}>{body ?? none}{ai}</span>;
}

/* ------------------------------------------------------------------ editors */

/** Props for AttributeEditor. */
export interface AttributeEditorProps {
  readonly attribute: Attribute;
  readonly value: AttributeValue;
  /** Saves a parsed value (`undefined` clears) and ends the edit. Invalid input never commits. */
  readonly onCommit: (value: AttributeValue) => void;
  /** Ends the edit without saving (Esc, or closing a list unchanged). */
  readonly onCancel: () => void;
  /** Where list pickers anchor; the editor's own box when omitted. */
  readonly anchorRef?: RefObject<Element | null>;
  readonly autoFocus?: boolean;
}

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const checks: Partial<Record<AttributeType, { readonly test: (s: string) => boolean; readonly hint: string }>> = {
  email: { test: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s), hint: 'Enter an email like priya@acme.com' },
  url: { test: (s) => URL_RE.test(s), hint: 'Enter a link like acme.com/pricing' },
  domain: { test: (s) => /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(s), hint: 'Enter a domain like acme.com' },
  phone: { test: (s) => s.replace(/\D/g, '').length >= 7, hint: 'Enter a phone number with at least 7 digits' },
};
function clean(t: AttributeType, s: string): string {
  const v = s.trim();
  if (t === 'email') return v.replace(/^mailto:/i, '').replace(/\.$/, '');
  if (t === 'domain') return v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase();
  if (t === 'url' && v && !/^https?:\/\//i.test(v)) return `https://${v}`;
  return v;
}

/** Shakes a field and shows its hint (transitions.dev error state shake); typing clears it. */
function useShake() {
  const [error, setError] = useState<string>();
  const [shakeKey, setShakeKey] = useState(0);
  return { error, shakeKey, fail: (hint: string) => { setError(hint); setShakeKey((k) => k + 1); }, clear: () => setError(undefined) };
}

/** Ends an edit when focus leaves the box (and any popover it owns). */
function leaves(e: FocusEvent<HTMLElement>, extra?: RefObject<Element | null>): boolean {
  const next = e.relatedTarget;
  return !(next instanceof Node && (e.currentTarget.contains(next) || extra?.current?.contains(next)));
}

function TextEditor({ attribute, value, onCommit, onCancel, autoFocus }: AttributeEditorProps) {
  const t = attribute.type;
  const multiline = t === 'longText';
  const [draft, setDraft] = useState(attributeText(attribute, value) === '' ? '' : t === 'url' ? str(value) ?? '' : attributeText(attribute, value));
  const s = useShake();
  const commit = () => {
    const v = clean(t, draft);
    if (v === '') return onCommit(undefined);
    if (t === 'location') { const [city = '', ...rest] = v.split(','); return onCommit({ city: city.trim(), country: rest.join(',').trim() }); }
    const check = checks[t];
    if (check && !check.test(t === 'url' ? v.replace(/^https?:\/\//, '') : v)) return s.fail(check.hint);
    onCommit(v);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };
  return (
    <TextField aria-label={attribute.name} value={draft} onChange={(v) => { setDraft(v); s.clear(); }} isInvalid={!!s.error} autoFocus={autoFocus} className={cx('tf-attr-input', s.error && 'is-error')}
      onBlur={() => { if (!s.error) commit(); }}>
      <span key={s.shakeKey} className={cx('tf-attr-input__box', s.shakeKey > 0 && 'is-shaking')}>
        {multiline ? <TextArea className="tf-attr-input__control tf-attr-input__control--area" rows={3} onKeyDown={onKeyDown} autoComplete="off" />
          : <Input className="tf-attr-input__control" onKeyDown={onKeyDown} autoComplete="off" type={t === 'email' ? 'email' : t === 'phone' ? 'tel' : 'text'} placeholder={t === 'location' ? 'City, country' : undefined} />}
      </span>
      <span className="tf-attr-input__error" role="alert">{s.error}</span>
    </TextField>
  );
}

function NumberEditor({ attribute, value, onCommit, onCancel, autoFocus }: AttributeEditorProps) {
  const t = attribute.type;
  const format: Intl.NumberFormatOptions = t === 'currency' ? { style: 'currency', currency: attribute.currency ?? 'USD', maximumFractionDigits: 0 } : t === 'percent' ? { style: 'percent' } : {};
  const latest = useRef<number | undefined>(num(value));
  const cancelled = useRef(false);
  return (
    <NumberField aria-label={attribute.name} defaultValue={num(value) ?? Number.NaN} formatOptions={format} autoFocus={autoFocus} className="tf-attr-input"
      onChange={(n) => { latest.current = Number.isNaN(n) ? undefined : n; }}
      onBlur={() => window.setTimeout(() => { if (!cancelled.current) onCommit(latest.current); })}>
      <span className="tf-attr-input__box">
        <Input className="tf-attr-input__control tf-num" autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; onCancel(); } if (e.key === 'Enter') e.currentTarget.blur(); }} />
      </span>
    </NumberField>
  );
}

function NameEditor({ attribute, value, onCommit, onCancel, autoFocus }: AttributeEditorProps) {
  const n = nameOf(value);
  const [first, setFirst] = useState(n?.first ?? '');
  const [last, setLast] = useState(n?.last ?? '');
  const commit = () => (first.trim() || last.trim() ? onCommit({ first: first.trim(), last: last.trim() }) : onCommit(undefined));
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
  return (
    <div className="tf-attr-name" role="group" aria-label={attribute.name} onBlur={(e) => { if (leaves(e)) commit(); }}>
      <TextField aria-label="First name" value={first} onChange={setFirst} autoFocus={autoFocus} className="tf-attr-input"><span className="tf-attr-input__box"><Input className="tf-attr-input__control" placeholder="First" onKeyDown={onKeyDown} autoComplete="off" /></span></TextField>
      <TextField aria-label="Last name" value={last} onChange={setLast} className="tf-attr-input"><span className="tf-attr-input__box"><Input className="tf-attr-input__control" placeholder="Last" onKeyDown={onKeyDown} autoComplete="off" /></span></TextField>
    </div>
  );
}

/** Closes a popover with its exit motion, then reports. */
function useClosing() {
  const [open, setOpen] = useState(true);
  const close = (then: () => void, wait = 150) => { setOpen(false); window.setTimeout(then, wait); };
  return { open, close };
}

/** The one key a single-choice Selection holds, or undefined when it was emptied. */
function onlyKey(keys: Selection): string | undefined {
  if (keys === 'all') return undefined;
  const k = [...keys][0];
  return k === undefined ? undefined : String(k);
}

function OptionEditor({ attribute, value, onCommit, onCancel, anchorRef }: AttributeEditorProps) {
  const multiple = attribute.type === 'multiSelect';
  const opts = attribute.options ?? [];
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set(multiple ? ids(value) : str(value) ? [str(value) ?? ''] : []));
  const { open, close } = useClosing();
  const own = useRef<HTMLSpanElement>(null);
  const shown: AttributeValue = multiple ? [...sel] : [...sel][0];
  return (
    <>
      <span ref={own} className="tf-attr-cell is-open"><AttributeDisplay attribute={attribute} value={shown} asLink={false} empty="Pick one" /></span>
      <Popover triggerRef={anchorRef ?? own} isOpen={open} width="menu" offset={4}
        onOpenChange={(o) => { if (!o) close(() => (multiple ? onCommit([...sel]) : onCancel())); }}>
        <MenuList aria-label={attribute.name} autoFocus={sel.size ? 'first' : true} selectionMode={multiple ? 'multiple' : 'single'} selectedKeys={sel}
          filterPlaceholder={opts.length > 8 ? `Search ${attribute.name.toLowerCase()}…` : undefined}
          onSelectionChange={(keys) => {
            if (!multiple) {
              const id = onlyKey(keys);
              // Pressing the chosen option again closes the list unchanged rather than clearing a single value.
              if (id === undefined) return close(onCancel);
              setSel(new Set([id]));
              // The tick draws, then the list closes.
              window.setTimeout(() => close(() => onCommit(id)), CLOSE_AFTER_PICK_MS);
              return;
            }
            setSel(new Set(keys === 'all' ? opts.map((o) => o.id) : [...keys].map(String)));
          }}>
          {opts.map((o) => (
            <MenuItem key={o.id} id={o.id} textValue={o.label}>
              <Tag size="sm" hue={o.hue} status={attribute.type === 'status' ? o.shape ?? 'draft' : undefined}>{o.label}</Tag>
            </MenuItem>
          ))}
        </MenuList>
      </Popover>
    </>
  );
}

function ReferenceEditor({ attribute, value, onCommit, onCancel, anchorRef }: AttributeEditorProps) {
  const people = attribute.candidates ?? [];
  const current = refOf(value);
  const [sel, setSel] = useState<string | undefined>(current?.id);
  const { open, close } = useClosing();
  const own = useRef<HTMLSpanElement>(null);
  const picked = people.find((p) => p.id === sel);
  return (
    <>
      <span ref={own} className="tf-attr-cell is-open"><AttributeDisplay attribute={attribute} value={picked} asLink={false} empty="Pick one" /></span>
      <Popover triggerRef={anchorRef ?? own} isOpen={open} width="menu" offset={4} label={attribute.name} onOpenChange={(o) => { if (!o) close(onCancel); }}>
        <MenuList aria-label={attribute.name} filterPlaceholder={`Search ${attribute.name.toLowerCase()}…`} selectionMode="single" selectedKeys={sel ? [sel] : []}
          onSelectionChange={(keys) => {
            const id = onlyKey(keys);
            if (id === undefined) return close(onCancel);
            setSel(id);
            window.setTimeout(() => close(() => onCommit(people.find((p) => p.id === id))), CLOSE_AFTER_PICK_MS);
          }}>
          {people.map((p) => (
            <MenuItem key={p.id} id={p.id} textValue={p.name} icon={<Avatar name={p.name} src={p.src} size={20} shape={isRecord(p) && p.kind !== 'person' ? 'square' : 'round'} />}>{p.name}</MenuItem>
          ))}
        </MenuList>
      </Popover>
    </>
  );
}

function DateEditor({ attribute, value, onCommit, onCancel, autoFocus }: AttributeEditorProps) {
  const initial = (() => { try { return str(value) ? parseDate(str(value) ?? '') : null; } catch { return null; } })();
  const [draft, setDraft] = useState<CalendarDate | null>(initial);
  const latest = useRef(draft);
  const picked = useRef(false);
  const pop = useRef<HTMLDivElement>(null);
  const commit = () => onCommit(latest.current ? latest.current.toString() : undefined);
  return (
    <div className="tf-attr-date" onBlur={(e) => { if (leaves(e, pop)) commit(); }}>
      <DatePicker aria-label={attribute.name} value={draft} defaultOpen autoFocus={autoFocus}
        onChange={(d) => { latest.current = d; setDraft(d); picked.current = true; }}
        onOpenChange={(o) => { if (!o && picked.current) commit(); }}>
        <Group className="tf-attr-input__box tf-attr-date__group" onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
          <DateInput className="tf-attr-date__input">{(seg) => <DateSegment segment={seg} className="tf-attr-date__seg" />}</DateInput>
          <AriaButton className="tf-attr-date__btn" aria-label="Open calendar"><CalendarIcon size={14} strokeWidth={1.75} /></AriaButton>
        </Group>
        {/* The shared calendar in the shared popover; the wrapper lets a move into the calendar count as staying in the editor. */}
        <Popover placement="bottom start" offset={4} label="Calendar">
          <div ref={pop}><Calendar /></div>
        </Popover>
      </DatePicker>
    </div>
  );
}

function FileEditor({ attribute, value, onCommit }: AttributeEditorProps) {
  const fs = files(value);
  const save = (next: ReadonlyArray<FileRef>) => onCommit(next.length ? next : undefined);
  return (
    <div className="tf-attr-files" role="group" aria-label={attribute.name}>
      {fs.map((f) => (
        <span key={f.id} className="tf-attr-file">
          <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" /><span className="tf-attr-file__name">{f.name}</span><span className="tf-attr-file__size">{formatBytes(f.size)}</span>
          <AriaButton className="tf-attr-file__remove" aria-label={`Remove ${f.name}`} onPress={() => save(fs.filter((x) => x.id !== f.id))}><X size={12} strokeWidth={2} /></AriaButton>
        </span>
      ))}
      <FileTrigger onSelect={(picked) => { if (picked) save([...fs, ...Array.from(picked).map((f, i) => ({ id: `${f.name}-${f.lastModified}-${i}`, name: f.name, size: f.size }))]); }}>
        <AriaButton className="tf-attr-upload"><Upload size={14} strokeWidth={1.75} />{fs.length ? 'Add' : 'Upload'}</AriaButton>
      </FileTrigger>
    </div>
  );
}

/** Edits any value: the one editor per type. Typed fields commit on Enter or leaving, Esc puts the value back; lists commit on pick (the tick draws, then the list closes). */
export function AttributeEditor(props: AttributeEditorProps) {
  const { attribute, value, onCommit } = props;
  switch (attribute.type) {
    case 'checkbox': return <Checkbox isSelected={value === true} onChange={(v) => onCommit(v)} aria-label={attribute.name} />;
    case 'rating': return <Rating value={num(value)} onChange={(v) => onCommit(v)} label={attribute.name} autoFocus={props.autoFocus} />;
    case 'number': case 'currency': case 'percent': return <NumberEditor {...props} />;
    case 'select': case 'multiSelect': case 'status': return <OptionEditor {...props} />;
    case 'record': case 'actor': return <ReferenceEditor {...props} />;
    case 'date': return <DateEditor {...props} />;
    case 'personalName': return <NameEditor {...props} />;
    case 'file': return <FileEditor {...props} />;
    case 'timestamp': return <ReadOnlyValue attribute={attribute} value={value} reason={attribute.readOnlyReason ?? 'Set by the system'} />;
    default: return <TextEditor {...props} />;
  }
}

function ReadOnlyValue({ attribute, value, reason }: { readonly attribute: Attribute; readonly value: AttributeValue; readonly reason: string }) {
  return (
    <span className="tf-attr-cell tf-attr-cell--readonly" title={reason}>
      <AttributeDisplay attribute={attribute} value={value} />
      <span className="tf-attr-cell__lock" aria-label={reason}><Lock size={12} strokeWidth={1.75} /></span>
    </span>
  );
}

/* ---------------------------------------------------------- inline field */

/** Props for AttributeField. */
export interface AttributeFieldProps {
  readonly attribute: Attribute;
  readonly value: AttributeValue;
  readonly onChange: (value: AttributeValue) => void;
  /** What an empty value invites. Defaults to "Add <name>…" in text-tertiary. */
  readonly empty?: string;
  readonly className?: string;
}

/** A value that edits in place: press it (or Enter on it) to swap the display for its editor, commit, and the row washes once. Checkboxes, ratings and files change where they are. */
export function AttributeField({ attribute, value, onChange, empty, className }: AttributeFieldProps) {
  const [editing, setEditing] = useState(false);
  const [wash, setWash] = useState(0);
  const [ends, setEnds] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const t = attribute.type;
  const readOnly = t === 'timestamp' || attribute.readOnlyReason !== undefined;
  // Focus comes back to the value after a keyboard commit or Esc; never steals it from where a click went.
  useEffect(() => {
    if (ends > 0 && (document.activeElement === document.body || document.activeElement === null)) btn.current?.focus();
  }, [ends]);
  const save = (v: AttributeValue) => { onChange(v); setWash((k) => k + 1); };
  const end = () => { setEditing(false); setEnds((k) => k + 1); };
  let inner: ReactNode;
  if (readOnly) inner = <ReadOnlyValue attribute={attribute} value={value} reason={attribute.readOnlyReason ?? 'Set by the system'} />;
  else if (t === 'checkbox' || t === 'rating' || t === 'file') inner = <span className="tf-attr-cell tf-attr-cell--inplace"><AttributeEditor attribute={attribute} value={value} onCommit={save} onCancel={() => undefined} /></span>;
  else if (editing) inner = <AttributeEditor attribute={attribute} value={value} anchorRef={box} autoFocus onCommit={(v) => { save(v); end(); }} onCancel={end} />;
  else inner = (
    <AriaButton ref={btn} className="tf-attr-cell tf-attr-cell--button" onPress={() => setEditing(true)} aria-label={`${attribute.name}: ${attributeText(attribute, value) || 'empty'}. Edit`}>
      <AttributeDisplay attribute={attribute} value={value} asLink={false} empty={empty ?? `Add ${attribute.name.toLowerCase()}…`} />
    </AriaButton>
  );
  return (
    <div ref={box} className={cx('tf-attr', editing && 'is-editing', className)} data-type={t}>
      {wash > 0 && <span key={wash} className="tf-attr__wash" aria-hidden="true" />}
      {inner}
    </div>
  );
}
