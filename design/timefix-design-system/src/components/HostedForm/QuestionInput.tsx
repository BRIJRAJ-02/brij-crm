import {
  Button as AriaButton, Checkbox as AriaCheckbox, CheckboxGroup, DateInput, DatePicker as AriaDatePicker, DateSegment, DropIndicator,
  GridList, GridListItem, Group, ListBox, ListBoxItem, Radio, RadioGroup, Select, SelectValue, useDragAndDrop, type Key,
} from 'react-aria-components';
import { parseDate, type CalendarDate } from '@internationalized/date';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Check, ChevronDown, Eraser, GripVertical, Star } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import { Calendar } from '../DatePicker/DatePicker.tsx';
import { FieldGroup, TextArea, TextField } from '../Field/Field.tsx';
import { FileDrop, FileList, FileRow } from '../FileDrop/FileDrop.tsx';
import { PhoneField } from '../PhoneField/PhoneField.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import {
  isAddress, isBooking, isFiles, isList, isPhone, isText,
  type AddressValue, type AnswerValue, type BookingSource, type FileAnswer, type FormQuestion,
} from './answers.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Uploads one file, reporting progress 0–100; resolves when it has landed. */
export type UploadFile = (file: File, onProgress: (percent: number) => void) => Promise<void>;

/** Props for QuestionInput. */
export interface QuestionInputProps {
  readonly question: FormQuestion;
  readonly value: AnswerValue | undefined;
  /** Takes a new answer, or a function of the latest one (uploads report progress after other changes). */
  readonly onChange: (next: AnswerValue | ((current: AnswerValue | undefined) => AnswerValue)) => void;
  /** The id of the element that names the question (its heading). */
  readonly labelId: string;
  readonly isInvalid?: boolean;
  /** A single choice was picked by pointer or letter: a one-at-a-time form goes on by itself. */
  readonly onPicked?: () => void;
  readonly booking?: BookingSource;
  readonly onUpload?: UploadFile;
}

/** The guest control for one question: 44px, 16px text, filled boxes, choice cards with letter keys. */
export function QuestionInput(props: QuestionInputProps) {
  const { question: q, value, onChange, labelId, isInvalid } = props;
  const text = isText(value) ? value : '';
  switch (q.kind) {
    case 'short':
      return <TextField size="lg" aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? 'Type your answer'} isInvalid={isInvalid} />;
    case 'email':
      return <TextField size="lg" type="email" autoComplete="email" aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? 'name@company.com'} isInvalid={isInvalid} />;
    case 'long':
      return <TextArea size="lg" rows={3} aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? 'Type your answer'} isInvalid={isInvalid} description="Shift + Enter for a new line" />;
    case 'phone':
      return <PhoneField size="lg" label="Phone number" value={isPhone(value) ? value : undefined} onChange={onChange} isInvalid={isInvalid} />;
    case 'choice':
    case 'multi':
      return <ChoiceCards {...props} />;
    case 'dropdown':
      return <Dropdown {...props} />;
    case 'rating':
      return <StarRating value={typeof value === 'number' ? value : undefined} onChange={(n, goOn) => { onChange(n); if (goOn) props.onPicked?.(); }} labelId={labelId} />;
    case 'date':
      return <DateAnswer value={text} onChange={onChange} labelId={labelId} isInvalid={isInvalid} />;
    case 'file':
      return <FileAnswerInput {...props} />;
    case 'address':
      return <AddressInput value={isAddress(value) ? value : undefined} onChange={onChange} labelId={labelId} />;
    case 'ranking':
      return <Ranking options={isList(value) ? value : q.options ?? []} onChange={onChange} labelId={labelId} />;
    case 'signature':
      return <SignaturePad value={text} onChange={onChange} labelId={labelId} />;
    case 'booking':
      return props.booking ? <BookingPicker source={props.booking} value={isBooking(value) ? value : undefined} onChange={(v) => { onChange(v); }} labelId={labelId} /> : null;
    default:
      return null;
  }
}

/** Choice cards: full width rows with a letter key; the letter on the keyboard picks it. Single picks tick and may go on. */
function ChoiceCards({ question: q, value, onChange, labelId, isInvalid, onPicked }: QuestionInputProps) {
  const options = q.options ?? [];
  const multi = q.kind === 'multi';
  const picked = isList(value) ? value : [];
  const single = isText(value) ? value : '';
  // Only a pick by pointer or letter goes on by itself; arrows just move between the cards.
  const byPointer = useRef(false);
  const choose = (opt: string, goOn: boolean) => {
    byPointer.current = false;
    if (multi) onChange(picked.includes(opt) ? picked.filter((p) => p !== opt) : [...picked, opt]);
    else { onChange(opt); if (goOn) onPicked?.(); }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
    const n = LETTERS.indexOf(e.key.toUpperCase());
    const opt = options[n];
    if (opt === undefined) return;
    e.preventDefault();
    choose(opt, true);
  };
  const card = (opt: string, n: number) => (
    <>
      <span className="tf-hq__key" aria-hidden="true">{LETTERS[n]}</span>
      <span className="tf-hq__choice-label">{opt}</span>
      <svg className="tf-hq__tick" width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength={1} /></svg>
    </>
  );
  return (
    <div onKeyDown={onKeyDown} onPointerDown={() => { byPointer.current = true; }}>
      {multi ? (
        <CheckboxGroup aria-labelledby={labelId} value={[...picked]} onChange={(v) => onChange(v)} isInvalid={isInvalid} className="tf-hq__choices">
          {options.map((opt, n) => <AriaCheckbox key={opt} value={opt} className="tf-hq__choice">{card(opt, n)}</AriaCheckbox>)}
        </CheckboxGroup>
      ) : (
        <RadioGroup aria-labelledby={labelId} value={single || null} onChange={(v) => choose(v, byPointer.current)} isInvalid={isInvalid} className="tf-hq__choices">
          {options.map((opt, n) => <Radio key={opt} value={opt} className="tf-hq__choice">{card(opt, n)}</Radio>)}
        </RadioGroup>
      )}
      <p className="tf-hq__aside">{multi ? 'Pick as many as fit. ' : ''}Press a letter to pick.</p>
    </div>
  );
}

/** A long list in a 44px filled trigger that opens the shared Popover (05 menu dropdown); stays pressed while open. */
function Dropdown({ question: q, value, onChange, labelId, isInvalid, onPicked }: QuestionInputProps) {
  const items = (q.options ?? []).map((o) => ({ id: o }));
  return (
    <Select aria-labelledby={labelId} selectedKey={isText(value) && value ? value : null} isInvalid={isInvalid}
      onSelectionChange={(k: Key | null) => { if (k !== null) { onChange(String(k)); onPicked?.(); } }} className="tf-hq__select">
      <AriaButton className="tf-hq__box tf-hq__trigger">
        <SelectValue className="tf-hq__value">{({ isPlaceholder, selectedText }) => (isPlaceholder ? <span className="tf-hq__placeholder">Choose…</span> : selectedText)}</SelectValue>
        <ChevronDown {...i16} className="tf-hq__chev" aria-hidden />
      </AriaButton>
      <Popover width="trigger" className="tf-hq__pop">
        <ListBox items={items} className="tf-hq__options">
          {(it) => (
            <ListBoxItem id={it.id} textValue={it.id} className="tf-hq__option">
              <span>{it.id}</span>
              <svg className="tf-hq__tick" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength={1} /></svg>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

/** Five 44px stars; hovering previews the rating, a pick pops the star (02 pop-in on the bounce curve). */
function StarRating({ value, onChange, labelId }: { readonly value?: number; readonly onChange: (n: number, byPointer: boolean) => void; readonly labelId: string }) {
  const [hover, setHover] = useState<number>();
  const byPointer = useRef(false);
  const lit = hover ?? value ?? 0;
  const words = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
  return (
    <div className="tf-hq__rating-row" onPointerDown={() => { byPointer.current = true; }}>
      <RadioGroup aria-labelledby={labelId} orientation="horizontal" value={value ? String(value) : null} onChange={(v) => { onChange(Number(v), byPointer.current); byPointer.current = false; }}
        className="tf-hq__rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <Radio key={n} value={String(n)} aria-label={`${n} of 5, ${words[n]}`} className={cx('tf-hq__star', n <= lit && 'is-lit')}
            onHoverStart={() => setHover(n)} onHoverEnd={() => setHover(undefined)}>
            <Star size={28} strokeWidth={1.5} aria-hidden="true" />
          </Radio>
        ))}
      </RadioGroup>
      <span className="tf-hq__rating-word" aria-hidden="true" key={lit}>{words[lit]}</span>
    </div>
  );
}

/** A date typed in segments or picked from the shared Calendar, in a 44px filled box. */
function DateAnswer({ value, onChange, labelId, isInvalid }: { readonly value: string; readonly onChange: (v: string) => void; readonly labelId: string; readonly isInvalid?: boolean }) {
  let parsed: CalendarDate | null = null;
  try { parsed = value ? parseDate(value) : null; } catch { parsed = null; }
  return (
    <AriaDatePicker aria-labelledby={labelId} value={parsed} onChange={(d) => onChange(d ? d.toString() : '')} isInvalid={isInvalid} className="tf-hq__date">
      <Group className="tf-hq__box">
        <DateInput className="tf-hq__date-input">{(segment) => <DateSegment segment={segment} className="tf-hq__seg" />}</DateInput>
        <AriaButton className="tf-hq__date-btn" aria-label="Open calendar"><CalendarDays {...i16} /></AriaButton>
      </Group>
      <Popover placement="bottom start" label="Calendar"><Calendar /></Popover>
    </AriaDatePicker>
  );
}

let fileSeq = 0;
/** The shared FileDrop, then each file as a FileRow that fills while it uploads. */
function FileAnswerInput({ value, onChange, onUpload }: QuestionInputProps) {
  const files = isFiles(value) ? value : [];
  const patch = (id: string, change: Partial<FileAnswer> | undefined) =>
    onChange((cur) => (isFiles(cur) ? cur : []).map((f) => (f.id === id ? (change ? { ...f, ...change } : { id: f.id, name: f.name, size: f.size, type: f.type }) : f)));
  const add = (list: readonly File[]) => {
    const added = list.map((f) => ({ file: f, answer: { id: `file-${(fileSeq += 1)}`, name: f.name, size: f.size, type: f.type, progress: onUpload ? 0 : undefined } }));
    onChange((cur) => [...added.map((a) => a.answer), ...(isFiles(cur) ? cur : [])]);
    for (const a of added) {
      if (onUpload) void onUpload(a.file, (p) => patch(a.answer.id, { progress: p })).then(() => patch(a.answer.id, undefined));
    }
  };
  return (
    <div className="tf-hq__files">
      <FileDrop label="Drop a file or browse" description="PDF, PNG or JPG, up to 10 MB" onFiles={add} variant={files.length ? 'compact' : 'zone'} />
      {files.length > 0 && (
        <FileList label="Attached files">
          {files.map((f) => <FileRow key={f.id} name={f.name} size={f.size} type={f.type} progress={f.progress} onRemove={() => onChange((cur) => (isFiles(cur) ? cur : []).filter((x) => x.id !== f.id))} />)}
        </FileList>
      )}
    </div>
  );
}

const EMPTY_ADDRESS: AddressValue = { street: '', apartment: '', city: '', postcode: '', country: '' };
/** Street, apartment, city beside postcode, and country: the shared fields two to a row, stacking on a phone. */
function AddressInput({ value = EMPTY_ADDRESS, onChange, labelId }: { readonly value?: AddressValue; readonly onChange: (v: AddressValue) => void; readonly labelId: string }) {
  const set = (k: keyof AddressValue) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div role="group" aria-labelledby={labelId}>
      <FieldGroup columns={2}>
        <TextField size="lg" label="Street" autoComplete="address-line1" value={value.street} onChange={set('street')} />
        <TextField size="lg" label="Apartment" aside="Optional" autoComplete="address-line2" value={value.apartment} onChange={set('apartment')} />
        <TextField size="lg" label="City" autoComplete="address-level2" value={value.city} onChange={set('city')} />
        <TextField size="lg" label="Postcode" autoComplete="postal-code" value={value.postcode} onChange={set('postcode')} />
        <TextField size="lg" label="Country" autoComplete="country-name" value={value.country} onChange={set('country')} />
      </FieldGroup>
    </div>
  );
}

/** Rows in order, moved by their grip with a pointer, or with Enter then the arrows; the drop slot opens dashed. */
function Ranking({ options, onChange, labelId }: { readonly options: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void; readonly labelId: string }) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => {
      const moving = options.filter((o) => e.keys.has(o));
      const rest = options.filter((o) => !e.keys.has(o));
      const at = rest.indexOf(String(e.target.key)) + (e.target.dropPosition === 'after' ? 1 : 0);
      onChange([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-hq__drop" />,
  });
  return (
    <GridList aria-labelledby={labelId} items={options.map((o) => ({ id: o }))} dragAndDropHooks={dragAndDropHooks} className="tf-hq__rank">
      {(it) => (
        <GridListItem id={it.id} textValue={it.id} className="tf-hq__rank-row">
          <AriaButton slot="drag" className="tf-hq__grip" aria-label={`Move ${it.id}`}><GripVertical {...i16} /></AriaButton>
          <span className="tf-hq__rank-n tf-num" aria-hidden="true">{options.indexOf(it.id) + 1}</span>
          <span className="tf-hq__choice-label">{it.id}</span>
        </GridListItem>
      )}
    </GridList>
  );
}

/** A pad three times as wide as tall, inked in the text colour; or the name typed instead. Clear starts again. */
function SignaturePad({ value, onChange, labelId }: { readonly value: string; readonly onChange: (v: string) => void; readonly labelId: string }) {
  const [mode, setMode] = useState<'draw' | 'type'>(value && !value.startsWith('data:') ? 'type' : 'draw');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    const c = canvas.current;
    if (!c || mode !== 'draw') return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.25;
    ctx.strokeStyle = getComputedStyle(c).color;
  }, [mode]);
  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = point(e); };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    const from = last.current;
    if (!drawing.current || !ctx || !from) return;
    const to = point(e);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    last.current = to;
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; drawing.current = false; onChange(e.currentTarget.toDataURL('image/png')); };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    onChange('');
  };
  return (
    <div className="tf-hq__sign" role="group" aria-labelledby={labelId}>
      <div className="tf-hq__sign-head">
        <SegmentedControl aria-label="How to sign" size="sm" items={[{ id: 'draw', label: 'Draw' }, { id: 'type', label: 'Type' }]} selectedKey={mode}
          onSelectionChange={(k) => { setMode(k === 'type' ? 'type' : 'draw'); onChange(''); }} />
        {mode === 'draw' && <Button size="sm" variant="ghost" icon={<Eraser size={14} strokeWidth={1.75} />} onPress={clear} isDisabled={!value}>Clear</Button>}
      </div>
      {mode === 'draw' ? (
        <div className="tf-hq__pad" data-empty={!value || undefined}>
          <canvas ref={canvas} className="tf-hq__canvas" aria-label="Signature pad. Draw with a pointer, or switch to Type." role="img"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <span className="tf-hq__pad-hint" aria-hidden="true">Sign here</span>
          <span className="tf-hq__pad-line" aria-hidden="true" />
        </div>
      ) : (
        <div className="tf-hq__typed">
          <TextField size="lg" label="Your full name" value={value} onChange={onChange} autoComplete="name" />
          {value && <p className="tf-hq__typed-ink" aria-hidden="true">{value}</p>}
        </div>
      )}
    </div>
  );
}

/** The booking step: the shared month Calendar beside the open times of the picked day (BookingFlow's picker, as a question). */
function BookingPicker({ source, value, onChange, labelId }: { readonly source: BookingSource; readonly value?: { readonly date: string; readonly minutes: number }; readonly onChange: (v: { date: string; minutes: number }) => void; readonly labelId: string }) {
  const first = (() => { for (let n = 0; n < 60; n += 1) { const d = source.today.add({ days: n }); if (source.isDayOpen(d)) return d; } return source.today; })();
  const [date, setDate] = useState<CalendarDate>(() => (value ? parseDate(value.date) : first));
  const slots = source.slotsFor(date);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date.year, date.month - 1, date.day));
  return (
    <div className="tf-hq__book" role="group" aria-labelledby={labelId}>
      <Calendar aria-label="Day" value={date} onChange={setDate} minValue={source.today} isDateUnavailable={(d) => !source.isDayOpen(d as CalendarDate)} />
      <div className="tf-hq__slots">
        <p className="tf-hq__slots-day" key={date.toString()}>{day}</p>
        <ul className="tf-hq__slot-list" key={`l${date.toString()}`} aria-label={`Open times on ${day}`}>
          {slots.map((m) => {
            const chosen = value?.date === date.toString() && value.minutes === m;
            return (
              <li key={m}>
                <AriaButton className="tf-hq__time" aria-pressed={chosen} onPress={() => onChange({ date: date.toString(), minutes: m })}>
                  {chosen && <Check size={14} strokeWidth={2} aria-hidden="true" />}{formatClock(m)}
                </AriaButton>
              </li>
            );
          })}
          {slots.length === 0 && <li className="tf-hq__aside">No times left on this day.</li>}
        </ul>
      </div>
    </div>
  );
}

