/**
 * The quick picks the colour pickers offer (AC-3): the library's nine hues, each as its dot colour in light (the
 * `dot-<hue>` tokens, which `packages/tokens/src/packs.test.ts` holds these to), so a pick is the same colour the app's own tags use.
 *
 * Its own module, and the only part of the brand kit in the first load: the store beside it is loaded with
 * `import()`, and a screen that only offers the picks (a booking page's embed button) must not drag it in.
 */
export const BRAND_QUICK_PICKS = [
  { hue: 'gray', value: '#cad0d9' },
  { hue: 'red', value: '#ff5b59' },
  { hue: 'orange', value: '#fb8f3c' },
  { hue: 'yellow', value: '#f5b900' },
  { hue: 'lime', value: '#b3cf2f' },
  { hue: 'green', value: '#0fc27b' },
  { hue: 'sky', value: '#3fb3e8' },
  { hue: 'blue', value: '#266df0' },
  { hue: 'purple', value: '#9d6ef5' },
] as const;
