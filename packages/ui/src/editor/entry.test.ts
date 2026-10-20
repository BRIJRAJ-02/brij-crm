// The editor is its own entry (`@crm/ui/editor`), loaded with import(): the
// main entry must never reach it, or Tiptap and ProseMirror land in the app's
// first load.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');
const RELATIVE_IMPORT =
  /(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** Every library file the entry reaches through relative imports, static or dynamic. */
function reachable(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !/\.tsx?$/.test(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (specifier !== undefined) queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return seen;
}

describe('@crm/ui/editor', () => {
  it('is never reached from the main entry', () => {
    const files = [...reachable(path.join(SRC, 'index.ts'))];
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => file.startsWith(path.join(SRC, 'editor') + path.sep))).toEqual([]);
  });

  it('is never reached from the main entry by a Tiptap import either', () => {
    const tiptap = [...reachable(path.join(SRC, 'index.ts'))].filter((file) =>
      readFileSync(file, 'utf8').includes("from '@tiptap/"),
    );
    expect(tiptap).toEqual([]);
  });
});
