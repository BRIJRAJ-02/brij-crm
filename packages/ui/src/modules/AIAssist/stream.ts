// An answer as it streams in (spec 0073, batch 3), held so that drawing it never costs in proportion to its length
// (gate 3): the text already settled is cut into closed blocks of at most `STREAM_BLOCK` characters, which never
// change again and so are never drawn again; one open block takes what settles next; and only the newest piece,
// `fresh`, fades in. Every piece is plain text, drawn as text nodes, never as HTML (AC-7317). Pure, so it is tested
// in Node.

/** The most characters a closed block holds: past it the open block closes at its last space. */
export const STREAM_BLOCK = 1_000;

/** How many reveal steps a whole answer handed over at once takes at most, so a long answer never keeps anyone waiting. */
export const REVEAL_STEPS = 60;

/** The fewest words one reveal step shows: the prototype's pace, two words a step. */
export const REVEAL_MIN_WORDS = 2;

/** An answer so far: closed blocks, the open block, and the newest piece. */
export interface StreamState {
  /** Settled text in blocks that never change again; a new array only when a block closes. */
  readonly blocks: readonly string[];
  /** Settled text after the last closed block. */
  readonly open: string;
  /** The newest piece, which fades in; it settles into `open` when the next piece arrives. */
  readonly fresh: string;
  /** Counts the pieces, so the newest one is drawn afresh (and fades in) each time. */
  readonly pieces: number;
}

/** Nothing streamed yet. */
export const EMPTY_STREAM: StreamState = { blocks: [], open: '', fresh: '', pieces: 0 };

/** The whole answer so far, as one string: what Copy and Save as note take. */
export function streamedText(stream: StreamState): string {
  return stream.blocks.join('') + stream.open + stream.fresh;
}

/** Cuts `text` at its last whitespace at or before `limit` (or at `limit` when a word runs past it). */
function cutAt(text: string, limit: number): number {
  const space = text.lastIndexOf(' ', limit);
  const line = text.lastIndexOf('\n', limit);
  const at = Math.max(space, line);
  return at > 0 ? at + 1 : limit;
}

/** `open` closed into blocks of at most `block` characters, after `blocks`; what is left stays open. */
function closeBlocks(
  blocks: readonly string[],
  text: string,
  block: number,
): { readonly blocks: readonly string[]; readonly open: string } {
  if (text.length <= block) return { blocks, open: text };
  const closed: string[] = [];
  let open = text;
  while (open.length > block) {
    const at = cutAt(open, block);
    closed.push(open.slice(0, at));
    open = open.slice(at);
  }
  return { blocks: [...blocks, ...closed], open };
}

/**
 * The stream with `piece` arrived: the last fresh piece settles into the open block, the open block closes into
 * blocks of at most `block` characters, and `piece` becomes the fresh one. An empty piece changes nothing.
 */
export function appendPiece(stream: StreamState, piece: string, block = STREAM_BLOCK): StreamState {
  if (piece === '') return stream;
  return { ...closeBlocks(stream.blocks, stream.open + stream.fresh, block), fresh: piece, pieces: stream.pieces + 1 };
}

/** The stream with its fresh piece settled: nothing is fading in any more (the answer is done or stopped). */
export function settleStream(stream: StreamState, block = STREAM_BLOCK): StreamState {
  if (stream.fresh === '') return stream;
  return { ...closeBlocks(stream.blocks, stream.open + stream.fresh, block), fresh: '', pieces: stream.pieces };
}

/** An answer handed over whole, cut into words with the spaces after them kept, so joining them gives it back. */
export function answerWords(answer: string): readonly string[] {
  return answer.match(/\S+\s*|\s+/g) ?? [];
}

/**
 * How many words each reveal step shows for an answer of `words` words: two at least (the prototype's pace), and
 * more for a long answer, so the whole of it shows within `REVEAL_STEPS` steps.
 */
export function wordsPerStep(words: number): number {
  return Math.max(REVEAL_MIN_WORDS, Math.ceil(words / REVEAL_STEPS));
}
