import { describe, expect, it } from 'vitest';
import type { FormDocument } from '@crm/data';
import {
  addAttributeQuestion,
  addFormOnlyQuestion,
  addLayout,
  askedAttributes,
  blocksOf,
  changeBlock,
  freeId,
  moveBlock,
  removeBlock,
} from './draft.ts';

const EMAIL = '0199f0a0-0000-7000-8000-00000000000e';
const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';

const base: FormDocument = {
  steps: [
    {
      id: 'main',
      blocks: [
        {
          kind: 'question',
          id: 'email',
          label: 'Email',
          required: true,
          target: { role: 'main', attributeId: EMAIL },
          update: 'fill',
        },
      ],
    },
  ],
  targets: { main: { objectId: PEOPLE, matchAttributeId: EMAIL } },
  owner: { kind: 'none' },
  after: { kind: 'message', text: 'Thanks.' },
  style: { title: 'Contact us', buttonText: 'Send', language: 'en' },
  spam: { minFillMs: 2_500, scoreThreshold: 0.3 },
};

describe('the builder’s draft edits (spec 0023)', () => {
  it('adds a field question, a form only question and layout blocks, each with its own id', () => {
    let draft = addAttributeQuestion(base, {
      attributeId: '0199f0a0-0000-7000-8000-0000000000a1',
      title: 'Job title',
      type: 'text',
      isRequired: false,
      isUnique: false,
      canWrite: true,
    });
    draft = addFormOnlyQuestion(draft, 'long_text', 'Long text');
    draft = addLayout(draft, 'heading', 'About you');
    draft = addLayout(draft, 'divider', '');
    expect(blocksOf(draft).map((block) => block.id)).toEqual(['email', 'job-title', 'long-text', 'heading', 'divider']);
    expect(askedAttributes(draft).has(EMAIL)).toBe(true);
    // The document passed in is never changed.
    expect(blocksOf(base)).toHaveLength(1);
  });

  it('keeps ids unique and well formed', () => {
    expect(freeId(base, 'Email')).toBe('email-2');
    expect(freeId(base, '  Why? ')).toBe('why-');
    expect(freeId(base, '***')).toBe('q');
  });

  it('changes, moves and removes a block', () => {
    const two = addLayout(base, 'text', 'Hello');
    const changed = changeBlock(two, 'text', (block) => (block.kind === 'text' ? { ...block, text: 'Hi' } : block));
    expect(blocksOf(changed)[1]).toEqual({ kind: 'text', id: 'text', text: 'Hi' });
    expect(blocksOf(moveBlock(changed, 'text', -1)).map((block) => block.id)).toEqual(['text', 'email']);
    expect(moveBlock(changed, 'email', -1)).toBe(changed);
    expect(blocksOf(removeBlock(changed, 'email')).map((block) => block.id)).toEqual(['text']);
  });
});
