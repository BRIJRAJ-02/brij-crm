// The rich text editor's extension set (spec 0003, the editor): the schema a
// note is written in. Its node and mark names must equal RICH_TEXT_NODES and
// RICH_TEXT_MARKS in @crm/contracts (schema.test.ts checks), since the stored
// document is parsed with those lists. Classes and the mention list come in as
// arguments, so the same set builds headless in a Node test.
import { isSafeLink, type ActorDisplay } from '@crm/contracts/values';
import { mergeAttributes, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';
import { Highlight } from '@tiptap/extension-highlight';
import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionOptions } from '@tiptap/suggestion';

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
  | 'emptyEditor';

/** The mention list's options, as the Suggestion utility takes them (members in, `{ id, label }` out). */
export type MentionSuggestion = Omit<SuggestionOptions<ActorDisplay, MentionNodeAttrs>, 'editor'>;

/** What the extension set needs from its host. */
export interface NoteExtensionOptions {
  /** A class per part, from the editor's CSS module; left out in a headless build. */
  readonly classes?: Readonly<Partial<Record<EditorPart, string | undefined>>>;
  /** Shown while the document is empty. */
  readonly placeholder?: string;
  /** The `@` list; without it typing `@` stays plain text. */
  readonly mention?: MentionSuggestion;
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

/**
 * The extensions a note is written with: StarterKit (paragraphs, three heading
 * levels, lists, quote, code block, rule, hard break, bold, italic, strike,
 * underline, inline code, links), highlight, task lists, mentions and the
 * placeholder. Links pass `isSafeLink` (typed, pasted or autolinked) and never
 * open on click while editing. Anything outside this schema is dropped on
 * paste, images included, since there is no image node.
 */
export function noteExtensions(options: NoteExtensionOptions = {}): Extensions {
  const { classes, placeholder, mention, mentionView, taskLabel } = options;
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
    Placeholder.configure({
      placeholder: placeholder ?? '',
      ...(classes?.emptyEditor === undefined ? {} : { emptyEditorClass: classes.emptyEditor }),
    }),
  ];
}
