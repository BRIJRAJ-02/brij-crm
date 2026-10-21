// The slash menu's blocks and how a query after "/" picks them (21 October
// 2026). What each block does to a note is checked by the editor's stories.
import { describe, expect, it } from 'vitest';
import { editorIcons } from '../atoms/Icon/editor-icons.ts';
import { icons } from '../atoms/Icon/icons.ts';
import { matchSlashCommands, SLASH_COMMANDS } from './slash-commands.ts';

const ids = (query: string) => matchSlashCommands(SLASH_COMMANDS, query).map((command) => command.id);

describe('the slash menu', () => {
  it('offers text, three headings, the three lists, a quote, a divider and code, in that order', () => {
    expect(SLASH_COMMANDS.map((command) => command.id)).toEqual([
      'text',
      'heading1',
      'heading2',
      'heading3',
      'bulletList',
      'orderedList',
      'taskList',
      'quote',
      'divider',
      'codeBlock',
    ]);
  });

  it('shows the markdown that makes each block, so the shortcut is learned from the menu', () => {
    const markdown = Object.fromEntries(SLASH_COMMANDS.map((command) => [command.id, command.markdown]));
    expect(markdown).toEqual({
      text: undefined,
      heading1: '#',
      heading2: '##',
      heading3: '###',
      bulletList: '-',
      orderedList: '1.',
      taskList: '[]',
      quote: '>',
      divider: '---',
      codeBlock: '```',
    });
  });

  it('draws every block with an icon the editor can draw', () => {
    const drawable = new Set([...Object.keys(icons), ...Object.keys(editorIcons)]);
    for (const command of SLASH_COMMANDS) expect(drawable.has(command.icon), command.id).toBe(true);
  });

  it('matches a query in the name or at the start of another word, ignoring case and spaces', () => {
    expect(ids('')).toHaveLength(SLASH_COMMANDS.length);
    expect(ids('head')).toEqual(['heading1', 'heading2', 'heading3']);
    expect(ids('Heading 2')).toEqual(['heading2']);
    expect(ids('h1')).toEqual(['heading1']);
    expect(ids('todo')).toEqual(['taskList']);
    expect(ids('LIST')).toEqual(['bulletList', 'orderedList', 'taskList']);
    expect(ids('code')).toEqual(['codeBlock']);
    expect(ids('xyz')).toEqual([]);
  });
});
