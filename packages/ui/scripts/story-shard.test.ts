import { describe, expect, it } from 'vitest';

import { KEEPS_A_PAGE, shardPasses, shardStories, storyFiles, type StoryFile } from './story-shard.ts';

/** Ten files, heaviest to lightest, so the weights are easy to read in an expectation. */
const FILES: readonly StoryFile[] = Array.from({ length: 10 }, (_, place) => ({
  file: `src/f${place}.stories.tsx`,
  size: (10 - place) * 100,
}));

describe('shardStories', () => {
  it('splits every file across the shards exactly once', () => {
    const one = shardStories(FILES, 1, 2);
    const two = shardStories(FILES, 2, 2);
    expect([...one, ...two].sort()).toEqual(FILES.map(({ file }) => file).sort());
  });

  it('gives the shards about the same weight, by dealing the heaviest first', () => {
    const weigh = (shard: readonly string[]): number =>
      shard.reduce((total, file) => total + (FILES.find((one) => one.file === file)?.size ?? 0), 0);
    const [one, two] = [weigh(shardStories(FILES, 1, 2)), weigh(shardStories(FILES, 2, 2))];
    expect(Math.abs(one - two)).toBeLessThanOrEqual(FILES[0]?.size ?? 0);
  });

  it('never runs two heavy files in a row, which is what the browser page cannot survive', () => {
    const shard = shardStories(FILES, 1, 2);
    // f0, f2, f4, f6, f8 are this shard's files, heaviest first; alternating pairs the
    // heaviest with the lightest, so the sizes zigzag rather than descend.
    expect(shard).toEqual([
      'src/f0.stories.tsx',
      'src/f8.stories.tsx',
      'src/f2.stories.tsx',
      'src/f6.stories.tsx',
      'src/f4.stories.tsx',
    ]);
  });

  it('is stable: the same files always shard the same way', () => {
    expect(shardStories(FILES, 1, 3)).toEqual(shardStories([...FILES].reverse(), 1, 3));
  });

  it('runs every file when the count is one', () => {
    expect(shardStories(FILES, 1, 1)).toHaveLength(FILES.length);
  });
});

describe('shardPasses', () => {
  it('gives the files that keep a page one of their own, ahead of the rest', () => {
    const files: readonly StoryFile[] = [
      { file: 'src/a.stories.tsx', size: 400 },
      { file: 'src/killer.stories.tsx', size: 300 },
      { file: 'src/b.stories.tsx', size: 200 },
      { file: 'src/c.stories.tsx', size: 100 },
    ];
    const passes = shardPasses(files, 1, 1, ['src/killer.stories.tsx']);
    expect(passes[0]).toEqual(['src/killer.stories.tsx']);
    expect(passes[1]).not.toContain('src/killer.stories.tsx');
    expect(passes.flat().sort()).toEqual(files.map(({ file }) => file).sort());
  });

  it('is one pass when the shard holds none of them', () => {
    expect(shardPasses(FILES, 1, 2, [])).toHaveLength(1);
  });

  it('quarantines the four that killed shard 2, and only in the shard that holds them', () => {
    const passes = [shardPasses(storyFiles(), 1, 2), shardPasses(storyFiles(), 2, 2)];
    const alone = passes.flatMap((shard) => (shard.length > 1 ? (shard[0] ?? []) : []));
    expect([...alone].sort()).toEqual([...KEEPS_A_PAGE].sort());
  });

  it('never leaves a pass empty, since vitest would run everything', () => {
    expect(shardPasses(storyFiles(), 1, 2).every((pass) => pass.length > 0)).toBe(true);
    expect(shardPasses(storyFiles(), 2, 2).every((pass) => pass.length > 0)).toBe(true);
  });
});

describe('storyFiles', () => {
  it('finds every story in the library, each with a size', () => {
    const found = storyFiles();
    expect(found.length).toBeGreaterThan(100);
    expect(found.every(({ file, size }) => file.endsWith('.stories.tsx') && size > 0)).toBe(true);
  });
});
