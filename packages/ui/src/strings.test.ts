// The library's built in copy follows the copy style: an ellipsis is the one
// character "…", never three full stops, and an empty attribute reads
// "Set <Attribute>…" with the attribute's name as people wrote it.
import { describe, expect, it } from 'vitest';
import { strings as fieldStrings } from './molecules/Field/strings.ts';

const modules = import.meta.glob<{ readonly strings: unknown }>('./**/strings.ts', { eager: true });

/** Every text a strings object can give: its strings, and its functions called with sample names and numbers. */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const call = value as (...args: unknown[]) => unknown;
    // Some take names, some counts, some lists; whatever a function can't take, it says nothing for.
    return [['Phone numbers', 'Phone numbers'], [3, 5], [['Ada', 'Grace']]].flatMap((args) => {
      try {
        return textsOf(call(...args));
      } catch {
        return [];
      }
    });
  }
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(textsOf);
  return [];
}

describe('built in copy', () => {
  it('writes an ellipsis as one character, never three full stops', () => {
    const files = Object.keys(modules);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      for (const text of textsOf(modules[file]?.strings)) {
        expect(text, `${file}: ${text}`).not.toContain('...');
      }
    }
  });

  it('reads an empty attribute as "Set <Attribute>…", keeping the name as written', () => {
    expect(fieldStrings.setAttribute('Instagram')).toBe('Set Instagram…');
    expect(fieldStrings.setAttribute('Close-lost reason')).toBe('Set Close-lost reason…');
  });
});
