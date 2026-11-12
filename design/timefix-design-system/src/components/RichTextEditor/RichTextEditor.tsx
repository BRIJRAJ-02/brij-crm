import { Button as AriaButton, DialogTrigger, ToggleButton, Toolbar } from 'react-aria-components';
import {
  EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState,
  type Editor, type JSONContent, type ReactNodeViewProps,
} from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Extension, Node, mergeAttributes, type Range } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extensions';
import { Selection, type EditorState } from '@tiptap/pm/state';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import {
  Bold, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListOrdered, ListTodo, Lock, Minus, Pilcrow, TextQuote, type LucideIcon,
} from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Avatar, PersonLine } from '../Avatar/Avatar.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Mention } from '../RecordChip/RecordChip.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import './RichTextEditor.css';

/** A workspace member who can be @mentioned. */
export interface MentionPerson { readonly id: string; readonly name: string; readonly email?: string; readonly role?: string; readonly src?: string }

/** One block of the slash menu. */
export interface SlashBlock {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** The markdown that makes it, shown at the row's end. */
  readonly markdown: string;
  /** Extra words it is found by ("h1", "todo"). */
  readonly keywords: string;
  readonly run: (editor: Editor, range: Range) => void;
}

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
/** The blocks `/` offers, as Notion's command menu: each with the markdown that makes it. */
export const SLASH_BLOCKS: ReadonlyArray<SlashBlock> = [
  { id: 'text', label: 'Text', icon: Pilcrow, markdown: '', keywords: 'paragraph plain', run: (e, r) => { chain(e, r).setParagraph().run(); } },
  { id: 'h1', label: 'Heading 1', icon: Heading1, markdown: '#', keywords: 'h1 title', run: (e, r) => { chain(e, r).setHeading({ level: 1 }).run(); } },
  { id: 'h2', label: 'Heading 2', icon: Heading2, markdown: '##', keywords: 'h2 section', run: (e, r) => { chain(e, r).setHeading({ level: 2 }).run(); } },
  { id: 'h3', label: 'Heading 3', icon: Heading3, markdown: '###', keywords: 'h3 subsection', run: (e, r) => { chain(e, r).setHeading({ level: 3 }).run(); } },
  { id: 'bullet', label: 'Bulleted list', icon: List, markdown: '-', keywords: 'ul unordered list', run: (e, r) => { chain(e, r).toggleBulletList().run(); } },
  { id: 'ordered', label: 'Numbered list', icon: ListOrdered, markdown: '1.', keywords: 'ol ordered list', run: (e, r) => { chain(e, r).toggleOrderedList().run(); } },
  { id: 'task', label: 'To-do list', icon: ListTodo, markdown: '[]', keywords: 'todo task check', run: (e, r) => { chain(e, r).toggleTaskList().run(); } },
  { id: 'quote', label: 'Quote', icon: TextQuote, markdown: '>', keywords: 'blockquote', run: (e, r) => { chain(e, r).setBlockquote().run(); } },
  { id: 'divider', label: 'Divider', icon: Minus, markdown: '---', keywords: 'hr rule line', run: (e, r) => { chain(e, r).setHorizontalRule().run(); } },
];

/* ---------- Nodes ---------- */

const stopInside = (selector: string) => ({ event }: { readonly event: Event }) => event.target instanceof Element && event.target.closest(selector) !== null;

/** A mention drawn as the shared Mention chip; pressing it opens the person in a popover. */
function MentionView({ node, extension }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const label = String(node.attrs.label ?? '');
  const people = (extension.options as { getPeople: () => ReadonlyArray<MentionPerson> }).getPeople();
  const person = people.find((p) => p.id === id);
  return (
    <NodeViewWrapper as="span" className="tf-rte__mention">
      <DialogTrigger>
        <AriaButton className="tf-rte__mention-btn" aria-label={`${label}, show details`}><Mention name={label} /></AriaButton>
        <Popover label={label} placement="bottom start" offset={6}>
          <div className="tf-rte__person">
            <PersonLine name={label} sub={person?.role ?? 'Member'} src={person?.src} size={36} />
            {person?.email && <a className="tf-rte__person-mail" href={`mailto:${person.email}`}>{person.email}</a>}
          </div>
        </Popover>
      </DialogTrigger>
    </NodeViewWrapper>
  );
}

/** The `mention` inline atom `{ id, label }`. Its list comes from the editor's `@` menu, not from here. */
const MentionNode = Node.create<{ getPeople: () => ReadonlyArray<MentionPerson> }>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addOptions() { return { getPeople: () => [] }; },
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      label: { default: null, parseHTML: (el) => el.getAttribute('data-label'), renderHTML: (a) => ({ 'data-label': a.label }) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-mention]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes({ 'data-mention': '' }, HTMLAttributes), `@${String(node.attrs.label)}`]; },
  renderText({ node }) { return `@${String(node.attrs.label)}`; },
  addNodeView() { return ReactNodeViewRenderer(MentionView, { as: 'span', stopEvent: stopInside('button') }); },
});

/** A to-do drawn with TaskList's round Checkbox; a ticked one greys and strikes through. */
function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const checked = node.attrs.checked === true;
  return (
    <NodeViewWrapper className="tf-rte__task" data-checked={checked || undefined}>
      <span className="tf-rte__task-check" contentEditable={false}>
        <Checkbox round isSelected={checked} isReadOnly={!editor.isEditable} aria-label={checked ? 'Done, mark open' : 'Mark done'} onChange={(v) => updateAttributes({ checked: v })} />
      </span>
      <NodeViewContent className="tf-rte__task-text" />
    </NodeViewWrapper>
  );
}

const TaskItemNode = TaskItem.extend({
  addNodeView() { return ReactNodeViewRenderer(TaskItemView, { as: 'li', stopEvent: stopInside('label, input') }); },
}).configure({ nested: true });

/** The arrow up on the first line, or Backspace in an empty first line, hands focus back to what sits above (a note's title). */
function exitTop(onExitTop: RefObject<(() => void) | undefined>) {
  return Extension.create({
    name: 'exitTop',
    addKeyboardShortcuts() {
      const atTop = () => {
        const { state, view } = this.editor;
        const first = Selection.atStart(state.doc);
        return state.selection.empty && state.selection.$from.sameParent(first.$from) && view.endOfTextblock('up');
      };
      const go = () => { if (!onExitTop.current) return false; onExitTop.current(); return true; };
      return {
        ArrowUp: () => atTop() && go(),
        Backspace: () => atTop() && this.editor.state.selection.$from.parent.content.size === 0 && go(),
      };
    },
  });
}

/* ---------- The @ and / menus ---------- */

interface Trigger { readonly kind: 'mention' | 'slash'; readonly query: string; readonly from: number; readonly to: number }

/** "@que" or "/que" right before the caret, at a line's start or after a space, never in code. */
function findTrigger(state: EditorState): Trigger | undefined {
  const { selection } = state;
  if (!selection.empty) return undefined;
  const $from = selection.$from;
  if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.name === 'code')) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const m = /(?:^|\s)([@/])([^\s@/]{0,24})$/.exec(before);
  if (!m || m[1] === undefined || m[2] === undefined) return undefined;
  const length = m[1].length + m[2].length;
  return { kind: m[1] === '@' ? 'mention' : 'slash', query: m[2], from: $from.pos - length, to: $from.pos };
}

/** Props for RichTextEditor. */
export interface RichTextEditorProps {
  /** The text's accessible name ("Note", "Comment"); not drawn. */
  readonly label: string;
  /** HTML or Tiptap JSON to start from. To show another document, remount with a new `key`. */
  readonly defaultContent?: string | JSONContent;
  /** The document as Tiptap JSON, 300ms after typing pauses and when the editor loses focus. Never HTML. */
  readonly onChange?: (doc: JSONContent) => void;
  readonly placeholder?: string;
  /** Members for `@`. Without them `@` stays plain text. */
  readonly people?: ReadonlyArray<MentionPerson>;
  readonly isReadOnly?: boolean;
  /** Shown under read-only text ("Only Priya can edit this note"). */
  readonly readOnlyReason?: string;
  readonly autoFocus?: boolean;
  /** Called when the caret leaves the top of the text; NoteEditor moves focus to its title. */
  readonly onExitTop?: () => void;
  /** Receives the editor once it exists, for a holder that moves focus into it. */
  readonly editorRef?: RefObject<Editor | null>;
  readonly className?: string;
}

/**
 * Writing as a page, as Notion's: no box around the text. Select text for the floating format bar, type `/` for blocks
 * and `@` for people (shared Mention chips), tick to-dos with TaskList's checks. Saves Tiptap JSON, never HTML.
 */
export function RichTextEditor({ label, defaultContent, onChange, placeholder = 'Write something, press / for blocks or @ to mention someone', people = [], isReadOnly = false, readOnlyReason, autoFocus = false, onExitTop, editorRef, className }: RichTextEditorProps) {
  const listId = useId();
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const exitRef = useRef(onExitTop);
  exitRef.current = onExitTop;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const timer = useRef<number | undefined>(undefined);
  const [trigger, setTrigger] = useState<Trigger & { readonly x: number; readonly y: number }>();
  const [active, setActive] = useState(0);
  const dismissed = useRef<number | undefined>(undefined);
  const anchor = useRef<HTMLSpanElement>(null);
  const lastKey = useRef('');

  // Null only while rendered on a server (Tiptap then waits for the client); every use below allows for it.
  const editor: Editor | null = useEditor({
    editable: !isReadOnly,
    autofocus: autoFocus && !isReadOnly ? 'end' : false,
    injectCSS: false,
    content: defaultContent ?? '',
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: isReadOnly, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
      Highlight,
      TaskList,
      TaskItemNode,
      MentionNode.configure({ getPeople: () => peopleRef.current }),
      Placeholder.configure({
        placeholder: ({ node, editor: ed }) => (node.type.name === 'heading' ? `Heading ${String(node.attrs.level)}` : ed.isEmpty ? placeholder : 'Press / for blocks'),
      }),
      exitTop(exitRef),
    ],
    editorProps: {
      attributes: { class: 'tf-rte__doc', 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' },
      handleKeyDown: (_view, event) => keyRef.current(event),
    },
    onUpdate: ({ editor: ed }) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => changeRef.current?.(ed.getJSON()), 300);
    },
    onBlur: ({ editor: ed }) => {
      if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; changeRef.current?.(ed.getJSON()); }
      setTrigger(undefined);
    },
  });

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Watch the text before the caret for "@…" and "/…".
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      const t = editor.isEditable && editor.isFocused ? findTrigger(editor.state) : undefined;
      if (!t) dismissed.current = undefined;
      if (!t || (t.kind === 'mention' && peopleRef.current.length === 0) || dismissed.current === t.from) { lastKey.current = ''; setTrigger(undefined); return; }
      dismissed.current = undefined;
      const at = editor.view.coordsAtPos(t.from);
      const key = `${t.kind}${t.from}`;
      if (lastKey.current !== key) { lastKey.current = key; setActive(0); }
      setTrigger({ ...t, x: at.left, y: at.bottom });
    };
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);

  const q = trigger?.query.toLowerCase() ?? '';
  const mentionItems = trigger?.kind === 'mention' ? peopleRef.current.filter((p) => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().startsWith(q)).slice(0, 6) : [];
  const slashItems = trigger?.kind === 'slash' ? SLASH_BLOCKS.filter((b) => `${b.label} ${b.keywords}`.toLowerCase().includes(q)) : [];
  const count = trigger?.kind === 'mention' ? mentionItems.length : slashItems.length;
  const isOpen = trigger !== undefined && (count > 0 || trigger.kind === 'slash');

  const pick = (n: number) => {
    if (!trigger || !editor) return;
    const range = { from: trigger.from, to: trigger.to };
    if (trigger.kind === 'mention') {
      const p = mentionItems[n];
      if (p) editor.chain().focus().insertContentAt(range, [{ type: 'mention', attrs: { id: p.id, label: p.name } }, { type: 'text', text: ' ' }]).run();
    } else {
      slashItems[n]?.run(editor, range);
    }
    setTrigger(undefined);
  };
  keyRef.current = (e) => {
    if (!isOpen || !trigger) return false;
    if (e.key === 'Escape') { dismissed.current = trigger.from; setTrigger(undefined); return true; }
    if (count === 0) return false;
    if (e.key === 'ArrowDown') { setActive((a) => (a + 1) % count); return true; }
    if (e.key === 'ArrowUp') { setActive((a) => (a - 1 + count) % count); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { pick(Math.min(active, count - 1)); return true; }
    return false;
  };
  const activeId = isOpen && count > 0 ? `${listId}-${Math.min(active, count - 1)}` : undefined;
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (activeId) { dom.setAttribute('aria-activedescendant', activeId); dom.setAttribute('aria-controls', listId); dom.setAttribute('aria-expanded', 'true'); }
    else { dom.removeAttribute('aria-activedescendant'); dom.removeAttribute('aria-controls'); dom.removeAttribute('aria-expanded'); }
  }, [editor, activeId, listId]);

  const row = (n: number, children: ReactNode) => (
    <div key={n} id={`${listId}-${n}`} role="option" aria-selected={n === Math.min(active, count - 1)} className="tf-rte__option"
      onMouseDown={(e: MouseEvent) => e.preventDefault()} onMouseEnter={() => setActive(n)} onClick={() => pick(n)}>
      {children}
    </div>
  );

  return (
    <div className={cx('tf-rte', isReadOnly && 'tf-rte--readonly', className)}>
      <EditorContent editor={editor} className="tf-rte__content" />
      {!isReadOnly && editor && <FormatToolbar editor={editor} />}
      <span ref={anchor} className="tf-rte__anchor" style={trigger ? { left: trigger.x, top: trigger.y } : undefined} aria-hidden="true" />
      <Popover triggerRef={anchor} isOpen={isOpen} isNonModal onOpenChange={(open) => { if (!open) setTrigger(undefined); }} placement="bottom start" offset={6} width="menu" className="tf-rte__pop">
        <div id={listId} role="listbox" aria-label={trigger?.kind === 'mention' ? 'People' : 'Blocks'} className="tf-rte__list">
          {trigger?.kind === 'mention' && mentionItems.map((p, n) => row(n, (
            <>
              <Avatar name={p.name} src={p.src} size={20} />
              <span className="tf-rte__option-label">{p.name}</span>
              {p.email && <span className="tf-rte__option-end">{p.email}</span>}
            </>
          )))}
          {trigger?.kind === 'slash' && (slashItems.length === 0 ? <p className="tf-rte__empty">No blocks match “{trigger.query}”</p> : (
            <>
              <p className="tf-rte__list-head">{trigger.query ? 'Blocks' : 'Type to filter'}</p>
              {slashItems.map((b, n) => row(n, (
                <>
                  <b.icon size={16} strokeWidth={1.75} className="tf-rte__option-icon" aria-hidden="true" />
                  <span className="tf-rte__option-label">{b.label}</span>
                  {b.markdown && <Kbd>{b.markdown}</Kbd>}
                </>
              )))}
            </>
          ))}
        </div>
      </Popover>
      {isReadOnly && readOnlyReason && <p className="tf-rte__reason"><Lock size={14} strokeWidth={1.75} aria-hidden="true" />{readOnlyReason}</p>}
    </div>
  );
}

/* ---------- Format bar ---------- */

const MARKS = [
  { id: 'bold', label: 'Bold', icon: Bold, kbd: '⌘B' },
  { id: 'italic', label: 'Italic', icon: Italic, kbd: '⌘I' },
  { id: 'heading', label: 'Heading', icon: Heading2, kbd: '⌘⌥2' },
  { id: 'bulletList', label: 'Bulleted list', icon: List, kbd: '⌘⇧8' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, kbd: '⌘⇧H' },
] as const;

/** The floating bar over a selection (Tiptap's BubbleMenu): bold, italic, heading, list, highlight and link, growing from the text (05). */
export function FormatToolbar({ editor }: { readonly editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const linkingRef = useRef(false);
  linkingRef.current = linking;
  const on = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'), italic: ed.isActive('italic'), heading: ed.isActive('heading', { level: 2 }),
      bulletList: ed.isActive('bulletList'), highlight: ed.isActive('highlight'), link: ed.isActive('link'),
      href: String(ed.getAttributes('link').href ?? ''),
    }),
  });
  const toggle = (id: (typeof MARKS)[number]['id']) => {
    const c = editor.chain().focus();
    if (id === 'bold') c.toggleBold().run();
    else if (id === 'italic') c.toggleItalic().run();
    else if (id === 'heading') c.toggleHeading({ level: 2 }).run();
    else if (id === 'bulletList') c.toggleBulletList().run();
    else c.toggleHighlight().run();
  };
  const applyLink = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get('href') ?? '').trim();
    const href = raw === '' || /^(https?:|mailto:|tel:|\/)/i.test(raw) ? raw : `https://${raw}`;
    if (href === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinking(false);
  };
  const cancel = (e: ReactKeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setLinking(false); editor.commands.focus(); } };
  // Keep the editor's selection: pressing a button must not move focus out of the text.
  const keepFocus = (e: MouseEvent) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); };
  return (
    <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: ed, view, from, to }) => ed.isEditable && from !== to && !ed.isActive('codeBlock') && (view.hasFocus() || linkingRef.current)}>
      <div className="tf-rte__bubble tf-overlay" onMouseDown={keepFocus}>
        {linking ? (
          <form className="tf-rte__link" onSubmit={applyLink}>
            <Link2 size={14} strokeWidth={1.75} aria-hidden="true" className="tf-rte__link-icon" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input name="href" className="tf-rte__link-input" aria-label="Link address" placeholder="Paste a link, Enter to apply" defaultValue={on?.href ?? ''} autoFocus onKeyDown={cancel} />
            <Kbd>↵</Kbd>
          </form>
        ) : (
          <Toolbar aria-label="Format" className="tf-rte__toolbar">
            {MARKS.map((m) => (
              <Tooltip key={m.id} label={m.label} shortcut={m.kbd}>
                <ToggleButton aria-label={m.label} className="tf-rte__tool" isSelected={on?.[m.id] ?? false} onChange={() => toggle(m.id)}>
                  <m.icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </ToggleButton>
              </Tooltip>
            ))}
            <span className="tf-rte__sep" aria-hidden="true" />
            <Tooltip label={on?.link ? 'Edit link' : 'Link'} shortcut="⌘K">
              <ToggleButton aria-label="Link" className="tf-rte__tool" isSelected={on?.link ?? false} onChange={() => setLinking(true)}>
                <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
              </ToggleButton>
            </Tooltip>
          </Toolbar>
        )}
      </div>
    </BubbleMenu>
  );
}

/* ---------- Note ---------- */

/** Props for NoteEditor. */
export interface NoteEditorProps extends Omit<RichTextEditorProps, 'onExitTop' | 'editorRef'> {
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  /** `title` for a new note, `text` for one opened again. */
  readonly autoFocusOn?: 'title' | 'text';
}

/** A note: its title as the page's own heading over the text. Enter or ↓ in the title goes to the text; ↑ on the first line comes back. */
export function NoteEditor({ title, onTitleChange, autoFocusOn, isReadOnly = false, placeholder = 'Write something, press / for blocks or @ to mention someone', ...rest }: NoteEditorProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => { if (autoFocusOn === 'title' && !isReadOnly) titleRef.current?.focus(); }, [autoFocusOn, isReadOnly]);
  const toText = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const atEnd = el.selectionStart === el.value.length;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) { e.preventDefault(); editorRef.current?.commands.focus('start'); }
  };
  return (
    <div className="tf-note">
      <textarea ref={titleRef} className="tf-note__title" rows={1} value={title} placeholder="Untitled" aria-label="Title" readOnly={isReadOnly}
        onChange={(e) => onTitleChange(e.target.value.replace(/\n/g, ' '))} onKeyDown={toText} />
      <RichTextEditor {...rest} isReadOnly={isReadOnly} placeholder={placeholder} autoFocus={autoFocusOn === 'text'} editorRef={editorRef}
        onExitTop={() => { const el = titleRef.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); }} />
    </div>
  );
}
