// The rich text editor's extension set (spec 0003, the editor): the schema a
// note is written in. Its node and mark names must equal RICH_TEXT_NODES and
// RICH_TEXT_MARKS in @crm/contracts (schema.test.ts checks), since the stored
// document is parsed with those lists. Classes, the mention list and the
// slash menu come in as arguments, so the same set builds headless in a Node
// test. The slash menu and the title handoff add no node or mark.
import { isSafeLink, type ActorDisplay } from '@crm/contracts/values';
import {
  Extension,
  mergeAttributes,
  type Extensions,
  type KeyboardShortcutCommand,
  type NodeViewRenderer,
} from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';
import { Highlight } from '@tiptap/extension-highlight';
import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extensions';
import { PluginKey, Selection } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion';
import type { SlashCommand } from './slash-commands.ts';

/** The heading levels a note may use: a title, a section and a subsection. */
export const HEADING_LEVELS = [1, 2, 3] as const;

/** The parts of a document the editor's stylesheet names, each drawn with its own class. */
export type EditorPart =
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'taskList'
  | 'taskItem'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'code'
  | 'highlight'
  | 'mention'
  | 'emptyEditor'
  | 'emptyLine'
  | 'slashQueryEmpty';

/** The mention list's options, as the Suggestion utility takes them (members in, `{ id, label }` out). */
export type MentionSuggestion = Omit<SuggestionOptions<ActorDisplay, MentionNodeAttrs>, 'editor'>;

/**
 * The slash menu's options, as the Suggestion utility takes them (blocks in, the picked block out). The host may
 * give the plugin's key, to close the menu itself (when the text loses focus).
 */
export type SlashSuggestion = Omit<SuggestionOptions<SlashCommand, SlashCommand>, 'editor' | 'char'>;

/** What the extension set needs from its host. */
export interface NoteExtensionOptions {
  /** A class per part, from the editor's CSS module; left out in a headless build. */
  readonly classes?: Readonly<Partial<Record<EditorPart, string | undefined>>>;
  /** Shown while the document is empty. */
  readonly placeholder?: string;
  /** Shown on an empty line under the caret once the document holds something ("Press / for commands"). */
  readonly lineHint?: string;
  /** Shown in an empty heading under the caret ("Heading 1"). */
  readonly headingHint?: (level: number) => string;
  /** The `@` list; without it typing `@` stays plain text. */
  readonly mention?: MentionSuggestion;
  /** The `/` menu; without it typing `/` stays plain text. */
  readonly slash?: SlashSuggestion;
  /**
   * The caret left the top of the text (the arrow up on its first line, or
   * Backspace in an empty first line): the host moves focus to what sits above
   * the text (given as its element), a note's title, and answers whether it did.
   */
  readonly onExitTop?: (text: HTMLElement) => boolean;
  /** How a mention draws in the editor (the library's Mention chip); without it, as its text. */
  readonly mentionView?: NodeViewRenderer;
  /** A task checkbox's name, from its text and whether it is ticked. */
  readonly taskLabel?: (text: string, isChecked: boolean) => string;
}

/** A class attribute for a part, or nothing when there is no class. */
function classOf(classes: NoteExtensionOptions['classes'], part: EditorPart): Record<string, string> {
  const name = classes?.[part];
  return name === undefined ? {} : { class: name };
}

/** The slash menu: typing "/" at a line's start or after a space opens the blocks, anywhere but in code. */
function slashCommands(slash: SlashSuggestion | undefined, classes: NoteExtensionOptions['classes']) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      if (slash === undefined) return [];
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommands'),
          char: '/',
          // Not in code, where "/" is just a character (a path, a comment, a division).
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return $from.parent.type.name !== 'codeBlock' && !$from.marks().some((mark) => mark.type.name === 'code');
          },
          ...(classes?.slashQueryEmpty === undefined ? {} : { decorationEmptyClass: classes.slashQueryEmpty }),
          ...slash,
        }),
      ];
    },
  });
}

/**
 * The way back up to a note's title: the arrow up on the first line of the
 * text, or Backspace in an empty first line, hands focus to the host.
 */
function titleHandoff(onExitTop: ((text: HTMLElement) => boolean) | undefined) {
  return Extension.create({
    name: 'titleHandoff',
    addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
      if (onExitTop === undefined) return {};
      const inFirstLine = (): boolean => {
        const { state, view } = this.editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const first = Selection.atStart(state.doc);
        return selection.$from.sameParent(first.$from) && view.endOfTextblock('up');
      };
      return {
        ArrowUp: () => inFirstLine() && onExitTop(this.editor.view.dom),
        Backspace: () => {
          const { selection } = this.editor.state;
          return inFirstLine() && selection.$from.parentOffset === 0 && selection.$from.parent.content.size === 0
            ? onExitTop(this.editor.view.dom)
            : false;
        },
      };
    },
  });
}

/**
 * The extensions a note is written with: StarterKit (paragraphs, three heading
 * levels, lists, quote, code block, rule, hard break, bold, italic, strike,
 * underline, inline code, links), highlight, task lists, mentions, the slash
 * menu, the way back up to the title and the placeholders. Links pass
 * `isSafeLink` (typed, pasted or autolinked) and never open on click while
 * editing. Anything outside this schema is dropped on paste, images
 * included, since there is no image node.
 */
export function noteExtensions(options: NoteExtensionOptions = {}): Extensions {
  const { classes, placeholder, lineHint, headingHint, mention, slash, onExitTop, mentionView, taskLabel } = options;
  const html = (part: EditorPart) => ({ HTMLAttributes: classOf(classes, part) });
  const level = Heading.extend({
    // The level as data-level, so the stylesheet sizes each level without styling the element.
    renderHTML({ node, HTMLAttributes }) {
      const value: unknown = node.attrs.level;
      const at = typeof value === 'number' && HEADING_LEVELS.some((each) => each === value) ? value : 1;
      return [`h${String(at)}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-level': at }), 0];
    },
  }).configure({ levels: [...HEADING_LEVELS], ...html('heading') });
  const mentionNode = mentionView === undefined ? Mention : Mention.extend({ addNodeView: () => mentionView });
  return [
    StarterKit.configure({
      heading: false,
      paragraph: html('paragraph'),
      bulletList: html('bulletList'),
      orderedList: html('orderedList'),
      listItem: html('listItem'),
      blockquote: html('blockquote'),
      codeBlock: html('codeBlock'),
      horizontalRule: html('horizontalRule'),
      bold: html('bold'),
      italic: html('italic'),
      strike: html('strike'),
      underline: html('underline'),
      code: html('code'),
      // A link's class, target and rel are stored attributes, so no class here: the stylesheet finds links by href.
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeLink(url),
        shouldAutoLink: (url) => isSafeLink(url),
      },
    }),
    level,
    Highlight.configure(html('highlight')),
    TaskList.configure(html('taskList')),
    TaskItem.configure({
      nested: true,
      ...html('taskItem'),
      ...(taskLabel === undefined
        ? {}
        : { a11y: { checkboxLabel: (node, isChecked) => taskLabel(node.textContent, isChecked) } }),
    }),
    mentionNode.configure({
      ...html('mention'),
      deleteTriggerWithBackspace: true,
      suggestion: mention ?? { char: '@', allow: () => false },
    }),
    slashCommands(slash, classes),
    titleHandoff(onExitTop),
    Placeholder.configure({
      // The whole note empty: its placeholder. Then an empty line under the caret says how to make a block, and an
      // empty heading names its level, as Notion's pages do.
      placeholder: ({ editor, node }) => {
        if (editor.isEmpty) return placeholder ?? '';
        if (node.type.name === 'heading') {
          const at: unknown = node.attrs.level;
          return typeof at === 'number' ? (headingHint?.(at) ?? '') : '';
        }
        return lineHint ?? '';
      },
      ...(classes?.emptyEditor === undefined ? {} : { emptyEditorClass: classes.emptyEditor }),
      ...(classes?.emptyLine === undefined ? {} : { emptyNodeClass: classes.emptyLine }),
    }),
  ];
}
