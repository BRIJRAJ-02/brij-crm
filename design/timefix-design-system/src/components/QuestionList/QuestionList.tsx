import {
  Button as AriaButton, DialogTrigger, DropIndicator, GridList, GridListItem, ListBox, ListBoxItem, useDragAndDrop, type Key, type Selection,
} from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyPlus, Ellipsis, GripVertical, MousePointerClick, Plus, Trash, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Select } from '../Select/Select.tsx';
import { Count } from '../Tag/Tag.tsx';
import { QUESTION_KINDS, type FormQuestion, type QuestionKind } from '../HostedForm/answers.ts';
import { DropIn } from '../Motion/Motion.tsx';
import './QuestionList.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
const HAS_OPTIONS: ReadonlySet<QuestionKind> = new Set(['choice', 'multi', 'dropdown', 'ranking']);
const HAS_PLACEHOLDER: ReadonlySet<QuestionKind> = new Set(['short', 'long', 'email']);

/** The type's icon on a grey tile, the way every question and type option starts. */
export function QuestionTypeTile({ kind, size = 'md' }: { readonly kind: QuestionKind; readonly size?: 'sm' | 'md' }) {
  const Icon = QUESTION_KINDS[kind].icon;
  return <span className={cx('tf-qtile', `tf-qtile--${size}`)} aria-hidden="true"><Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} /></span>;
}

/** The grey line under a question's title: its type and, for choices, how many. */
export function questionSummary(q: FormQuestion): string {
  const parts: string[] = [QUESTION_KINDS[q.kind].label];
  if (HAS_OPTIONS.has(q.kind)) { const n = q.options?.length ?? 0; parts.push(n === 0 ? 'No choices yet' : n === 1 ? '1 choice' : `${n} choices`); }
  return parts.join(' · ');
}

/** "+ Add question": a grid of every answer type in the shared Popover (05). The plus turns while it is open. */
export function QuestionTypePicker({ onPick, label = 'Add question', only }: { readonly onPick: (kind: QuestionKind) => void; readonly label?: string; /** Offer just these types (a booking page needs a few, a form all). Six or fewer list in one column. */ readonly only?: ReadonlyArray<QuestionKind> }) {
  const [open, setOpen] = useState(false);
  const kinds = (only ?? (Object.keys(QUESTION_KINDS) as QuestionKind[])).map((k) => ({ id: k }));
  const short = kinds.length <= 6;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button variant="primary" size="sm" icon={<Plus size={14} strokeWidth={2} className="tf-qlist__plus" aria-hidden="true" />} className="tf-qlist__add">{label}</Button>
      <Popover label="Question types" placement="bottom end" offset={6} className={short ? undefined : 'tf-qtypes__pop'}>
        {!short && <p className="tf-qtypes__head">Pick a type</p>}
        <ListBox aria-label="Question types" layout={short ? 'stack' : 'grid'} items={kinds} className={short ? 'tf-qtypes tf-qtypes--list' : 'tf-qtypes'} autoFocus="first"
          onAction={(k: Key) => { onPick(String(k) as QuestionKind); setOpen(false); }}>
          {(it) => {
            const info = QUESTION_KINDS[it.id];
            return (
              <ListBoxItem id={it.id} textValue={info.label} className="tf-qtypes__item">
                <QuestionTypeTile kind={it.id} />
                <span className="tf-qtypes__text"><span className="tf-qtypes__label">{info.label}</span><span className="tf-qtypes__hint">{info.hint}</span></span>
              </ListBoxItem>
            );
          }}
        </ListBox>
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
  readonly onRequiredChange: (id: string, required: boolean) => void;
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
}

/**
 * A form's questions as cards: grip, type tile, title over its type, a Required switch and a ⋯ menu. Cards reorder by the grip
 * (pointer, or Enter then arrows), the dragged card lifts and the slot opens dashed. Pressing a card opens it in the side panel.
 */
export function QuestionList({ questions, selectedId, onSelect, onReorder, onRequiredChange, onDuplicate, onDelete, onAdd, freshIds, notice, kinds, title = 'Questions' }: QuestionListProps) {
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
        <h3 className="tf-qlist__title">{title} <Count>{questions.length}</Count></h3>
        <QuestionTypePicker onPick={onAdd} only={kinds} />
      </header>
      {notice}
      {questions.length === 0 ? (
        <EmptyState size="sm" icon={<Plus size={20} strokeWidth={1.75} />} title="No questions yet" description="Add the first one. Visitors see them in this order." />
      ) : (
        <GridList aria-label="Questions, drag to reorder" items={questions} dragAndDropHooks={dragAndDropHooks} selectionMode="single" selectionBehavior="replace"
          selectedKeys={selectedId ? [selectedId] : []} onSelectionChange={select} className="tf-qlist__list">
          {(q) => {
            const n = questions.indexOf(q);
            return (
              <GridListItem id={q.id} textValue={q.title || 'Untitled question'} className="tf-qlist__row">
                <DropIn animate={freshIds?.has(q.id) ?? false}>
                  <div className="tf-qlist__card">
                    <AriaButton slot="drag" className="tf-qlist__grip" aria-label={`Move ${q.title || 'question'}`}><GripVertical {...i16} /></AriaButton>
                    <QuestionTypeTile kind={q.kind} />
                    <span className="tf-qlist__text">
                      <span className="tf-qlist__q"><span className="tf-qlist__n tf-num">{n + 1}.</span> {q.title || <span className="tf-qlist__untitled">Untitled question</span>}</span>
                      <span className="tf-qlist__sub">{questionSummary(q)}</span>
                    </span>
                    <span className="tf-qlist__end">
                      <Switch isSelected={q.required ?? false} onChange={(v) => onRequiredChange(q.id, v)} aria-label={`Required: ${q.title || 'question'}`}>Required</Switch>
                      <MenuTrigger>
                        <IconButton label={`More for ${q.title || 'question'}`} size="sm"><Ellipsis {...i16} /></IconButton>
                        <Menu placement="bottom end" onAction={(k) => (k === 'delete' ? onDelete(q.id) : onDuplicate(q.id))}>
                          <MenuItem id="duplicate" icon={<CopyPlus {...i16} />}>Duplicate</MenuItem>
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
}

/** The side panel for the selected question: type, words, required, choices. Its content swaps softly when another question opens (34). */
export function QuestionSettings({ question: q, onChange, onClose }: QuestionSettingsProps) {
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
        <div className="tf-qset__row">
          <span className="tf-qset__row-text"><span className="tf-qset__row-label">Required</span><span className="tf-qset__row-sub">Visitors can't go on without an answer.</span></span>
          <Switch isSelected={q.required ?? false} onChange={(required) => set({ required })} aria-label="Required" />
        </div>
      </div>
    </aside>
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
  id: newId(), kind, title: '', required: false,
  ...(HAS_OPTIONS.has(kind) ? { options: ['Option 1', 'Option 2', 'Option 3'] } : {}),
});

/** Props for QuestionBuilder. */
export interface QuestionBuilderProps {
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly onChange: (questions: ReadonlyArray<FormQuestion>) => void;
  readonly kinds?: ReadonlyArray<QuestionKind>;
  readonly title?: string;
}

/** The builder's Questions tab: the list beside the selected question's settings. Delete collapses to "Deleted · Undo" for 6s. */
export function QuestionBuilder({ questions, onChange, kinds, title }: QuestionBuilderProps) {
  const [selected, setSelected] = useState<string | undefined>(questions[0]?.id);
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
  return (
    <div className="tf-qbuilder">
      <QuestionList
        questions={questions}
        selectedId={selected}
        onSelect={setSelected}
        onReorder={onChange}
        onRequiredChange={(id, required) => onChange(questions.map((q) => (q.id === id ? { ...q, required } : q)))}
        onDuplicate={(id) => { const n = questions.findIndex((q) => q.id === id); const q = questions[n]; if (q) insert({ ...q, id: newId(), title: q.title ? `${q.title} (copy)` : '' }, n + 1); }}
        onDelete={remove}
        onAdd={(kind) => insert(blank(kind), questions.length)}
        freshIds={fresh}
        notice={notice}
        kinds={kinds}
        title={title}
      />
      <QuestionSettings question={questions.find((q) => q.id === selected)} onChange={(next) => onChange(questions.map((q) => (q.id === next.id ? next : q)))} onClose={() => setSelected(undefined)} />
    </div>
  );
}
