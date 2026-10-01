// The Vite settings every consumer of the library shares: apps/web, Storybook
// and the artifact build. One place decides how CSS module classes are named,
// so dev tools, screenshots and the artifact all show the same names.
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

/** The library's Vite plugin: CSS module class names as `ws-<component>-<local>`. */
export function uiVite(): Plugin {
  return {
    name: 'crm-ui',
    config: () => ({ css: { modules: { generateScopedName: scopedClassName } } }),
  };
}
