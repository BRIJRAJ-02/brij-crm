// The rich text editor's stored document (spec 0003, `RichTextDoc`): Tiptap's
// JSON, never HTML, so nothing a person pastes can run. Only the node and mark
// names below are allowed (a test in packages/ui checks they equal the
// editor's schema), attributes are plain scalars, a link must pass the same
// protocol rule as the library's `safeHref()`, and nesting is capped so a
// hostile document can't exhaust the parser. `RichTextDoc` also caps the
// document at `RICH_TEXT_MAX_BYTES` as UTF-8 JSON; `RichTextDocBody` leaves
// the size to a service that checks it itself (spec 0019: a note's size is
// the service's 422, never the input parse's 400).
import * as z from 'zod';
import { isSafeLink } from './safe-link.ts';

/** The node types a document may hold. */
export const RICH_TEXT_NODES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'mention',
] as const;

/** The mark types text may carry. */
export const RICH_TEXT_MARKS = ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight'] as const;

/** The largest document, as UTF-8 JSON: 200 KB. */
export const RICH_TEXT_MAX_BYTES = 200 * 1024;

/** How deep nodes may nest (a list in a list in a quote…): far past any real note, short of a parser's stack. */
export const RICH_TEXT_MAX_DEPTH = 40;

export { isSafeLink, safeLink } from './safe-link.ts';

/** How deep a JSON value nests, counted without recursion (so a hostile one can't blow the stack). */
export function jsonDepth(value: unknown, limit: number): number {
  let deepest = 0;
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    if (typeof next.value !== 'object' || next.value === null) continue;
    deepest = Math.max(deepest, next.depth);
    if (deepest > limit) return deepest;
    for (const child of Object.values(next.value)) stack.push({ value: child, depth: next.depth + 1 });
  }
  return deepest;
}

/** The size of a document as UTF-8 JSON, in bytes: what the 200 KB cap measures. */
export function richTextBytes(doc: unknown): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/** A node's or a mark's attributes: plain scalars only. */
const Attrs = z.record(z.string().max(64), z.union([z.string().max(2_048), z.number(), z.boolean(), z.null()]));

/** One mark on a text node; a link's `href` must be safe. */
export const RichTextMark = z
  .object({ type: z.enum(RICH_TEXT_MARKS), attrs: Attrs.optional() })
  .refine((mark) => mark.type !== 'link' || (typeof mark.attrs?.href === 'string' && isSafeLink(mark.attrs.href)), {
    error: 'A link must start with http, https, mailto or tel.',
  });
/** One mark on a text node. */
export type RichTextMark = z.infer<typeof RichTextMark>;

/** One node of a document. */
export interface RichTextNode {
  readonly type: (typeof RICH_TEXT_NODES)[number];
  readonly attrs?: Readonly<Record<string, string | number | boolean | null>>;
  readonly content?: readonly RichTextNode[];
  readonly text?: string;
  readonly marks?: readonly RichTextMark[];
}

/** One node of a document, its children by the same rule. */
export const RichTextNode: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.enum(RICH_TEXT_NODES),
    attrs: Attrs.optional(),
    content: z.array(RichTextNode).optional(),
    text: z.string().optional(),
    marks: z.array(RichTextMark).optional(),
  }),
);

const DEPTH_MESSAGE = 'This document nests too deeply.';

/** A document without the size cap: a `doc` node, nested at most `RICH_TEXT_MAX_DEPTH` deep. */
export const RichTextDocBody = z
  .unknown()
  .refine((value) => jsonDepth(value, RICH_TEXT_MAX_DEPTH * 4) <= RICH_TEXT_MAX_DEPTH * 4, { error: DEPTH_MESSAGE })
  .pipe(RichTextNode)
  .refine((node) => node.type === 'doc', { error: 'A document starts with a doc node.' });
/** A document without the size cap. */
export type RichTextDocBody = z.infer<typeof RichTextDocBody>;

/** The editor's stored document: `RichTextDocBody` at most 200 KB as UTF-8 JSON. */
export const RichTextDoc = RichTextDocBody.refine((doc) => richTextBytes(doc) <= RICH_TEXT_MAX_BYTES, {
  error: 'This document is over 200 KB.',
});
/** The editor's stored document. */
export type RichTextDoc = z.infer<typeof RichTextDoc>;
