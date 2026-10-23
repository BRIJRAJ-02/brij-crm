// The operator console's definers (spec 0047) cross every workspace, and crm_app may execute them, as it may the
// public lookups: what keeps them to the console is that only its reads call them. This walks the server sources
// and fails when any other file names one.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The one file allowed to call them, beside tests and the migration that makes them. */
const ALLOWED = new Set(['packages/core/src/operator/reads.ts']);

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}

describe('the operator definers', () => {
  it('are called only from the operator reads', async () => {
    const files = (
      await Promise.all(
        ['apps/api/src', 'packages/core/src', 'packages/db/src', 'packages/data/src'].map((dir) =>
          sources(join(ROOT, dir)),
        ),
      )
    ).flat();
    const callers: string[] = [];
    for (const file of files) {
      const path = relative(ROOT, file);
      if (!ALLOWED.has(path) && (await readFile(file, 'utf8')).includes('crm_operator_')) callers.push(path);
    }
    expect(files.length).toBeGreaterThan(100);
    expect(callers).toEqual([]);
  });
});
