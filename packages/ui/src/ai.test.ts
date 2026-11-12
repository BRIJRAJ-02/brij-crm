// Ask AI is its own entry (`@crm/ui/ai`, spec 0073, AC-7314), loaded with import(): the main entry must never reach
// it, or its module and stylesheet land in every page that imports anything from `@crm/ui`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
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

const AI_MODULE = path.join(SRC, 'modules', 'AIAssist') + path.sep;

describe('@crm/ui/ai', () => {
  it('is an entry of its own that reaches AIAssist', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')) as {
      readonly exports: Readonly<Record<string, string>>;
    };
    expect(manifest.exports['./ai']).toBe('./src/ai.ts');
    expect([...reachable(path.join(SRC, 'ai.ts'))].some((file) => file.startsWith(AI_MODULE))).toBe(true);
  });

  it('is never reached from the main entry or a public page entry', () => {
    for (const entry of [
      'index.ts',
      'public-booking/booking.ts',
      'public-form/hosted-form.ts',
      'public-menu/menu.ts',
    ]) {
      const files = [...reachable(path.join(SRC, entry))];
      expect(files.length, entry).toBeGreaterThan(10);
      expect(
        files.filter((file) => file.startsWith(AI_MODULE)),
        entry,
      ).toEqual([]);
    }
  });
});
