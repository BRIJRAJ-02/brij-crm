import { RICH_TEXT_MARKS, RICH_TEXT_NODES, RichTextDocBody } from '@crm/contracts/values';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { noteExtensions } from './extensions.ts';

const schema = getSchema(noteExtensions());

/** A note with every node and mark the editor writes. */
const EVERY_PART = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Kick off' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' struck', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' under', marks: [{ type: 'underline' }] },
        { type: 'text', text: ' code', marks: [{ type: 'code' }] },
        { type: 'text', text: ' marked', marks: [{ type: 'highlight' }] },
        { type: 'text', text: ' a link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'hardBreak' },
        { type: 'mention', attrs: { id: 'm1', label: 'Ada Lovelace' } },
      ],
    },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Send the deck' }] }],
        },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;' }] },
    { type: 'horizontalRule' },
  ],
};

describe('the editor schema', () => {
  it('has exactly the node names the stored document allows', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual([...RICH_TEXT_NODES].sort());
  });

  it('has exactly the mark names the stored document allows', () => {
    expect(Object.keys(schema.marks).sort()).toEqual([...RICH_TEXT_MARKS].sort());
  });

  it('writes documents that parse as RichTextDocBody, with no class names stored', () => {
    const json = Node.fromJSON(schema, EVERY_PART).toJSON() as unknown;
    expect(RichTextDocBody.safeParse(json).success).toBe(true);
    expect(JSON.stringify(json)).not.toContain('ws-');
  });

  it('builds the same schema with classes, so the stylesheet never changes what is stored', () => {
    const styled = getSchema(noteExtensions({ classes: { paragraph: 'ws-p', bold: 'ws-b' }, placeholder: 'Write' }));
    const json = Node.fromJSON(styled, EVERY_PART).toJSON() as unknown;
    expect(JSON.stringify(json)).not.toContain('ws-');
    expect(Object.keys(styled.nodes)).toEqual(Object.keys(schema.nodes));
  });
});
