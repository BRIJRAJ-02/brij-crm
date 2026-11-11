import {
  Button as AriaButton, DialogTrigger, DropIndicator, GridList, GridListItem, Header, ListBox, ListBoxItem, ListBoxSection, useDragAndDrop, type Key, type Selection,
} from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CopyPlus, Ellipsis, GripVertical, MousePointerClick, Plus, Sparkles, Trash, X } from 'lucide-react';
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
import { Count } from '../Tag/Tag.tsx';
import { QUESTION_GROUPS, QUESTION_KINDS, type FormQuestion, type QuestionKind } from '../HostedForm/answers.ts';
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
  if (q.showIf) parts.push(`Shown if ${all.find((x) => x.id === q.showIf?.questionId)?.title || 'an earlier answer'} is ${q.showIf.is}`);
  if (q.jumps?.length) parts.push(q.jumps.length === 1 ? '1 jump' : `${q.jumps.length} jumps`);
  if (q.points && Object.keys(q.points).length) parts.push('Points');
  if (q.insights) parts.push('In Insights');
  if (q.saveTo) parts.push(`Saves to ${targets.find((t) => t.id === q.saveTo)?.label ?? q.saveTo}`);
  return parts.join(' · ');
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

/** "+ Add question": a grid of every answer type in the shared Popover (05). The plus turns while it is open. */
export function QuestionTypePicker({ onPick, label = 'Add question', only, presets = [], onPreset }: { readonly onPick: (kind: QuestionKind) => void; readonly label?: string; /** Offer just these types (a booking page needs a few, a form all). Six or fewer list in one column, without groups. */ readonly only?: ReadonlyArray<QuestionKind>; /** Ready-made questions, in their own group. */ readonly presets?: ReadonlyArray<QuestionPreset>; readonly onPreset?: (p: QuestionPreset) => void }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const allowed = new Set(only ?? (Object.keys(QUESTION_KINDS) as QuestionKind[]));
  const short = allowed.size <= 6;
  const q = find.trim().toLowerCase();
  const fits = (k: QuestionKind) => allowed.has(k) && (!q || `${QUESTION_KINDS[k].label} ${QUESTION_KINDS[k].hint}`.toLowerCase().includes(q));
  const groups = QUESTION_GROUPS.map((g) => ({ id: g.title, title: g.title, items: g.kinds.filter(fits).map((k) => ({ id: k })) })).filter((g) => g.items.length > 0);
  const shownPresets = presets.filter((x) => (only === undefined || only.includes(x.question.kind)) && (!q || `${x.label} ${x.hint}`.toLowerCase().includes(q)));
  const pick = (k: Key) => { const key = String(k); const pre = key.startsWith('preset:') ? presets.find((x) => `preset:${x.id}` === key) : undefined; if (pre) onPreset?.(pre); else onPick(key as QuestionKind); setOpen(false); setFind(''); };
  const presetItem = (x: QuestionPreset) => (
    <ListBoxItem key={`preset:${x.id}`} id={`preset:${x.id}`} textValue={x.label} className="tf-qtypes__item">
      <span className="tf-qtile tf-qtile--md" aria-hidden="true"><Sparkles size={16} strokeWidth={1.75} /></span>
      <span className="tf-qtypes__text"><span className="tf-qtypes__label">{x.label}</span><span className="tf-qtypes__hint">{x.hint}</span></span>
    </ListBoxItem>
  );
  const item = (id: QuestionKind) => {
    const info = QUESTION_KINDS[id];
    return (
      <ListBoxItem key={id} id={id} textValue={info.label} className="tf-qtypes__item">
        <QuestionTypeTile kind={id} />
        <span className="tf-qtypes__text"><span className="tf-qtypes__label">{info.label}</span><span className="tf-qtypes__hint">{info.hint}</span></span>
      </ListBoxItem>
    );
  };
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (!o) setFind(''); }}>
      <Button variant="primary" size="sm" icon={<Plus size={14} strokeWidth={2} aria-hidden="true" />} className="tf-qlist__add">{label}</Button>
      <Popover label="Question types" placement="bottom end" offset={6} className={short ? undefined : 'tf-qtypes__pop'}>
        {short ? (
          <ListBox aria-label="Question types" className="tf-qtypes tf-qtypes--list" autoFocus="first" onAction={pick}>
            {[...allowed].map((k) => item(k))}
            {shownPresets.length > 0 && onPreset && <ListBoxSection id="ready" className="tf-qtypes__sec"><Header className="tf-qtypes__head">Ready-made</Header>{shownPresets.map(presetItem)}</ListBoxSection>}
          </ListBox>
        ) : (
          <div className="tf-qtypes__wrap">
            <SearchField label="Find a question type" placeholder="Find a type: date, scale, file…" size="sm" value={find} onChange={setFind} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { const first = groups[0]?.items[0]; if (first) pick(first.id); } }} />
            {groups.length === 0 && shownPresets.length === 0 ? <p className="tf-qtypes__none">No type matches “{find}”.</p> : (
              <ListBox aria-label="Question types" className="tf-qtypes tf-qtypes--groups" onAction={pick}>
                {shownPresets.length > 0 && onPreset && <ListBoxSection id="ready" className="tf-qtypes__sec"><Header className="tf-qtypes__head">Ready-made</Header>{shownPresets.map(presetItem)}</ListBoxSection>}
                {groups.map((g) => (
                  <ListBoxSection key={g.id} id={g.id} className="tf-qtypes__sec">
                    <Header className="tf-qtypes__head">{g.title}</Header>
                    {g.items.map((it) => item(it.id))}
                  </ListBoxSection>
                ))}
              </ListBox>
            )}
          </div>
        )}
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
}

/**
 * A form's questions as cards: grip, type tile, title over its type, a Required switch and a ⋯ menu. Cards reorder by the grip
 * (pointer, or Enter then arrows), the dragged card lifts and the slot opens dashed. Pressing a card opens it in the side panel.
 */
export function QuestionList({ questions, selectedId, onSelect, onReorder, onRequiredChange, onDuplicate, onDelete, onAdd, freshIds, notice, kinds, title = 'Questions', presets, onPreset, saveTargets }: QuestionListProps) {
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
        <QuestionTypePicker onPick={onAdd} only={kinds} presets={presets} onPreset={onPreset} />
      </header>
      {notice}
      {questions.length === 0 ? (
        <EmptyState size="sm" icon={<Plus size={20} strokeWidth={1.75} />} title="No questions yet" description="Add the first one. Visitors see them in this order." />
      ) : (
        <GridList aria-label="Questions, drag to reorder" items={questions} dragAndDropHooks={dragAndDropHooks} selectionMode="single" selectionBehavior="replace"
          selectedKeys={selectedId ? [selectedId] : []} onSelectionChange={select} className="tf-qlist__list">
          {(q) => {
            const n = questions.indexOf(q);
            // Steps: the first question opens step 1 when any later one starts a step.
            const stepNo = questions.slice(0, n + 1).filter((x, m) => m === 0 || x.step).length;
            const showsStep = questions.some((x, m) => m > 0 && x.step) && (n === 0 || q.step !== undefined);
            return (
              <GridListItem id={q.id} textValue={q.title || 'Untitled question'} className="tf-qlist__row">
                <DropIn animate={freshIds?.has(q.id) ?? false}>
                  {showsStep && <span className="tf-qlist__step tf-num">Step {stepNo}{q.step?.title ? ` · ${q.step.title}` : ''}</span>}
                  <div className="tf-qlist__card">
                    <AriaButton slot="drag" className="tf-qlist__grip" aria-label={`Move ${q.title || 'question'}`}><GripVertical {...i16} /></AriaButton>
                    <QuestionTypeTile kind={q.kind} />
                    <span className="tf-qlist__text">
                      <span className="tf-qlist__q"><span className="tf-qlist__n tf-num">{n + 1}.</span> {q.title || <span className="tf-qlist__untitled">Untitled question</span>}</span>
                      <span className="tf-qlist__sub">{questionSummary(q, questions, saveTargets)}</span>
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
}

/** The side panel for the selected question: type, words, required, choices. Its content swaps softly when another question opens (34). */
export function QuestionSettings({ question: q, onChange, onClose, questions = [], saveTargets }: QuestionSettingsProps) {
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
        {HAS_OPTIONS.has(q.kind) && <OptionsEditor options={options} onChange={(next) => set({ options: next })} />}
        {(q.kind === 'number' || q.kind === 'scale') && <div className="tf-qset__pair">
          <TextField label="Lowest" inputMode="numeric" value={q.min === undefined ? (q.kind === 'scale' ? '0' : '') : String(q.min)} onChange={(v) => set({ min: v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} />
          <TextField label="Highest" inputMode="numeric" value={q.max === undefined ? (q.kind === 'scale' ? '10' : '') : String(q.max)} onChange={(v) => set({ max: v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v) })} />
        </div>}
        {q.kind === 'scale' && <div className="tf-qset__pair">
          <TextField label="Word under the lowest" value={q.low ?? ''} placeholder="Not likely" onChange={(low) => set({ low: low || undefined })} />
          <TextField label="Word under the highest" value={q.high ?? ''} placeholder="Very likely" onChange={(high) => set({ high: high || undefined })} />
        </div>}
        {q.kind === 'consent' && <SegmentedControl aria-label="Consent for" selectedKey={q.consentKind ?? 'terms'} onSelectionChange={(k) => set({ consentKind: k === 'marketing' ? 'marketing' : 'terms', required: k !== 'marketing' })} items={[{ id: 'terms', label: 'Terms (must tick)' }, { id: 'marketing', label: 'Marketing (optional)' }]} />}
        {(q.kind === 'checkbox' || q.kind === 'consent') && <TextField label="Words beside the box" value={q.defaultValue ?? ''} placeholder={q.kind === 'consent' ? (q.consentKind === 'marketing' ? 'Yes, email me news and offers' : 'I agree to the terms') : 'Yes'} onChange={(v) => set({ defaultValue: v || undefined })} />}
        {q.kind === 'hidden' && <TextField label="Value when the link has none" value={q.defaultValue ?? ''} placeholder="website" description={`The link can set it: ?${(q.title || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '_')}=newsletter`} onChange={(v) => set({ defaultValue: v || undefined })} />}
        {q.kind !== 'statement' && q.kind !== 'hidden' && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Required</span><span className="tf-qset__row-sub">Visitors can't go on without an answer.</span></span>
          <Switch isSelected={q.required ?? false} onChange={(required) => set({ required })} aria-label="Required" />
        </div>}
        {saveTargets && q.kind !== 'statement' && <Select label="Save answer to" value={q.saveTo ?? 'none'} onChange={(v) => set({ saveTo: !v || v === 'none' ? undefined : v })} description="The record field this answer fills in."
          items={[{ id: 'none', label: 'Kept with the submission only' }, ...saveTargets.map((t) => ({ id: t.id, label: t.label }))]} />}
        {(HAS_OPTIONS.has(q.kind) || q.kind === 'yesno') && q.kind !== 'ranking' && (q.kind === 'choice' || q.kind === 'dropdown' || q.kind === 'multi') && <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Use as “How did you hear about us” in Insights</span><span className="tf-qset__row-sub">Insights counts where people came from by this answer.</span></span>
          <Switch isSelected={q.insights ?? false} onChange={(insights) => set({ insights: insights || undefined })} aria-label="Use in Insights" />
        </div>}
        <LogicSettings q={q} questions={questions} set={set} />
      </div>
    </aside>
  );
}

/** Show only if, steps, jumps and points, folded under More options so a plain question stays calm. */
function LogicSettings({ q, questions, set }: { readonly q: FormQuestion; readonly questions: ReadonlyArray<FormQuestion>; readonly set: (patch: Partial<FormQuestion>) => void }) {
  const at = questions.findIndex((x) => x.id === q.id);
  const earlier = questions.slice(0, Math.max(0, at)).filter((x) => HAS_OPTIONS.has(x.kind) || x.kind === 'yesno');
  const later = questions.slice(at + 1);
  const answersOf = (x: FormQuestion | undefined) => (x?.kind === 'yesno' ? ['Yes', 'No'] : x?.options ?? []);
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
                <Select label={`After ${o}, go to`} isLabelHidden value={to} onChange={(v) => { const rest = (q.jumps ?? []).filter((j) => j.is !== o); set({ jumps: !v || v === 'next' ? (rest.length ? rest : undefined) : [...rest, { is: o, to: v }] }); }}
                  items={[{ id: 'next', label: 'Next question' }, ...later.map((x) => ({ id: x.id, label: `→ ${x.title || 'Untitled question'}` })), { id: 'end', label: '→ After they send' }]} /></li>;
            })}
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
}

/** The builder's Questions tab: the list, and a question opens in its place with "All questions" to go back, so the page keeps one editor column beside its one preview. Delete collapses to "Deleted · Undo" for 6s. */
export function QuestionBuilder({ questions, onChange, kinds, title, saveTargets, presets = QUESTION_PRESETS }: QuestionBuilderProps) {
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
          <QuestionSettings question={open} questions={questions} saveTargets={saveTargets} onChange={(next) => onChange(questions.map((q) => (q.id === next.id ? next : q)))} />
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
          onPreset={(pre) => insert({ ...pre.question, id: newId() }, questions.length)}
        />
      )}
    </div>
  );
}
