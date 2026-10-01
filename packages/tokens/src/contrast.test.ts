// AC-4: every pair the components draw meets its minimum in both themes, on
// the synced tokens.json. The fixtures put back the values of artifact
// versions 8 and 12, proving the test catches the pairs that missed then.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContrast, contrastRatio, resolveColor, type ContrastCheck } from './contrast.ts';
import { type ColorFamily, ShadowFamily, TokensFile } from './grammar.ts';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const tokens = TokensFile.parse(JSON.parse(readFileSync(path.join(PACKAGE, 'tokens.json'), 'utf8')));

/** The values these five tokens had in artifact version 8, before the contrast fixes. */
const VERSION_8: Record<string, Partial<Record<'light' | 'dark', string>>> = {
  'text-tertiary': { light: '#6c7077', dark: '#888c94' },
  danger: { light: '#cf3432' },
  'control-border': { light: '#838892' },
  'accent-hover': { dark: '#538bf3' },
};

/** Version 12: the focus ring and checkbox edges on selected rows, before `accent-line` (spec 0003). */
const VERSION_12: typeof VERSION_8 = {
  'control-border': { light: '#7b808a', dark: '#7b808a' },
  'accent-line': { dark: '#266df0' },
};

function withValues(color: ColorFamily, values: typeof VERSION_8): ColorFamily {
  return {
    ...color,
    tokens: color.tokens.map((token) =>
      token.name in values && typeof token.value !== 'string'
        ? { ...token, value: { ...token.value, ...values[token.name] } }
        : token,
    ),
  };
}

function describeCheck(check: ContrastCheck): string {
  return `${check.theme}: ${check.foreground} on ${check.background} ${check.ratio.toFixed(2)} < ${check.minimum}${check.problem === undefined ? '' : ` (${check.problem})`}`;
}

function failures(color: ColorFamily): string[] {
  return checkContrast(color)
    .filter((check) => check.problem !== undefined || check.ratio < check.minimum)
    .map(describeCheck);
}

describe('contrast (AC-4)', () => {
  it('passes every pair in both themes on the synced tokens.json', () => {
    expect(failures(tokens.color)).toEqual([]);
  });

  it('measures every pair in the table, in both themes', () => {
    expect(checkContrast(tokens.color)).toHaveLength(124);
  });

  it('catches the pairs that missed in artifact version 8', () => {
    const missed = failures(withValues(tokens.color, VERSION_8)).map((line) => line.replace(/ \d+\.\d+ </, ' <'));
    expect(missed).toEqual([
      'light: text-tertiary on surface-hover < 4.5',
      'light: text-tertiary on surface-selected < 4.5',
      'light: danger on surface-hover < 4.5',
      'light: danger on surface-selected < 4.5',
      'light: control-border on surface-sidebar < 3.5',
      'light: control-border on surface-subtle < 3.5',
      'light: control-border on surface-hover < 3.5',
      'light: control-border on surface-selected < 3.5',
      'light: control-border on surface-column < 3.5',
      'light: control-border on accent-soft < 3.5',
      'dark: text-tertiary on surface-hover < 4.5',
      'dark: text-tertiary on surface-selected < 4.5',
      'dark: on-accent on accent-hover < 4.5',
    ]);
  });

  it('catches the selected row pairs that missed in artifact version 12', () => {
    const missed = failures(withValues(tokens.color, VERSION_12)).map((line) => line.replace(/ \d+\.\d+ </, ' <'));
    expect(missed).toEqual([
      'light: control-border on surface-selected < 3.5',
      'light: control-border on accent-soft < 3.5',
      'dark: control-border on surface-selected < 3.5',
      'dark: accent-line on surface-selected < 3',
    ]);
  });

  it('fails a pair whose colour has alpha or is a function, naming it', () => {
    const color = withValues(tokens.color, { link: { light: '#245bc2cc' }, surface: { dark: 'oklch(0.2 0 0)' } });
    const problems = checkContrast(color).filter((check) => check.problem !== undefined);
    expect(problems.some((check) => check.foreground === 'link' && check.theme === 'light')).toBe(true);
    expect(problems.some((check) => check.background === 'surface' && check.theme === 'dark')).toBe(true);
  });

  it('follows an alias to the colour it names', () => {
    const color = withValues(tokens.color, { link: { light: '{text}' } });
    expect(resolveColor(color, 'link', 'light')).toBe(resolveColor(color, 'text', 'light'));
  });

  it('computes WCAG 2 ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#fff')).toBe(1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('focus shadows', () => {
  it('draw the halo in the focus-ring colour of each theme', () => {
    const shadow = ShadowFamily.parse(tokens.shadow);
    const focus = shadow.tokens.find((token) => token.name === 'shadow-focus');
    const ring = tokens.color.tokens.find((token) => token.name === 'focus-ring');
    expect(focus, 'shadow-focus').toBeDefined();
    for (const theme of ['light', 'dark'] as const) {
      const ringValue = typeof ring?.value === 'string' ? ring.value : ring?.value[theme];
      const focusValue = typeof focus?.value === 'string' ? focus.value : focus?.value[theme];
      expect(ringValue).toBeDefined();
      expect(focusValue).toContain(ringValue);
    }
  });
});
