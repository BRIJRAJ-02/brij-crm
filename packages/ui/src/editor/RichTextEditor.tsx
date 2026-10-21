// The rich text editor (spec 0003, `0003-rich-text-and-email.md`): Tiptap 3,
// saving Tiptap's JSON as a RichTextDoc, never HTML. Note mode only for now;
// comment and email modes come with their features (#29, #45). Built with
// useEditor and EditorContent (the hook API), since the editor, its title,
// its bubble toolbar and its two lists (members after "@", blocks after "/")
// all live in this one component.
import { RichTextDocBody, type ActorDisplay, type RichTextDoc, type RichTextNode } from '@crm/contracts/values';
import type { Editor, JSONContent } from '@tiptap/core';
import type { MentionNodeAttrs } from '@tiptap/extension-mention';
import { PluginKey, Selection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Avatar } from '../atoms/Avatar/Avatar.tsx';
import { editorIcons } from '../atoms/Icon/editor-icons.ts';
import { Icon, IconScope } from '../atoms/Icon/Icon.tsx';
import { Field } from '../molecules/Field/Field.tsx';
import { noteExtensions, type MentionSuggestion, type SlashSuggestion } from './extensions.ts';
import { FormatToolbar } from './FormatToolbar.tsx';
import { MentionNames, mentionView } from './MentionView.tsx';
import styles from './RichTextEditor.module.css';
import { matchSlashCommands, SLASH_COMMANDS, type SlashCommand } from './slash-commands.ts';
import { strings } from './strings.ts';
import { SuggestionList, suggestionOptionId, type SuggestionRow } from './SuggestionList.tsx';

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
  /**
   * The document's title (a note's), drawn over the text as the page's own
   * heading: the Field's `title` variant. Enter in it moves to the text, and
   * the arrow up on the text's first line (or Backspace in an empty first
   * line) comes back. Without it, the editor has no title.
   */
  readonly title?: string;
  readonly onTitleChange?: (title: string) => void;
  /** The title's name for screen readers; "Title" by default. */
  readonly titleLabel?: string;
  /** Shown while the title is empty; "Untitled" by default. */
  readonly titlePlaceholder?: string;
  readonly titleMaxLength?: number;
  /**
   * Where focus goes as it mounts: `title` (a new note, still to be named) or
   * `text`, the start of the text (a note opened again). Read only takes none.
   */
  readonly autoFocus?: 'title' | 'text';
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

/** An open list under the text: its rows' items, and how to pick one. */
interface ListSession<T> {
  readonly items: readonly T[];
  readonly isLoading: boolean;
  readonly pick: (item: T) => void;
}

/**
 * A list's highlighted row and the Suggestion renderer that drives it from
 * the editor's keys: the arrows move, Enter or Tab picks, and Esc closes it
 * without the dialog around the editor hearing that Esc.
 */
function useListSession<T>() {
  const [session, setSession] = useState<ListSession<T> | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const sessionRef = useRef<ListSession<T> | undefined>(undefined);
  const activeRef = useRef(0);
  const anchorRef = useRef<Element | null>(null);
  const highlight = useCallback((index: number) => {
    activeRef.current = index;
    setActiveIndex(index);
  }, []);
  const show = useCallback(
    (anchor: Element | null, next: ListSession<T>) => {
      anchorRef.current = anchor;
      sessionRef.current = next;
      setSession(next);
      if (activeRef.current >= next.items.length) highlight(0);
    },
    [highlight],
  );
  const hide = useCallback(() => {
    sessionRef.current = undefined;
    anchorRef.current = null;
    setSession(undefined);
  }, []);
  const onKeyDown = useCallback(
    ({ event }: SuggestionKeyDownProps): boolean => {
      const current = sessionRef.current;
      if (current === undefined) return false;
      // The list closes; the dialog around the editor must not hear this Esc.
      if (event.key === 'Escape') {
        event.stopPropagation();
        return true;
      }
      const count = current.items.length;
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
        const item = current.items[activeRef.current];
        if (item !== undefined) current.pick(item);
        return true;
      }
      return false;
    },
    [highlight],
  );
  return { session, activeIndex, highlight, anchorRef, show, hide, onKeyDown };
}

/** The `@` list's state, and the Suggestion options that drive it from the editor's keys. */
function useMentions(search: RichTextEditorProps['onSearchMentions']) {
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  const list = useListSession<ActorDisplay>();
  const [hasSearch] = useState(() => search !== undefined);
  const { show, hide, onKeyDown, highlight } = list;
  const suggestion = useMemo((): MentionSuggestion | undefined => {
    if (!hasSearch) return undefined;
    const open = (props: SuggestionProps<ActorDisplay, MentionNodeAttrs>) => {
      show(props.decorationNode, {
        items: props.items.filter((member) => member.id !== null),
        isLoading: props.loading,
        pick: (member) => {
          if (member.id !== null) props.command({ id: member.id, label: member.name });
        },
      });
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
        onExit: hide,
        onKeyDown,
      }),
    };
  }, [hasSearch, highlight, show, hide, onKeyDown]);
  return { suggestion, ...list };
}

/**
 * The `/` menu's state, and the Suggestion options that drive it: the blocks
 * matching what follows the "/", matched here as it is typed (nothing to
 * fetch), the first highlighted again as the query changes.
 */
function useSlashMenu() {
  const list = useListSession<SlashCommand>();
  const [pluginKey] = useState(() => new PluginKey('slashCommands'));
  // The query the list last showed: a new one highlights the first block again.
  const lastQuery = useRef<string | undefined>(undefined);
  const { show, hide, onKeyDown, highlight } = list;
  const suggestion = useMemo((): SlashSuggestion => {
    const open = (props: SuggestionProps<SlashCommand, SlashCommand>) => {
      if (props.query !== lastQuery.current) highlight(0);
      lastQuery.current = props.query;
      show(props.decorationNode, {
        items: matchSlashCommands(SLASH_COMMANDS, props.query),
        isLoading: false,
        pick: (command) => {
          props.command(command);
        },
      });
    };
    return {
      pluginKey,
      decorationContent: strings.slashFilter,
      items: () => [],
      command: ({ editor, range, props: command }) => {
        command.run(editor, range);
      },
      render: () => ({
        onStart: open,
        onUpdate: open,
        onExit: () => {
          lastQuery.current = undefined;
          hide();
        },
        onKeyDown,
      }),
    };
  }, [pluginKey, highlight, show, hide, onKeyDown]);
  return { suggestion, pluginKey, ...list };
}

/** Up from the text to its editor's title, the caret at the title's end; nothing when the editor has no title. */
function focusTitleAbove(text: HTMLElement): boolean {
  const input = text.closest('[data-mode]')?.querySelector<HTMLTextAreaElement>('[data-title] textarea');
  if (input === null || input === undefined) return false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  return true;
}

/**
 * A rich text editor for a note: headings, bold, italic, strike, code,
 * highlight, links, lists, task lists, quotes, code blocks and @mentions,
 * with a slash menu of blocks, markdown shortcuts, a format toolbar over a
 * selection and the usual shortcuts (⌘B, ⌘I…), drawn as a page: no box
 * around the text, and an optional title over it. It saves Tiptap's JSON,
 * never HTML; pasted content outside its schema (images among it) is
 * dropped, and links must be http, https, mailto, tel or a path on this site.
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
  title,
  onTitleChange,
  titleLabel = strings.title,
  titlePlaceholder = strings.titlePlaceholder,
  titleMaxLength,
  autoFocus,
}: RichTextEditorProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const membersId = `${id}-members`;
  const blocksId = `${id}-blocks`;
  const { schedule, flush } = useChangeEmitter(onChange, onChangeMaxWait);
  const mentions = useMentions(onSearchMentions);
  // The slash menu is note mode's (the one mode so far): comment and email modes decide theirs as they come.
  const slash = useSlashMenu();
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
        emptyLine: styles.emptyLine,
        slashQueryEmpty: styles.slashQueryEmpty,
      },
      ...(placeholder === undefined ? {} : { placeholder }),
      lineHint: strings.commandsHint,
      headingHint: strings.headingHint,
      ...(mentions.suggestion === undefined ? {} : { mention: mentions.suggestion }),
      slash: slash.suggestion,
      onExitTop: focusTitleAbove,
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
      // Esc over a selection puts the caret at its end, closing the format toolbar; the next Esc closes whatever holds
      // the editor. The lists' own Esc comes first, in their plugins, and their caret selects nothing.
      handleKeyDown: (view: Editor['view'], event: KeyboardEvent) => {
        if (event.key !== 'Escape' || view.state.selection.empty) return false;
        const { state } = view;
        view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.to), -1)));
        event.stopPropagation();
        return true;
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
    autofocus: autoFocus === 'text' && !isReadOnly ? 'start' : false,
    editorProps,
    onUpdate: ({ editor: current }) => {
      schedule(current);
    },
    onBlur: ({ editor: current }) => {
      flush();
      // The "/" menu belongs to the caret it opened at: leaving the text closes it.
      const menu: unknown = current.isDestroyed ? undefined : slash.pluginKey.getState(current.state);
      if (typeof menu === 'object' && menu !== null && 'active' in menu && menu.active === true) {
        exitSuggestion(current.view, slash.pluginKey);
      }
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

  // While a list is open, the editor points screen readers at its highlighted row.
  const open =
    mentions.session !== undefined
      ? { id: membersId, active: mentions.activeIndex, count: mentions.session.items.length }
      : slash.session !== undefined
        ? { id: blocksId, active: slash.activeIndex, count: slash.session.items.length }
        : undefined;
  const openId = open?.id;
  const activeId = open === undefined || open.count === 0 ? undefined : suggestionOptionId(open.id, open.active);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    if (openId === undefined) {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
      dom.removeAttribute('aria-autocomplete');
      return;
    }
    dom.setAttribute('aria-controls', openId);
    dom.setAttribute('aria-autocomplete', 'list');
    if (activeId === undefined) dom.removeAttribute('aria-activedescendant');
    else dom.setAttribute('aria-activedescendant', activeId);
  }, [editor, openId, activeId]);

  const memberRows = useMemo(
    (): readonly SuggestionRow[] =>
      (mentions.session?.items ?? []).map((member) => ({
        key: member.id ?? member.name,
        leading: (
          <Avatar
            name={member.name}
            id={member.id ?? member.name}
            size="xs"
            isDecorative
            {...(member.imageSrc === undefined ? {} : { src: member.imageSrc })}
            {...(member.hue === undefined ? {} : { hue: member.hue })}
          />
        ),
        label: member.name,
        ...(member.email === undefined ? {} : { detail: member.email }),
      })),
    [mentions.session],
  );
  const blockRows = useMemo(
    (): readonly SuggestionRow[] =>
      (slash.session?.items ?? []).map((command) => ({
        key: command.id,
        leading: <Icon name={command.icon} size="md" tone="muted" />,
        label: command.label,
        ...(command.markdown === undefined ? {} : { hint: command.markdown }),
      })),
    [slash.session],
  );
  const mentionSession = mentions.session;
  const slashSession = slash.session;

  return (
    <div
      className={styles.root}
      data-mode={mode}
      data-invalid={error === undefined ? undefined : ''}
      data-readonly={isReadOnly || undefined}
    >
      {title !== undefined && (
        <div className={styles.title} data-title>
          <Field
            variant="title"
            label={titleLabel}
            isLabelHidden
            isWrapping
            placeholder={titlePlaceholder}
            value={title}
            {...(onTitleChange === undefined ? {} : { onChange: onTitleChange })}
            {...(titleMaxLength === undefined ? {} : { maxLength: titleMaxLength })}
            isReadOnly={isReadOnly}
            // Enter in the title goes on to the text, as a page's title does.
            onSubmit={() => {
              if (!isReadOnly) editor.commands.focus('start');
            }}
            // A new note opens named nothing yet: its title takes focus (spec 0019, keyboard and focus).
            autoFocus={autoFocus === 'title' && !isReadOnly}
          />
        </div>
      )}
      <MentionNames.Provider value={mentionName}>
        <EditorContent editor={editor} className={styles.frame} />
      </MentionNames.Provider>
      {!isReadOnly && <FormatToolbar editor={editor} />}
      {mentionSession !== undefined && (
        <SuggestionList
          anchorRef={mentions.anchorRef}
          id={membersId}
          label={strings.members}
          rows={memberRows}
          activeIndex={mentions.activeIndex}
          emptyText={mentionSession.isLoading ? strings.searchingMembers : strings.noMembers}
          onPick={(index) => {
            const member = mentionSession.items[index];
            if (member !== undefined) mentionSession.pick(member);
          }}
          onHighlight={mentions.highlight}
        />
      )}
      {slashSession !== undefined && (
        // The blocks' own icons come in the editor's chunk (editor-icons.ts), as the format toolbar's do.
        <IconScope icons={editorIcons}>
          <SuggestionList
            anchorRef={slash.anchorRef}
            id={blocksId}
            label={strings.blocks}
            rows={blockRows}
            activeIndex={slash.activeIndex}
            emptyText={strings.noBlocks}
            onPick={(index) => {
              const command = slashSession.items[index];
              if (command !== undefined) slashSession.pick(command);
            }}
            onHighlight={slash.highlight}
          />
        </IconScope>
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
