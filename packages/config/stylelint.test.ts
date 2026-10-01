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
        --tile-bg: var(--tag-blue-bg);
        color: var(--text);
        background-color: transparent;
        padding: var(--space-2) calc(var(--space-4) * 2);
        margin: 0 auto;
        border-radius: var(--radius-md);
        transition: opacity var(--duration-popover) var(--ease-out);
        z-index: var(--z-popover);
        opacity: var(--opacity-disabled);
        scale: var(--scale-press);
        font: var(--text-body);
        box-shadow: var(--shadow-primary), var(--shadow-focus);
        letter-spacing: var(--tracking-body);
        inline-size: 100%;
      }
      .root .icon { color: currentColor; opacity: 0; scale: 1; }
      .primary { composes: root; }
      .tile { background: var(--tile-bg); }
      @container (width < 480px) { .root { gap: var(--space-4); } }
      @media (hover: hover) and (pointer: fine) { .root { color: var(--text-secondary); } }
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
    [
      'a raw shadow stacked on a token',
      '.root { box-shadow: var(--shadow-md), 0 0 0 3px blue; }',
      'scale-unlimited/declaration-strict-value',
    ],
    ['a raw opacity', '.root { opacity: 0.5; }', 'scale-unlimited/declaration-strict-value'],
    ['a raw scale', '.root { scale: 0.97; }', 'scale-unlimited/declaration-strict-value'],
    ['a raw line height of 1', '.root { line-height: 1; }', 'scale-unlimited/declaration-strict-value'],
    ['an unknown token', '.root { color: var(--colour-text); }', 'csstools/value-no-unknown-custom-properties'],
    [
      'a renamed token',
      '.root { transition-duration: var(--duration-fast); }',
      'csstools/value-no-unknown-custom-properties',
    ],
    [
      'a container size that is not a token',
      '.root { } @container (width < 400px) { .root { gap: 0; } }',
      'crm/breakpoint-tokens',
    ],
    ['an off by one page breakpoint', '@media (max-width: 1023.98px) { .root { gap: 0; } }', 'crm/breakpoint-tokens'],
    ['a breakpoint in rem', '@media (min-width: 64rem) { .root { gap: 0; } }', 'crm/breakpoint-tokens'],
    ['calc() in a condition', '@media (width < calc(1024px - 1px)) { .root { gap: 0; } }', 'crm/breakpoint-tokens'],
    [
      'a page breakpoint in a container query',
      '@container (width < 1024px) { .root { gap: 0; } }',
      'crm/breakpoint-tokens',
    ],
    ['a system colour outside forced colours', '.root { outline: 2px solid Highlight; }', 'crm/system-colors'],
    [
      'a system colour in another media query',
      '@media (prefers-contrast: more) { .root { border-color: CanvasText; } }',
      'crm/system-colors',
    ],
  ])('refuses %s', async (_name, code, rule) => {
    const { rules } = await lintCss(code);
    expect(rules).toContain(rule);
  });

  it('refuses !important', async () => {
    const { rules } = await lintCss('.root { color: var(--text) !important; }');
    expect(rules).toContain('declaration-no-important');
  });

  it.each([
    ['an id selector', '#main { color: var(--text); }', 'selector-max-id'],
    ['a global selector', ':global(.app) { color: var(--text); }', 'selector-pseudo-class-disallowed-list'],
    ['a descendant chain two levels deep', '.root .a .b { color: var(--text); }', 'selector-max-compound-selectors'],
  ])('refuses %s, which reaches outside the component', async (_name, code, rule) => {
    const { rules } = await lintCss(code);
    expect(rules).toContain(rule);
  });

  it('refuses element selectors in a component module, but allows them in a reset', async () => {
    const component = await lintCss('button { color: var(--text); }');
    const reset = await lintCss('button { color: inherit; }', 'packages/ui/src/reset.css');
    expect(component.rules).toContain('selector-max-type');
    expect(reset.rules).not.toContain('selector-max-type');
  });

  it('leaves packages/tokens alone, since it defines the raw values', async () => {
    const { ignored } = await lintCss(':root { --color-text: #1a1a1a; }', 'packages/tokens/src/tokens.css');
    expect(ignored).toBe(true);
  });

  it.each([
    ['the range form', '@media (width < 1024px) { .root { gap: 0; } }'],
    ['min-width', '@media (min-width: 1024px) { .root { gap: 0; } }'],
    ['a container token', '@container (width >= 320px) { .root { gap: 0; } }'],
    ['a named container', '@container panel (width < 480px) { .root { gap: 0; } }'],
    ['a condition with no length', '@media (prefers-reduced-motion: reduce) { .root { scale: none; } }'],
    [
      'system colours inside forced colours',
      '@media (forced-colors: active) { .root { outline: var(--border-width-thick) solid Highlight; color: GrayText; } }',
    ],
  ])('allows %s', async (_name, code) => {
    const { rules } = await lintCss(code);
    expect(rules).toEqual([]);
  });

  it('gives the same answer from inside a workspace folder', async () => {
    const { results } = await stylelint.lint({
      code: '.root { color: var(--text); } .bad { color: var(--duration-fast); }',
      codeFilename: path.join(REPO_ROOT, COMPONENT),
      config: stylelintConfig,
      cwd: path.join(REPO_ROOT, 'packages/ui'),
    });
    expect(results[0]?.warnings.map((warning) => warning.rule)).toEqual([
      'csstools/value-no-unknown-custom-properties',
    ]);
  });
});
