// Notes' limits and their plain text (spec 0019), as plain TypeScript with no
// Zod, so the browser's lazily loaded notes store and the screens read them
// without the schema library. `notes.ts` re-exports them with the schemas.

/** The longest note title, in characters. */
export const NOTE_TITLE_MAX = 200;

/** The largest note body, as UTF-8 JSON: 200 KB (the rich text document's own cap). */
export const NOTE_CONTENT_MAX_BYTES = 200 * 1024;

/** The longest plain text copy of a note the server keeps, in characters. */
export const NOTE_TEXT_MAX = 100_000;

/** The most records one note links, its own record included (migration 0136). */
export const NOTE_RECORDS_MAX = 20;

/** What a note is: a plain note, or a call or a meeting logged on a record (migration 0141), for life. */
export const NOTE_KINDS = ['note', 'call', 'meeting'] as const;
/** What a note is. */
export type NoteKind = (typeof NOTE_KINDS)[number];

/** How a logged call went, in the order the dialog shows them. */
export const CALL_OUTCOMES = ['connected', 'no_answer', 'left_message'] as const;
/** How a logged meeting went, in the order the dialog shows them. */
export const MEETING_OUTCOMES = ['held', 'cancelled', 'no_show'] as const;
/** How a logged call or meeting went. */
export type NoteOutcome = (typeof CALL_OUTCOMES)[number] | (typeof MEETING_OUTCOMES)[number];

/** The outcomes a kind takes: those of a call, those of a meeting, none for a plain note. */
export function outcomesFor(kind: NoteKind): readonly NoteOutcome[] {
  return kind === 'call' ? CALL_OUTCOMES : kind === 'meeting' ? MEETING_OUTCOMES : [];
}

/** The longest logged duration, in minutes: a day. */
export const ACTIVITY_DURATION_MAX = 1440;

/** How far past now a logged call or meeting may be dated: a day (the calendar owns what is ahead). */
export const ACTIVITY_AHEAD_MS = 24 * 60 * 60 * 1000;

/** What a moment too far ahead answers, on `occurredAt`. */
export const ACTIVITY_TOO_FAR = 'Log what already happened. Meetings ahead belong in the calendar.';

/** What a kind that changes, or details on a plain note, answer. */
export const ACTIVITY_KIND_FIXED = 'A call or meeting can’t change what it is.';

/** A page of notes when the caller names no limit. */
export const NOTE_PAGE = 20;

/** The most notes one page answers. */
export const NOTE_PAGE_MAX = 50;

/** How much of a note's text its list row shows, in characters. */
export const NOTE_EXCERPT = 200;

/** How far a record's note count goes before it says "at least" ("10,000+"). */
export const NOTE_COUNT_CAP = 10_000;

/** What a body too large to save says, the same from the browser's check and the service's (AC-441). */
export const NOTE_TOO_LONG = 'This note is too long to save. Split it into two notes.';

/** What saving a note with nothing in it yet says. */
export const NOTE_EMPTY = 'Write something first.';

/** A rich text node, as far as its plain text needs it. */
interface PlainNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
}

/** Nodes that end a line of the plain text. */
const BLOCKS = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'taskList',
]);

/**
 * A document's plain text (spec 0019, `content_text`): its text in order, a
 * line break between blocks, a hard break as a line break, a mention as `@`
 * and its label; cut to `NOTE_TEXT_MAX` characters. Walked without recursion,
 * so any depth is safe. Anything that isn't a node is skipped.
 */
export function richTextToPlain(doc: unknown): string {
  let out = '';
  const stack: unknown[] = [doc];
  while (stack.length > 0 && out.length < NOTE_TEXT_MAX) {
    const item = stack.pop();
    if (item === '\n') {
      if (out !== '' && !out.endsWith('\n')) out += '\n';
      continue;
    }
    if (typeof item !== 'object' || item === null) continue;
    const node = item as PlainNode;
    if (node.type === 'text' && typeof node.text === 'string') out += node.text;
    else if (node.type === 'hardBreak') out += '\n';
    else if (node.type === 'mention') {
      const attrs = (typeof node.attrs === 'object' && node.attrs !== null ? node.attrs : {}) as Record<
        string,
        unknown
      >;
      const label = typeof attrs.label === 'string' ? attrs.label : typeof attrs.id === 'string' ? attrs.id : '';
      out += `@${label}`;
    }
    const isBlock = typeof node.type === 'string' && BLOCKS.has(node.type);
    if (isBlock) stack.push('\n');
    if (Array.isArray(node.content)) for (let i = node.content.length - 1; i >= 0; i -= 1) stack.push(node.content[i]);
  }
  return out.replace(/\n+$/, '').slice(0, NOTE_TEXT_MAX);
}

/** A list row's excerpt: the start of the text, runs of white space as one space. */
export function noteExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, NOTE_EXCERPT);
}

/** The size of a document as UTF-8 JSON, in bytes: what the 200 KB cap measures. */
export function noteBytes(doc: unknown): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}
