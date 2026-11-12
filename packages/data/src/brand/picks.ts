/**
 * The quick picks the colour pickers offer (AC-3): the library's nine hues, each as its dot colour in light (the
 * `dot-<hue>` tokens, which `packages/tokens/src/packs.test.ts` holds these to), so a pick is the same colour the app's own tags use.
 *
 * Its own module, and the only part of the brand kit in the first load: the store beside it is loaded with
 * `import()`, and a screen that only offers the picks (a booking page's embed button) must not drag it in.
 */
export const BRAND_QUICK_PICKS = [
  { hue: 'gray', value: '#a1a1aa' },
  { hue: 'red', value: '#f0524f' },
  { hue: 'orange', value: '#f5872f' },
  { hue: 'yellow', value: '#eab308' },
  { hue: 'lime', value: '#9cc22a' },
  { hue: 'green', value: '#16b374' },
  { hue: 'sky', value: '#32a9e0' },
  { hue: 'blue', value: '#2f6af2' },
  { hue: 'purple', value: '#9466f2' },
] as const;
