// The Vite settings every consumer of the library shares: apps/web, Storybook
// and the artifact build. One place decides how CSS module classes are named,
// so dev tools, screenshots and the artifact all show the same names.
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** `SplitButton` → `split-button`, `iconOnly` → `icon-only`. */
function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * The class name for `local` in the CSS module at `filename`:
 * `ws-<component>-<local>`, where the component comes from the file name
 * (`Button.module.css` gives `button`, `CurrencyDisplay.module.css` gives
 * `currency-display`). Names carry no hash, so component names must be unique
 * across the library (`pnpm house-rules` checks it).
 */
export function scopedClassName(local: string, filename: string): string {
  const file = filename.split('?')[0]?.split(/[\\/]/).pop() ?? '';
  const component = file.replace(/\.module\.css$/, '');
  return `ws-${kebab(component)}-${kebab(local)}`;
}

/**
 * Names in `process.env` React Aria reads besides NODE_ENV. The browser has no
 * `process`, so each is replaced at build time (its Virtualizer checks
 * `VIRT_ON` for debug logging).
 */
export const LIBRARY_DEFINES: Readonly<Record<string, string>> = { 'process.env.VIRT_ON': 'undefined' };

/** The library's Vite plugin: CSS module class names as `ws-<component>-<local>`, and the defines React Aria needs. */
export function uiVite(): Plugin {
  return {
    name: 'crm-ui',
    // A define the config already sets wins (the tests turn VIRT_ON on).
    config: (user) => ({
      css: { modules: { generateScopedName: scopedClassName } },
      define: { ...LIBRARY_DEFINES, ...user.define },
    }),
  };
}

/** The library's root stylesheet, which declares the cascade layer order first. */
const ROOT_STYLESHEET = new URL('./styles/index.css', import.meta.url);

/** Where `layerOrder()` publishes the layer order, beside index.html. */
export const LAYER_ORDER_FILE = 'layers.css';

/** The `@layer …;` order statement in a stylesheet. Throws if it has none. */
export function layerOrderStatement(css: string): string {
  const match = /^@layer\s+[\w\s,-]+;/m.exec(css);
  if (match === null) throw new Error('The root stylesheet declares no @layer order.');
  return match[0];
}

/** `html` with the layer order linked just before its first stylesheet, or at the end of its head. */
export function linkLayerOrder(html: string, base: string): string {
  const link = `<link rel="stylesheet" href="${base}${LAYER_ORDER_FILE}">`;
  const first = html.search(/<link[^>]+rel="stylesheet"/);
  if (first === -1) return html.replace('</head>', `  ${link}\n  </head>`);
  return `${html.slice(0, first)}${link}\n    ${html.slice(first)}`;
}

/**
 * For an app's index.html: the root stylesheet's layer order as a file of its
 * own, linked ahead of every bundled stylesheet. Browsers order layers by first
 * appearance, the minifier drops the order statement, and Vite links a shared
 * chunk's CSS (component modules) before the entry's (the reset), so the bundle
 * alone can't keep the order.
 */
export function layerOrder(): Plugin {
  const source = `${layerOrderStatement(readFileSync(ROOT_STYLESHEET, 'utf8'))}\n`;
  let base = '/';
  return {
    name: 'crm-ui-layer-order',
    configResolved: (config) => {
      base = config.base;
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.url !== `${base}${LAYER_ORDER_FILE}`) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'text/css');
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LAYER_ORDER_FILE, source });
    },
    transformIndexHtml: { order: 'post', handler: (html) => linkLayerOrder(html, base) },
  };
}
