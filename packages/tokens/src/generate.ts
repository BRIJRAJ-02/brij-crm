// Turns the source tokens.json (and legacy.json) into tokens.css: every token as
// a CSS variable inside `@layer tokens`, with light and dark theme blocks, a
// System block that follows the OS, the type shorthands, the app scale block
// (spec 0071) and the @font-face rules. It also writes values.ts, the same
// numbers for JavaScript. Pure: the caller reads the files and passes them in.
import {
  type ColorFamily,
  LegacyFile,
  PlainFamily,
  type ShadowFamily,
  TokensFile,
  type TypeFamily,
  type TypeStyle,
} from './grammar.ts';

/** Why generation stopped. Each code names one kind of problem in tokens.json. */
export type TokensErrorCode = 'TOKENS_INVALID' | 'TOKENS_UNKNOWN_FAMILY' | 'TOKENS_DUPLICATE';

/** A generation failure in the `{ code, message }` shape. */
export interface TokensError {
  readonly code: TokensErrorCode;
  readonly message: string;
}

/** Either the generated CSS and values module, or the reason there are none. */
export type GenerateResult =
  | { readonly ok: true; readonly css: string; readonly appCss: string; readonly values: string }
  | { readonly ok: false; readonly error: TokensError };

/** What the caller knows from disk. */
export interface GenerateOptions {
  /** The artifact version tokens.json came from (source.json `version`), written into the header. */
  readonly version: string;
  /** File names present in packages/tokens/fonts/. A font tokens.json names must be among them. */
  readonly fontFiles: readonly string[];
  /** The parsed legacy.json, when there is one (spec 0071, AC-13). */
  readonly legacy?: unknown;
}

/** The two themes the app switches between. The first is the default. */
const THEMES = ['light', 'dark'] as const;
type ThemeId = (typeof THEMES)[number];

/** Top level keys that carry no tokens. */
const SKIPPED_KEYS = new Set(['version', 'name', 'meta']);
/** Top level keys with their own shape, read separately. */
const SHAPED_KEYS = new Set(['color', 'shadow', 'type']);

/** The token whose value is the app's scale (spec 0071, AC-2), and the family that holds it. */
const DENSITY = { family: 'density', name: 'density-app' } as const;
/** Plain families whose lengths the app draws at the density. Type styles scale too. */
const SCALED_FAMILIES = new Set(['spacing', 'radius', 'size']);
/** Lengths that never scale even inside a scaled family. */
const UNSCALED_NAMES = new Set(['radius-full']);
/** Size tokens that are heights: rounded to an even pixel so text centres on whole pixels (spec 0071). */
const HEIGHTS = new Set([
  'size-control-sm',
  'size-control',
  'size-control-lg',
  'size-row',
  'size-nav-item',
  'size-topbar',
  'size-avatar',
  'size-avatar-lg',
]);
/** Size tokens that are widths: rounded to a whole pixel. A size token on neither list is refused. */
const WIDTHS = new Set([
  'size-icon',
  'size-icon-lg',
  'size-sidebar',
  'size-menu',
  'size-dialog',
  'size-dialog-wide',
  'size-panel',
  'size-measure',
]);
const PIXELS = /^(\d+(?:\.\d+)?)px$/;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^;{}]*\)$/i;
const ALIAS = /^\{([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\}$/;
// Plain CSS values: lengths, numbers, keywords, curves. No var(), url() or blocks.
const PLAIN_VALUE = /^(?!.*\b(?:var|url)\()[A-Za-z0-9 #%(),./+_-]{1,200}$/i;
const SHADOW_VALUE = /^(?!.*\b(?:var|url)\()[A-Za-z0-9 #%(),./+_-]{1,400}$/i;

const FONT_FORMATS: Readonly<Record<string, string>> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

class TokensProblem extends Error {
  readonly code: TokensErrorCode;

  constructor(code: TokensErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: TokensErrorCode, message: string): never {
  throw new TokensProblem(code, message);
}

/** One emitted declaration: `--name: value`. */
interface Declaration {
  readonly name: string;
  readonly value: string;
}

/** A custom property name, with any `.` escaped as the artifact's compiler does. */
function propertyName(name: string): string {
  return `--${name.replaceAll('.', '\\.')}`;
}

/** Reads one themed token's value for a theme, refusing a token without both. */
function themedValue(
  family: string,
  token: { name: string; value: string | Record<string, string> },
  theme: ThemeId,
): string {
  if (typeof token.value === 'string') {
    fail('TOKENS_INVALID', `${family} token "${token.name}" has one value; it needs a light and a dark value.`);
  }
  for (const id of THEMES) {
    if (token.value[id] === undefined) fail('TOKENS_INVALID', `${family} token "${token.name}" has no ${id} value.`);
  }
  return token.value[theme] ?? '';
}

function colorDeclarations(color: ColorFamily, theme: ThemeId): Declaration[] {
  const names = new Set(color.tokens.map((token) => token.name));
  return color.tokens.map((token) => {
    const raw = themedValue('Colour', token, theme);
    const alias = ALIAS.exec(raw);
    if (alias) {
      const target = alias[1] ?? '';
      if (target === token.name || !names.has(target)) {
        fail(
          'TOKENS_INVALID',
          `Colour token "${token.name}" (${theme}) aliases "${target}", which isn't another colour.`,
        );
      }
      return { name: propertyName(token.name), value: `var(${propertyName(target)})` };
    }
    if (!HEX.test(raw) && !COLOR_FUNCTION.test(raw)) {
      fail('TOKENS_INVALID', `Colour token "${token.name}" (${theme}) has "${raw}", which isn't a colour.`);
    }
    return { name: propertyName(token.name), value: raw };
  });
}

/** Colour aliases that lead back to themselves can never resolve. */
function refuseAliasCycles(color: ColorFamily): void {
  for (const theme of THEMES) {
    const aliases = new Map<string, string>();
    for (const token of color.tokens) {
      const target = ALIAS.exec(themedValue('Colour', token, theme))?.[1];
      if (target !== undefined) aliases.set(token.name, target);
    }
    for (const start of aliases.keys()) {
      const seen = new Set([start]);
      let next = aliases.get(start);
      while (next !== undefined) {
        if (seen.has(next)) fail('TOKENS_INVALID', `Colour alias "${start}" (${theme}) loops back on itself.`);
        seen.add(next);
        next = aliases.get(next);
      }
    }
  }
}

function shadowDeclarations(shadow: ShadowFamily | undefined, theme: ThemeId): Declaration[] {
  return (shadow?.tokens ?? []).map((token) => {
    const value = themedValue('Shadow', token, theme);
    if (!SHADOW_VALUE.test(value)) {
      fail('TOKENS_INVALID', `Shadow token "${token.name}" (${theme}) has "${value}", which isn't a plain shadow.`);
    }
    return { name: propertyName(token.name), value };
  });
}

function plainDeclarations(key: string, family: PlainFamily): Declaration[] {
  return family.tokens.map((token) => {
    if (!PLAIN_VALUE.test(token.value)) {
      fail('TOKENS_INVALID', `Token "${token.name}" in "${key}" has "${token.value}", which isn't a plain CSS value.`);
    }
    return { name: propertyName(token.name), value: token.value };
  });
}

function typeDeclarations(type: TypeFamily, hundredths?: number): Declaration[] {
  const families = Object.entries(type.families).map(([key, stack]) => ({
    name: propertyName(`font-${key}`),
    value: stack,
  }));
  const styles = type.groups.flatMap((group) =>
    group.styles.flatMap((style) => {
      if (style.opticalSize !== undefined && style.opticalSize !== null) {
        fail('TOKENS_INVALID', `Type style "${style.name}" sets opticalSize, which the generator doesn't support yet.`);
      }
      const family = style.family !== undefined && style.family !== '' ? style.family : group.family;
      if (!(family in type.families)) {
        fail(
          'TOKENS_INVALID',
          `Type style "${style.name}" uses family "${family}", which type.families doesn't define.`,
        );
      }
      return [
        { name: propertyName(`text-${style.name}`), value: typeShorthand(style, family, hundredths) },
        { name: propertyName(`tracking-${style.name}`), value: style.letterSpacing ?? '0' },
      ];
    }),
  );
  return [...families, ...styles];
}

function fontFaces(type: TypeFamily, fontFiles: readonly string[]): string[] {
  return type.fonts.map((font) => {
    const file = font.file.startsWith('fonts/') ? font.file.slice('fonts/'.length) : font.file;
    if (!fontFiles.includes(file)) {
      fail('TOKENS_INVALID', `Font "${font.family}" names fonts/${file}, which isn't in packages/tokens/fonts/.`);
    }
    const format = FONT_FORMATS[file.split('.').pop()?.toLowerCase() ?? ''];
    if (format === undefined) fail('TOKENS_INVALID', `Font file fonts/${file} isn't a woff2, woff, ttf or otf file.`);
    return [
      '@font-face {',
      `  font-family: "${font.family}";`,
      `  src: url("./fonts/${file}") format("${format}");`,
      `  font-weight: ${font.weight};`,
      `  font-style: ${font.style ?? 'normal'};`,
      '  font-display: swap;',
      '}',
    ].join('\n');
  });
}

/** Every emitted name shares one namespace, so two tokens can never fight over a variable. */
function refuseDuplicates(groups: readonly (readonly Declaration[])[]): void {
  const seen = new Set<string>();
  for (const declaration of groups.flat()) {
    if (seen.has(declaration.name)) {
      fail('TOKENS_DUPLICATE', `${declaration.name} is defined twice. Every token needs its own name.`);
    }
    seen.add(declaration.name);
  }
}

function block(selector: string, lines: readonly string[], indent: string): string {
  return [`${indent}${selector} {`, ...lines.map((line) => `${indent}  ${line}`), `${indent}}`].join('\n');
}

function declarationLines(declarations: readonly Declaration[]): string[] {
  return declarations.map(({ name, value }) => `${name}: ${value};`);
}

/** How one scaled length rounds in the app (spec 0071, the scale rules). */
type Rounding = 'half' | 'even' | 'whole';

/** The density as a whole number of hundredths, so every product below is integer maths. */
function densityHundredths(plainFamilies: ReadonlyMap<string, PlainFamily>): number | undefined {
  const token = plainFamilies.get(DENSITY.family)?.tokens.find((candidate) => candidate.name === DENSITY.name);
  if (token === undefined) return undefined;
  const hundredths = Math.round(Number(token.value) * 100);
  if (!/^\d+(?:\.\d{1,2})?$/.test(token.value) || hundredths <= 0 || hundredths > 100) {
    fail(
      'TOKENS_INVALID',
      `${DENSITY.name} is "${token.value}"; it needs a number above 0 and at most 1, in hundredths.`,
    );
  }
  return hundredths;
}

/** A source length in px as a number, or a refusal naming the token. */
function pixels(name: string, value: string): number {
  const match = PIXELS.exec(value);
  if (match === null) fail('TOKENS_INVALID', `"${name}" is "${value}"; a scaled length must be written in px.`);
  return Number(match[1]);
}

/**
 * A length at the app's density. `v × hundredths` is exact for any whole or half pixel source value, and every
 * rounding adds half a step before flooring, so a tie rounds up and floating point never decides a pixel.
 */
function scale(value: number, hundredths: number, rounding: Rounding): number {
  const scaled = Math.round(value * 2 * hundredths); // in 1/200 px, exact for half pixel sources
  if (rounding === 'half') return Math.floor((scaled + 50) / 100) / 2;
  if (rounding === 'even') return Math.floor((scaled + 200) / 400) * 2;
  return Math.floor((scaled + 100) / 200);
}

function roundingOf(family: string, name: string): Rounding {
  if (family !== 'size') return 'whole';
  if (HEIGHTS.has(name)) return 'even';
  if (WIDTHS.has(name)) return 'whole';
  return fail(
    'TOKENS_INVALID',
    `Size token "${name}" is neither a height nor a width. Add it to HEIGHTS or WIDTHS in packages/tokens/src/generate.ts.`,
  );
}

/** The app value of one plain token, or undefined when it does not scale. */
function appPlainValue(family: string, name: string, value: string, hundredths: number): string | undefined {
  if (!SCALED_FAMILIES.has(family) || UNSCALED_NAMES.has(name)) return undefined;
  return `${String(scale(pixels(name, value), hundredths, roundingOf(family, name)))}px`;
}

/** A type style's font shorthand at full size, or with its size and line height at the app's density. */
function typeShorthand(style: TypeStyle, family: string, hundredths?: number): string {
  const italic = style.fontStyle === 'italic' ? 'italic ' : '';
  const size =
    hundredths === undefined
      ? style.fontSize
      : `${String(scale(pixels(`text-${style.name}`, style.fontSize), hundredths, 'half'))}px`;
  const line =
    hundredths === undefined
      ? style.lineHeight
      : `${String(scale(pixels(`text-${style.name}`, style.lineHeight), hundredths, 'even'))}px`;
  return `${italic}${style.fontWeight} ${size}/${line} var(${propertyName(`font-${family}`)})`;
}

/** A TypeScript string literal for the values module. */
function literal(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/** The values module: every plain token at full size, and the app value of each that scales (spec 0071, AC-16). */
function valuesModule(full: readonly Declaration[], app: readonly Declaration[], version: string): string {
  const entries = (declarations: readonly Declaration[]) =>
    declarations.map(({ name, value }) => `  ${literal(name.slice(2))}: ${literal(value)},`).join('\n');
  return [
    `// Generated from tokens.json and legacy.json (artifact version ${version}) by packages/tokens/scripts/generate.ts. Do not edit.`,
    '',
    '/** Every plain token (spacing, size, radius, breakpoint, duration, easing and the rest) as tokens.css writes it at full size. */',
    `export const fullValues: Readonly<Record<string, string>> = {\n${entries(full)}\n};`,
    '',
    '/** The tokens that draw differently in the app (`<html data-scale="app">`), as tokens.css writes them there. */',
    `export const appValues: Readonly<Record<string, string>> = {\n${entries(app)}\n};`,
    '',
  ].join('\n');
}

function legacyDeclarations(input: unknown): { themed: (theme: ThemeId) => Declaration[]; plain: Declaration[] } {
  if (input === undefined) return { themed: () => [], plain: [] };
  const parsed = LegacyFile.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail('TOKENS_INVALID', `legacy.json: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'is not valid'}`.trim());
  }
  const { note: _note, color, shadow, ...plainFamilies } = parsed.data;
  const plain = Object.entries(plainFamilies).flatMap(([key, family]) =>
    plainDeclarations(key, { tokens: family.tokens }),
  );
  const themed = (theme: ThemeId) => [
    ...(color?.tokens ?? []).map((token) => {
      const value = themedValue('Legacy colour', token, theme);
      const alias = ALIAS.exec(value)?.[1];
      return { name: propertyName(token.name), value: alias === undefined ? value : `var(${propertyName(alias)})` };
    }),
    ...shadowDeclarations(shadow === undefined ? undefined : { tokens: shadow.tokens }, theme),
  ];
  return { themed, plain };
}

function generate(input: unknown, options: GenerateOptions): { css: string; appCss: string; values: string } {
  const parsed = TokensFile.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail('TOKENS_INVALID', `tokens.json: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'is not valid'}`.trim());
  }
  const file = parsed.data;

  const themeIds = file.color.themes.map((theme) => theme.id);
  if (themeIds.join(',') !== THEMES.join(',')) {
    fail('TOKENS_INVALID', `tokens.json themes are "${themeIds.join(', ')}"; expected "light, dark".`);
  }
  refuseAliasCycles(file.color);

  const families = new Map<string, PlainFamily>();
  for (const [key, value] of Object.entries(file)) {
    if (SKIPPED_KEYS.has(key) || SHAPED_KEYS.has(key)) continue;
    const family = PlainFamily.safeParse(value);
    if (!family.success) {
      fail(
        'TOKENS_UNKNOWN_FAMILY',
        `tokens.json has "${key}", which isn't a { tokens: [...] } family the generator knows.`,
      );
    }
    families.set(key, family.data);
  }
  const hundredths = densityHundredths(families);

  const plain: Declaration[] = [];
  const app: Declaration[] = [];
  for (const [key, family] of families) {
    plain.push(...plainDeclarations(key, family));
    if (hundredths === undefined) continue;
    for (const token of family.tokens) {
      const value = appPlainValue(key, token.name, token.value, hundredths);
      if (value !== undefined) app.push({ name: propertyName(token.name), value });
    }
  }
  const appType =
    hundredths === undefined
      ? []
      : typeDeclarations(file.type, hundredths).filter(({ name }) => name.startsWith('--text-'));

  const legacy = legacyDeclarations(options.legacy);
  const themed = (theme: ThemeId) => [
    ...colorDeclarations(file.color, theme),
    ...shadowDeclarations(file.shadow, theme),
    ...legacy.themed(theme),
  ];
  const light = themed('light');
  const dark = themed('dark');
  const rootTokens = [...plain, ...typeDeclarations(file.type), ...legacy.plain];
  refuseDuplicates([light, rootTokens]);

  const darkLines = ['color-scheme: dark;', ...declarationLines(dark)];
  const blocks = [
    block(":root,\n  [data-theme='light']", ['color-scheme: light;', ...declarationLines(light)], '  '),
    block("[data-theme='dark']", darkLines, '  '),
    ['  @media (prefers-color-scheme: dark) {', block(':root:not([data-theme])', darkLines, '    '), '  }'].join('\n'),
    block(':root', declarationLines(rootTokens), '  '),
  ];
  const appTokens = [...app, ...appType];

  const css = [
    `/* Generated from tokens.json (artifact version ${options.version}) by packages/tokens/scripts/generate.ts. Do not edit. */`,
    `@layer tokens {\n${blocks.join('\n\n')}\n}`,
    ...fontFaces(file.type, options.fontFiles),
  ]
    .join('\n\n')
    .concat('\n');
  // The app's sizes live in their own stylesheet that only the app loads (spec 0071): public pages never draw at the
  // app's density, so they never carry the block (their CSS budgets).
  const appCss =
    appTokens.length === 0
      ? ''
      : [
          `/* Generated from tokens.json (artifact version ${options.version}) by packages/tokens/scripts/generate.ts. Do not edit. */`,
          `/* The app's sizes (spec 0071): every scaled token at density-app, under <html data-scale="app">. */`,
          `@layer tokens {\n${block(":root[data-scale='app']", declarationLines(appTokens), '  ')}\n}`,
        ]
          .join('\n\n')
          .concat('\n');
  return { css, appCss, values: valuesModule([...plain, ...legacy.plain], app, options.version) };
}

/**
 * Generates tokens.css and values.ts from a parsed tokens.json (and legacy.json). Stops with a coded error, and no
 * output, on anything outside the artifact's grammar, a colour or shadow without both theme values, a name used twice
 * (legacy included), a size token on neither scale list, or a font file that's missing.
 */
export function generateTokensCss(input: unknown, options: GenerateOptions): GenerateResult {
  try {
    return { ok: true, ...generate(input, options) };
  } catch (error) {
    if (error instanceof TokensProblem) return { ok: false, error: { code: error.code, message: error.message } };
    throw error;
  }
}
