// Notes' shapes (spec 0019, AC-441): the stored document's rules (allowed
// nodes and marks, safe links, the nesting cap, the 200 KB cap that only
// `RichTextDoc` applies) and the server's plain text copy.
import { describe, expect, it } from 'vitest';
import { noteExcerpt, richTextToPlain, SaveNoteInput } from './notes.ts';
import { RICH_TEXT_MAX_BYTES, RichTextDoc, RichTextDocBody } from './values/rich-text.ts';

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('RichTextDoc', () => {
  it('takes a document of the allowed nodes and marks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Call notes')] },
        para(
          text('Bold', [{ type: 'bold' }]),
          text(' and a '),
          text('link', [{ type: 'link', attrs: { href: 'https://acme.test' } }]),
        ),
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('Send it'))] }],
        },
        para({ type: 'mention', attrs: { id: 'm1', label: 'Ada' } }),
      ],
    };
    expect(RichTextDoc.safeParse(doc).success).toBe(true);
  });

  it('refuses an unknown node, a script link, a non doc root and deep nesting', () => {
    expect(RichTextDoc.safeParse({ type: 'doc', content: [{ type: 'image' }] }).success).toBe(false);
    const evil = para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]));
    expect(RichTextDoc.safeParse({ type: 'doc', content: [evil] }).success).toBe(false);
    expect(RichTextDoc.safeParse(para(text('x'))).success).toBe(false);
    let deep: unknown = text('x');
    for (let i = 0; i < 5_000; i += 1) deep = { type: 'blockquote', content: [deep] };
    expect(RichTextDocBody.safeParse({ type: 'doc', content: [deep] }).success).toBe(false);
  });

  it('caps the size in RichTextDoc only, so a save reaches the service with it', () => {
    const big = { type: 'doc', content: [para(text('a'.repeat(RICH_TEXT_MAX_BYTES)))] };
    expect(RichTextDoc.safeParse(big).success).toBe(false);
    expect(RichTextDocBody.safeParse(big).success).toBe(true);
    const save = SaveNoteInput.safeParse({
      workspace: 'acme',
      id: '0199a6f2-0000-7000-8000-000000000001',
      recordId: '0199a6f2-0000-7000-8000-000000000002',
      content: big,
      mutationId: '0199a6f2-0000-7000-8000-000000000003',
    });
    expect(save.success).toBe(true);
  });
});

describe('richTextToPlain', () => {
  it('writes text in order, a line between blocks, mentions as @label', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [text('Title')] },
        para(text('Hello '), { type: 'mention', attrs: { id: 'm1', label: 'Ada' } }, text('!')),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para(text('one'))] },
            { type: 'listItem', content: [para(text('two'))] },
          ],
        },
        para(text('a'), { type: 'hardBreak' }, text('b')),
      ],
    };
    expect(richTextToPlain(doc)).toBe('Title\nHello @Ada!\none\ntwo\na\nb');
    expect(richTextToPlain({ type: 'doc' })).toBe('');
    expect(richTextToPlain('nonsense')).toBe('');
  });

  it('cuts at 100,000 characters, and an excerpt joins white space', () => {
    expect(richTextToPlain({ type: 'doc', content: [para(text('x'.repeat(150_000)))] })).toHaveLength(100_000);
    expect(noteExcerpt('  Call\n\n  back   soon ')).toBe('Call back soon');
  });
});
