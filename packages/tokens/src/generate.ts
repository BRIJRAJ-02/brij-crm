// Turns the artifact's tokens.json into tokens.css: every token as a CSS
// variable inside `@layer tokens`, with light and dark theme blocks, a System
// block that follows the OS, the type shorthands and the @font-face rules.
// Pure: the caller reads the files and passes in what's on disk.
import { type ColorFamily, PlainFamily, type ShadowFamily, TokensFile, type TypeFamily } from './grammar.ts';

/** Why generation stopped. Each code names one kind of problem in tokens.json. */
export type TokensErrorCode = 'TOKENS_INVALID' | 'TOKENS_UNKNOWN_FAMILY' | 'TOKENS_DUPLICATE';

/** A generation failure in the `{ code, message }` shape. */
export interface TokensError {
  readonly code: TokensErrorCode;
  readonly message: string;
}

/** Either the generated CSS or the reason there is none. */
export type GenerateResult =
  { readonly ok: true; readonly css: string } | { readonly ok: false; readonly error: TokensError };

/** What the caller knows from disk. */
export interface GenerateOptions {
  /** The artifact version tokens.json came from (source.json `version`), written into the header. */
  readonly version: string;
  /** File names present in packages/tokens/fonts/. A font tokens.json names must be among them. */
  readonly fontFiles: readonly string[];
}

/** The two themes the app switches between. The first is the default. */
const THEMES = ['light', 'dark'] as const;
type ThemeId = (typeof THEMES)[number];

/** Top level keys that carry no tokens. */
const SKIPPED_KEYS = new Set(['version', 'name', 'meta']);
/** Top level keys with their own shape, read separately. */
const SHAPED_KEYS = new Set(['color', 'shadow', 'type']);

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

function typeDeclarations(type: TypeFamily): Declaration[] {
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
      const italic = style.fontStyle === 'italic' ? 'italic ' : '';
      return [
        {
          name: propertyName(`text-${style.name}`),
          value: `${italic}${style.fontWeight} ${style.fontSize}/${style.lineHeight} var(${propertyName(`font-${family}`)})`,
        },
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

function generate(input: unknown, options: GenerateOptions): string {
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

  const plain: Declaration[] = [];
  for (const [key, value] of Object.entries(file)) {
    if (SKIPPED_KEYS.has(key) || SHAPED_KEYS.has(key)) continue;
    const family = PlainFamily.safeParse(value);
    if (!family.success) {
      fail(
        'TOKENS_UNKNOWN_FAMILY',
        `tokens.json has "${key}", which isn't a { tokens: [...] } family the generator knows.`,
      );
    }
    plain.push(...plainDeclarations(key, family.data));
  }

  const themed = (theme: ThemeId) => [
    ...colorDeclarations(file.color, theme),
    ...shadowDeclarations(file.shadow, theme),
  ];
  const light = themed('light');
  const dark = themed('dark');
  const rootTokens = [...plain, ...typeDeclarations(file.type)];
  refuseDuplicates([light, rootTokens]);

  const darkLines = ['color-scheme: dark;', ...declarationLines(dark)];
  const layer = [
    block(":root,\n  [data-theme='light']", ['color-scheme: light;', ...declarationLines(light)], '  '),
    block("[data-theme='dark']", darkLines, '  '),
    ['  @media (prefers-color-scheme: dark) {', block(':root:not([data-theme])', darkLines, '    '), '  }'].join('\n'),
    block(':root', declarationLines(rootTokens), '  '),
  ].join('\n\n');

  return [
    `/* Generated from tokens.json (artifact version ${options.version}) by packages/tokens/scripts/generate.ts. Do not edit. */`,
    `@layer tokens {\n${layer}\n}`,
    ...fontFaces(file.type, options.fontFiles),
  ]
    .join('\n\n')
    .concat('\n');
}

/**
 * Generates tokens.css from a parsed tokens.json. Stops with a coded error,
 * and no CSS, on anything outside the artifact's grammar, a colour or shadow
 * without both theme values, a name used twice, or a font file that's missing.
 */
export function generateTokensCss(input: unknown, options: GenerateOptions): GenerateResult {
  try {
    return { ok: true, css: generate(input, options) };
  } catch (error) {
    if (error instanceof TokensProblem) return { ok: false, error: { code: error.code, message: error.message } };
    throw error;
  }
}
