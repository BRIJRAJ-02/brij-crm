// Locks in how tokens.json becomes tokens.css (AC-2) and that the committed
// file is exactly the generator's output (AC-3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTokensCss, type GenerateResult } from './generate.ts';
import { TokenSource } from './grammar.ts';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const OPTIONS = { version: 'test-1', fontFiles: ['Inter.woff2', 'Mono.woff2'] };

/** The smallest valid tokens.json, with a few overrides. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    color: {
      themes: [
        { id: 'light', name: 'Light' },
        { id: 'dark', name: 'Dark' },
      ],
      tokens: [
        { name: 'surface', value: { light: '#fdfdff', dark: '#18191c' } },
        { name: 'text', value: { light: '#18191d', dark: '#ebedef' } },
        { name: 'text-secondary', value: { light: '#575b62', dark: '#a7abb3' } },
      ],
    },
    type: {
      fonts: [
        { family: 'Inter', file: 'fonts/Inter.woff2', weight: '100 900', style: 'normal' },
        { family: 'JetBrains Mono', file: 'Mono.woff2', weight: '100 800' },
      ],
      families: { sans: '"Inter", ui-sans-serif, sans-serif', mono: '"JetBrains Mono", monospace' },
      groups: [
        {
          name: 'Text',
          family: 'sans',
          styles: [
            { name: 'body', fontSize: '13px', lineHeight: '20px', fontWeight: '400', letterSpacing: '0' },
            { name: 'heading', fontSize: '18px', lineHeight: '24px', fontWeight: '600', letterSpacing: '-0.01em' },
          ],
        },
        {
          name: 'Mono',
          family: 'mono',
          styles: [{ name: 'code', fontSize: '12px', lineHeight: '16px', fontWeight: '400' }],
        },
      ],
    },
    spacing: { note: '', tokens: [{ name: 'space-8', value: '8px' }] },
    shadow: { tokens: [{ name: 'shadow-xs', value: { light: '0 1px 2px #1c1d1f0d', dark: '0 1px 2px #00000040' } }] },
    name: 'Test',
    meta: { source: 'test' },
    ...overrides,
  };
}

function css(result: GenerateResult): string {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.css;
}

function errorCode(result: GenerateResult): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** The body of the first block whose selector line starts with `selector`. */
function blockAfter(output: string, selector: string): string {
  const start = output.indexOf(selector);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return output.slice(start, output.indexOf('}', start));
}

describe('generateTokensCss', () => {
  it('puts every token inside @layer tokens, with the font faces after it', () => {
    const output = css(generateTokensCss(fixture(), OPTIONS));
    expect(output.startsWith('/* Generated from tokens.json (artifact version test-1)')).toBe(true);
    expect(output.indexOf('@layer tokens {')).toBeLessThan(output.indexOf('@font-face'));
    expect(output.endsWith('}\n')).toBe(true);
  });

  it('writes light values under :root and [data-theme=light], with color-scheme', () => {
    const light = blockAfter(css(generateTokensCss(fixture(), OPTIONS)), ':root,');
    expect(light).toContain("[data-theme='light'] {");
    expect(light).toContain('color-scheme: light;');
    expect(light).toContain('--surface: #fdfdff;');
    expect(light).toContain('--shadow-xs: 0 1px 2px #1c1d1f0d;');
  });

  it('writes dark values under [data-theme=dark] and again for System inside prefers-color-scheme', () => {
    const output = css(generateTokensCss(fixture(), OPTIONS));
    const dark = blockAfter(output, "[data-theme='dark'] {");
    expect(dark).toContain('color-scheme: dark;');
    expect(dark).toContain('--surface: #18191c;');
    const media = output.slice(output.indexOf('@media (prefers-color-scheme: dark) {'));
    const system = blockAfter(media, ':root:not([data-theme]) {');
    expect(system).toContain('color-scheme: dark;');
    expect(system).toContain('--surface: #18191c;');
    expect(system).toContain('--shadow-xs: 0 1px 2px #00000040;');
  });

  it('writes plain families, type families, and each style as a font shorthand plus its tracking', () => {
    const root = blockAfter(css(generateTokensCss(fixture(), OPTIONS)), '  :root {');
    expect(root).toContain('--space-8: 8px;');
    expect(root).toContain('--font-sans: "Inter", ui-sans-serif, sans-serif;');
    expect(root).toContain('--text-body: 400 13px/20px var(--font-sans);');
    expect(root).toContain('--tracking-heading: -0.01em;');
    expect(root).toContain('--text-code: 400 12px/16px var(--font-mono);');
    expect(root).toContain('--tracking-code: 0;');
  });

  it('keeps tokens in the order tokens.json lists them', () => {
    const output = css(generateTokensCss(fixture(), OPTIONS));
    expect(output.indexOf('--surface:')).toBeLessThan(output.indexOf('--text:'));
    expect(output.indexOf('--text:')).toBeLessThan(output.indexOf('--text-secondary:'));
  });

  it('adds italic to a style that asks for it', () => {
    const input = fixture();
    const type = input.type as { groups: { styles: Record<string, unknown>[] }[] };
    type.groups[0]?.styles.push({
      name: 'quote',
      fontSize: '13px',
      lineHeight: '20px',
      fontWeight: '400',
      fontStyle: 'italic',
    });
    expect(css(generateTokensCss(input, OPTIONS))).toContain('--text-quote: italic 400 13px/20px var(--font-sans);');
  });

  it('writes an @font-face per font, served from the package', () => {
    const output = css(generateTokensCss(fixture(), OPTIONS));
    expect(output).toContain('font-family: "Inter";\n  src: url("./fonts/Inter.woff2") format("woff2");');
    expect(output).toContain('src: url("./fonts/Mono.woff2") format("woff2");');
    expect(output).toContain('font-display: swap;');
  });

  it('turns a colour alias into var() in the theme that uses it', () => {
    const input = fixture();
    const color = input.color as { tokens: Record<string, unknown>[] };
    color.tokens.push({ name: 'link', value: { light: '{text}', dark: '#709ff5' } });
    const output = css(generateTokensCss(input, OPTIONS));
    expect(blockAfter(output, ':root,')).toContain('--link: var(--text);');
    expect(blockAfter(output, "[data-theme='dark'] {")).toContain('--link: #709ff5;');
  });

  it('flows a new { tokens } family through with no code change', () => {
    const output = css(generateTokensCss(fixture({ zIndex: { tokens: [{ name: 'z-modal', value: 300 }] } }), OPTIONS));
    expect(blockAfter(output, '  :root {')).toContain('--z-modal: 300;');
  });

  it('gives the same bytes on every run', () => {
    expect(generateTokensCss(fixture(), OPTIONS)).toEqual(generateTokensCss(fixture(), OPTIONS));
  });

  it.each([
    [
      'a colour without its dark value',
      fixture({
        color: {
          themes: [
            { id: 'light', name: 'L' },
            { id: 'dark', name: 'D' },
          ],
          tokens: [{ name: 'surface', value: { light: '#fff' } }],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'a colour with one value for every theme',
      fixture({
        color: {
          themes: [
            { id: 'light', name: 'L' },
            { id: 'dark', name: 'D' },
          ],
          tokens: [{ name: 'surface', value: '#fff' }],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'a shadow without its dark value',
      fixture({ shadow: { tokens: [{ name: 'shadow-xs', value: { light: '0 1px 2px #0000' } }] } }),
      'TOKENS_INVALID',
    ],
    [
      'a value that is not a colour',
      fixture({
        color: {
          themes: [
            { id: 'light', name: 'L' },
            { id: 'dark', name: 'D' },
          ],
          tokens: [{ name: 'surface', value: { light: 'var(--x)', dark: '#000' } }],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'an alias to a colour that does not exist',
      fixture({
        color: {
          themes: [
            { id: 'light', name: 'L' },
            { id: 'dark', name: 'D' },
          ],
          tokens: [{ name: 'surface', value: { light: '{nope}', dark: '#000' } }],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'aliases that loop',
      fixture({
        color: {
          themes: [
            { id: 'light', name: 'L' },
            { id: 'dark', name: 'D' },
          ],
          tokens: [
            { name: 'a', value: { light: '{b}', dark: '#000' } },
            { name: 'b', value: { light: '{a}', dark: '#000' } },
          ],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'themes other than light and dark',
      fixture({ color: { themes: [{ id: 'day', name: 'Day' }], tokens: [] } }),
      'TOKENS_INVALID',
    ],
    ['an unknown top level key', fixture({ motion: { curves: ['ease'] } }), 'TOKENS_UNKNOWN_FAMILY'],
    [
      'a plain value with var()',
      fixture({ spacing: { tokens: [{ name: 'space-8', value: 'var(--x)' }] } }),
      'TOKENS_INVALID',
    ],
    [
      'two tokens with one name',
      fixture({ radius: { tokens: [{ name: 'space-8', value: '4px' }] } }),
      'TOKENS_DUPLICATE',
    ],
    [
      'a type style colliding with a colour',
      fixture({
        type: {
          fonts: [],
          families: { sans: 'sans-serif' },
          groups: [
            {
              name: 'T',
              family: 'sans',
              styles: [{ name: 'secondary', fontSize: '1px', lineHeight: '1px', fontWeight: '400' }],
            },
          ],
        },
        spacing: { tokens: [{ name: 'text-secondary', value: '1px' }] },
      }),
      'TOKENS_DUPLICATE',
    ],
    [
      'a missing font file',
      fixture({ type: { fonts: [{ family: 'Gone', file: 'Gone.woff2', weight: '400' }], families: {}, groups: [] } }),
      'TOKENS_INVALID',
    ],
    [
      'an opticalSize the generator cannot express',
      fixture({
        type: {
          fonts: [],
          families: { sans: 'sans-serif' },
          groups: [
            {
              name: 'T',
              family: 'sans',
              styles: [{ name: 'big', fontSize: '28px', lineHeight: '36px', fontWeight: '600', opticalSize: 32 }],
            },
          ],
        },
      }),
      'TOKENS_INVALID',
    ],
    [
      'a style naming a family that does not exist',
      fixture({
        type: {
          fonts: [],
          families: {},
          groups: [
            {
              name: 'T',
              family: 'serif',
              styles: [{ name: 'x', fontSize: '1px', lineHeight: '1px', fontWeight: '400' }],
            },
          ],
        },
      }),
      'TOKENS_INVALID',
    ],
    ['a file that is not tokens.json at all', 'not json', 'TOKENS_INVALID'],
  ])('refuses %s', (_name, input, code) => {
    const result = generateTokensCss(input, OPTIONS);
    expect(errorCode(result)).toBe(code);
    expect(result.ok ? undefined : result.error.message).toBeTruthy();
  });
});

describe('the committed tokens.css (AC-3)', () => {
  it('is exactly what the generator makes from tokens.json and source.json', () => {
    const source = TokenSource.parse(JSON.parse(readFileSync(path.join(PACKAGE, 'source.json'), 'utf8')));
    const tokens: unknown = JSON.parse(readFileSync(path.join(PACKAGE, 'tokens.json'), 'utf8'));
    const result = generateTokensCss(tokens, {
      version: source.version,
      fontFiles: readdirSync(path.join(PACKAGE, 'fonts')),
    });
    expect(css(result)).toBe(readFileSync(path.join(PACKAGE, 'tokens.css'), 'utf8'));
  });
});
