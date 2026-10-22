import { HUES, type Hue } from '../hue.ts';
import { memoIntl } from './intl-memo.ts';

/**
 * The hue for something with no hue of its own (an avatar with no picture): a stable hash of its id over the
 * nine hues, or over `among` (a link card's edge leaves out grey and red).
 */
export function stableHue(id: string, among: readonly Hue[] = HUES): Hue {
  // FNV-1a: small, fast and spreads short ids well.
  let hash = 0x811c9dc5;
  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return among[(hash >>> 0) % among.length] ?? 'gray';
}

/** The hues a link may take from its id: every data hue but grey (neutral) and red (an error). */
const LINK_HUES = HUES.filter((hue) => hue !== 'gray' && hue !== 'red');

/**
 * A link's colour when it has none of its own (a booking page today): the same hue its LinkCard's edge takes and
 * its bookings take on the Bookings week, so one link keeps one colour everywhere.
 */
export function linkHue(id: string): Hue {
  return stableHue(id, LINK_HUES);
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
