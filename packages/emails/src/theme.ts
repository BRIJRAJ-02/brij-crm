// How an email wears the design tokens. Every part of an email has a role
// (the page, the card, body text, the button), and each role names the
// tokens it is painted with. The light values go inline, since every client
// reads inline styles; the dark values come from the same map as one
// stylesheet under `prefers-color-scheme: dark` (Apple Mail, iOS Mail,
// Outlook for Mac, Gmail on iOS with its own setting off), and again under
// Outlook.com's `[data-ogsc]` and `[data-ogsb]` hooks, which it sets when it
// darkens an email itself. A client that reads neither keeps the light
// email, which is the safe fallback: every pair here holds its contrast.
import {
  borderWidthToken,
  breakpointToken,
  colorToken,
  fontStack,
  radiusToken,
  sizeToken,
  spaceToken,
  typeToken,
  type Scheme,
} from './tokens.ts';

/** The CSS properties a role may paint, each with the colour token it takes. */
interface Paint {
  readonly backgroundColor?: string;
  readonly color?: string;
  readonly borderColor?: string;
}

/** Each part of an email and the colour tokens it is painted with. */
const ROLES = {
  /** The ground around the card. */
  page: { backgroundColor: 'surface-subtle' },
  /** The card the content sits on: raised, so it reads lighter than the ground in dark too. */
  card: { backgroundColor: 'surface-raised', borderColor: 'border-subtle' },
  text: { color: 'text' },
  secondary: { color: 'text-secondary' },
  tertiary: { color: 'text-tertiary' },
  link: { color: 'link' },
  /** The one action: the accent, as the app's primary button. */
  button: { backgroundColor: 'accent', color: 'on-accent', borderColor: 'accent' },
  /** A sign in code's box. */
  code: { backgroundColor: 'surface-sunken', color: 'text' },
  /** A quoted message or excerpt: a line beside it. */
  quote: { borderColor: 'border', color: 'text-secondary' },
  /** A hairline between parts. */
  rule: { borderColor: 'border-subtle' },
} as const satisfies Record<string, Paint>;

/** A part of an email that has colours. */
export type Role = keyof typeof ROLES;

/** Every role, in the order the stylesheet lists them. */
export const ROLE_NAMES = Object.keys(ROLES) as readonly Role[];

/** A role's class name: the hook the dark stylesheet repaints it by. */
export function roleClass(role: Role): string {
  return `tf-${role}`;
}

/** A role's colours in one theme, as inline style properties. */
export function paint(role: Role, scheme: Scheme = 'light'): Paint {
  const tokens: Paint = ROLES[role];
  return {
    ...(tokens.backgroundColor === undefined ? {} : { backgroundColor: colorToken(tokens.backgroundColor, scheme) }),
    ...(tokens.color === undefined ? {} : { color: colorToken(tokens.color, scheme) }),
    ...(tokens.borderColor === undefined ? {} : { borderColor: colorToken(tokens.borderColor, scheme) }),
  };
}

/** The design tokens an email's layout uses, resolved once. */
export const SPACE = {
  2: spaceToken('space-2'),
  4: spaceToken('space-4'),
  6: spaceToken('space-6'),
  8: spaceToken('space-8'),
  12: spaceToken('space-12'),
  16: spaceToken('space-16'),
  20: spaceToken('space-20'),
  24: spaceToken('space-24'),
  32: spaceToken('space-32'),
} as const;

/** The radii an email uses: the card's (cards take 12px corners) and a control's. */
export const RADIUS = { card: radiusToken('radius-xl'), control: radiusToken('radius-md') } as const;

/** The one line width: the hairline every outline and divider uses. */
export const HAIRLINE = borderWidthToken('border-width-hairline');

/** A row label's column, beside its value. */
export const LABEL_COLUMN = sizeToken('size-column-min');

/** The width below which the card's padding tightens: a phone. */
export const NARROW = breakpointToken('bp-container-md');

/** The type styles an email uses. */
export const TYPE = {
  heading: typeToken('heading'),
  body: typeToken('body'),
  bodyStrong: typeToken('body-strong'),
  label: typeToken('label'),
  labelStrong: typeToken('label-strong'),
  /** A sign in code: the note title's size, in the mono family. */
  code: { ...typeToken('note-title'), fontFamily: fontStack('mono') },
} as const;

/**
 * The widest an email gets: 600px, the width every client and reading pane
 * is built around. It is an email client's constraint, not a design choice,
 * so it has no token. Outlook on Windows reads it from the table's `width`
 * attribute, which ignores CSS, and everyone else from `max-width`.
 */
export const EMAIL_WIDTH = 600;

/**
 * Outlook on Windows draws with Word, which takes only the first family of a
 * stack and falls back to Times New Roman when it isn't installed. So for
 * Word alone the stack starts at its first family Windows has: the token's
 * own stack, less the families only browsers know.
 */
export function wordFontStack(family: 'sans' | 'mono'): string {
  const browserOnly = new Set([
    'inter',
    'jetbrains mono',
    'ui-sans-serif',
    'ui-monospace',
    'system-ui',
    '-apple-system',
  ]);
  return fontStack(family)
    .split(',')
    .map((name) => name.trim())
    .filter((name) => !browserOnly.has(name.replaceAll('"', '').toLowerCase()))
    .join(', ');
}

const CSS_PROPERTY: Readonly<Record<keyof Paint, string>> = {
  backgroundColor: 'background-color',
  color: 'color',
  borderColor: 'border-color',
};

/** One role's dark declarations, each forced past the inline light value. */
function darkRule(selector: string, role: Role, keep: (property: keyof Paint) => boolean): string | undefined {
  const dark = paint(role, 'dark');
  const declarations = (Object.keys(dark) as (keyof Paint)[])
    .filter(keep)
    .map((property) => `${CSS_PROPERTY[property]}: ${dark[property] ?? ''} !important;`);
  return declarations.length === 0 ? undefined : `${selector} { ${declarations.join(' ')} }`;
}

/**
 * The email's one stylesheet: the dark theme for clients that follow the
 * reader's setting, the same colours for Outlook.com when it darkens the
 * email itself, the logo for each theme, and a tighter card on a phone.
 * `!important` is how a stylesheet wins over inline styles, which every
 * client needs for the light theme.
 */
export function emailStylesheet(): string {
  const media = ROLE_NAMES.map((role) => darkRule(`.${roleClass(role)}`, role, () => true)).filter(
    (rule): rule is string => rule !== undefined,
  );
  // Outlook.com marks what it recoloured: `data-ogsc` on text it changed, `data-ogsb` on backgrounds.
  const outlookText = ROLE_NAMES.map((role) =>
    darkRule(`[data-ogsc] .${roleClass(role)}`, role, (property) => property !== 'backgroundColor'),
  ).filter((rule): rule is string => rule !== undefined);
  const outlookGround = ROLE_NAMES.map((role) =>
    darkRule(`[data-ogsb] .${roleClass(role)}`, role, (property) => property === 'backgroundColor'),
  ).filter((rule): rule is string => rule !== undefined);
  return [
    ':root { color-scheme: light dark; supported-color-schemes: light dark; }',
    `@media (prefers-color-scheme: dark) {`,
    ...media.map((rule) => `  ${rule}`),
    '  .tf-logo-light { display: none !important; }',
    '  .tf-logo-dark { display: inline-block !important; max-height: none !important; overflow: visible !important; }',
    '}',
    ...outlookText,
    ...outlookGround,
    `@media (max-width: ${NARROW}) {`,
    `  .tf-card-cell { padding: ${SPACE[24]} ${SPACE[20]} !important; }`,
    `  .tf-page-cell { padding: ${SPACE[16]} ${SPACE[8]} !important; }`,
    '}',
  ].join('\n');
}
