// CSS module classes come out as ws-<component>-<local>, the same in the app,
// Storybook and the artifact (AC-17).
import { describe, expect, it } from 'vitest';
import { scopedClassName, uiVite } from './vite.ts';

describe('scopedClassName', () => {
  it('names a class after its component and its local name', () => {
    expect(scopedClassName('root', '/repo/packages/ui/src/atoms/Button/Button.module.css')).toBe('ws-button-root');
  });

  it('turns camel case into kebab case on both sides', () => {
    expect(scopedClassName('iconOnly', '/x/SplitButton.module.css')).toBe('ws-split-button-icon-only');
    expect(scopedClassName('value', '/x/fields/currency/CurrencyDisplay.module.css')).toBe('ws-currency-display-value');
  });

  it('ignores a query string and Windows separators', () => {
    expect(scopedClassName('tile', 'C:\\repo\\Icon.module.css?direct')).toBe('ws-icon-tile');
  });
});

describe('uiVite', () => {
  it('hands the naming to Vite through css.modules', async () => {
    const hook = uiVite().config;
    const config = typeof hook === 'function' ? hook : hook?.handler;
    const result: unknown = await config?.call(undefined as never, {}, { command: 'build', mode: 'production' });
    expect(result).toEqual({ css: { modules: { generateScopedName: scopedClassName } } });
  });
});
