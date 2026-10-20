// The rich text editor (spec 0003, `0003-rich-text-and-email.md`): Tiptap 3,
// saving Tiptap's JSON as a RichTextDoc, never HTML. Note mode only for now;
// comment and email modes come with their features (#29, #45). Built with
// useEditor and EditorContent (the hook API), since the editor, its bubble
// toolbar and its mention list all live in this one component.
import { RichTextDocBody, type ActorDisplay, type RichTextDoc, type RichTextNode } from '@crm/contracts/values';
import type { Editor, JSONContent } from '@tiptap/core';
import type { MentionNodeAttrs } from '@tiptap/extension-mention';
import { EditorContent, useEditor } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { noteExtensions, type MentionSuggestion } from './extensions.ts';
import { FormatToolbar } from './FormatToolbar.tsx';
import { MentionList, mentionOptionId } from './MentionList.tsx';
import { MentionNames, mentionView } from './MentionView.tsx';
import styles from './RichTextEditor.module.css';
import { strings } from './strings.ts';

/** Which tools the editor offers: `note` (headings, marks, lists, task lists, quote, code, links, mentions). */
export type RichTextMode = 'note';

/** How long typing must pause before `onChange` hears the document, in milliseconds. */
export const CHANGE_DEBOUNCE_MS = 300;

/** Props for RichTextEditor. */
export interface RichTextEditorProps {
  readonly mode: RichTextMode;
  /** The editor's name, read by screen readers ("Note"). */
  readonly label: string;
  /** The document, when the screen holds it; a later change replaces the text only while the editor isn't focused. */
  readonly value?: RichTextDoc | null;
  /** The starting document, when the editor holds its own. Remount (a new `key`) to start over. */
  readonly defaultValue?: RichTextDoc | null;
  /** The document after an edit: 300 ms after typing pauses, on blur, and as the editor unmounts. */
  readonly onChange?: (doc: RichTextDoc) => void;
  /** The most milliseconds `onChange` waits while typing goes on (a note passes 2,000); without it, it waits for a pause. */
  readonly onChangeMaxWait?: number;
  /** Shown while the document is empty. */
  readonly placeholder?: string;
  /** Members matching what follows `@`; without it (when the editor mounts) `@` stays plain text. */
  readonly onSearchMentions?: (query: string) => Promise<readonly ActorDisplay[]>;
  /**
   * A mentioned member's name now, by id, from the screen's members: a
   * mention draws this, never the label stored in the document (which anyone
   * who could write the note could have set). Undefined (a member no longer
   * here) draws the screen's word for that; without the prop, the stored label.
   */
  readonly mentionName?: (id: string) => string | undefined;
  readonly isReadOnly?: boolean;
  /** Why it is read only, shown under it. */
  readonly readOnlyReason?: string;
  /** A refusal, shown under it in the danger colour. */
  readonly error?: string;
}

/** An empty document. */
const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/** A stored node as Tiptap's JSON (the same shape, with Tiptap's mutable types). */
function toContent(node: RichTextNode): JSONContent {
  return {
    type: node.type,
    ...(node.attrs === undefined ? {} : { attrs: { ...node.attrs } }),
    ...(node.content === undefined ? {} : { content: node.content.map(toContent) }),
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.marks === undefined
      ? {}
      : {
          marks: node.marks.map((mark) => ({
            type: mark.type,
            ...(mark.attrs === undefined ? {} : { attrs: { ...mark.attrs } }),
          })),
        }),
  };
}

/** The editor's document as a RichTextDoc, or undefined if it somehow falls outside the stored shape. */
function documentOf(editor: Editor): RichTextDoc | undefined {
  const parsed = RichTextDocBody.safeParse(editor.getJSON());
  return parsed.success ? parsed.data : undefined;
}

/**
 * Hands the document to `onChange` once typing pauses for 300 ms, or after
 * `maxWait` ms of steady typing, and at once on `flush` (blur, unmount).
 */
function useChangeEmitter(
  onChange: RichTextEditorProps['onChange'],
  maxWait: number | undefined,
): { readonly schedule: (editor: Editor) => void; readonly flush: () => void } {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const pending = useRef<Editor | undefined>(undefined);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(pause.current);
    clearTimeout(longest.current);
    pause.current = undefined;
    longest.current = undefined;
    const editor = pending.current;
    pending.current = undefined;
    if (editor === undefined || editor.isDestroyed) return;
    const doc = documentOf(editor);
    if (doc !== undefined) latest.current?.(doc);
  }, []);
  const schedule = useCallback(
    (editor: Editor) => {
      pending.current = editor;
      clearTimeout(pause.current);
      pause.current = setTimeout(flush, CHANGE_DEBOUNCE_MS);
      if (maxWait !== undefined && longest.current === undefined) longest.current = setTimeout(flush, maxWait);
    },
    [flush, maxWait],
  );
  useEffect(() => flush, [flush]);
  return { schedule, flush };
}

/** The open `@` list: who matches, and how to insert one. */
interface MentionSession {
  readonly members: readonly ActorDisplay[];
  readonly isLoading: boolean;
  readonly pick: (member: ActorDisplay) => void;
}

/** The `@` list's state, and the Suggestion options that drive it from the editor's keys. */
function useMentions(search: RichTextEditorProps['onSearchMentions']) {
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  const [session, setSession] = useState<MentionSession | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const sessionRef = useRef<MentionSession | undefined>(undefined);
  const activeRef = useRef(0);
  const anchorRef = useRef<Element | null>(null);
  const [hasSearch] = useState(() => search !== undefined);
  const highlight = useCallback((index: number) => {
    activeRef.current = index;
    setActiveIndex(index);
  }, []);

  const suggestion = useMemo((): MentionSuggestion | undefined => {
    if (!hasSearch) return undefined;
    const open = (props: SuggestionProps<ActorDisplay, MentionNodeAttrs>) => {
      anchorRef.current = props.decorationNode;
      const members = props.items.filter((member) => member.id !== null);
      const next: MentionSession = {
        members,
        isLoading: props.loading,
        pick: (member) => {
          if (member.id !== null) props.command({ id: member.id, label: member.name });
        },
      };
      sessionRef.current = next;
      setSession(next);
      if (activeRef.current >= members.length) highlight(0);
    };
    return {
      char: '@',
      items: async ({ query }) => {
        const find = searchRef.current;
        if (find === undefined) return [];
        try {
          return [...(await find(query))];
        } catch {
          return [];
        }
      },
      render: () => ({
        onStart: (props) => {
          highlight(0);
          open(props);
        },
        onUpdate: open,
        onExit: () => {
          sessionRef.current = undefined;
          anchorRef.current = null;
          setSession(undefined);
        },
        onKeyDown: ({ event }) => {
          const current = sessionRef.current;
          if (current === undefined) return false;
          // The list closes; the dialog around the editor must not hear this Esc.
          if (event.key === 'Escape') {
            event.stopPropagation();
            return true;
          }
          const count = current.members.length;
          if (count === 0) return false;
          if (event.key === 'ArrowDown') {
            highlight((activeRef.current + 1) % count);
            return true;
          }
          if (event.key === 'ArrowUp') {
            highlight((activeRef.current - 1 + count) % count);
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const member = current.members[activeRef.current];
            if (member !== undefined) current.pick(member);
            return true;
          }
          return false;
        },
      }),
    };
  }, [hasSearch, highlight]);

  return { suggestion, session, activeIndex, highlight, anchorRef };
}

/**
 * A rich text editor for a note: headings, bold, italic, strike, code,
 * highlight, links, lists, task lists, quotes, code blocks and @mentions,
 * with a format toolbar over a selection and the usual shortcuts (⌘B, ⌘I…).
 * It saves Tiptap's JSON, never HTML; pasted content outside its schema
 * (images among it) is dropped, and links must be http, https, mailto, tel or
 * a path on this site.
 */
export function RichTextEditor({
  mode,
  label,
  value,
  defaultValue,
  onChange,
  onChangeMaxWait,
  placeholder,
  onSearchMentions,
  mentionName,
  isReadOnly = false,
  readOnlyReason,
  error,
}: RichTextEditorProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const listId = `${id}-members`;
  const { schedule, flush } = useChangeEmitter(onChange, onChangeMaxWait);
  const mentions = useMentions(onSearchMentions);
  const [extensions] = useState(() =>
    noteExtensions({
      classes: {
        paragraph: styles.paragraph,
        heading: styles.heading,
        bulletList: styles.bulletList,
        orderedList: styles.orderedList,
        listItem: styles.listItem,
        taskList: styles.taskList,
        taskItem: styles.taskItem,
        blockquote: styles.blockquote,
        codeBlock: styles.codeBlock,
        horizontalRule: styles.horizontalRule,
        code: styles.code,
        highlight: styles.highlight,
        emptyEditor: styles.empty,
      },
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(mentions.suggestion === undefined ? {} : { mention: mentions.suggestion }),
      mentionView,
      taskLabel: strings.markTask,
    }),
  );
  const [content] = useState(() => {
    const start = value ?? defaultValue;
    return start === undefined || start === null ? EMPTY : toContent(start);
  });
  const note = readOnlyReason !== undefined && isReadOnly ? readOnlyReason : undefined;
  const describedBy = [error === undefined ? undefined : `${noteId}-error`, note === undefined ? undefined : noteId]
    .filter((each) => each !== undefined)
    .join(' ');
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: styles.content ?? '',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
        ...(error === undefined ? {} : { 'aria-invalid': 'true' }),
        ...(isReadOnly ? { 'aria-readonly': 'true' } : {}),
      },
    }),
    [label, describedBy, error, isReadOnly],
  );
  const editor = useEditor({
    extensions,
    content,
    editable: !isReadOnly,
    injectCSS: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps,
    onUpdate: ({ editor: current }) => {
      schedule(current);
    },
    onBlur: () => {
      flush();
    },
  });

  useEffect(() => {
    editor.setEditable(!isReadOnly, false);
  }, [editor, isReadOnly]);

  // A new value from outside replaces the text, unless someone is typing in it.
  useEffect(() => {
    if (value === undefined || editor.isDestroyed || editor.isFocused) return;
    const next = value === null ? EMPTY : toContent(value);
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  // While the list is open, the editor points screen readers at the highlighted member.
  const { session, activeIndex } = mentions;
  const isListOpen = session !== undefined;
  const hasMembers = (session?.members.length ?? 0) > 0;
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    if (!isListOpen) {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
      dom.removeAttribute('aria-autocomplete');
      return;
    }
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-autocomplete', 'list');
    if (hasMembers) dom.setAttribute('aria-activedescendant', mentionOptionId(listId, activeIndex));
    else dom.removeAttribute('aria-activedescendant');
  }, [editor, isListOpen, hasMembers, activeIndex, listId]);

  return (
    <div
      className={styles.root}
      data-mode={mode}
      data-invalid={error === undefined ? undefined : ''}
      data-readonly={isReadOnly || undefined}
    >
      <MentionNames.Provider value={mentionName}>
        <EditorContent editor={editor} className={styles.frame} />
      </MentionNames.Provider>
      {!isReadOnly && <FormatToolbar editor={editor} />}
      {session !== undefined && (
        <MentionList
          anchorRef={mentions.anchorRef}
          id={listId}
          members={session.members}
          activeIndex={activeIndex}
          isLoading={session.isLoading}
          onPick={session.pick}
          onHighlight={mentions.highlight}
        />
      )}
      {note !== undefined && (
        <span className={styles.note} id={noteId}>
          <Icon name="lock" size="xs" label={strings.readOnly} />
          {note}
        </span>
      )}
      {error !== undefined && (
        <span className={styles.error} id={`${noteId}-error`}>
          <Icon name="circle-alert" size="xs" />
          {error}
        </span>
      )}
    </div>
  );
}
