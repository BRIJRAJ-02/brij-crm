// Every write to `members` stores a `members` row (spec 0007, AC-82, AC-85):
// the relay keeps a workspace's audiences until it reaches one, and a rule
// that names ids only to an audience whose every member may read them (jobs,
// private views, tasks) would leak to a member the cached audience lacks. So
// a file that inserts or updates `members` must record the members it
// changed in the `Change`, unless it only makes a workspace nobody is in yet.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Files that write `members` only for a workspace nobody can be subscribed to yet (made, or seeded). */
const BEFORE_ANYONE_LISTENS: ReadonlySet<string> = new Set([
  'src/engine/workspaces.ts',
  'scripts/seed-crm.ts',
  'scripts/seed-scale.ts',
  'scripts/bench-notes-tasks.ts',
]);

const WRITES = /insert\s+into\s+members\b|update\s+members\b|\.insert\(members\)|\.update\(members\)/i;

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, directory), { recursive: true });
  return entries
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => relative(ROOT, join(ROOT, directory, file)));
}

describe('writes to members', () => {
  it('record the members they changed, so the outbox stores a members row', async () => {
    const files = [...(await sources('src')), ...(await sources('scripts'))];
    const writers: string[] = [];
    for (const file of files) {
      const text = await readFile(join(ROOT, file), 'utf8');
      if (WRITES.test(text)) writers.push(file);
    }
    expect(writers).toContain('src/members/members.ts');
    const silent: string[] = [];
    for (const file of writers.filter((name) => !BEFORE_ANYONE_LISTENS.has(name))) {
      const text = await readFile(join(ROOT, file), 'utf8');
      if (!/record\(\{\s*members:/.test(text)) silent.push(file);
    }
    expect(silent).toEqual([]);
  });
});
