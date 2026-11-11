import {
  Button as AriaButton, DialogTrigger, DropIndicator, GridList, GridListItem, useDragAndDrop, type Selection,
} from 'react-aria-components';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Briefcase, Building2, CopyPlus, Ellipsis, Eye, GripVertical, Megaphone, MousePointerClick, Phone, Plus, Sparkles, Trash, TriangleAlert, Wallet, X, type LucideIcon } from 'lucide-react';
import { QuestionInput } from '../HostedForm/QuestionInput.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Select } from '../Select/Select.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Count, Tag } from '../Tag/Tag.tsx';
import { QUESTION_KINDS, type FormQuestion, type QuestionKind } from '../HostedForm/answers.ts';
import { DropIn } from '../Motion/Motion.tsx';
import './QuestionList.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
const HAS_OPTIONS: ReadonlySet<QuestionKind> = new Set(['choice', 'multi', 'dropdown', 'ranking']);
const HAS_PLACEHOLDER: ReadonlySet<QuestionKind> = new Set(['short', 'long', 'email', 'url', 'number']);

/** The type's icon on a grey tile, the way every question and type option starts. */
export function QuestionTypeTile({ kind, size = 'md' }: { readonly kind: QuestionKind; readonly size?: 'sm' | 'md' }) {
  const Icon = QUESTION_KINDS[kind].icon;
  return <span className={cx('tf-qtile', `tf-qtile--${size}`)} aria-hidden="true"><Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} /></span>;
}

/** The grey line under a question's title: its type, how many choices, and any logic, points, Insights or record field it has. */
export function questionSummary(q: FormQuestion, all: ReadonlyArray<FormQuestion> = [], targets: ReadonlyArray<SaveTarget> = []): string {
  const parts: string[] = [QUESTION_KINDS[q.kind].label];
  if (HAS_OPTIONS.has(q.kind)) { const n = q.options?.length ?? 0; parts.push(n === 0 ? 'No choices yet' : n === 1 ? '1 choice' : `${n} choices`); }
  if (q.jumps?.length) parts.push(q.jumps.length === 1 ? '1 jump' : `${q.jumps.length} jumps`);
  if (q.points && Object.keys(q.points).length) parts.push('Points');
  if (q.insights) parts.push('In Insights');
  if (q.saveTo) parts.push(`Saves to ${targets.find((t) => t.id === q.saveTo)?.label ?? q.saveTo}`);
  return parts.join(' · ');
}

/** A thank-you message a jump can end on, besides the main one. */
export interface JumpEnding { readonly id: string; readonly title: string }
/** The answers a question's logic can read: its choices, Yes and No, or none. */
const answersOf = (x: FormQuestion | undefined): ReadonlyArray<string> => (x?.kind === 'yesno' ? ['Yes', 'No'] : x?.kind === 'choice' || x?.kind === 'multi' || x?.kind === 'dropdown' ? [...(x.options ?? []), ...(x.other ? ['Other'] : [])] : []);
/** Whether a question has any logic: Show only if, jumps or points. */
export const hasLogicOf = (q: FormQuestion) => Boolean(q.showIf || q.jumps?.length || q.points);
/** What is broken in a question's logic, in plain words: a rule that reads a question or answer that is gone, or sends people backwards. */
export function logicProblems(q: FormQuestion, all: ReadonlyArray<FormQuestion>, endings: ReadonlyArray<JumpEnding> = []): ReadonlyArray<string> {
  const out: string[] = [];
  const at = all.findIndex((x) => x.id === q.id);
  if (q.showIf) {
    const src = all.findIndex((x) => x.id === q.showIf?.questionId);
    if (src < 0) out.push('Shown if reads a deleted question');
    else if (src >= at) out.push('Shown if reads a later question');
    else if (!answersOf(all[src]).includes(q.showIf.is)) out.push(`Shown if waits for “${q.showIf.is}”, which is no longer a choice`);
  }
  for (const j of q.jumps ?? []) {
    if (j.is !== '*' && !answersOf(q).includes(j.is)) out.push(`A jump reads “${j.is}”, which is no longer a choice`);
    if (j.to.startsWith('end:') && !endings.some((e) => `end:${e.id}` === j.to)) out.push('A jump ends on a deleted thank-you message');
    else if (j.to !== 'end' && !j.to.startsWith('end:')) { const t = all.findIndex((x) => x.id === j.to); if (t < 0) out.push('A jump goes to a deleted question'); else if (t <= at) out.push('A jump goes back to an earlier question'); }
  }
  return out;
}

/** A record field an answer can fill ("Person › Job title"). */
export interface SaveTarget { readonly id: string; readonly label: string }
/** A ready-made question: picked from the type list, it arrives filled in. */
export interface QuestionPreset { readonly id: string; readonly label: string; readonly hint: string; readonly question: Omit<FormQuestion, 'id'> }
/** The ready-made questions every builder offers. "How did you hear about us" counts in Insights. */
export const QUESTION_PRESETS: ReadonlyArray<QuestionPreset> = [
  { id: 'heard', label: 'How did you hear about us', hint: 'Counted in Insights', question: { kind: 'choice', title: 'How did you hear about us?', options: ['Google', 'A friend or colleague', 'LinkedIn', 'An event', 'Other'], insights: true } },
  { id: 'size', label: 'Company size', hint: 'Fills Company › Employees', question: { kind: 'dropdown', title: 'How big is your company?', options: ['1–10', '11–50', '51–200', '201–1,000', 'Over 1,000'], saveTo: 'company.employees' } },
  { id: 'title', label: 'Job title', hint: 'Fills Person › Job title', question: { kind: 'short', title: 'What’s your job title?', saveTo: 'person.title' } },
  { id: 'phone', label: 'Phone number', hint: 'Fills Person › Phone', question: { kind: 'phone', title: 'Best number to reach you', saveTo: 'person.phone' } },
  { id: 'budget', label: 'Budget', hint: 'With points for a score', question: { kind: 'dropdown', title: 'What budget do you have in mind?', options: ['Under ₹1 lakh', '₹1–5 lakh', 'Over ₹5 lakh'], points: { 'Under ₹1 lakh': 0, '₹1–5 lakh': 5, 'Over ₹5 lakh': 10 } } },
];

/** The picker's groups, in the order people look for them. */
const PICKER_GROUPS: ReadonlyArray<{ readonly title: string; readonly kinds: ReadonlyArray<QuestionKind> }> = [
  { title: 'Text', kinds: ['short', 'long', 'email', 'phone', 'url', 'number', 'address'] },
  { title: 'Choices', kinds: ['choice', 'multi', 'yesno', 'dropdown', 'country', 'checkbox', 'ranking'] },
  { title: 'Date & time', kinds: ['date', 'time', 'datetime', 'booking'] },
  { title: 'Rating & scale', kinds: ['rating', 'scale'] },
  { title: 'Files', kinds: ['file', 'signature', 'consent'] },
  { title: 'Layout', kinds: ['statement', 'hidden'] },
];
/** Each ready-made question's own mark. */
const PRESET_ICON: Readonly<Record<string, LucideIcon>> = { heard: Megaphone, size: Building2, title: Briefcase, phone: Phone, budget: Wallet };
/** What a type's answer fills, said under its preview. */
const fillsOf = (k: QuestionKind): string => (k === 'email' ? 'Fills Person › Email' : k === 'phone' ? 'Fills Person › Phone' : k === 'hidden' ? 'Filled from the link, never shown' : k === 'statement' ? 'Shows words; asks nothing'
  : k === 'short' || k === 'long' || k === 'url' || k === 'number' || k === 'date' || k === 'choice' || k === 'dropdown' ? 'Can fill a field of the same kind' : 'Kept with the submission');
const noop = () => undefined;

/** One row of the picker: a kind or a ready-made question. */
interface PickRow { readonly key: string; readonly label: string; readonly hint: string; readonly fills: string; readonly icon: LucideIcon; readonly group: string; readonly sample: FormQuestion }

/** "+ Add question": a search over a compact list of types and ready-made questions, beside a live preview of the one under the
 *  pointer or the arrow keys, drawn by the guest form's own control. Enter or a click adds; Esc closes. The shared Popover (05). */
export function QuestionTypePicker({ onPick, label = 'Add question', only, presets = [], onPreset }: { readonly onPick: (kind: QuestionKind) => void; readonly label?: string; /** Offer just these types (a booking page needs a few, a form all). */ readonly only?: ReadonlyArray<QuestionKind>; /** Ready-made questions, in their own group. */ readonly presets?: ReadonlyArray<QuestionPreset>; readonly onPreset?: (p: QuestionPreset) => void }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [active, setActive] = useState(0);
  const listId = useRef(`tf-qtypes-${Math.random().toString(36).slice(2, 8)}`).current;
  const listEl = useRef<HTMLDivElement>(null);
  const allowed = new Set(only ?? (Object.keys(QUESTION_KINDS) as QuestionKind[]));
  const q = find.trim().toLowerCase();
  const all: PickRow[] = [
    ...(onPreset ? presets.filter((x) => only === undefined || only.includes(x.question.kind)).map((x) => ({ key: `preset:${x.id}`, label: x.label, hint: x.hint, fills: x.hint, icon: PRESET_ICON[x.id] ?? Sparkles, group: 'Ready-made', sample: { ...x.question, id: `pv-${x.id}` } })) : []),
    ...PICKER_GROUPS.flatMap((g) => g.kinds.filter((k) => allowed.has(k)).map((k) => ({ key: k, label: QUESTION_KINDS[k].label, hint: QUESTION_KINDS[k].hint, fills: fillsOf(k), icon: QUESTION_KINDS[k].icon, group: g.title, sample: { ...blank(k), id: `pv-${k}`, title: k === 'statement' ? 'A few words before the next part' : blank(k).title || `${QUESTION_KINDS[k].label} question` } }))),
  ];
  const rows = all.filter((r) => !q || `${r.label} ${r.hint} ${r.group}`.toLowerCase().includes(q));
  const at = Math.min(active, Math.max(0, rows.length - 1));
  const cur = rows[at];
  const pick = (r: PickRow | undefined) => {
    if (!r) return;
    const pre = r.key.startsWith('preset:') ? presets.find((x) => `preset:${x.id}` === r.key) : undefined;
    if (pre) onPreset?.(pre); else onPick(r.key as QuestionKind);
    setOpen(false); setFind(''); setActive(0);
  };
  const move = (to: number) => { const n = Math.max(0, Math.min(rows.length - 1, to)); setActive(n); window.requestAnimationFrame(() => listEl.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' })); };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(at - 1); }
    else if (e.key === 'Home' && !find) { e.preventDefault(); move(0); }
    else if (e.key === 'End' && !find) { e.preventDefault(); move(rows.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cur); }
  };
  // The search keeps focus; the list's active row is announced through it (a combobox's active descendant).
  const searchBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = searchBox.current?.querySelector('input'); if (!input) return;
    input.setAttribute('aria-controls', listId);
    if (cur) input.setAttribute('aria-activedescendant', `${listId}-${at}`); else input.removeAttribute('aria-activedescendant');
  });
  let lastGroup = '';
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (!o) { setFind(''); setActive(0); } }}>
      <Button variant="primary" size="sm" icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />} className="tf-qlist__add">{label}</Button>
      <Popover label="Question types" placement="bottom end" offset={6} width="content" className="tf-qpick__pop">
        <div className="tf-qpick" onKeyDown={onKeyDown}>
          <div className="tf-qpick__search" ref={searchBox}>
            <SearchField label="Find a question type" placeholder="Find a type: date, scale, file…" size="sm" value={find} autoFocus
              onChange={(v) => { setFind(v); setActive(0); }} />
          </div>
          <div className="tf-qpick__panes">
            <div className="tf-qpick__list" ref={listEl} role="listbox" id={listId} aria-label="Question types">
              {rows.length === 0 ? <div className="tf-qpick__none" role="presentation"><p>No type matches “{find}”.</p><Button size="sm" variant="ghost" onPress={() => { setFind(''); setActive(0); }}>Show every type</Button></div>
                : rows.map((r, n) => {
                  const head = r.group !== lastGroup ? r.group : undefined; lastGroup = r.group;
                  const Icon = r.icon;
                  return (
                    <div key={r.key} className="tf-qpick__item-wrap" role="presentation">
                      {head && <div className="tf-qpick__head" role="presentation">{head}</div>}
                      <div id={`${listId}-${n}`} data-index={n} role="option" aria-selected={n === at} tabIndex={-1} className="tf-qpick__item" data-active={n === at || undefined} data-group={r.group === 'Ready-made' ? 'ready' : undefined}
                        onMouseEnter={() => setActive(n)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                        <span className="tf-qpick__icon" aria-hidden="true"><Icon size={14} strokeWidth={1.75} /></span>
                        <span className="tf-qpick__label">{r.label}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="tf-qpick__side" aria-live="polite">
              {cur && <>
                <div className="tf-qpick__preview" aria-hidden="true" inert>
                  <p className="tf-qpick__ptitle">{cur.sample.title}</p>
                  <QuestionInput question={{ ...cur.sample, options: cur.sample.options?.slice(0, 3) }} value={undefined} onChange={noop} labelId="" />
                </div>
                <p className="tf-qpick__what"><strong>{cur.label}</strong> · {cur.hint}</p>
                {cur.fills !== cur.hint && <p className="tf-qpick__fills">{cur.fills}</p>}
                <span className="tf-qpick__keys"><Kbd>↑</Kbd><Kbd>↓</Kbd> to look · <Kbd>Enter</Kbd> to add</span>
              </>}
            </div>
          </div>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/** Props for QuestionList. */
export interface QuestionListProps {
  readonly questions: ReadonlyArray<FormQuestion>;
  /** The question open in the side panel. */
  readonly selectedId?: string;
  readonly onSelect: (id: string | undefined) => void;
  /** The list in its new order after a drag or a keyboard move. */
  readonly onReorder: (questions: ReadonlyArray<FormQuestion>) => void;
  /** Draws a Required switch on each row. Leave out when a settings panel sits beside the list (it has the switch). */
  readonly onRequiredChange?: (id: string, required: boolean) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onAdd: (kind: QuestionKind) => void;
  /** Ids added since the list drew; they drop in. */
  readonly freshIds?: ReadonlySet<string>;
  /** Something above the cards: the "Deleted · Undo" strip. */
  readonly notice?: ReactNode;
  /** Offer just these answer types. */
  readonly kinds?: ReadonlyArray<QuestionKind>;
  /** The list's heading ("Questions"). */
  readonly title?: string;
  /** Ready-made questions in the type list, and what picking one does. */
  readonly presets?: ReadonlyArray<QuestionPreset>;
  readonly onPreset?: (p: QuestionPreset) => void;
  /** Names the record fields in each card's grey line ("Saves to Person › Job title"). */
  readonly saveTargets?: ReadonlyArray<SaveTarget>;
  /** The form's other thank-you messages, so a jump to one isn't flagged as broken. */
  readonly endings?: ReadonlyArray<JumpEnding>;
}

/**
 * A form's questions as cards: grip, type tile, title over its type, a Required switch and a ⋯ menu. Cards reorder by the grip
 * (pointer, or Enter then arrows), the dragged card lifts and the slot opens dashed. Pressing a card opens it in the side panel.
 */
export function QuestionList({ questions, selectedId, onSelect, onReorder, onRequiredChange, onDuplicate, onDelete, onAdd, freshIds, notice, kinds, title = 'Questions', presets, onPreset, saveTargets, endings = [] }: QuestionListProps) {
  // The Logic filter: only questions with rules, the broken ones counted on the switch.
  const [only, setOnly] = useState<'all' | 'logic'>('all');
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly title: string }>();
  const withLogic = questions.filter(hasLogicOf);
  const broken = questions.filter((q) => logicProblems(q, questions, endings).length > 0).length;
  const filter = withLogic.length === 0 && broken === 0 ? 'all' : only;
  const shownQs = filter === 'logic' ? questions.filter((q) => hasLogicOf(q) || logicProblems(q, questions, endings).length > 0) : questions;
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': questions.find((q) => q.id === k)?.title ?? String(k) })),
    onReorder: (e) => {
      const moving = questions.filter((q) => e.keys.has(q.id));
      const rest = questions.filter((q) => !e.keys.has(q.id));
      const at = rest.findIndex((q) => q.id === e.target.key) + (e.target.dropPosition === 'after' ? 1 : 0);
      onReorder([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-qlist__drop" />,
    renderDragPreview: (items) => <div className="tf-qlist__preview">{items[0]?.['text/plain'] ?? 'Question'}</div>,
  });
  const select = (keys: Selection) => {
    if (keys === 'all') return;
    const k = [...keys][0];
    onSelect(k === undefined ? undefined : String(k));
  };
  return (
    <section className="tf-qlist" aria-label="Questions">
      <header className="tf-qlist__head">
        {title ? <h3 className="tf-qlist__title">{title} <Count>{questions.length}</Count></h3> : <span className="tf-qlist__count tf-num">{questions.length} {questions.length === 1 ? 'question' : 'questions'}</span>}
        {(withLogic.length > 0 || broken > 0) && <SegmentedControl aria-label="Show questions" size="sm" selectedKey={filter} onSelectionChange={(k) => setOnly(k === 'logic' ? 'logic' : 'all')}
          items={[{ id: 'all', label: 'All' }, { id: 'logic', label: broken ? `Logic · ${broken} to check` : `Logic · ${withLogic.length}` }]} />}
        <QuestionTypePicker onPick={onAdd} only={kinds} presets={presets} onPreset={onPreset} />
      </header>
      {notice}
      {questions.length === 0 ? (
        <EmptyState size="sm" icon={<Plus size={20} strokeWidth={1.75} />} title="No questions yet" description="Add the first one. Visitors see them in this order." />
      ) : (
        <GridList aria-label="Questions, drag to reorder" items={shownQs} dragAndDropHooks={dragAndDropHooks} selectionMode="single" selectionBehavior="replace"
          selectedKeys={selectedId ? [selectedId] : []} onSelectionChange={select} className="tf-qlist__list">
          {(q) => {
            const n = questions.indexOf(q);
            // Steps: the first question opens step 1 when any later one starts a step.
            const stepNo = questions.slice(0, n + 1).filter((x, m) => m === 0 || x.step).length;
            const showsStep = questions.some((x, m) => m > 0 && x.step) && (n === 0 || q.step !== undefined);
            return (
              <GridListItem id={q.id} textValue={q.title || 'Untitled question'} className="tf-qlist__row">
                <DropIn animate={freshIds?.has(q.id) ?? false}>
                  {showsStep && <span className="tf-qlist__step tf-num"><span>Step {stepNo}{q.step?.title ? ` · ${q.step.title}` : ''}</span>
                    <MenuTrigger>
                      <IconButton label={`More for step ${stepNo}`} size="sm"><Ellipsis {...i16} /></IconButton>
                      <Menu placement="bottom end" onAction={(k) => { if (k === 'rename') setRenaming({ id: q.id, title: q.step?.title ?? '' }); else onReorder(questions.map((x) => (x.id === q.id ? { ...x, step: undefined } : x))); }}>
                        <MenuItem id="rename">Rename step</MenuItem>
                        {n > 0 && <MenuItem id="merge">Merge with the step above</MenuItem>}
                      </Menu>
                    </MenuTrigger></span>}
                  <div className="tf-qlist__card">
                    <AriaButton slot="drag" className="tf-qlist__grip" aria-label={`Move ${q.title || 'question'}`}><GripVertical {...i16} /></AriaButton>
                    <QuestionTypeTile kind={q.kind} />
                    <span className="tf-qlist__text">
                      <span className="tf-qlist__q"><span className="tf-qlist__n tf-num">{n + 1}.</span> {q.title || <span className="tf-qlist__untitled">Untitled question</span>}</span>
                      <span className="tf-qlist__sub">{questionSummary(q, questions, saveTargets)}</span>
                      {(q.showIf || logicProblems(q, questions, endings).length > 0) && <span className="tf-qlist__chips">
                        {q.showIf && <Tag size="sm" hue="purple" icon={<Eye size={12} strokeWidth={1.75} />}>Shown if {questions.find((x) => x.id === q.showIf?.questionId)?.title || 'an earlier answer'} is {q.showIf.is}</Tag>}
                        {logicProblems(q, questions, endings).map((w) => <Tag key={w} size="sm" hue="orange" icon={<TriangleAlert size={12} strokeWidth={1.75} />}>{w}</Tag>)}
                      </span>}
                    </span>
                    <span className="tf-qlist__end">
                      {onRequiredChange ? <Switch isSelected={q.required ?? false} onChange={(v) => onRequiredChange(q.id, v)} aria-label={`Required: ${q.title || 'question'}`}>Required</Switch>
                        : q.required ? <span className="tf-qlist__req">Required</span> : null}
                      <MenuTrigger>
                        <IconButton label={`More for ${q.title || 'question'}`} size="sm"><Ellipsis {...i16} /></IconButton>
                        <Menu placement="bottom end" onAction={(k) => { if (k === 'delete') onDelete(q.id); else if (k === 'step') onReorder(questions.map((x) => (x.id === q.id ? { ...x, step: x.step ? undefined : {} } : x))); else onDuplicate(q.id); }}>
                          <MenuItem id="duplicate" icon={<CopyPlus {...i16} />}>Duplicate</MenuItem>
                          {n > 0 && <MenuItem id="step">{q.step ? 'Merge with the step above' : 'Start a new step here'}</MenuItem>}
                          <MenuSeparator />
                          <MenuItem id="delete" icon={<Trash {...i16} />} isDanger>Delete</MenuItem>
                        </Menu>
                      </MenuTrigger>
                    </span>
                  </div>
                </DropIn>
              </GridListItem>
            );
          }}
        </GridList>
      )}
      {renaming && <Dialog isOpen onOpenChange={(o) => { if (!o) setRenaming(undefined); }} title="Rename step" description="Visitors see it over the step’s questions."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { const r = renaming; onReorder(questions.map((x, m) => (x.id === r.id ? { ...x, step: m === 0 && !r.title.trim() ? undefined : { title: r.title.trim() || undefined } } : x))); setRenaming(undefined); }}>Rename</Button></>}>
        <TextField label="Step name" value={renaming.title} placeholder="About your company" autoFocus onChange={(t) => setRenaming({ ...renaming, title: t })} />
      </Dialog>}
    </section>
  );
}

/** Props for QuestionSettings. */
export interface QuestionSettingsProps {
  readonly question?: FormQuestion;
  readonly onChange: (question: FormQuestion) => void;
  readonly onClose?: () => void;
  /** Every question, for Show only if (earlier ones) and jumps (later ones). */
  readonly questions?: ReadonlyArray<FormQuestion>;
  /** Record fields an answer can fill; with them, a Save answer to choice shows. */
  readonly saveTargets?: ReadonlyArray<SaveTarget>;
  /** The form's other thank-you messages, as places a jump can end. */
  readonly endings?: ReadonlyArray<JumpEnding>;
}

/** The side panel for the selected question: type, words, required, choices. Its content swaps softly when another question opens (34). */
export function QuestionSettings({ question: q, onChange, onClose, questions = [], saveTargets, endings = [] }: QuestionSettingsProps) {
  if (!q) {
    return (
      <aside className="tf-qset tf-qset--empty" aria-label="Question settings">
        <EmptyState size="sm" icon={<MousePointerClick size={20} strokeWidth={1.75} />} title="Pick a question" description="Its words, type and choices open here." />
      </aside>
    );
  }
  const set = (patch: Partial<FormQuestion>) => onChange({ ...q, ...patch });
  const options = q.options ?? [];
  const kinds = (Object.keys(QUESTION_KINDS) as QuestionKind[]).map((k) => {
    const Icon = QUESTION_KINDS[k].icon;
    return { id: k, label: QUESTION_KINDS[k].label, icon: <Icon {...i16} /> };
  });
  return (
    <aside className="tf-qset" aria-label="Question settings">
      <header className="tf-qset__head">
        <QuestionTypeTile kind={q.kind} />
        <h3 className="tf-qset__title">Question settings</h3>
        {onClose && <IconButton label="Close settings" size="sm" onPress={onClose}><X {...i16} /></IconButton>}
      </header>
      <div className="tf-qset__body" key={q.id}>
        <Select label="Type" items={kinds} value={q.kind} onChange={(k) => { if (k) set({ kind: k as QuestionKind, options: HAS_OPTIONS.has(k as QuestionKind) && options.length === 0 ? ['Option 1', 'Option 2'] : q.options }); }} />
        <TextArea label="Question" rows={1} value={q.title} onChange={(title) => set({ title })} placeholder="What do you want to ask?" />
        <TextField label="Description" aside="Optional" value={q.description ?? ''} onChange={(description) => set({ description })} placeholder="A line of help under the question" />
        {HAS_PLACEHOLDER.has(q.kind) && <TextField label="Placeholder" aside="Optional" value={q.placeholder ?? ''} onChange={(placeholder) => set({ placeholder })} />}
        {(q.kind === 'choice' || q.kind === 'multi' || q.kind === 'dropdown') && <SegmentedControl aria-label="Choice type" size="sm" isFullWidth selectedKey={q.kind}
          onSelectionChange={(k) => set({ kind: k as QuestionKind, ...(k === 'dropdown' ? { other: undefined } : {}), ...(k !== 'multi' ? { fewest: undefined, most: undefined } : {}) })}
          items={[{ id: 'choice', label: 'Pick one' }, { id: 'multi', label: 'Pick several' }, { id: 'dropdown', label: 'Dropdown' }]} />}
        {HAS_OPTIONS.has(q.kind) && <OptionsEditor options={options} onChange={(next) => set({ options: next })} />}
        {(q.kind === 'choice' || q.kind === 'multi') && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Add “Other”</span><span className="tf-qset__row-sub">A last choice that opens a line to type in.</span></span>
          <Switch isSelected={q.other ?? false} onChange={(other) => set({ other: other || undefined })} aria-label="Add Other" />
        </div>}
        {q.kind === 'multi' && <div className="tf-qset__pair">
          <TextField label="Fewest picks" aside="Optional" inputMode="numeric" value={q.fewest === undefined ? '' : String(q.fewest)} onChange={(v) => { const n = Number(v.replace(/[^\d]/g, '')); set({ fewest: v.trim() === '' || !n ? undefined : n }); }}
            isInvalid={q.fewest !== undefined && q.most !== undefined && q.fewest > q.most} errorMessage="More than the most." />
          <TextField label="Most picks" aside="Optional" inputMode="numeric" value={q.most === undefined ? '' : String(q.most)} onChange={(v) => { const n = Number(v.replace(/[^\d]/g, '')); set({ most: v.trim() === '' || !n ? undefined : n }); }}
            isInvalid={q.most !== undefined && q.most > options.length + (q.other ? 1 : 0)} errorMessage="More than there are choices." />
        </div>}
        {q.kind === 'date' && <div className="tf-qset__pair">
          <Select label="Earliest day" value={q.earliest === undefined ? 'any' : q.earliest === 'today' ? 'today' : 'day'} onChange={(v) => set({ earliest: v === 'today' ? 'today' : v === 'day' ? q.earliest && q.earliest !== 'today' ? q.earliest : new Date().toISOString().slice(0, 10) : undefined })}
            items={[{ id: 'any', label: 'Any day' }, { id: 'today', label: 'Today' }, { id: 'day', label: 'A day…' }]} />
          <TextField label="Latest day" aside="Optional" type="date" value={q.latest ?? ''} onChange={(v) => set({ latest: v || undefined })} isInvalid={Boolean(q.latest && q.earliest && q.earliest !== 'today' && q.latest < q.earliest)} errorMessage="Before the earliest day." />
        </div>}
        {q.kind === 'date' && q.earliest && q.earliest !== 'today' && <TextField label="Earliest" type="date" value={q.earliest} onChange={(v) => set({ earliest: v || undefined })} />}
        {(q.kind === 'number' || q.kind === 'scale') && <div className="tf-qset__pair">
          <TextField label="Lowest" inputMode="numeric" value={q.min === undefined ? (q.kind === 'scale' ? '0' : '') : String(q.min)} onChange={(v) => set({ min: v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} />
          <TextField label="Highest" inputMode="numeric" value={q.max === undefined ? (q.kind === 'scale' ? '10' : '') : String(q.max)} onChange={(v) => set({ max: v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} />
        </div>}
        {q.kind === 'scale' && <div className="tf-qset__pair">
          <TextField label="Word under the lowest" value={q.low ?? ''} placeholder="Not likely" onChange={(low) => set({ low: low || undefined })} />
          <TextField label="Word under the highest" value={q.high ?? ''} placeholder="Very likely" onChange={(high) => set({ high: high || undefined })} />
        </div>}
        {q.kind === 'consent' && <SegmentedControl aria-label="Consent for" selectedKey={q.consentKind ?? 'terms'} onSelectionChange={(k) => set({ consentKind: k === 'marketing' ? 'marketing' : 'terms', required: k !== 'marketing' })} items={[{ id: 'terms', label: 'Terms (must tick)' }, { id: 'marketing', label: 'Marketing (optional)' }]} />}
 {q.kind === 'consent' && <p className="tf-qset__note">Consent record: each tick is kept on the submission with these exact words and when they ticked.</p>}
        {(q.kind === 'checkbox' || q.kind === 'consent') && <TextField label="Words beside the box" value={q.defaultValue ?? ''} placeholder={q.kind === 'consent' ? (q.consentKind === 'marketing' ? 'Yes, email me news and offers' : 'I agree to the terms') : 'Yes'} onChange={(v) => set({ defaultValue: v || undefined })} />}
        {q.kind === 'hidden' && <TextField label="Value when the link has none" value={q.defaultValue ?? ''} placeholder="website" description={`The link can set it: ?${(q.title || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '_')}=newsletter`} onChange={(v) => set({ defaultValue: v || undefined })} />}
        {q.kind !== 'statement' && q.kind !== 'hidden' && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Required</span><span className="tf-qset__row-sub">Visitors can't go on without an answer.</span></span>
          <Switch isSelected={q.required ?? false} onChange={(required) => set({ required })} aria-label="Required" />
        </div>}
        {saveTargets && q.kind !== 'statement' && <Select label="Save answer to" value={q.saveTo ?? 'none'} onChange={(v) => set({ saveTo: !v || v === 'none' ? undefined : v })} description="The record field this answer fills in."
          items={[{ id: 'none', label: 'Kept with the submission only' }, ...saveTargets.map((t) => ({ id: t.id, label: t.label }))]} />}
        {saveTargets && q.saveTo && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Replace what’s on the record</span><span className="tf-qset__row-sub">{q.overwrite ? 'A new answer replaces the value there.' : 'Off: only fills it when it’s empty; a different answer waits for you.'}</span></span>
          <Switch isSelected={q.overwrite ?? false} onChange={(overwrite) => set({ overwrite: overwrite || undefined })} aria-label="Replace what’s on the record" />
        </div>}
        {(HAS_OPTIONS.has(q.kind) || q.kind === 'yesno') && q.kind !== 'ranking' && (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'multi') && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Use as “How did you hear about us” in Insights</span><span className="tf-qset__row-sub">Insights counts where people came from by this answer.</span></span>
          <Switch isSelected={q.insights ?? false} onChange={(insights) => set({ insights: insights || undefined })} aria-label="Use in Insights" />
        </div>}
        <LogicSettings q={q} questions={questions} set={set} endings={endings} />
        {logicProblems(q, questions, endings).map((w) => <p key={w} className="tf-qset__warn" role="alert"><TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{w}. Pick again or remove it.</p>)}
      </div>
    </aside>
  );
}

/** Show only if, steps, jumps and points, folded under More options so a plain question stays calm. */
function LogicSettings({ q, questions, set, endings }: { readonly q: FormQuestion; readonly questions: ReadonlyArray<FormQuestion>; readonly set: (patch: Partial<FormQuestion>) => void; readonly endings: ReadonlyArray<JumpEnding> }) {
  const at = questions.findIndex((x) => x.id === q.id);
  const earlier = questions.slice(0, Math.max(0, at)).filter((x) => HAS_OPTIONS.has(x.kind) || x.kind === 'yesno');
  const later = questions.slice(at + 1);
  const destinations = [{ id: 'next', label: 'Next question' }, ...later.map((x) => ({ id: x.id, label: `→ ${x.title || 'Untitled question'}` })), { id: 'end', label: '→ The thank you' }, ...endings.map((e) => ({ id: `end:${e.id}`, label: `→ ${e.title || 'Thank-you message'}` }))];
  const setJump = (is: string, v: string | null) => { const rest = (q.jumps ?? []).filter((j) => j.is !== is); set({ jumps: !v || v === 'next' ? (rest.length ? rest : undefined) : [...rest, { is, to: v }] }); };
  const source = questions.find((x) => x.id === q.showIf?.questionId);
  const choices = answersOf(q);
  const hasLogic = Boolean(q.showIf || q.jumps?.length || q.points || q.step);
  return (
    <ShowMore showLabel="Logic and points" hideLabel="Hide logic and points" defaultExpanded={hasLogic}>
      <div className="tf-qset__logic">
        <div className="tf-qset__group">
          <span className="tf-qset__row-label">Show only if</span>
          {earlier.length === 0 ? <span className="tf-qset__row-sub">Add an earlier choice question first.</span> : <div className="tf-qset__pair">
            <Select label="Question" isLabelHidden value={q.showIf?.questionId ?? 'always'} onChange={(v) => { if (!v || v === 'always') set({ showIf: undefined }); else set({ showIf: { questionId: v, is: answersOf(questions.find((x) => x.id === v))[0] ?? '' } }); }}
              items={[{ id: 'always', label: 'Always show' }, ...earlier.map((x) => ({ id: x.id, label: x.title || 'Untitled question' }))]} />
            {q.showIf && <Select label="Answer" isLabelHidden value={q.showIf.is} onChange={(v) => { if (v && q.showIf) set({ showIf: { ...q.showIf, is: v } }); }} items={answersOf(source).map((o) => ({ id: o, label: `is ${o}` }))} />}
          </div>}
          {q.showIf && <span className="tf-qset__row-sub">Hidden answers aren’t kept.</span>}
        </div>
        {at > 0 && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Start a new step here</span><span className="tf-qset__row-sub">One question at a time shows a step as one page.</span></span>
          <Switch isSelected={q.step !== undefined} onChange={(on) => set({ step: on ? {} : undefined })} aria-label="Start a new step here" />
        </div>}
        {q.step && <TextField label="Step title" aside="Optional" value={q.step.title ?? ''} onChange={(title) => set({ step: { title: title || undefined } })} placeholder="About your company" />}
        {choices.length > 0 && <div className="tf-qset__group">
          <span className="tf-qset__row-label">After this question</span>
          <ul className="tf-qset__jumps">
            {choices.map((o) => {
              const to = q.jumps?.find((j) => j.is === o)?.to ?? 'next';
              return <li key={o} className="tf-qset__jump"><span className="tf-qset__jump-if">If {o}</span>
                <Select label={`After ${o}, go to`} isLabelHidden value={destinations.some((d) => d.id === to) ? to : null} placeholder="Pick again" onChange={(v) => setJump(o, v)} items={destinations} /></li>;
            })}
            {q.jumps?.some((j) => j.is !== '*') && <li className="tf-qset__jump"><span className="tf-qset__jump-if">Otherwise</span>
              <Select label="Otherwise, go to" isLabelHidden value={q.jumps.find((j) => j.is === '*')?.to ?? 'next'} onChange={(v) => setJump('*', v)} items={destinations} /></li>}
          </ul>
        </div>}
        {choices.length > 0 && q.kind !== 'yesno' && <div className="tf-qset__group">
          <div className="tf-qset__row">
            <span className="tf-qset__row-text"><span className="tf-qset__row-label">Give points</span><span className="tf-qset__row-sub">Each answer adds its points; the total is the score.</span></span>
            <Switch isSelected={q.points !== undefined} onChange={(on) => set({ points: on ? Object.fromEntries(choices.map((o, n) => [o, n])) : undefined })} aria-label="Give points" />
          </div>
          {q.points && <ul className="tf-qset__jumps">{choices.map((o) => <li key={o} className="tf-qset__jump"><span className="tf-qset__jump-if">{o}</span>
            <NumberField aria-label={`Points for ${o}`} value={q.points?.[o] ?? 0} minValue={-100} maxValue={100} onChange={(n) => set({ points: { ...(q.points ?? {}), [o]: Number.isFinite(n) ? n : 0 } })} /></li>)}</ul>}
        </div>}
      </div>
    </ShowMore>
  );
}

/** The choices of a choice, dropdown or ranking question: a field each with remove, then "Add choice". A new one takes focus. */
function OptionsEditor({ options, onChange }: { readonly options: ReadonlyArray<string>; readonly onChange: (o: ReadonlyArray<string>) => void }) {
  const list = useRef<HTMLUListElement>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    list.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus();
    setAdded(false);
  }, [added]);
  return (
    <div className="tf-qset__options" role="group" aria-label="Choices">
      <span className="tf-qset__row-label">Choices</span>
      <ul ref={list} className="tf-qset__option-list">
        {options.map((o, n) => (
          <li key={n} className="tf-qset__option">
            <TextField aria-label={`Choice ${n + 1}`} value={o} onChange={(v) => onChange(options.map((x, m) => (m === n ? v : x)))} />
            <IconButton label={`Remove ${o || `choice ${n + 1}`}`} size="sm" onPress={() => onChange(options.filter((_, m) => m !== n))} isDisabled={options.length <= 1}><X size={14} strokeWidth={1.75} /></IconButton>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => { onChange([...options, `Option ${options.length + 1}`]); setAdded(true); }} className="tf-qset__add">Add choice</Button>
    </div>
  );
}

let seq = 0;
const newId = () => `q-${Date.now().toString(36)}-${(seq += 1)}`;
const blank = (kind: QuestionKind): FormQuestion => ({
  id: newId(), kind, title: kind === 'statement' ? 'A few words before the next part' : kind === 'consent' ? 'Before you send' : kind === 'scale' ? 'How likely are you to recommend us?' : '', required: kind === 'consent',
  ...(HAS_OPTIONS.has(kind) ? { options: ['Option 1', 'Option 2', 'Option 3'] } : {}),
  ...(kind === 'scale' ? { min: 0, max: 10 } : {}),
});

/** Props for QuestionBuilder. */
export interface QuestionBuilderProps {
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly onChange: (questions: ReadonlyArray<FormQuestion>) => void;
  readonly kinds?: ReadonlyArray<QuestionKind>;
  readonly title?: string;
  /** Record fields an answer can fill (Save answer to). */
  readonly saveTargets?: ReadonlyArray<SaveTarget>;
  /** Ready-made questions offered with the types; QUESTION_PRESETS by default, [] for none. */
  readonly presets?: ReadonlyArray<QuestionPreset>;
  /** The form's other thank-you messages: jumps can end on them. */
  readonly endings?: ReadonlyArray<JumpEnding>;
}

/** The builder's Questions tab: the list, and a question opens in its place with "All questions" to go back, so the page keeps one editor column beside its one preview. Delete collapses to "Deleted · Undo" for 6s. */
export function QuestionBuilder({ questions, onChange, kinds, title, saveTargets, presets = QUESTION_PRESETS, endings }: QuestionBuilderProps) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<{ readonly question: FormQuestion; readonly index: number }>();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const insert = (q: FormQuestion, at: number) => {
    onChange([...questions.slice(0, at), q, ...questions.slice(at)]);
    setFresh(new Set([q.id]));
    setSelected(q.id);
  };
  const remove = (id: string) => {
    const index = questions.findIndex((q) => q.id === id);
    const question = questions[index];
    if (!question) return;
    onChange(questions.filter((q) => q.id !== id));
    if (selected === id) setSelected(undefined);
    setUndo({ question, index });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndo(undefined), 6000);
  };
  const notice = (
    <div className="tf-qlist__undo" data-open={undo ? true : undefined} inert={!undo}>
      <div className="tf-qlist__undo-clip">
        <p className="tf-qlist__undo-row" role="status">
          <span>“{undo?.question.title || 'Untitled question'}” deleted</span>
          <Button size="sm" variant="ghost" onPress={() => { if (undo) { insert(undo.question, undo.index); setUndo(undefined); } }}>Undo</Button>
        </p>
      </div>
    </div>
  );
  const open = questions.find((q) => q.id === selected);
  const at = open ? questions.indexOf(open) : -1;
  return (
    <div className="tf-qbuilder">
      {open ? (
        <div className="tf-qbuilder__open" key={open.id}>
          <div className="tf-qbuilder__nav">
            <Button size="sm" variant="ghost" icon={<ArrowLeft {...i16} />} onPress={() => setSelected(undefined)}>All questions</Button>
            <span className="tf-qbuilder__pos tf-num">{at + 1} of {questions.length}</span>
          </div>
          <QuestionSettings question={open} questions={questions} saveTargets={saveTargets} endings={endings} onChange={(next) => onChange(questions.map((q) => (q.id === next.id ? next : q)))} />
        </div>
      ) : (
        <QuestionList
          questions={questions}
          selectedId={selected}
          onSelect={setSelected}
          onReorder={onChange}
          onDuplicate={(id) => { const n = questions.findIndex((q) => q.id === id); const q = questions[n]; if (q) insert({ ...q, id: newId(), title: q.title ? `${q.title} (copy)` : '' }, n + 1); }}
          onDelete={remove}
          onAdd={(kind) => insert(blank(kind), questions.length)}
          freshIds={fresh}
          notice={notice}
          kinds={kinds}
          title={title}
          presets={presets}
          saveTargets={saveTargets}
          endings={endings}
          onPreset={(pre) => insert({ ...pre.question, id: newId() }, questions.length)}
        />
      )}
    </div>
  );
}
