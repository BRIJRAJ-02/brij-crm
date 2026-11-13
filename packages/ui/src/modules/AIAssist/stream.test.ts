// AIAssist's stream (spec 0073, batch 3, gate 3): however long an answer grows, each new piece changes only the open
// block and the fresh piece, and every closed block stays the same string, so nothing redraws in proportion to the
// answer's length; the pieces always join back into exactly what arrived.
import { describe, expect, it } from 'vitest';
import {
  answerWords,
  appendPiece,
  EMPTY_STREAM,
  REVEAL_STEPS,
  settleStream,
  streamedText,
  wordsPerStep,
  type StreamState,
} from './stream.ts';

describe('appendPiece', () => {
  it('keeps the newest piece apart, to fade in, and settles the one before', () => {
    const one = appendPiece(EMPTY_STREAM, 'Acme ');
    expect(one).toEqual({ blocks: [], open: '', fresh: 'Acme ', pieces: 1 });
    const two = appendPiece(one, 'Corp is');
    expect(two).toEqual({ blocks: [], open: 'Acme ', fresh: 'Corp is', pieces: 2 });
    expect(streamedText(two)).toBe('Acme Corp is');
  });

  it('changes nothing for an empty piece', () => {
    const one = appendPiece(EMPTY_STREAM, 'Acme');
    expect(appendPiece(one, '')).toBe(one);
  });

  it('closes the open text into blocks at a space, and never touches a closed block again', () => {
    let stream: StreamState = EMPTY_STREAM;
    const pieces: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const piece = `word${String(index)} `;
      pieces.push(piece);
      const before = stream.blocks;
      stream = appendPiece(stream, piece, 50);
      // Closed blocks are only ever added to: the ones before keep their identity and their text.
      before.forEach((block, at) => {
        expect(stream.blocks[at]).toBe(block);
      });
      expect(stream.open.length).toBeLessThanOrEqual(50);
    }
    expect(stream.blocks.length).toBeGreaterThan(40);
    for (const block of stream.blocks) {
      expect(block.length).toBeLessThanOrEqual(50);
      expect(block.endsWith(' ')).toBe(true);
    }
    expect(streamedText(stream)).toBe(pieces.join(''));
  });

  it('cuts a word longer than a block where the block ends', () => {
    const stream = appendPiece(appendPiece(EMPTY_STREAM, 'x'.repeat(25)), 'y', 10);
    expect(stream.blocks).toEqual(['x'.repeat(10), 'x'.repeat(10)]);
    expect(stream.open).toBe('x'.repeat(5));
    expect(streamedText(stream)).toBe(`${'x'.repeat(25)}y`);
  });

  it('keeps a piece of markup as the characters it is: the stream is text, never HTML', () => {
    const stream = appendPiece(EMPTY_STREAM, '<img src=x onerror=alert(1)>');
    expect(streamedText(stream)).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('settleStream', () => {
  it('settles the fresh piece into the open text, and is a no op once settled', () => {
    const settled = settleStream(appendPiece(appendPiece(EMPTY_STREAM, 'Acme '), 'Corp'));
    expect(settled).toEqual({ blocks: [], open: 'Acme Corp', fresh: '', pieces: 2 });
    expect(settleStream(settled)).toBe(settled);
  });
});

describe('the reveal of an answer handed over whole', () => {
  it('cuts it into words that join back into the answer, line breaks and all', () => {
    const answer = 'Acme Corp is Qualified.\n\nNext: the  Thursday demo. ';
    expect(answerWords(answer).join('')).toBe(answer);
    expect(answerWords('')).toEqual([]);
  });

  it('shows two words a step, and more for a long answer, so it never takes more than its steps', () => {
    expect(wordsPerStep(10)).toBe(2);
    expect(wordsPerStep(120)).toBe(2);
    expect(wordsPerStep(10_000)).toBe(Math.ceil(10_000 / REVEAL_STEPS));
    expect(Math.ceil(10_000 / wordsPerStep(10_000))).toBeLessThanOrEqual(REVEAL_STEPS);
  });
});
