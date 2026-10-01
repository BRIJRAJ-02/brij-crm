// The hue list on its own, with no Zod, so a bundle that needs only the names
// (the library's pickers and tiles) doesn't pull the schema library in.

/**
 * The nine data hues. Each has `tag-<hue>-bg`, `-border` and `-text` tokens and
 * a `dot-<hue>`, and a select option keeps its hue wherever it appears. The
 * server and the pickers share this one list; a test in `packages/ui` checks it
 * against the tag tokens.
 */
export const HUES = ['gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple'] as const;
