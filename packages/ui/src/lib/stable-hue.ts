import { HUES, type Hue } from '../hue.ts';
import { memoIntl } from './intl-memo.ts';

/** The hue for something with no hue of its own (an avatar with no picture): a stable hash of its id over the nine hues. */
export function stableHue(id: string): Hue {
  // FNV-1a: small, fast and spreads short ids well.
  let hash = 0x811c9dc5;
  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return HUES[(hash >>> 0) % HUES.length] ?? 'gray';
}

/** Up to two initials from a name: the first letters of its first and last words ("Ada Lovelace" gives "AL"). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const first = words[0];
  if (first === undefined) return '';
  const last = words.length > 1 ? words.at(-1) : undefined;
  const segmenter = memoIntl('segmenter', () => new Intl.Segmenter());
  const letter = (word: string) =>
    segmenter.segment(word)[Symbol.iterator]().next().value?.segment.toLocaleUpperCase() ?? '';
  return `${letter(first)}${last === undefined ? '' : letter(last)}`;
}
