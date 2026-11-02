// `node scripts/story-shard.ts <index> <count>`: what one CI shard should run, as one
// line per pass, each line a space separated list of story files. The shard runs a
// `vitest run` per line.
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
// So we choose the split ourselves: deal the files heaviest first into the shards, which
// balances what each shard carries and keeps the heaviest files apart. That got shard 1
// through all 91 of its files on run 41461134131, while shard 2 died after 7.
//
// This picks membership and pass boundaries, not order. The files reach vitest as
// filters, so vitest still runs them in whatever order it collected them; what we decide
// is which files share a page. A pass is one `vitest run`, so each pass gets a page of
// its own, which is stronger than ordering inside one page. That is why KEEPS_A_PAGE
// below runs alone: on run 41461134131 those four ran first in shard 2 and killed it,
// and they are the same set crm-6c's bisect hung on. Give them their own page and the
// other 86 never meet what they leave behind.
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
 * The stories that leave so much in the browser page that the files after them run out
 * of memory. They get a page to themselves. Take one out only with a run that shows the
 * shard holding it finishing without it quarantined.
 */
export const KEEPS_A_PAGE: readonly string[] = [
  'src/modules/WeekCalendar/WeekCalendar.stories.tsx',
  'src/modules/LinkPage/LinkPage.stories.tsx',
  'src/modules/SettingsLayout/SettingsLayout.stories.tsx',
  'src/modules/LinkList/LinkList.stories.tsx',
];

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
 * A shard's passes, each one a `vitest run` of its own and so a browser page of its own.
 * The files in `KEEPS_A_PAGE` this shard holds go in a pass by themselves, ahead of the
 * rest; a shard holding none of them is a single pass, exactly as it was.
 */
export function shardPasses(
  files: readonly StoryFile[],
  index: number,
  count: number,
  quarantined: readonly string[] = KEEPS_A_PAGE,
): readonly (readonly string[])[] {
  const mine = shardStories(files, index, count);
  const alone = mine.filter((file) => quarantined.includes(file));
  const rest = mine.filter((file) => !quarantined.includes(file));
  return [alone, rest].filter((pass) => pass.length > 0);
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
