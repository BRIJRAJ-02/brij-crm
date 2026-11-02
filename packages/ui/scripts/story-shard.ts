// `node scripts/story-shard.ts <index> <count>`: what one CI shard should run, as one
// line per pass, each line a space separated list of story files. The shard runs a
// `vitest run` per line.
//
// Why this exists rather than vitest's own `--shard`. Every story file in an engine
// shares one long lived browser page, and sometimes that page runs out of memory. It is
// a MITIGATION, not a fix, and not a demonstrated one: the crash point is a distribution
// rather than a property of a tree, and splitting the set has one green behind it
// (41469582229) against a branch with no library change that both passed its whole set
// three times and crashed at 37 of 178. Read docs/runbooks/story-page-leak.md, which
// lists every observation, before concluding anything from a run of this.
//
// What it does: deal the files heaviest first into the shards, so each carries about the
// same, and give KEEPS_A_PAGE a pass of its own. It picks membership and pass boundaries,
// never order, because the files reach vitest as filters and vitest still runs them in
// whatever order it collected them. A pass is one `vitest run`, so each pass is a fresh
// page. We avoided vitest's own `--shard` because it orders files by the sha1 of their
// path and, with no cache on a fresh runner, its `sort()` leaves that order alone, so
// which files land first is a coin toss; a 5 of 91 run came out of that (41457814575).
//
// File isolation stays on, and the shard count is a reading of the symptom, not a knob:
// if a shard dies again, what a story leaves in the page has grown.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const UI = path.resolve(import.meta.dirname, '..');

/** One story file and what it weighs, the stand in for how much it leaves in the page. */
export type StoryFile = { readonly file: string; readonly size: number };

/** Every story file under `src`, by path relative to the package, in a stable order. */
export function storyFiles(root: string = UI): readonly StoryFile[] {
  const src = path.join(root, 'src');
  return readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.stories.tsx'))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort()
    .map((file) => ({ file, size: statSync(path.join(root, file)).size }));
}

/**
 * The most files one pass may run. WebKit has died after the 37th file four times, on
 * two shardings, two file counts per page and four trees (41477180390, 41478500792,
 * 41490051715, 41491888165), while what the page was scheduled to run never moved that
 * figure. If the ceiling really is counted in files, a pass below it survives, so every
 * pass is kept comfortably under. 30 rather than 36 because 37 is the only count we have
 * seen it reach, not a measured limit.
 */
export const MAX_PER_PASS = 30;

/**
 * The files for shard `index` of `count` (both 1 based). Dealing heaviest first gives
 * every shard about the same total and keeps the heaviest files apart.
 */
export function shardStories(files: readonly StoryFile[], index: number, count: number): readonly string[] {
  const heaviestFirst = [...files].sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
  const mine = heaviestFirst.filter((_, place) => place % count === index - 1).map(({ file }) => file);
  const alternating: string[] = [];
  for (let heavy = 0, light = mine.length - 1; heavy <= light; heavy += 1, light -= 1) {
    alternating.push(mine[heavy] as string);
    if (heavy !== light) alternating.push(mine[light] as string);
  }
  return alternating;
}

/**
 * A shard's passes, each one a `vitest run` of its own and so a browser page of its own,
 * none holding more than `MAX_PER_PASS` files. Split into as few passes as that allows
 * and then evenly, so no pass is a straggler of one.
 */
export function shardPasses(
  files: readonly StoryFile[],
  index: number,
  count: number,
  maxPerPass: number = MAX_PER_PASS,
): readonly (readonly string[])[] {
  const mine = shardStories(files, index, count);
  if (mine.length === 0) return [];
  const howMany = Math.ceil(mine.length / maxPerPass);
  const passes: string[][] = Array.from({ length: howMany }, () => []);
  mine.forEach((file, place) => passes[place % howMany]?.push(file));
  return passes.filter((pass) => pass.length > 0);
}

if (process.argv[1] === import.meta.filename) {
  const [index, count] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index === undefined || count === undefined) {
    throw new Error('story-shard needs an index and a count, as in `story-shard.ts 1 2`');
  }
  if (index < 1 || count < 1 || index > count) throw new Error(`a shard ${index} of ${count} doesn't exist`);
  const passes = shardPasses(storyFiles(), index, count);
  process.stdout.write(`${passes.map((pass) => pass.join(' ')).join('\n')}\n`);
}
