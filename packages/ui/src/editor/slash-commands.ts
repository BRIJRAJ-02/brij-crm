// The slash menu's blocks (spec 0019, 21 October 2026): what typing "/" in a
// note offers, as Notion's command menu does. Each turns the line the "/" was
// typed on into its block (the "/" and what was typed after it go), so it
// works on a fresh line and on one with text alike; the divider goes in after
// the line. Matching is plain, with no React and no editor, so it tests in Node.
import type { Editor, Range } from '@tiptap/core';
import type { IconName } from '../atoms/Icon/icons.ts';
import { strings } from './strings.ts';

/** One block the slash menu offers. */
export interface SlashCommand {
  readonly id: string;
  /** Its name in the menu ("Heading 1"). */
  readonly label: string;
  readonly icon: IconName;
  /** The markdown that makes the same block as it is typed ("#"), shown at the row's end; none for plain text. */
  readonly markdown?: string;
  /** Other words it answers to ("h1", "todo"). */
  readonly keywords: readonly string[];
  /** Makes the block from the line the "/" was typed on, `range` being the "/" and its query. */
  readonly run: (editor: Editor, range: Range) => void;
}

/** The note's blocks, in the menu's order. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'text',
    label: strings.text,
    icon: 'type',
    keywords: ['paragraph', 'plain', 'body'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().run();
    },
  },
  {
    id: 'heading1',
    label: strings.heading1,
    icon: 'heading-1',
    markdown: '#',
    keywords: ['h1', 'title', 'big'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().setNode('heading', { level: 1 }).run();
    },
  },
  {
    id: 'heading2',
    label: strings.heading2,
    icon: 'heading-2',
    markdown: '##',
    keywords: ['h2', 'subheading', 'medium'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().setNode('heading', { level: 2 }).run();
    },
  },
  {
    id: 'heading3',
    label: strings.heading3,
    icon: 'heading-3',
    markdown: '###',
    keywords: ['h3', 'small'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().setNode('heading', { level: 3 }).run();
    },
  },
  {
    id: 'bulletList',
    label: strings.bulletList,
    icon: 'list',
    markdown: '-',
    keywords: ['bullets', 'unordered', 'ul'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleBulletList().run();
    },
  },
  {
    id: 'orderedList',
    label: strings.orderedList,
    icon: 'list-ordered',
    markdown: '1.',
    keywords: ['numbers', 'ordered', 'ol'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleOrderedList().run();
    },
  },
  {
    id: 'taskList',
    label: strings.taskList,
    icon: 'list-todo',
    markdown: '[]',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleTaskList().run();
    },
  },
  {
    id: 'quote',
    label: strings.quote,
    icon: 'text-quote',
    markdown: '>',
    keywords: ['blockquote', 'citation'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().toggleBlockquote().run();
    },
  },
  {
    id: 'divider',
    label: strings.divider,
    icon: 'minus',
    markdown: '---',
    keywords: ['rule', 'line', 'separator', 'hr'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    id: 'codeBlock',
    label: strings.codeBlock,
    icon: 'square-code',
    markdown: '```',
    keywords: ['code', 'snippet', 'pre'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).clearNodes().setNode('codeBlock').run();
    },
  },
];

/**
 * The blocks a query after "/" names, in the menu's order: those whose name
 * holds it, or one of whose other words starts with it, ignoring case and
 * spaces ("h1", "head", "todo", "numbered"). An empty query names them all.
 */
export function matchSlashCommands(commands: readonly SlashCommand[], query: string): readonly SlashCommand[] {
  const wanted = query.toLowerCase().replace(/\s+/g, '');
  if (wanted === '') return commands;
  return commands.filter(
    (command) =>
      command.label.toLowerCase().replace(/\s+/g, '').includes(wanted) ||
      command.keywords.some((keyword) => keyword.startsWith(wanted)),
  );
}
