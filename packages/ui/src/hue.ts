/**
 * The nine data hues. Each has `tag-<hue>-bg`, `-border` and `-text` tokens and
 * a `dot-<hue>`; a select option keeps its hue wherever it appears. A test
 * checks this list against the tag tokens in tokens.json.
 */
export const HUES = ['gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple'] as const;

/** One of the nine data hues. */
export type Hue = (typeof HUES)[number];
