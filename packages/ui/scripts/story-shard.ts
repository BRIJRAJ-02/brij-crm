// `node scripts/story-shard.ts <index> <count>`: the story files one CI shard should run,
// as one space separated line. The shard runs them in a single `vitest run`.
//
// Why this exists rather than vitest's own `--shard`: that orders files by the sha1 of
// their path and, with no cache on a fresh runner, its sequencer leaves that order alone,
// so which files land first is a coin toss, and a 5 of 91 run came out of it
// (41457814575). This deals them heaviest first instead, so the two shards carry about
// the same.
//
// It picks membership, never order: the files reach vitest as filters, and vitest still
// runs them in whatever order it collected them.
//
// The shards exist because the shared browser page sometimes runs out of memory, and they
// are a MITIGATION that has never been demonstrated to help. Do not collapse them into one
// run, do not add a third, do not raise the timeout, and keep isolation on
// (`--no-isolate` hangs identically, 41448193169). A cap on files per page WAS tried here
// and removed: it predicted that a pass under the cap would survive, and a fresh page of
// 23 died after 9 (41495821106). docs/runbooks/story-page-leak.md has every observation;
// read it before concluding anything from a single run, green or red.
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

if (process.argv[1] === import.meta.filename) {
  const [index, count] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index === undefined || count === undefined) {
    throw new Error('story-shard needs an index and a count, as in `story-shard.ts 1 2`');
  }
  if (index < 1 || count < 1 || index > count) throw new Error(`a shard ${index} of ${count} doesn't exist`);
  process.stdout.write(`${shardStories(storyFiles(), index, count).join(' ')}\n`);
}
