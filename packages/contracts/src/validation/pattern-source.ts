// The RE2 source a pattern rule matches the whole value against (spec 0013,
// AC-258), before the checker wraps it as `^(?:…)$`. Plain, with no Zod.
import { PATTERN_PRESETS } from './kinds.ts';

/** Escapes text so RE2 matches it literally. */
function literal(text: string): string {
  return text.replaceAll(/[\\^$.|?*+()[\]{}]/g, (character) => `\\${character}`);
}

/** A pattern rule's source: its preset's, "Starts with" or "Ends with" as a literal, or the custom pattern. */
export function patternSourceOf(params: Readonly<Record<string, unknown>>): string | undefined {
  switch (params.preset) {
    case 'digits':
    case 'letters':
    case 'letters_digits':
    case 'no_spaces':
      return PATTERN_PRESETS[params.preset];
    case 'starts_with':
      return typeof params.text === 'string' ? `${literal(params.text)}(?s:.*)` : undefined;
    case 'ends_with':
      return typeof params.text === 'string' ? `(?s:.*)${literal(params.text)}` : undefined;
    case 'custom':
      return typeof params.regex === 'string' ? params.regex : undefined;
    default:
      return undefined;
  }
}
