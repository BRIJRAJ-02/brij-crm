// The form builder's draft edits (spec 0023, milestone 1), as plain functions
// over a draft document, each answering a new one: add a question for an
// attribute or a form only question, add a heading, text or divider, change,
// move or remove a block. Milestone 1 forms have one step. No React, so they
// test in Node.
import type { FormAttributeChoice, FormBlock, FormDocument, QuestionBlock } from '@crm/data';

/** The types a form only question can take, with their names in the builder (`FORM_ONLY_TYPES`). */
export const FORM_ONLY_CHOICES = [
  { type: 'text', label: 'Short text' },
  { type: 'long_text', label: 'Long text' },
  { type: 'email', label: 'Email' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'rating', label: 'Rating' },
  { type: 'url', label: 'Link' },
] as const;
/** A form only question's type. */
export type FormOnlyType = (typeof FORM_ONLY_CHOICES)[number]['type'];

/** The one step's blocks. */
export function blocksOf(document: FormDocument): readonly FormBlock[] {
  return document.steps[0]?.blocks ?? [];
}

/** The document with its one step's blocks replaced. */
function withBlocks(document: FormDocument, blocks: readonly FormBlock[]): FormDocument {
  const [step] = document.steps;
  return {
    ...document,
    steps: [
      { id: step?.id ?? 'main', ...(step?.title === undefined ? {} : { title: step.title }), blocks: [...blocks] },
    ],
  };
}

/** A block id not yet used in the document: `base`, else `base-2`, `base-3`, … */
export function freeId(document: FormDocument, base: string): string {
  const taken = new Set([...document.steps.map((step) => step.id), ...blocksOf(document).map((block) => block.id)]);
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .slice(0, 30) || 'q';
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n += 1) {
    const id = `${clean}-${String(n)}`;
    if (!taken.has(id)) return id;
  }
}

/** The attributes already asked by a question. */
export function askedAttributes(document: FormDocument): ReadonlySet<string> {
  return new Set(
    blocksOf(document).flatMap((block) =>
      block.kind === 'question' && 'attributeId' in block.target ? [block.target.attributeId] : [],
    ),
  );
}

/** Adds a question for one of the main object's attributes, at the end. */
export function addAttributeQuestion(document: FormDocument, choice: FormAttributeChoice): FormDocument {
  const question: QuestionBlock = {
    kind: 'question',
    id: freeId(document, choice.type === 'email' ? 'email' : choice.title),
    label: choice.title,
    required: choice.isRequired,
    target: { role: 'main', attributeId: choice.attributeId },
    update: 'fill',
  };
  return withBlocks(document, [...blocksOf(document), question]);
}

/** Adds a question kept on the submission only, at the end. */
export function addFormOnlyQuestion(document: FormDocument, type: FormOnlyType, label: string): FormDocument {
  const question: QuestionBlock = {
    kind: 'question',
    id: freeId(document, label),
    label,
    required: false,
    target: { formOnly: true, type },
    update: 'fill',
  };
  return withBlocks(document, [...blocksOf(document), question]);
}

/** Adds a heading, a line of text or a divider, at the end. */
export function addLayout(document: FormDocument, kind: 'heading' | 'text' | 'divider', text: string): FormDocument {
  const id = freeId(document, kind);
  const block: FormBlock = kind === 'divider' ? { kind, id } : { kind, id, text };
  return withBlocks(document, [...blocksOf(document), block]);
}

/** Changes one block: the change is merged into it (its id and kind stay). */
export function changeBlock(document: FormDocument, id: string, change: (block: FormBlock) => FormBlock): FormDocument {
  return withBlocks(
    document,
    blocksOf(document).map((block) => (block.id === id ? { ...change(block), id: block.id } : block)),
  );
}

/** Removes one block. */
export function removeBlock(document: FormDocument, id: string): FormDocument {
  return withBlocks(
    document,
    blocksOf(document).filter((block) => block.id !== id),
  );
}

/** Moves one block up (-1) or down (1) by one place; at an end, nothing changes. */
export function moveBlock(document: FormDocument, id: string, direction: -1 | 1): FormDocument {
  const blocks = [...blocksOf(document)];
  const at = blocks.findIndex((block) => block.id === id);
  const to = at + direction;
  const moving = blocks[at];
  const other = blocks[to];
  if (at < 0 || moving === undefined || other === undefined) return document;
  blocks[at] = other;
  blocks[to] = moving;
  return withBlocks(document, blocks);
}
