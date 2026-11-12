import {
  Button as AriaButton, Checkbox as AriaCheckbox, CheckboxGroup, DateInput, DatePicker as AriaDatePicker, DateSegment,
  Group, ListBox, ListBoxItem, Radio, RadioGroup, Select, SelectValue, type Key,
} from 'react-aria-components';
import { parseDate, parseTime, type CalendarDate, type Time } from '@internationalized/date';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DragList } from '../../lib/drag.ts';
import { DragItem } from '../DragHandle/DragHandle.tsx';
import { CalendarDays, Check, ChevronDown, Eraser, GripVertical, Star } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../Button/Button.tsx';
import { Calendar } from '../DatePicker/DatePicker.tsx';
import { FieldGroup, TextArea, TextField } from '../Field/Field.tsx';
import { FileDrop, FileList, FileRow } from '../FileDrop/FileDrop.tsx';
import { PhoneField } from '../PhoneField/PhoneField.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { TimeField } from '../TimeField/TimeField.tsx';
import { formatClock } from '../WeekCalendar/clock.ts';
import {
  COUNTRIES, GUEST_WORDS, OTHER_PREFIX, dayBound, isAddress, isBooking, isFiles, isList, isPhone, isText, localeOf,
  type AddressValue, type AnswerValue, type BookingSource, type FileAnswer, type FormLang, type FormQuestion, type GuestWords,
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
  /** The form's language: placeholders, hints, Other, the file drop and the pickers' words (GUEST_WORDS). English when left out. */
  readonly lang?: FormLang;
}

/** The guest control for one question: 44px, 16px text, filled boxes, choice cards with letter keys. */
export function QuestionInput(props: QuestionInputProps) {
  const { question: q, value, onChange, labelId, isInvalid } = props;
  const g = GUEST_WORDS[props.lang ?? 'en'];
  const text = isText(value) ? value : '';
  switch (q.kind) {
    case 'short':
      return <TextField size="lg" aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? g.typeAnswer} isInvalid={isInvalid} />;
    case 'email':
      return <TextField size="lg" type="email" autoComplete="email" aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? 'name@company.com'} isInvalid={isInvalid} />;
    case 'long':
      return <TextArea size="lg" rows={3} aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? g.typeAnswer} isInvalid={isInvalid} description={g.newLine} />;
    case 'phone':
      return <PhoneField size="lg" label={g.phone} value={isPhone(value) ? value : undefined} onChange={onChange} isInvalid={isInvalid} />;
    case 'choice':
    case 'multi':
      return <ChoiceCards {...props} />;
    case 'dropdown':
      return <Dropdown {...props} />;
    case 'rating':
      return <StarRating value={typeof value === 'number' ? value : undefined} onChange={(n, goOn) => { onChange(n); if (goOn) props.onPicked?.(); }} labelId={labelId} words={g} />;
    case 'date':
      return <DateAnswer value={text} onChange={onChange} labelId={labelId} isInvalid={isInvalid} words={g} earliest={dayBound(q.earliest)} latest={dayBound(q.latest)} />;
    case 'file':
      return <FileAnswerInput {...props} />;
    case 'address':
      return <AddressInput value={isAddress(value) ? value : undefined} onChange={onChange} labelId={labelId} words={g} />;
    case 'ranking':
      return <Ranking options={isList(value) ? value : q.options ?? []} onChange={onChange} labelId={labelId} words={g} />;
    case 'signature':
      return <SignaturePad value={text} onChange={onChange} labelId={labelId} words={g} />;
    case 'booking':
      return props.booking ? <BookingPicker source={props.booking} value={isBooking(value) ? value : undefined} onChange={(v) => { onChange(v); }} labelId={labelId} words={g} locale={localeOf(props.lang ?? 'en')} /> : null;
    case 'url':
      return <TextField size="lg" type="url" inputMode="url" autoComplete="url" aria-labelledby={labelId} value={text} onChange={onChange} placeholder={q.placeholder ?? 'example.com'} isInvalid={isInvalid} />;
    case 'number':
      return <TextField size="lg" inputMode="decimal" aria-labelledby={labelId} value={text} onChange={(v) => onChange(v.replace(/[^\d.,-]/g, ''))} placeholder={q.placeholder ?? (q.min !== undefined && q.max !== undefined ? g.range(q.min, q.max) : g.aNumber)} isInvalid={isInvalid} />;
    case 'yesno':
      return <ChoiceCards {...props} question={{ ...q, kind: 'choice', options: ['Yes', 'No'] }} />;
    case 'country':
      return <Dropdown {...props} question={{ ...q, options: q.options?.length ? q.options : COUNTRIES }} />;
    case 'checkbox':
    case 'consent':
      return <TickBox label={q.defaultValue || (q.kind === 'consent' ? (q.consentKind === 'marketing' ? g.news : g.agree) : g.yes)} checked={text === 'Yes'} onChange={(on) => onChange(on ? 'Yes' : '')} labelId={labelId} isInvalid={isInvalid} />;
    case 'time':
      return <TimeAnswer value={text} onChange={onChange} labelId={labelId} label={g.time} />;
    case 'datetime': {
      const [d = '', t = ''] = text.split('T');
      const join = (dd: string, tt: string) => onChange(dd || tt ? `${dd}T${tt}` : '');
      return <div className="tf-hq__pair"><DateAnswer value={d} onChange={(v) => join(v, t)} labelId={labelId} isInvalid={isInvalid} words={g} /><TimeAnswer value={t} onChange={(v) => join(d, v)} labelId={labelId} label={g.time} /></div>;
    }
    case 'scale':
      return <Scale min={q.min ?? 0} max={q.max ?? 10} low={q.low ?? g.notLikely} high={q.high ?? g.veryLikely} value={typeof value === 'number' ? value : undefined} onChange={(n) => { onChange(n); props.onPicked?.(); }} labelId={labelId} isInvalid={isInvalid} />;
    case 'statement':
    case 'hidden':
      return null;
    default:
      return null;
  }
}

/** Choice cards: full width rows with a letter key; the letter on the keyboard picks it. Single picks tick and may go on.
 *  With `other`, a last "Other" card opens a line to type in; its answer reads "Other: <words>". Multiple choice says its pick limits. */
function ChoiceCards({ question: q, value, onChange, labelId, isInvalid, onPicked, lang }: QuestionInputProps) {
  const g = GUEST_WORDS[lang ?? 'en'];
  // Yes or no and Other keep their English answers (logic and reports read them); the guest reads them in the form's language.
  const yesNo = q.options?.length === 2 && q.options[0] === 'Yes' && q.options[1] === 'No';
  const shownAs = (opt: string) => (opt === 'Other' && q.other ? g.other : yesNo && opt === 'Yes' ? g.yes : yesNo && opt === 'No' ? g.no : opt);
  const options = q.other ? [...(q.options ?? []), 'Other'] : q.options ?? [];
  const multi = q.kind === 'multi';
  const raw = isList(value) ? value : [];
  const rawSingle = isText(value) ? value : '';
  // "Other: words" is shown as the Other card ticked, with its words in the line under the cards.
  const isOther = (x: string) => x.startsWith(OTHER_PREFIX.trim());
  const otherWords = (multi ? raw.find(isOther) : isOther(rawSingle) ? rawSingle : undefined)?.replace(/^Other:?\s?/, '') ?? '';
  const picked = raw.map((x) => (isOther(x) ? 'Other' : x));
  const single = isOther(rawSingle) ? 'Other' : rawSingle;
  const otherOn = multi ? picked.includes('Other') : single === 'Other';
  // Only a pick by pointer or letter goes on by itself; arrows just move between the cards.
  const byPointer = useRef(false);
  const asAnswer = (opt: string, words = otherWords) => (opt === 'Other' && q.other ? `${OTHER_PREFIX}${words}` : opt);
  const choose = (opt: string, goOn: boolean) => {
    byPointer.current = false;
    if (multi) onChange(picked.includes(opt) ? picked.filter((p) => p !== opt).map((x) => asAnswer(x)) : [...picked, opt].map((x) => asAnswer(x)));
    else { onChange(asAnswer(opt)); if (goOn && opt !== 'Other') onPicked?.(); }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || (e.target as HTMLElement).tagName === 'INPUT') return;
    const n = LETTERS.indexOf(e.key.toUpperCase());
    const opt = options[n];
    if (opt === undefined) return;
    e.preventDefault();
    choose(opt, true);
  };
  const card = (opt: string, n: number) => (
    <>
      <span className="tf-hq__key" aria-hidden="true">{LETTERS[n]}</span>
      <span className="tf-hq__choice-label">{shownAs(opt)}</span>
      <svg className="tf-hq__tick" width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength={1} /></svg>
    </>
  );
  const limits = multi && (q.fewest !== undefined || q.most !== undefined)
    ? `${q.fewest !== undefined && q.most !== undefined ? (q.fewest === q.most ? g.pickExactly(q.fewest) : g.pickRange(q.fewest, q.most)) : q.most !== undefined ? g.pickUpTo(q.most) : g.pickAtLeast(q.fewest ?? 1)} `
    : multi ? `${g.pickAny} ` : '';
  return (
    <div onKeyDown={onKeyDown} onPointerDown={() => { byPointer.current = true; }}>
      {multi ? (
        <CheckboxGroup aria-labelledby={labelId} value={[...picked]} onChange={(v) => onChange(v.map((x) => asAnswer(x)))} isInvalid={isInvalid} className="tf-hq__choices">
          {options.map((opt, n) => <AriaCheckbox key={opt} value={opt} className="tf-hq__choice">{card(opt, n)}</AriaCheckbox>)}
        </CheckboxGroup>
      ) : (
        <RadioGroup aria-labelledby={labelId} value={single || null} onChange={(v) => choose(v, byPointer.current)} isInvalid={isInvalid} className="tf-hq__choices">
          {options.map((opt, n) => <Radio key={opt} value={opt} className="tf-hq__choice">{card(opt, n)}</Radio>)}
        </RadioGroup>
      )}
      {otherOn && <div className="tf-hq__other"><TextField size="lg" aria-label={g.otherLabel} value={otherWords} placeholder={g.typeOwn} autoFocus
        onChange={(w) => onChange(multi ? picked.map((x) => (x === 'Other' ? `${OTHER_PREFIX}${w}` : x)) : `${OTHER_PREFIX}${w}`)} /></div>}
      <p className="tf-hq__aside">{limits}{g.pressLetter}</p>
    </div>
  );
}

/** A long list in a 44px filled trigger that opens the shared Popover (05 menu dropdown); stays pressed while open. */
function Dropdown({ question: q, value, onChange, labelId, isInvalid, onPicked, lang }: QuestionInputProps) {
  const g = GUEST_WORDS[lang ?? 'en'];
  const items = (q.options ?? []).map((o) => ({ id: o }));
  return (
    <Select aria-labelledby={labelId} selectedKey={isText(value) && value ? value : null} isInvalid={isInvalid}
      onSelectionChange={(k: Key | null) => { if (k !== null) { onChange(String(k)); onPicked?.(); } }} className="tf-hq__select">
      <AriaButton className="tf-hq__box tf-hq__trigger">
        <SelectValue className="tf-hq__value">{({ isPlaceholder, selectedText }) => (isPlaceholder ? <span className="tf-hq__placeholder">{g.choose}</span> : selectedText)}</SelectValue>
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
function StarRating({ value, onChange, labelId, words: g }: { readonly value?: number; readonly onChange: (n: number, byPointer: boolean) => void; readonly labelId: string; readonly words: GuestWords }) {
  const [hover, setHover] = useState<number>();
  const byPointer = useRef(false);
  const lit = hover ?? value ?? 0;
  const words = ['', ...g.stars];
  return (
    <div className="tf-hq__rating-row" onPointerDown={() => { byPointer.current = true; }}>
      <RadioGroup aria-labelledby={labelId} orientation="horizontal" value={value ? String(value) : null} onChange={(v) => { onChange(Number(v), byPointer.current); byPointer.current = false; }}
        className="tf-hq__rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <Radio key={n} value={String(n)} aria-label={g.ofFive(n, words[n] ?? '')} className={cx('tf-hq__star', n <= lit && 'is-lit')}
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
function DateAnswer({ value, onChange, labelId, isInvalid, earliest, latest, words: g }: { readonly value: string; readonly onChange: (v: string) => void; readonly labelId: string; readonly isInvalid?: boolean; readonly words: GuestWords; /** YYYY-MM-DD bounds: days outside them can't be picked. */ readonly earliest?: string; readonly latest?: string }) {
  let parsed: CalendarDate | null = null;
  try { parsed = value ? parseDate(value) : null; } catch { parsed = null; }
  const bound = (b: string | undefined) => { try { return b ? parseDate(b) : undefined; } catch { return undefined; } };
  return (
    <AriaDatePicker aria-labelledby={labelId} value={parsed} onChange={(d) => onChange(d ? d.toString() : '')} isInvalid={isInvalid} className="tf-hq__date" minValue={bound(earliest)} maxValue={bound(latest)}>
      <Group className="tf-hq__box">
        <DateInput className="tf-hq__date-input">{(segment) => <DateSegment segment={segment} className="tf-hq__seg" />}</DateInput>
        <AriaButton className="tf-hq__date-btn" aria-label={g.openCalendar}><CalendarDays {...i16} /></AriaButton>
      </Group>
      <Popover placement="bottom start" label={g.calendar}><Calendar /></Popover>
    </AriaDatePicker>
  );
}

/** One tick box as a full-width card (Checkbox, Consent): ticking it is the answer. */
function TickBox({ label, checked, onChange, labelId, isInvalid }: { readonly label: string; readonly checked: boolean; readonly onChange: (on: boolean) => void; readonly labelId: string; readonly isInvalid?: boolean }) {
  return (
    <AriaCheckbox isSelected={checked} onChange={onChange} isInvalid={isInvalid} aria-describedby={labelId} className="tf-hq__choice tf-hq__tick-card">
      <span className="tf-hq__box-tick" aria-hidden="true"><Check size={14} strokeWidth={2.5} /></span>
      <span className="tf-hq__choice-label">{label}</span>
    </AriaCheckbox>
  );
}

/** A time typed as hours and minutes; the answer is "HH:MM". */
function TimeAnswer({ value, onChange, labelId, label }: { readonly value: string; readonly onChange: (v: string) => void; readonly labelId: string; readonly label: string }) {
  let parsed: Time | null = null;
  try { parsed = value ? parseTime(value) : null; } catch { parsed = null; }
  return <div className="tf-hq__timebox"><TimeField label={label} isLabelHidden aria-labelledby={labelId} hourCycle={12} value={parsed} onChange={(t) => onChange(t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : '')} /></div>;
}

/** A row of numbers from low to high (0–10 by default) with a word under each end; a pick goes on in a one-at-a-time form. */
function Scale({ min, max, low, high, value, onChange, labelId, isInvalid }: { readonly min: number; readonly max: number; readonly low: string; readonly high: string; readonly value: number | undefined; readonly onChange: (n: number) => void; readonly labelId: string; readonly isInvalid?: boolean }) {
  const nums = Array.from({ length: Math.max(1, max - min + 1) }, (_, n) => min + n);
  return (
    <div className="tf-hq__scale">
      <RadioGroup aria-labelledby={labelId} orientation="horizontal" value={value === undefined ? null : String(value)} onChange={(v) => onChange(Number(v))} isInvalid={isInvalid} className="tf-hq__scale-row">
        {nums.map((n) => <Radio key={n} value={String(n)} className="tf-hq__scale-pick">{n}</Radio>)}
      </RadioGroup>
      <span className="tf-hq__scale-ends" aria-hidden="true"><span>{low}</span><span>{high}</span></span>
    </div>
  );
}

let fileSeq = 0;
/** The shared FileDrop, then each file as a FileRow that fills while it uploads. */
function FileAnswerInput({ value, onChange, onUpload, lang }: QuestionInputProps) {
  const g = GUEST_WORDS[lang ?? 'en'];
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
      <FileDrop label={g.dropFile} description={g.fileHint} onFiles={add} variant={files.length ? 'compact' : 'zone'} />
      {files.length > 0 && (
        <FileList label={g.attached}>
          {files.map((f) => <FileRow key={f.id} name={f.name} size={f.size} type={f.type} progress={f.progress} onRemove={() => onChange((cur) => (isFiles(cur) ? cur : []).filter((x) => x.id !== f.id))} />)}
        </FileList>
      )}
    </div>
  );
}

const EMPTY_ADDRESS: AddressValue = { street: '', apartment: '', city: '', postcode: '', country: '' };
/** Street, apartment, city beside postcode, and country: the shared fields two to a row, stacking on a phone. */
function AddressInput({ value = EMPTY_ADDRESS, onChange, labelId, words: g }: { readonly value?: AddressValue; readonly onChange: (v: AddressValue) => void; readonly labelId: string; readonly words: GuestWords }) {
  const set = (k: keyof AddressValue) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div role="group" aria-labelledby={labelId}>
      <FieldGroup columns={2}>
        <TextField size="lg" label={g.street} autoComplete="address-line1" value={value.street} onChange={set('street')} />
        <TextField size="lg" label={g.apartment} aside={g.optional} autoComplete="address-line2" value={value.apartment} onChange={set('apartment')} />
        <TextField size="lg" label={g.city} autoComplete="address-level2" value={value.city} onChange={set('city')} />
        <TextField size="lg" label={g.postcode} autoComplete="postal-code" value={value.postcode} onChange={set('postcode')} />
        <TextField size="lg" label={g.country} autoComplete="country-name" value={value.country} onChange={set('country')} />
      </FieldGroup>
    </div>
  );
}

/** Rows in order, moved by their grip with a pointer, or with Space then the arrows (lib/drag.ts): the row lifts, the others slide aside, a dashed gap shows where it lands. */
function Ranking({ options, onChange, labelId, words: g }: { readonly options: ReadonlyArray<string>; readonly onChange: (v: ReadonlyArray<string>) => void; readonly labelId: string; readonly words: GuestWords }) {
  const row = (o: string, grip: ReactNode) => <>{grip}<span className="tf-hq__rank-n tf-num" aria-hidden="true">{options.indexOf(o) + 1}</span><span className="tf-hq__choice-label">{o}</span></>;
  return (
    <DragList ids={options} onReorder={(ids) => onChange(ids)} textOf={(id) => id}
      overlay={(id) => <div className="tf-hq__rank-row">{row(id, <span className="tf-hq__grip" aria-hidden="true"><GripVertical {...i16} /></span>)}</div>}>
      <ul aria-labelledby={labelId} className="tf-hq__rank">
        {options.map((o) => (
          <DragItem key={o} id={o} className="tf-hq__rank-row">
            {(d) => row(o, <button type="button" className="tf-hq__grip" aria-label={g.move(o)} {...d.grip}><GripVertical {...i16} /></button>)}
          </DragItem>
        ))}
      </ul>
    </DragList>
  );
}

/** A pad three times as wide as tall, inked in the text colour; or the name typed instead. Clear starts again. */
function SignaturePad({ value, onChange, labelId, words: g }: { readonly value: string; readonly onChange: (v: string) => void; readonly labelId: string; readonly words: GuestWords }) {
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
        <SegmentedControl aria-label={g.howSign} size="sm" items={[{ id: 'draw', label: g.draw }, { id: 'type', label: g.type }]} selectedKey={mode}
          onSelectionChange={(k) => { setMode(k === 'type' ? 'type' : 'draw'); onChange(''); }} />
        {mode === 'draw' && <Button size="sm" variant="ghost" icon={<Eraser size={14} strokeWidth={1.75} />} onPress={clear} isDisabled={!value}>{g.clear}</Button>}
      </div>
      {mode === 'draw' ? (
        <div className="tf-hq__pad" data-empty={!value || undefined}>
          <canvas ref={canvas} className="tf-hq__canvas" aria-label={g.pad} role="img"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <span className="tf-hq__pad-hint" aria-hidden="true">{g.signHere}</span>
          <span className="tf-hq__pad-line" aria-hidden="true" />
        </div>
      ) : (
        <div className="tf-hq__typed">
          <TextField size="lg" label={g.fullName} value={value} onChange={onChange} autoComplete="name" />
          {value && <p className="tf-hq__typed-ink" aria-hidden="true">{value}</p>}
        </div>
      )}
    </div>
  );
}

/** The booking step: the shared month Calendar beside the open times of the picked day (BookingFlow's picker, as a question). */
function BookingPicker({ source, value, onChange, labelId, words: g, locale }: { readonly source: BookingSource; readonly value?: { readonly date: string; readonly minutes: number }; readonly onChange: (v: { date: string; minutes: number }) => void; readonly labelId: string; readonly words: GuestWords; readonly locale: string }) {
  const first = (() => { for (let n = 0; n < 60; n += 1) { const d = source.today.add({ days: n }); if (source.isDayOpen(d)) return d; } return source.today; })();
  const [date, setDate] = useState<CalendarDate>(() => (value ? parseDate(value.date) : first));
  const slots = source.slotsFor(date);
  const day = new Intl.DateTimeFormat(locale === 'en-US' ? 'en-GB' : locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(date.year, date.month - 1, date.day));
  return (
    <div className="tf-hq__book" role="group" aria-labelledby={labelId}>
      <Calendar aria-label={g.day} value={date} onChange={setDate} minValue={source.today} isDateUnavailable={(d) => !source.isDayOpen(d as CalendarDate)} />
      <div className="tf-hq__slots">
        <p className="tf-hq__slots-day" key={date.toString()}>{day}</p>
        <ul className="tf-hq__slot-list" key={`l${date.toString()}`} aria-label={g.openTimes(day)}>
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
          {slots.length === 0 && <li className="tf-hq__aside">{g.noTimes}</li>}
        </ul>
      </div>
    </div>
  );
}

