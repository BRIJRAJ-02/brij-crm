// CSS module classes come out as ws-<component>-<local>, the same in the app,
// Storybook and the artifact (AC-17).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIRST_SCREEN_FONTS,
  layerOrderStatement,
  linkFontPreloads,
  linkLayerOrder,
  numberLucideKeys,
  scopedClassName,
  uiVite,
} from './vite.ts';

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

describe('numberLucideKeys', () => {
  const icon = '["path", { d: "M16 14v.5", key: "1lajdz" }],\n["circle", { cx: "12", key: "w7jh35" }]';

  it("numbers a Lucide icon's shape keys in order, leaving the shapes as they were", () => {
    expect(numberLucideKeys(icon, '/repo/node_modules/lucide-react/dist/esm/icons/dog.mjs')).toBe(
      '["path", { d: "M16 14v.5", key: "0" }],\n["circle", { cx: "12", key: "1" }]',
    );
  });

  it('leaves every other module alone', () => {
    expect(numberLucideKeys(icon, '/repo/node_modules/lucide-react/dist/esm/Icon.mjs')).toBeUndefined();
    expect(numberLucideKeys(icon, '/repo/packages/ui/src/atoms/Icon/icons.ts')).toBeUndefined();
  });
});

describe('uiVite', () => {
  it('hands the naming to Vite through css.modules, with the defines React Aria needs', async () => {
    const hook = uiVite().config;
    const config = typeof hook === 'function' ? hook : hook?.handler;
    const result: unknown = await config?.call(undefined as never, {}, { command: 'build', mode: 'production' });
    expect(result).toEqual({
      css: { modules: { generateScopedName: scopedClassName } },
      define: { 'process.env.VIRT_ON': 'undefined' },
    });
  });
});

describe('layerOrder', () => {
  it('takes the order the root stylesheet declares', () => {
    const css = readFileSync(new URL('./styles/index.css', import.meta.url), 'utf8');
    expect(layerOrderStatement(css)).toBe('@layer reset, tokens, base, components, utilities;');
    expect(() => layerOrderStatement('.a { color: red; }')).toThrow(/no @layer order/);
  });

  it('links it before the first stylesheet, after any script ahead of it', () => {
    const html = [
      '<head>',
      '<script src="/theme-boot.js"></script>',
      '<link rel="stylesheet" href="/assets/shared.css">',
      '<link rel="stylesheet" href="/assets/index.css">',
      '</head>',
    ].join('\n');
    const linked = linkLayerOrder(html, '/');
    expect(linked.indexOf('/layers.css')).toBeGreaterThan(linked.indexOf('theme-boot.js'));
    expect(linked.indexOf('/layers.css')).toBeLessThan(linked.indexOf('/assets/shared.css'));
  });

  it('links it at the end of the head when the page has no stylesheet yet (the dev server)', () => {
    expect(linkLayerOrder('<head><title>CRM</title></head>', '/app/')).toContain(
      '<link rel="stylesheet" href="/app/layers.css" id="react-aria-pressable-style">\n  </head>',
    );
  });
});

describe('font preloads', () => {
  it('preloads Inter, the face the first screen draws with, and never the code face', () => {
    const built = [
      'assets/Inter-Variable-latin-Bx3k9.woff2',
      'assets/JetBrainsMono-Variable-latin-Q1.woff2',
      'assets/index-a1.js',
    ];
    expect(built.filter((file) => FIRST_SCREEN_FONTS.some((font) => font.test(file)))).toEqual([
      'assets/Inter-Variable-latin-Bx3k9.woff2',
    ]);
  });

  it('links each one ahead of the first stylesheet, fetched as a font the way the stylesheet fetches it', () => {
    const html = '<head>\n    <link rel="stylesheet" href="/layers.css">\n  </head>';
    expect(linkFontPreloads(html, '/', ['assets/Inter-Variable-latin-Bx3k9.woff2'])).toBe(
      '<head>\n    <link rel="preload" href="/assets/Inter-Variable-latin-Bx3k9.woff2" as="font" type="font/woff2" crossorigin>\n    <link rel="stylesheet" href="/layers.css">\n  </head>',
    );
    expect(linkFontPreloads('<head></head>', '/app/', ['assets/a.woff2'])).toBe(
      '<head>  <link rel="preload" href="/app/assets/a.woff2" as="font" type="font/woff2" crossorigin>\n  </head>',
    );
    expect(linkFontPreloads(html, '/', [])).toBe(html);
  });
});
