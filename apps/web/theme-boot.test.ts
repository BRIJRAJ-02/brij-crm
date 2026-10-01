// AC-7: theme-boot.js applies a saved Light or Dark choice before first paint,
// using the same key as the controller, and follows the OS for anything else.
// AC-11: it loads as a plain, blocking, same origin script, first in <head>.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { THEME_STORAGE_KEY } from '@crm/ui/theme';
import { describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const script = readFileSync(path.join(ROOT, 'public/theme-boot.js'), 'utf8');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Runs the boot script against a fake page, returning the data-theme it set and the keys it read. */
function boot(stored: Record<string, string>, { blocked = false } = {}) {
  const attributes = new Map<string, string>();
  const readKeys: string[] = [];
  const localStorage = {
    getItem: (key: string) => {
      if (blocked) throw new Error('SecurityError');
      readKeys.push(key);
      return stored[key] ?? null;
    },
  };
  const documentElement = { setAttribute: (name: string, value: string) => attributes.set(name, value) };
  runInNewContext(script, { window: { localStorage }, document: { documentElement } });
  return { theme: attributes.get('data-theme'), readKeys };
}

describe('theme-boot.js', () => {
  it.each(['light', 'dark'])('applies a saved %s choice', (choice) => {
    expect(boot({ [THEME_STORAGE_KEY]: choice }).theme).toBe(choice);
  });

  it('reads the same key the theme controller writes', () => {
    expect(boot({}).readKeys).toEqual([THEME_STORAGE_KEY]);
  });

  it.each([
    ['nothing saved', {}],
    ['an unknown value', { [THEME_STORAGE_KEY]: 'purple' }],
  ])('leaves the OS in charge with %s', (_name, stored) => {
    expect(boot(stored).theme).toBeUndefined();
  });

  it('does nothing, and never throws, when storage is blocked', () => {
    expect(() => boot({}, { blocked: true })).not.toThrow();
    expect(boot({}, { blocked: true }).theme).toBeUndefined();
  });
});

describe('index.html', () => {
  it('loads theme-boot.js as the first script in <head>, plain and blocking', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const scripts = [...head.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
    expect(scripts[0]).toBe('<script src="/theme-boot.js">');
  });
});
