// AC-4 (spec 0002) and AC-12 (spec 0071): every pair the components draw meets
// its minimum in both themes, on tokens.json plus legacy.json's colours. The
// fixture puts back the prototype's published values before spec 0071's
// lightness moves, proving the test catches the pairs that missed then.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContrast, contrastRatio, resolveColor, type ContrastCheck } from './contrast.ts';
import { type ColorFamily, LegacyFile, TokensFile } from './grammar.ts';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const source = TokensFile.parse(JSON.parse(readFileSync(path.join(PACKAGE, 'tokens.json'), 'utf8')));
const legacy = LegacyFile.parse(JSON.parse(readFileSync(path.join(PACKAGE, 'legacy.json'), 'utf8')));
/** The colours the app draws with: the source's, then legacy's. */
const tokens = {
  color: { ...source.color, tokens: [...source.color.tokens, ...(legacy.color?.tokens ?? [])] },
};

/** The prototype's published values (Timefix design system v55) of the tokens spec 0071 moved for contrast. */
const PROTOTYPE: Record<string, Partial<Record<'light' | 'dark', string>>> = {
  'text-tertiary': { light: '#6b6b74', dark: '#8b8b94' },
  danger: { light: '#d0312d' },
  success: { light: '#12805c' },
  warning: { light: '#a15c00' },
  'control-border': { light: '#8a8a93', dark: '#6e6e78' },
};

function withValues(color: ColorFamily, values: typeof PROTOTYPE): ColorFamily {
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
    expect(checkContrast(tokens.color)).toHaveLength(182);
  });

  it("catches the pairs the prototype's published colours missed (spec 0071)", () => {
    const missed = failures(withValues(tokens.color, PROTOTYPE)).map((line) => line.replace(/ \d+\.\d+ </, ' <'));
    expect(missed).toHaveLength(25);
    expect(missed).toContain('light: control-border on surface < 3.5');
    expect(missed).toContain('light: text-tertiary on surface-selected < 4.5');
    expect(missed).toContain('dark: control-border on surface-selected < 3.5');
    expect(missed).toContain('light: success on success-soft < 4.5');
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
  it('draw a surface gap, then the solid focus-ring colour, in each theme (spec 0071)', () => {
    const shadows = legacy.shadow?.tokens ?? [];
    const ring = tokens.color.tokens.find((token) => token.name === 'focus-ring');
    for (const name of ['shadow-focus', 'shadow-focus-inset']) {
      const focus = shadows.find((token) => token.name === name);
      expect(focus, name).toBeDefined();
      for (const theme of ['light', 'dark'] as const) {
        const ringValue = typeof ring?.value === 'string' ? ring.value : ring?.value[theme];
        const focusValue = typeof focus?.value === 'string' ? focus.value : focus?.value[theme];
        expect(ringValue).toBeDefined();
        expect(focusValue).toContain(` ${ringValue ?? ''}`);
      }
    }
  });
});
