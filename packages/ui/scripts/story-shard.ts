// `node scripts/story-shard.ts <index> <count>`: the story files one CI shard should
// run, one per line, in the order it should run them.
//
// Why this exists rather than vitest's own `--shard`. Every story file in an engine
// shares one long lived browser page, and what a file leaves behind in that page is
// never fully reclaimed, so a run of heavy files back to back kills it: WebKit ran out
// of memory 62 files in on run 41448200887 and 74 in on 41453929022, and with
// `--shard=1/2` it died after 5 (run 41457814575). Vitest's `shard()` orders the files
// by the sha1 of their path and slices that, and with no cache on a fresh runner its
// `sort()` leaves that order alone, so which files land first is effectively a coin
// toss, and that run of 5 drew four of the heaviest in the library.
//
// So we choose the split and the order ourselves: deal the files heaviest first into
// the shards, which balances what each shard carries, then within a shard alternate a
// heavy file and a light one, so no shard ever runs a stretch of heavy files. File
// isolation stays on, and the shard count is a reading of the symptom, not a knob: if a
// shard dies again, what a story leaves in the page has grown.
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
 * The files for shard `index` of `count` (both 1 based), ordered heavy, light, heavy,
 * light. Dealing heaviest first gives every shard about the same total, and alternating
 * inside it keeps heavy files apart, which is what the browser page cannot survive.
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

if (process.argv[1] === import.meta.filename) {
  const [index, count] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index === undefined || count === undefined) {
    throw new Error('story-shard needs an index and a count, as in `story-shard.ts 1 2`');
  }
  if (index < 1 || count < 1 || index > count) throw new Error(`a shard ${index} of ${count} doesn't exist`);
  process.stdout.write(`${shardStories(storyFiles(), index, count).join('\n')}\n`);
}
