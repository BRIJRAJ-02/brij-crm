// Locks in the CSS house rules: tokens only, no !important, and styles that
// stay inside their own component.
import path from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import { stylelintConfig } from './stylelint.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const COMPONENT = 'packages/ui/src/Button/Button.module.css';

async function lintCss(code: string, file = COMPONENT): Promise<{ rules: string[]; ignored: boolean }> {
  const { results } = await stylelint.lint({
    code,
    codeFilename: path.join(REPO_ROOT, file),
    config: stylelintConfig,
    cwd: REPO_ROOT,
  });
  const [result] = results;
  return { rules: result?.warnings.map((warning) => warning.rule) ?? [], ignored: result?.ignored === true };
}

describe('stylelint house rules', () => {
  it('passes a component styled only with tokens', async () => {
    const { rules } = await lintCss(`
      .root {
        color: var(--color-text);
        background-color: transparent;
        padding: var(--space-2) calc(var(--space-3) * 2);
        margin: 0 auto;
        border-radius: var(--radius-md);
        transition: opacity var(--duration-menu) var(--ease-out);
        z-index: var(--layer-menu);
        font-weight: var(--font-weight-medium);
        inline-size: 100%;
      }
      .root .icon { color: currentColor; }
      .primary { composes: root; }
      @container (inline-size > 40cqi) { .root { gap: var(--space-1); } }
    `);
    expect(rules).toEqual([]);
  });

  it.each([
    ['a hex colour', '.root { color: #fff; }', 'color-no-hex'],
    ['a named colour', '.root { color: red; }', 'color-named'],
    ['an rgb() colour', '.root { color: rgb(0 0 0); }', 'function-disallowed-list'],
    ['raw spacing', '.root { padding: 8px; }', 'unit-disallowed-list'],
    ['a raw radius', '.root { border-radius: 4px; }', 'unit-disallowed-list'],
    ['a raw duration', '.root { transition: opacity 200ms; }', 'unit-disallowed-list'],
    ['a raw curve', '.root { transition-timing-function: cubic-bezier(0.2, 0, 0, 1); }', 'function-disallowed-list'],
    ['a raw z-index', '.root { z-index: 10; }', 'scale-unlimited/declaration-strict-value'],
    ['a raw font weight', '.root { font-weight: 600; }', 'scale-unlimited/declaration-strict-value'],
    ['a raw shadow', '.root { box-shadow: 0 1px 2px black; }', 'scale-unlimited/declaration-strict-value'],
  ])('refuses %s', async (_name, code, rule) => {
    const { rules } = await lintCss(code);
    expect(rules).toContain(rule);
  });

  it('refuses !important', async () => {
    const { rules } = await lintCss('.root { color: var(--color-text) !important; }');
    expect(rules).toContain('declaration-no-important');
  });

  it.each([
    ['an id selector', '#main { color: var(--color-text); }', 'selector-max-id'],
    ['a global selector', ':global(.app) { color: var(--color-text); }', 'selector-pseudo-class-disallowed-list'],
    [
      'a descendant chain two levels deep',
      '.root .a .b { color: var(--color-text); }',
      'selector-max-compound-selectors',
    ],
  ])('refuses %s, which reaches outside the component', async (_name, code, rule) => {
    const { rules } = await lintCss(code);
    expect(rules).toContain(rule);
  });

  it('refuses element selectors in a component module, but allows them in a reset', async () => {
    const component = await lintCss('button { color: var(--color-text); }');
    const reset = await lintCss('button { color: inherit; }', 'packages/ui/src/reset.css');
    expect(component.rules).toContain('selector-max-type');
    expect(reset.rules).not.toContain('selector-max-type');
  });

  it('leaves packages/tokens alone, since it defines the raw values', async () => {
    const { ignored } = await lintCss(':root { --color-text: #1a1a1a; }', 'packages/tokens/src/tokens.css');
    expect(ignored).toBe(true);
  });
});
