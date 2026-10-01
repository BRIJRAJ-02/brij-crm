// The one Stylelint config for the repo, loaded by the root stylelint.config.js.
// It enforces the CSS house rules: tokens only (no raw colour, size, spacing,
// radius, shadow or motion values), no !important, and styles that stay inside
// their own component. packages/tokens is exempt, since it defines the values.
import recommended from 'stylelint-config-recommended';
import strictValue from 'stylelint-declaration-strict-value';

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

export const stylelintConfig = {
  plugins: [strictValue],
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
      { message: 'Use a token (var(--name)) instead of a raw size or duration.' },
    ],
    'scale-unlimited/declaration-strict-value': [
      TOKEN_PROPERTIES,
      { ignoreValues: KEYWORDS, message: 'Expected a token (var(--name)) for "${value}" of "${property}".' },
    ],
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
