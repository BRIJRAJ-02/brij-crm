// Google Calendar style lanes for a day's blocks: side by side when they start together, indented over an earlier
// one when they start well after it, and "+N" when a lane would be too narrow.
import { describe, expect, it } from 'vitest';
import { placeBlocks, type Timed } from './placeBlocks.ts';

const at = (id: string, from: number, to: number): Timed => ({ id, startMinute: from * 60, endMinute: to * 60 });

const slot = (layout: ReturnType<typeof placeBlocks>, id: string) => {
  const found = layout.blocks.find((block) => block.id === id);
  if (found === undefined) throw new Error(`${id} not placed`);
  const { left, width, indent, lane, lanes, span } = found;
  return { left, width, indent, lane, lanes, span };
};

describe('placeBlocks', () => {
  it('gives a lone block the whole column', () => {
    expect(slot(placeBlocks([at('a', 9, 10)]), 'a')).toEqual({
      left: 0,
      width: 1,
      indent: 0,
      lane: 0,
      lanes: 1,
      span: 1,
    });
  });

  it('puts blocks that start together side by side', () => {
    const layout = placeBlocks([at('a', 9, 10), at('b', 9.5, 10.5)]);
    expect(slot(layout, 'a')).toMatchObject({ lane: 0, lanes: 2, span: 1, indent: 0 });
    expect(slot(layout, 'b')).toMatchObject({ lane: 1, lanes: 2, span: 1, indent: 0 });
  });

  it('indents a block that starts well after the one it overlaps, over it', () => {
    const layout = placeBlocks([at('long', 9, 12), at('later', 10, 11)]);
    expect(slot(layout, 'long')).toMatchObject({ lane: 0, lanes: 1, indent: 0 });
    expect(slot(layout, 'later')).toMatchObject({ left: 0, width: 1, lane: 0, lanes: 1, indent: 1 });
    // Paint order: the later one comes after, so it draws on top.
    expect(layout.blocks.map((block) => block.id)).toEqual(['long', 'later']);
  });

  it('nests inside the lane of the block it sits over', () => {
    const layout = placeBlocks([at('a', 9, 12), at('b', 9, 9.5), at('c', 10, 11)]);
    expect(slot(layout, 'a')).toMatchObject({ lane: 0, lanes: 2 });
    expect(slot(layout, 'c')).toMatchObject({ left: 0, width: 0.5, indent: 1, lanes: 1 });
  });

  it('widens a block into lanes free for its whole time', () => {
    const layout = placeBlocks([at('a', 9, 10), at('b', 9, 9.5), at('c', 9.25, 9.5), at('d', 9.5, 10)]);
    // a, b, c take three lanes; d starts after b and c end, in lane 1, and lane 2 stays free under it.
    expect(slot(layout, 'd')).toMatchObject({ lane: 1, lanes: 3, span: 2 });
    expect(slot(layout, 'a')).toMatchObject({ lane: 0, span: 1 });
  });

  it('folds lanes too narrow to draw into "+N", hiding nothing', () => {
    const blocks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => at(id, 9, 10));
    const layout = placeBlocks(blocks);
    expect(layout.blocks).toHaveLength(2);
    expect(layout.blocks.every((block) => block.lanes === 3)).toBe(true);
    expect(layout.more).toHaveLength(1);
    expect(layout.more[0]).toMatchObject({ lane: 2, lanes: 3, startMinute: 540 });
    expect(layout.more[0]?.hidden.map((block) => block.id)).toEqual(['c', 'd', 'e', 'f']);
    expect(layout.blocks.length + (layout.more[0]?.hidden.length ?? 0)).toBe(blocks.length);
  });

  it('steps a chain of overlaps in no further than MAX_INDENT', () => {
    const chain = Array.from({ length: 8 }, (_, index) => at(`c${String(index)}`, 9 + index, 11 + index));
    const layout = placeBlocks(chain);
    expect(layout.blocks.map((block) => block.indent)).toEqual([0, 1, 2, 3, 3, 3, 3, 3]);
  });

  it('gives a folded block that starts well after the chip a chip of its own, where it starts', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => at(id, 9, 12));
    const layout = placeBlocks([...five, at('late', 10.5, 11)]);
    expect(layout.more.map((more) => [more.startMinute, more.hidden.map((block) => block.id)])).toEqual([
      [540, ['c', 'd', 'e']],
      [630, ['late']],
    ]);
  });

  it('keeps clusters apart: blocks that never overlap each take the whole column', () => {
    const layout = placeBlocks([at('a', 9, 10), at('b', 9, 10), at('c', 11, 12)]);
    expect(slot(layout, 'c')).toMatchObject({ lane: 0, lanes: 1, indent: 0 });
  });
});
