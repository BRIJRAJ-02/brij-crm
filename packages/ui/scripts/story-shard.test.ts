import { describe, expect, it } from 'vitest';

import { MAX_PER_PASS, shardPasses, shardStories, storyFiles, type StoryFile } from './story-shard.ts';

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
  it('never puts more than MAX_PER_PASS files in one pass', () => {
    for (const index of [1, 2]) {
      for (const pass of shardPasses(storyFiles(), index, 2)) {
        expect(pass.length).toBeLessThanOrEqual(MAX_PER_PASS);
      }
    }
  });

  it('runs every file of its shard exactly once, across the passes', () => {
    const shard = shardStories(FILES, 1, 2);
    expect(shardPasses(FILES, 1, 2).flat().sort()).toEqual([...shard].sort());
  });

  it('uses as few passes as the cap allows, and splits them evenly', () => {
    const files: readonly StoryFile[] = Array.from({ length: 10 }, (_, place) => ({
      file: `src/f${place}.stories.tsx`,
      size: 100,
    }));
    // Ten files under a cap of four: three passes, never 4 + 4 + 2 with a straggler.
    const passes = shardPasses(files, 1, 1, 4);
    expect(passes).toHaveLength(3);
    expect(passes.map((pass) => pass.length)).toEqual([4, 3, 3]);
  });

  it('is one pass when the shard fits under the cap', () => {
    expect(shardPasses(FILES, 1, 2, 100)).toHaveLength(1);
  });

  it('never leaves a pass empty, since vitest would then run everything', () => {
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
