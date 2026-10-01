// The one Stylelint config for the repo, loaded by the root stylelint.config.js.
// It enforces the CSS house rules: tokens only (no raw colour, size, spacing,
// radius, shadow, motion, opacity, scale or layer values), only known tokens,
// breakpoints from tokens, system colours only for forced colours, no
// !important, and styles that stay inside their own component. packages/tokens
// is exempt, since it defines the values.
import path from 'node:path';
import recommended from 'stylelint-config-recommended';
import strictValue from 'stylelint-declaration-strict-value';
import unknownCustomProperties from 'stylelint-value-no-unknown-custom-properties';
import { breakpointTokens } from './stylelint/breakpoint-tokens.js';
import { SYSTEM_COLORS, systemColors } from './stylelint/system-colors.js';

// Absolute, so Stylelint gives the same answer run from any folder. Read by
// path, since @crm/tokens already depends on this package.
const TOKENS_CSS = path.resolve(import.meta.dirname, '../tokens/tokens.css');

const TOKEN_PROPERTIES = [
  '/color$/',
  'background',
  'fill',
  'stroke',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'z-index',
  'opacity',
  'scale',
  'box-shadow',
  'text-shadow',
  '/radius$/',
  '/^(margin|padding)/',
  '/gap$/',
  '/^border(-(top|right|bottom|left|block|inline)(-start|-end)?)?-width$/',
  '/^(transition|animation)-(duration|delay|timing-function)$/',
];

const KEYWORDS = [
  '0',
  'auto',
  'none',
  'normal',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'transparent',
  'currentColor',
  'currentcolor',
];

// opacity and scale also take 0 and 1 (hidden and shown, none and full size),
// without loosening line-height: 1 or any other property. System colours pass
// here, and crm/system-colors keeps them inside forced colours.
// Shadows may stack tokens (a shadow plus the focus ring), which the rule sees
// as `var(--shadow-md),` before the comma.
const IGNORED_VALUES = {
  '': [...KEYWORDS, ...SYSTEM_COLORS],
  opacity: [...KEYWORDS, '1'],
  scale: [...KEYWORDS, '1'],
  'box-shadow': [...KEYWORDS, '/^var\\(--[\\w-]+\\),$/'],
};

/** The repo's Stylelint config, re-exported by the root stylelint.config.js. */
export const stylelintConfig = {
  plugins: [strictValue, unknownCustomProperties, breakpointTokens, systemColors],
  ignoreFiles: ['**/node_modules/**', '**/dist/**', 'packages/tokens/**'],
  rules: {
    ...recommended.rules,
    // CSS Modules syntax. `:global` is still refused below, with a clearer message.
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'property-no-unknown': [true, { ignoreProperties: ['composes'] }],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'cubic-bezier', 'steps'],
      { message: 'Use a token (var(--name)) instead of a raw colour or curve.' },
    ],
    'unit-disallowed-list': [
      ['px', 'rem', 'em', 'ex', 'ch', 'pt', 'pc', 'in', 'cm', 'mm', 'q', 'ms', 's'],
      {
        // In size conditions px passes here, and crm/breakpoint-tokens decides.
        ignoreMediaFeatureNames: { px: ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'] },
        message: 'Use a token (var(--name)) instead of a raw size or duration.',
      },
    ],
    'scale-unlimited/declaration-strict-value': [
      TOKEN_PROPERTIES,
      { ignoreValues: IGNORED_VALUES, message: 'Expected a token (var(--name)) for "${value}" of "${property}".' },
    ],
    'csstools/value-no-unknown-custom-properties': [true, { importFrom: [TOKENS_CSS] }],
    'crm/breakpoint-tokens': true,
    'crm/system-colors': true,
    'declaration-no-important': true,
    'selector-max-id': 0,
    // One level of descendant at most, so no component styles another's insides.
    'selector-max-compound-selectors': 2,
    'selector-pseudo-class-disallowed-list': [
      ['global'],
      { message: 'No global selectors in a component. Global styles live in the reset and base layers.' },
    ],
  },
  overrides: [
    {
      files: ['**/*.module.css'],
      rules: {
        'selector-max-type': [0, { message: 'Style a class, not an element, so the style stays in this component.' }],
      },
    },
  ],
};
